import { randomUUID } from "node:crypto";
import type { Prisma, SubscriptionInvoice } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { contractPlan } from "./contractTerms";
import { getGoPayCredentials, getSubscriptionPaymentConfig, paymentOrderId } from "./paymentConfig";
import { initializeGoPay, getGoPayStatus } from "./gopay";
import { subscriptionPaymentDescription } from "./checkoutDescription";
import {
  assertPaymentReceipt,
  freedomPayReceipt,
  goPayReceipt,
  type VerifiedPaymentReceipt,
} from "./paymentReceipt";
import { extendSubscriptionMonths, kgsToMinor } from "./paymentMath";
import { getFreedomPayStatus, initializeFreedomPay, scalar, type SignedFields } from "./freedomPay";
import type { PlanCode } from "@/lib/billing/plans";
import {
  EMPTY_SUBSCRIPTION_EXTRAS,
  subscriptionPrice,
  type SubscriptionMonths,
  type SubscriptionExtras,
} from "@/lib/billing/subscriptionPricing";
import { getOrganizationPlan } from "@/server/services/planLimits";
import { calculateSubscriptionQuote } from "./subscriptionQuotes";
import { readPurchaseSnapshot, verifyPurchaseQuote } from "./purchaseSnapshot";
import { LIFETIME_ORGANIZATION_IDS } from "./lifetimeOrganizations";
import { assertSubscriptionSelectionReady } from "./subscriptionPreparation";

const nowPlus = (milliseconds: number) => new Date(Date.now() + milliseconds);
const lockOrganization = async (tx: Prisma.TransactionClient, organizationId: string) => {
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
  return tx.organization.findUniqueOrThrow({
    where: { id: organizationId },
    include: { subscriptionContract: true },
  });
};

export const presentInvoice = (
  invoice: SubscriptionInvoice & { period?: { startsAt: Date; endsAt: Date } | null },
) => ({
  id: invoice.id,
  provider: invoice.provider,
  plan: invoice.plan,
  purchase: readPurchaseSnapshot(invoice.purchaseSnapshot),
  amountMinor: invoice.amountMinor,
  currency: invoice.currency,
  status: invoice.status,
  isTest: invoice.isTest,
  createdAt: invoice.createdAt,
  paidAt: invoice.paidAt,
  syncDelayed: invoice.lastIssue === "RECONCILIATION_REQUIRED",
  expiresAt: invoice.expiresAt,
  period: invoice.period,
  sellerName: invoice.sellerName,
  termsVersion: invoice.termsVersion,
  termsUrl: invoice.termsUrl,
  checkoutUrl:
    invoice.status === "PENDING" && invoice.expiresAt > new Date() ? invoice.checkoutUrl : null,
});

export const getSubscriptionPaymentState = async (organizationId: string) => {
  const config = getSubscriptionPaymentConfig();
  const [organization, pending, lastPeriod] = await Promise.all([
    getOrganizationPlan(organizationId),
    prisma.subscriptionInvoice.findFirst({
      where: { organizationId, OR: [{ pendingSlot: organizationId }, { status: "REVIEW" }] },
      orderBy: { createdAt: "desc" },
      include: { period: true },
    }),
    prisma.subscriptionPeriod.findFirst({ where: { organizationId }, orderBy: { endsAt: "desc" } }),
  ]);
  return {
    provider: config.provider,
    available: config.ready,
    mode: config.mode,
    sellerName: config.sellerName,
    termsUrl: config.termsUrl,
    termsVersion: config.termsVersion,
    billingMode: organization.subscriptionBillingMode,
    lifetimeAccess: organization.lifetimeAccess,
    catalogVersion: organization.billingCatalogVersion,
    currentExtras: organization.subscriptionExtras,
    currentMonths: organization.activePurchase?.months ?? 1,
    canChange: Boolean(organization.activeSubscriptionPeriod),
    paidUntil: organization.currentPeriodEndsAt,
    accountPaused: organization.subscriptionStatus === "CANCELED",
    canPurchase:
      config.ready &&
      organization.subscriptionBillingMode === "SELF_SERVE" &&
      !organization.lifetimeAccess &&
      organization.subscriptionStatus !== "CANCELED" &&
      !pending,
    currentPlan: organization.plan,
    mayChangePlan:
      !lastPeriod ||
      !organization.currentPeriodEndsAt ||
      organization.currentPeriodEndsAt <= new Date(),
    catalog: Object.values(organization.contractTerms.plans).map((entry) => ({
      plan: entry.code,
      amountMinor: kgsToMinor(entry.monthlyPriceKgs),
      limits: entry.limits,
      features: entry.features,
    })),
    pendingInvoice: pending ? presentInvoice(pending) : null,
  };
};

export const listSubscriptionInvoices = async (organizationId: string, cursor?: string) => {
  if (
    cursor &&
    !(await prisma.subscriptionInvoice.findFirst({
      where: { id: cursor, organizationId },
      select: { id: true },
    }))
  )
    throw new AppError("recordNotFound", "NOT_FOUND", 404);
  const records = await prisma.subscriptionInvoice.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 21,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { period: true },
  });
  return {
    items: records.slice(0, 20).map(presentInvoice),
    nextCursor: records.length > 20 ? records[19].id : undefined,
  };
};

export const createSubscriptionCheckout = async (input: {
  organizationId: string;
  actorId: string;
  plan: PlanCode;
  months?: SubscriptionMonths;
  extras?: SubscriptionExtras;
  action?: "RENEW" | "CHANGE";
  quoteToken?: string;
  idempotencyKey: string;
  termsVersion: string;
  expectedProvider?: "GOPAY" | "FREEDOMPAY";
  expectedAmountMinor: number;
  locale: string;
  requestId: string;
}) => {
  const config = getSubscriptionPaymentConfig();
  if (!config.ready) throw new AppError("billingPaymentsUnavailable", "CONFLICT", 409);
  if (input.expectedProvider && input.expectedProvider !== config.provider)
    throw new AppError("billingQuoteChanged", "CONFLICT", 409);
  const invoice = await prisma.$transaction(async (tx) => {
    const org = await lockOrganization(tx, input.organizationId);
    if (org.subscriptionContract?.lifetimeAccess || LIFETIME_ORGANIZATION_IDS.has(org.id))
      throw new AppError("billingLifetimeProtected", "FORBIDDEN", 403);
    if (org.subscriptionBillingMode !== "SELF_SERVE" || org.subscriptionStatus === "CANCELED")
      throw new AppError("billingManualAccessProtected", "CONFLICT", 409);
    const prior = await tx.subscriptionInvoice.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: org.id,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (prior) {
      const purchase = readPurchaseSnapshot(prior.purchaseSnapshot);
      const extras = input.extras ?? EMPTY_SUBSCRIPTION_EXTRAS;
      if (
        (purchase &&
          (purchase.months !== (input.months ?? 1) ||
            purchase.extras.stores !== extras.stores ||
            purchase.extras.productPacks !== extras.productPacks ||
            purchase.extras.userPacks !== extras.userPacks ||
            purchase.kind !== ((input.action ?? "RENEW") === "CHANGE" ? "UPGRADE" : "RENEWAL"))) ||
        prior.amountMinor !== input.expectedAmountMinor ||
        prior.plan !== input.plan ||
        prior.createdById !== input.actorId
      )
        throw new AppError("idempotencyConflict", "CONFLICT", 409);
      return { value: prior, initialize: false };
    }
    const pending = await tx.subscriptionInvoice.findFirst({
      where: { organizationId: org.id, OR: [{ pendingSlot: org.id }, { status: "REVIEW" }] },
    });
    if (pending)
      throw new AppError(
        pending.status === "REVIEW" ? "billingPaymentNeedsReview" : "billingPaymentPending",
        "CONFLICT",
        409,
      );
    if (input.termsVersion !== config.termsVersion)
      throw new AppError("billingTermsChanged", "CONFLICT", 409);
    const selection = {
      plan: input.plan,
      months: input.months ?? 1,
      extras: input.extras ?? EMPTY_SUBSCRIPTION_EXTRAS,
      action: input.action ?? "RENEW",
    } as const;
    const snapshot = input.quoteToken
      ? verifyPurchaseQuote(input.quoteToken, org.id)
      : await calculateSubscriptionQuote(org.id, selection, tx);
    const effective = await getOrganizationPlan(org.id, tx);
    await assertSubscriptionSelectionReady(
      effective,
      contractPlan(effective.contractTerms, input.plan, selection.extras),
      tx,
    );
    if (
      snapshot.plan !== input.plan ||
      snapshot.months !== selection.months ||
      snapshot.extras.stores !== selection.extras.stores ||
      snapshot.extras.productPacks !== selection.extras.productPacks ||
      snapshot.extras.userPacks !== selection.extras.userPacks ||
      snapshot.kind !== (selection.action === "CHANGE" ? "UPGRADE" : "RENEWAL") ||
      snapshot.catalogVersion !== effective.billingCatalogVersion ||
      snapshot.expectedPlan !== org.plan ||
      (snapshot.kind === "UPGRADE" &&
        snapshot.sourcePeriodId !== effective.activeSubscriptionPeriod?.id) ||
      snapshot.expectedPeriodEnd !== (org.currentPeriodEndsAt?.toISOString() ?? null)
    )
      throw new AppError("billingQuoteChanged", "CONFLICT", 409);
    if (
      snapshot.monthlyMinor !==
      subscriptionPrice(
        kgsToMinor(
          contractPlan(effective.contractTerms, input.plan, selection.extras).monthlyPriceKgs,
        ),
        snapshot.months,
        snapshot.extras,
      ).monthlyMinor
    )
      throw new AppError("billingPriceChanged", "CONFLICT", 409);
    const amountMinor = snapshot.amountMinor;
    if (input.expectedAmountMinor !== amountMinor)
      throw new AppError("billingPriceChanged", "CONFLICT", 409);
    const invoiceId = randomUUID().replaceAll("-", "");
    const created = await tx.subscriptionInvoice.create({
      data: {
        id: invoiceId,
        provider: config.provider,
        providerOrderId:
          config.provider === "GOPAY" ? paymentOrderId("subscription", invoiceId) : null,
        organizationId: org.id,
        createdById: input.actorId,
        idempotencyKey: input.idempotencyKey,
        pendingSlot: org.id,
        plan: input.plan,
        amountMinor,
        purchaseSnapshot: snapshot,
        merchantId: config.merchantId,
        isTest: config.mode === "sandbox",
        termsVersion: config.termsVersion,
        termsUrl: config.termsUrl,
        sellerName: config.sellerName,
        expiresAt: nowPlus(15 * 60_000),
        nextCheckAt: nowPlus(20_000),
        processingUntil: nowPlus(30_000),
      },
    });
    await writeAuditLog(tx, {
      organizationId: org.id,
      actorId: input.actorId,
      action: "SUBSCRIPTION_CHECKOUT_CREATE",
      entity: "SubscriptionInvoice",
      entityId: created.id,
      after: {
        plan: created.plan,
        amountMinor: created.amountMinor,
        currency: created.currency,
        isTest: created.isTest,
        termsVersion: created.termsVersion,
      },
      requestId: input.requestId,
    });
    return { value: created, initialize: true };
  });
  if (!invoice.initialize) return presentInvoice(invoice.value);
  // Persist before calling the provider. An uncertain result must be reconciled
  // by our unique order id, never by blindly creating a second payment.
  try {
    const result =
      invoice.value.provider === "GOPAY"
        ? {
            accepted: true as const,
            ...(await initializeGoPay(
              {
                orderId: invoice.value.providerOrderId!,
                amountMinor: invoice.value.amountMinor,
                description: subscriptionPaymentDescription({
                  ...invoice.value,
                  locale: input.locale,
                }),
                isTest: invoice.value.isTest,
                ...(config.publicOrigin.startsWith("https:")
                  ? { returnUrl: `${config.publicOrigin}/billing` }
                  : {}),
                lifetimeSeconds: 900,
              },
              getGoPayCredentials(invoice.value.merchantId),
            )),
          }
        : await initializeFreedomPay({ ...invoice.value, locale: input.locale });
    await prisma.subscriptionInvoice.updateMany({
      where: { id: invoice.value.id, status: "CREATING" },
      data: result.accepted
        ? {
            providerPaymentId: result.paymentId,
            checkoutUrl: result.checkoutUrl,
            status: "PENDING",
            processingUntil: null,
          }
        : {
            status: "FAILED",
            pendingSlot: null,
            processingUntil: null,
            lastIssue: "PROVIDER_REJECTED",
          },
    });
  } catch {
    await prisma.subscriptionInvoice.updateMany({
      where: { id: invoice.value.id, status: "CREATING" },
      data: {
        lastIssue: "INITIALIZATION_UNKNOWN",
        processingUntil: null,
        nextCheckAt: nowPlus(15_000),
      },
    });
  }
  return presentInvoice(
    await prisma.subscriptionInvoice.findUniqueOrThrow({
      where: { id: invoice.value.id },
      include: { period: true },
    }),
  );
};

const sameAmount = (fields: SignedFields, amount: number) => {
  try {
    return kgsToMinor(scalar(fields, "pg_amount") ?? "") === amount;
  } catch {
    return false;
  }
};
export const applyVerifiedPayment = async (input: {
  invoiceId: string;
  fields: SignedFields;
  source: "CALLBACK" | "RECONCILIATION";
}) => {
  const invoice = await prisma.subscriptionInvoice.findUnique({ where: { id: input.invoiceId } });
  if (!invoice) throw new AppError("recordNotFound", "NOT_FOUND", 404);
  return applySubscriptionReceipt({
    invoiceId: invoice.id,
    source: input.source,
    receipt: freedomPayReceipt(invoice, input.fields, input.source),
  });
};

export const applySubscriptionReceipt = async (input: {
  invoiceId: string;
  receipt: VerifiedPaymentReceipt;
  source: "CALLBACK" | "RECONCILIATION";
}) => {
  const seed = await prisma.subscriptionInvoice.findUnique({ where: { id: input.invoiceId } });
  if (!seed) throw new AppError("recordNotFound", "NOT_FOUND", 404);
  return prisma.$transaction(async (tx) => {
    const org = await lockOrganization(tx, seed.organizationId);
    const invoice = await tx.subscriptionInvoice.findUniqueOrThrow({ where: { id: seed.id } });
    assertPaymentReceipt(invoice, input.receipt);
    const { paymentId, state, eventKey: key } = input.receipt;
    const refunded = state === "REFUND_REVIEW",
      settled = state === "PAID",
      failed = state === "FAILED" || state === "EXPIRED";
    const exists = await tx.subscriptionPaymentEvent.findUnique({
      where: { deduplicationKey: key },
      select: { id: true },
    });
    if (!exists)
      await tx.subscriptionPaymentEvent.create({
        data: {
          invoiceId: invoice.id,
          deduplicationKey: key,
          source: input.source,
          state,
          payloadDigest: input.receipt.payloadDigest,
        },
      });
    const update = {
      providerPaymentId: paymentId,
      nextCheckAt: nowPlus(30_000),
      lastIssue: null,
      ...(input.receipt.checkoutUrl ? { checkoutUrl: input.receipt.checkoutUrl } : {}),
    };
    if (
      invoice.status === "RESOLVED" ||
      (invoice.status === "REVIEW" && invoice.lastIssue === "REFUND_REVIEW" && !refunded)
    )
      return invoice;
    if (invoice.status === "PAID" && !refunded) return invoice;
    if (
      refunded ||
      (settled &&
        (org.subscriptionBillingMode !== "SELF_SERVE" ||
          org.subscriptionStatus === "CANCELED" ||
          org.subscriptionContract?.lifetimeAccess ||
          LIFETIME_ORGANIZATION_IDS.has(org.id)))
    ) {
      return tx.subscriptionInvoice.update({
        where: { id: invoice.id },
        data: {
          ...update,
          status: "REVIEW",
          lastIssue: refunded ? "REFUND_REVIEW" : "ACCESS_CHANGED",
        },
      });
    }
    if (settled) {
      const priorPeriod = await tx.subscriptionPeriod.findUnique({
        where: { invoiceId: invoice.id },
      });
      if (priorPeriod)
        return tx.subscriptionInvoice.update({
          where: { id: invoice.id },
          data: { ...update, status: "PAID", pendingSlot: null },
        });
      const now = new Date();
      const purchase = readPurchaseSnapshot(invoice.purchaseSnapshot);
      const effective = await getOrganizationPlan(org.id, tx);
      if (purchase?.entitlements) {
        try {
          await assertSubscriptionSelectionReady(effective, purchase.entitlements, tx);
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          return tx.subscriptionInvoice.update({
            where: { id: invoice.id },
            data: { ...update, status: "REVIEW", lastIssue: "ACCESS_CHANGED" },
          });
        }
      }
      if (
        purchase &&
        (purchase.expectedPlan !== org.plan ||
          purchase.expectedPeriodEnd !== (org.currentPeriodEndsAt?.toISOString() ?? null) ||
          (purchase.kind === "UPGRADE" &&
            (effective.activeSubscriptionPeriod?.id !== purchase.sourcePeriodId ||
              new Date(purchase.endsAt) <= now)))
      )
        return tx.subscriptionInvoice.update({
          where: { id: invoice.id },
          data: { ...update, status: "REVIEW", lastIssue: "ACCESS_CHANGED" },
        });
      // Pre-v2 invoices keep their original one-month grant semantics.
      if (!purchase) {
        const anyPeriod = await tx.subscriptionPeriod.findFirst({
          where: { organizationId: org.id },
          select: { id: true },
        });
        if (
          anyPeriod &&
          org.currentPeriodEndsAt &&
          org.currentPeriodEndsAt > now &&
          org.plan !== invoice.plan
        )
          return tx.subscriptionInvoice.update({
            where: { id: invoice.id },
            data: { ...update, status: "REVIEW", lastIssue: "PLAN_CHANGED" },
          });
      }
      const startsAt =
        purchase?.kind === "UPGRADE"
          ? new Date(purchase.startsAt)
          : new Date(
              Math.max(
                now.getTime(),
                org.currentPeriodEndsAt?.getTime() ?? 0,
                org.trialEndsAt?.getTime() ?? 0,
              ),
            );
      const anchorDay =
        purchase?.kind === "UPGRADE"
          ? purchase.anchorDay
          : org.currentPeriodEndsAt?.getTime() === startsAt.getTime() && org.billingAnchorDay
            ? org.billingAnchorDay
            : startsAt.getUTCDate();
      const endsAt =
        purchase?.kind === "UPGRADE"
          ? new Date(purchase.endsAt)
          : extendSubscriptionMonths(startsAt, anchorDay, purchase?.months ?? 1);
      const grantedPurchase = purchase
        ? {
            ...purchase,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            ...(purchase.kind === "RENEWAL"
              ? {
                  cycleStartsAt: startsAt.toISOString(),
                  cycleEndsAt: endsAt.toISOString(),
                  anchorDay,
                }
              : {}),
          }
        : undefined;
      const hasPriorPeriod = await tx.subscriptionPeriod.findFirst({
        where: { organizationId: org.id },
        select: { id: true },
      });
      await tx.subscriptionPeriod.create({
        data: {
          invoiceId: invoice.id,
          organizationId: org.id,
          plan: invoice.plan,
          startsAt,
          endsAt,
          ...(grantedPurchase ? { purchaseSnapshot: grantedPurchase } : {}),
        },
      });
      await tx.organization.update({
        where: { id: org.id },
        data: {
          plan: startsAt <= now || !hasPriorPeriod ? invoice.plan : org.plan,
          subscriptionStatus: "ACTIVE",
          currentPeriodEndsAt: endsAt,
          billingAnchorDay: anchorDay,
        },
      });
      await writeAuditLog(tx, {
        organizationId: org.id,
        actorId: null,
        action: "SUBSCRIPTION_PAYMENT_CONFIRMED",
        entity: "SubscriptionInvoice",
        entityId: invoice.id,
        after: {
          amountMinor: invoice.amountMinor,
          currency: "KGS",
          plan: invoice.plan,
          periodStartsAt: startsAt.toISOString(),
          periodEndsAt: endsAt.toISOString(),
          isTest: invoice.isTest,
        },
        requestId: `payment:${invoice.id}`,
      });
      return tx.subscriptionInvoice.update({
        where: { id: invoice.id },
        data: { ...update, status: "PAID", paidAt: now, pendingSlot: null, lastIssue: null },
      });
    }
    if (invoice.status === "REVIEW" || ["FAILED", "EXPIRED"].includes(invoice.status))
      return invoice;
    return tx.subscriptionInvoice.update({
      where: { id: invoice.id },
      data: {
        ...update,
        ...(failed
          ? {
              status: state === "EXPIRED" ? "EXPIRED" : "FAILED",
              pendingSlot: null,
              lastIssue: null,
            }
          : { status: "PENDING" }),
      },
    });
  });
};

export const checkSubscriptionInvoice = async (organizationId: string, invoiceId: string) => {
  const invoice = await prisma.subscriptionInvoice.findFirst({
    where: { id: invoiceId, organizationId },
  });
  if (!invoice) throw new AppError("recordNotFound", "NOT_FOUND", 404);
  const now = new Date();
  const processingToken = randomUUID();
  const claimed = await prisma.subscriptionInvoice.updateMany({
    where: {
      id: invoice.id,
      nextCheckAt: { lte: now },
      OR: [{ processingUntil: null }, { processingUntil: { lt: now } }],
    },
    data: { processingToken, processingUntil: nowPlus(30_000), nextCheckAt: nowPlus(20_000) },
  });
  let checkFailed = false;
  if (claimed.count) {
    try {
      if (invoice.provider === "GOPAY") {
        if (!invoice.providerOrderId) throw new Error("Missing payment order identity");
        const payment = await getGoPayStatus(
          {
            orderId: invoice.providerOrderId,
            providerPaymentId: invoice.providerPaymentId ?? undefined,
            isTest: invoice.isTest,
          },
          getGoPayCredentials(invoice.merchantId),
        );
        await applySubscriptionReceipt({
          invoiceId: invoice.id,
          source: "RECONCILIATION",
          receipt: goPayReceipt(invoice, payment),
        });
      } else {
        const fields = await getFreedomPayStatus(invoice);
        if (scalar(fields, "pg_status") !== "ok") throw new Error("Unconfirmed provider status");
        {
          // The documented get_status3 not-found result uses payment_id=0. Give
          // initialization at least one minute before treating it as absent.
          if (
            scalar(fields, "pg_payment_id") === "0" &&
            !invoice.providerPaymentId &&
            invoice.createdAt < new Date(Date.now() - 60_000)
          ) {
            await prisma.subscriptionInvoice.updateMany({
              where: { id: invoice.id, status: "CREATING", processingToken },
              data: { status: "FAILED", pendingSlot: null, lastIssue: "PAYMENT_NOT_CREATED" },
            });
          } else
            await applyVerifiedPayment({ invoiceId: invoice.id, fields, source: "RECONCILIATION" });
        }
      }
    } catch (error) {
      if (
        invoice.provider === "GOPAY" &&
        !invoice.providerPaymentId &&
        invoice.status === "CREATING" &&
        invoice.createdAt < new Date(Date.now() - 60_000) &&
        error instanceof AppError &&
        error.details?.providerCode === "4041"
      ) {
        await prisma.subscriptionInvoice.updateMany({
          where: { id: invoice.id, status: "CREATING", processingToken },
          data: { status: "FAILED", pendingSlot: null, lastIssue: "PAYMENT_NOT_CREATED" },
        });
      } else {
        checkFailed = true;
        await prisma.subscriptionInvoice.updateMany({
          where: { id: invoice.id, processingToken, status: { in: ["CREATING", "PENDING"] } },
          data: { lastIssue: "RECONCILIATION_REQUIRED" },
        });
      }
    } finally {
      const latest = await prisma.subscriptionInvoice.findUniqueOrThrow({
        where: { id: invoice.id },
        select: { status: true },
      });
      const delay =
        latest.status === "PAID"
          ? 15 * 60_000
          : ["FAILED", "EXPIRED", "REVIEW", "RESOLVED"].includes(latest.status)
            ? 60 * 60_000
            : 30_000;
      await prisma.subscriptionInvoice.updateMany({
        where: { id: invoice.id, processingToken },
        data: { processingUntil: null, processingToken: null, nextCheckAt: nowPlus(delay) },
      });
    }
  }
  const result = presentInvoice(
    await prisma.subscriptionInvoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: { period: true },
    }),
  );
  return { ...result, syncDelayed: checkFailed || result.syncDelayed };
};

export const verifyInvoiceCanBePaid = async (invoiceId: string, fields: SignedFields) => {
  const seed = await prisma.subscriptionInvoice.findUnique({
    where: { id: invoiceId },
    select: { organizationId: true },
  });
  if (!seed) throw new AppError("billingPaymentMismatch", "CONFLICT", 409);
  return prisma.$transaction(async (tx) => {
    const org = await lockOrganization(tx, seed.organizationId);
    const invoice = await tx.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const now = new Date();
    if (
      invoice.provider !== "FREEDOMPAY" ||
      invoice.expiresAt <= now ||
      !["CREATING", "PENDING"].includes(invoice.status) ||
      org.subscriptionBillingMode !== "SELF_SERVE" ||
      org.subscriptionStatus === "CANCELED" ||
      org.subscriptionContract?.lifetimeAccess ||
      LIFETIME_ORGANIZATION_IDS.has(org.id) ||
      scalar(fields, "pg_currency") !== "KGS" ||
      !sameAmount(fields, invoice.amountMinor) ||
      (scalar(fields, "pg_testing_mode") !== undefined &&
        scalar(fields, "pg_testing_mode") !== (invoice.isTest ? "1" : "0")) ||
      (invoice.isTest && process.env.VERCEL_ENV === "production") ||
      (scalar(fields, "pg_merchant_id") !== undefined &&
        scalar(fields, "pg_merchant_id") !== invoice.merchantId) ||
      (invoice.providerPaymentId && scalar(fields, "pg_payment_id") !== invoice.providerPaymentId)
    )
      throw new AppError("billingPaymentMismatch", "CONFLICT", 409);
    const purchase = readPurchaseSnapshot(invoice.purchaseSnapshot);
    const effective = await getOrganizationPlan(org.id, tx);
    if (
      purchase &&
      (purchase.expectedPlan !== org.plan ||
        purchase.expectedPeriodEnd !== (org.currentPeriodEndsAt?.toISOString() ?? null) ||
        purchase.catalogVersion !== effective.billingCatalogVersion ||
        (purchase.kind === "UPGRADE" &&
          (effective.activeSubscriptionPeriod?.id !== purchase.sourcePeriodId ||
            new Date(purchase.endsAt) <= now)))
    )
      throw new AppError("billingQuoteChanged", "CONFLICT", 409);
    if (!purchase) {
      const prior = await tx.subscriptionPeriod.findFirst({
        where: { organizationId: org.id },
        select: { id: true },
      });
      if (
        prior &&
        org.currentPeriodEndsAt &&
        org.currentPeriodEndsAt > now &&
        org.plan !== invoice.plan
      )
        throw new AppError("billingQuoteChanged", "CONFLICT", 409);
    }
    await assertSubscriptionSelectionReady(
      effective,
      purchase?.entitlements ??
        contractPlan(effective.contractTerms, invoice.plan, purchase?.extras),
      tx,
    );
    // The provider has not collected yet. This check deliberately changes no
    // invoice/access state; settlement repeats these checks after confirmation.
  });
};

export const reconcileSubscriptionPayments = async () => {
  const records = await prisma.subscriptionInvoice.findMany({
    where: {
      nextCheckAt: { lte: new Date() },
      OR: [
        { status: { in: ["CREATING", "PENDING", "REVIEW"] } },
        { status: "PAID", period: { endsAt: { gt: new Date() } } },
        {
          status: { in: ["FAILED", "EXPIRED"] },
          createdAt: { gt: new Date(Date.now() - 72 * 60 * 60_000) },
        },
      ],
    },
    orderBy: { nextCheckAt: "asc" },
    take: 25,
    select: { id: true, organizationId: true },
  });
  let failed = 0;
  let checked = 0;
  let cursor = 0;
  const deadline = Date.now() + 30_000;
  // Bound both provider concurrency and wall time. Unclaimed rows stay due for
  // the next cron; slow provider calls must not monopolize the recovery group.
  await Promise.all(
    Array.from({ length: Math.min(5, records.length) }, async () => {
      while (cursor < records.length && Date.now() < deadline) {
        const record = records[cursor++];
        checked += 1;
        try {
          if ((await checkSubscriptionInvoice(record.organizationId, record.id)).syncDelayed)
            failed += 1;
        } catch {
          failed += 1;
        }
      }
    }),
  );
  return {
    job: "subscription-payment-reconcile",
    status: failed ? ("skipped" as const) : ("ok" as const),
    details: {
      checked,
      deferred: records.length - checked,
      failed,
      ...(failed ? { reason: "failed" } : {}),
    },
  };
};

export const listSubscriptionPaymentReviews = async () => {
  const records = await prisma.subscriptionInvoice.findMany({
    where: { status: "REVIEW" },
    orderBy: { createdAt: "asc" },
    take: 50,
    include: { period: true, organization: { select: { id: true, name: true } } },
  });
  return records.map((invoice) => ({
    ...presentInvoice(invoice),
    organization: invoice.organization,
    reason: invoice.lastIssue,
  }));
};

// This closes an operator-reviewed case; it never asserts that money arrived,
// creates a paid period or changes access. Any exceptional access adjustment is
// explicit in the existing audited organization billing controls.
export const resolveSubscriptionPaymentReview = async (input: {
  invoiceId: string;
  actorId: string;
  note: string;
  requestId: string;
}) => {
  const seed = await prisma.subscriptionInvoice.findUnique({ where: { id: input.invoiceId } });
  if (!seed) throw new AppError("recordNotFound", "NOT_FOUND", 404);
  return prisma.$transaction(async (tx) => {
    await lockOrganization(tx, seed.organizationId);
    const invoice = await tx.subscriptionInvoice.findUniqueOrThrow({ where: { id: seed.id } });
    if (invoice.status !== "REVIEW")
      throw new AppError("billingReviewAlreadyResolved", "CONFLICT", 409);
    const updated = await tx.subscriptionInvoice.update({
      where: { id: invoice.id },
      data: { status: "RESOLVED", pendingSlot: null, processingUntil: null, processingToken: null },
    });
    await writeAuditLog(tx, {
      organizationId: invoice.organizationId,
      actorId: input.actorId,
      action: "SUBSCRIPTION_REVIEW_RESOLVED",
      entity: "SubscriptionInvoice",
      entityId: invoice.id,
      before: { status: invoice.status, issue: invoice.lastIssue },
      after: { status: updated.status, note: input.note },
      requestId: input.requestId,
    });
    return presentInvoice(updated);
  });
};
