import { createHash, randomUUID } from "node:crypto";
import type { Prisma, SubscriptionInvoice } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { getPlanCatalogEntries, getPlanMonthlyPriceKgs } from "./planCatalog";
import { getSubscriptionPaymentConfig } from "./paymentConfig";
import { extendSubscriptionMonth, kgsToMinor } from "./paymentMath";
import { getFreedomPayStatus, initializeFreedomPay, scalar, type SignedFields } from "./freedomPay";
import type { PlanCode } from "@/lib/billing/plans";

const nowPlus = (milliseconds: number) => new Date(Date.now() + milliseconds);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const lockOrganization = async (tx: Prisma.TransactionClient, organizationId: string) => {
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
  return tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
};

export const presentInvoice = (
  invoice: SubscriptionInvoice & { period?: { startsAt: Date; endsAt: Date } | null },
) => ({
  id: invoice.id,
  plan: invoice.plan,
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
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    prisma.subscriptionInvoice.findFirst({
      where: { organizationId, OR: [{ pendingSlot: organizationId }, { status: "REVIEW" }] },
      orderBy: { createdAt: "desc" },
      include: { period: true },
    }),
    prisma.subscriptionPeriod.findFirst({ where: { organizationId }, orderBy: { endsAt: "desc" } }),
  ]);
  return {
    available: config.ready,
    mode: config.mode,
    sellerName: config.sellerName,
    termsUrl: config.termsUrl,
    termsVersion: config.termsVersion,
    billingMode: organization.subscriptionBillingMode,
    accountPaused: organization.subscriptionStatus === "CANCELED",
    canPurchase:
      config.ready &&
      organization.subscriptionBillingMode === "SELF_SERVE" &&
      organization.subscriptionStatus !== "CANCELED" &&
      !pending,
    currentPlan: organization.plan,
    mayChangePlan:
      !lastPeriod ||
      !organization.currentPeriodEndsAt ||
      organization.currentPeriodEndsAt <= new Date(),
    catalog: getPlanCatalogEntries().map((entry) => ({
      plan: entry.code,
      amountMinor: kgsToMinor(entry.monthlyPriceKgs),
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
  idempotencyKey: string;
  termsVersion: string;
  expectedAmountMinor: number;
  locale: string;
  requestId: string;
}) => {
  const config = getSubscriptionPaymentConfig();
  if (!config.ready) throw new AppError("billingPaymentsUnavailable", "CONFLICT", 409);
  if (input.termsVersion !== config.termsVersion)
    throw new AppError("billingTermsChanged", "CONFLICT", 409);
  const invoice = await prisma.$transaction(async (tx) => {
    const org = await lockOrganization(tx, input.organizationId);
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
      if (prior.plan !== input.plan || prior.createdById !== input.actorId)
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
    const priorPayment = await tx.subscriptionPeriod.findFirst({
      where: { organizationId: org.id },
      select: { id: true },
    });
    if (
      priorPayment &&
      org.currentPeriodEndsAt &&
      org.currentPeriodEndsAt > new Date() &&
      input.plan !== org.plan
    )
      throw new AppError("billingPlanChangeAfterPeriod", "CONFLICT", 409);
    const amountMinor = kgsToMinor(getPlanMonthlyPriceKgs(input.plan));
    if (input.expectedAmountMinor !== amountMinor)
      throw new AppError("billingPriceChanged", "CONFLICT", 409);
    const created = await tx.subscriptionInvoice.create({
      data: {
        organizationId: org.id,
        createdById: input.actorId,
        idempotencyKey: input.idempotencyKey,
        pendingSlot: org.id,
        plan: input.plan,
        amountMinor,
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
    const result = await initializeFreedomPay({ ...invoice.value, locale: input.locale });
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
const hasRefund = (fields: SignedFields) =>
  ["pg_refund_amount", "pg_revoke_amount"].some((key) => {
    const value = scalar(fields, key);
    return value !== undefined && (!/^-?\d+(?:\.\d{1,2})?$/.test(value) || Number(value) !== 0);
  });

export const applyVerifiedPayment = async (input: {
  invoiceId: string;
  fields: SignedFields;
  source: "CALLBACK" | "RECONCILIATION";
}) => {
  const seed = await prisma.subscriptionInvoice.findUnique({ where: { id: input.invoiceId } });
  if (!seed) throw new AppError("recordNotFound", "NOT_FOUND", 404);
  return prisma.$transaction(async (tx) => {
    const org = await lockOrganization(tx, seed.organizationId);
    const invoice = await tx.subscriptionInvoice.findUniqueOrThrow({ where: { id: seed.id } });
    const f = input.fields;
    const paymentId = scalar(f, "pg_payment_id");
    const orderId = scalar(f, "pg_order_id");
    const testingMode = scalar(f, "pg_testing_mode");
    if (
      !paymentId ||
      !/^[1-9]\d{0,29}$/.test(paymentId) ||
      (invoice.providerPaymentId && paymentId !== invoice.providerPaymentId) ||
      (orderId !== undefined && orderId !== invoice.id) ||
      (input.source === "CALLBACK" && orderId !== invoice.id) ||
      (scalar(f, "pg_merchant_id") !== undefined &&
        scalar(f, "pg_merchant_id") !== invoice.merchantId) ||
      scalar(f, "pg_currency") !== "KGS" ||
      !sameAmount(f, invoice.amountMinor) ||
      (input.source === "CALLBACK" && testingMode === undefined) ||
      (testingMode !== undefined && testingMode !== (invoice.isTest ? "1" : "0")) ||
      (invoice.isTest && process.env.VERCEL_ENV === "production")
    )
      throw new AppError("billingPaymentMismatch", "CONFLICT", 409);
    const result = scalar(f, "pg_result");
    const status = scalar(f, "pg_payment_status");
    const success =
      input.source === "CALLBACK" ? result === "1" : ["ok", "success"].includes(status ?? "");
    const failed =
      input.source === "CALLBACK"
        ? result === "0"
        : ["failed", "error", "revoked", "incomplete", "expired"].includes(status ?? "");
    const captured = scalar(f, "pg_captured");
    const settled =
      success &&
      captured !== "0" &&
      (scalar(f, "pg_payment_method") !== "bankcard" || captured === "1");
    const refunded = hasRefund(f) || ["revoked", "refunded"].includes(status ?? "");
    const state = refunded ? "REFUND_REVIEW" : settled ? "PAID" : failed ? "FAILED" : "PENDING";
    const key = digest({
      invoice: invoice.id,
      paymentId,
      state,
      captured,
      refund: scalar(f, "pg_refund_amount"),
      revoke: scalar(f, "pg_revoke_amount"),
    });
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
          payloadDigest: digest(f),
        },
      });
    const update = { providerPaymentId: paymentId, nextCheckAt: nowPlus(30_000), lastIssue: null };
    if (
      invoice.status === "RESOLVED" ||
      (invoice.status === "REVIEW" && invoice.lastIssue === "REFUND_REVIEW" && !refunded)
    )
      return invoice;
    if (invoice.status === "PAID" && !refunded) return invoice;
    if (
      refunded ||
      (settled &&
        (org.subscriptionBillingMode !== "SELF_SERVE" || org.subscriptionStatus === "CANCELED"))
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
      const anyPeriod = await tx.subscriptionPeriod.findFirst({
        where: { organizationId: org.id },
        select: { id: true },
      });
      const now = new Date();
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
      const startsAt = new Date(
        Math.max(
          now.getTime(),
          org.currentPeriodEndsAt?.getTime() ?? 0,
          org.trialEndsAt?.getTime() ?? 0,
        ),
      );
      const anchorDay =
        org.currentPeriodEndsAt?.getTime() === startsAt.getTime() && org.billingAnchorDay
          ? org.billingAnchorDay
          : startsAt.getUTCDate();
      const endsAt = extendSubscriptionMonth(startsAt, anchorDay);
      await tx.subscriptionPeriod.create({
        data: {
          invoiceId: invoice.id,
          organizationId: org.id,
          plan: invoice.plan,
          startsAt,
          endsAt,
        },
      });
      await tx.organization.update({
        where: { id: org.id },
        data: {
          plan: invoice.plan,
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
              status: status === "incomplete" || status === "expired" ? "EXPIRED" : "FAILED",
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
    } catch {
      checkFailed = true;
      await prisma.subscriptionInvoice.updateMany({
        where: { id: invoice.id, processingToken, status: { in: ["CREATING", "PENDING"] } },
        data: { lastIssue: "RECONCILIATION_REQUIRED" },
      });
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
  const invoice = await prisma.subscriptionInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      organization: { select: { subscriptionBillingMode: true, subscriptionStatus: true } },
    },
  });
  if (
    !invoice ||
    invoice.expiresAt <= new Date() ||
    !["CREATING", "PENDING"].includes(invoice.status) ||
    invoice.organization.subscriptionBillingMode !== "SELF_SERVE" ||
    invoice.organization.subscriptionStatus === "CANCELED" ||
    scalar(fields, "pg_currency") !== "KGS" ||
    !sameAmount(fields, invoice.amountMinor) ||
    (scalar(fields, "pg_testing_mode") !== undefined &&
      scalar(fields, "pg_testing_mode") !== (invoice.isTest ? "1" : "0")) ||
    (scalar(fields, "pg_merchant_id") !== undefined &&
      scalar(fields, "pg_merchant_id") !== invoice.merchantId) ||
    (invoice.providerPaymentId && scalar(fields, "pg_payment_id") !== invoice.providerPaymentId)
  )
    throw new AppError("billingPaymentMismatch", "CONFLICT", 409);
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
