import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import {
  getGoPayCredentials,
  getSubscriptionPaymentConfig,
  paymentOrderId,
} from "@/server/billing/paymentConfig";
import { initializeGoPay, getGoPayStatus } from "@/server/billing/gopay";
import { whatsAppPaymentDescription } from "@/server/billing/checkoutDescription";
import {
  assertPaymentReceipt,
  freedomPayReceipt,
  goPayReceipt,
  type VerifiedPaymentReceipt,
} from "@/server/billing/paymentReceipt";
import {
  getFreedomPayStatus,
  getPaymentCredentials,
  initializeFreedomPayWhatsAppPack,
  RESULT_SCRIPT,
  scalar,
  verifyFreedomPay,
  type SignedFields,
} from "@/server/billing/freedomPay";
import { kgsToMinor } from "@/server/billing/paymentMath";
import {
  WHATSAPP_OFFER_VERSION,
  WHATSAPP_PACK_PRICE_MINOR,
  whatsappOffer,
  whatsappPackExpiresAt,
  whatsappPackSelectionSchema,
} from "@/lib/whatsapp-ai";
import {
  whatsappConnection,
  whatsappActor,
  whatsappOrganizationLock,
  type WhatsAppActor,
} from "./access";
import { whatsappConfig } from "./config";

const present = (v: {
  id: string;
  provider: "GOPAY" | "FREEDOMPAY";
  isTest: boolean;
  quantity: number;
  amountMinor: number;
  status: string;
  checkoutUrl: string | null;
  expiresAt: Date;
  paidAt: Date | null;
  lastIssue: string | null;
  createdAt: Date;
}) => ({
  id: v.id,
  provider: v.provider,
  isTest: v.isTest,
  quantity: v.quantity,
  amountMinor: v.amountMinor,
  status: v.status,
  checkoutUrl: v.status === "PENDING" && v.expiresAt > new Date() ? v.checkoutUrl : null,
  expiresAt: v.expiresAt,
  paidAt: v.paidAt,
  lastIssue: v.lastIssue,
  createdAt: v.createdAt,
});

export async function whatsAppPaymentState(actor: WhatsAppActor) {
  await whatsappActor(actor, prisma, true);
  const payment = getSubscriptionPaymentConfig(),
    config = whatsappConfig();
  const invoices = await prisma.whatsAppInvoice.findMany({
    where: { organizationId: actor.organizationId },
    take: 20,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return {
    ready: payment.ready && config.salesReady && config.paymentsApproved,
    mode: payment.mode,
    provider: payment.provider,
    termsVersion: payment.termsVersion,
    termsUrl: payment.termsUrl,
    invoices: invoices.map(present),
  };
}

export async function createWhatsAppCheckout(
  actor: WhatsAppActor,
  storeId: string,
  raw: unknown,
  requestId: string,
) {
  const access = await whatsappConnection(actor, storeId, { admin: true, active: true });
  const input = whatsappPackSelectionSchema.parse(raw),
    config = getSubscriptionPaymentConfig(),
    wa = whatsappConfig();
  if (!config.ready || !wa.salesReady || !wa.paymentsApproved)
    throw new AppError("billingPaymentsUnavailable", "CONFLICT", 409);
  if (input.expectedProvider && input.expectedProvider !== config.provider)
    throw new AppError("billingQuoteChanged", "CONFLICT", 409);
  const worker = await prisma.whatsAppWorkerState.findUnique({ where: { id: "worker" } });
  if (
    access.connection?.state !== "CONNECTED" ||
    !worker ||
    !["READY", "MANUAL"].includes(worker.state) ||
    Date.now() - worker.heartbeatAt.getTime() > 90000
  )
    throw new AppError("whatsappNotReady", "CONFLICT", 409);
  const amount = input.quantity * WHATSAPP_PACK_PRICE_MINOR;
  if (input.expectedAmountMinor !== amount || input.termsVersion !== config.termsVersion)
    throw new AppError("billingPaymentMismatch", "CONFLICT", 409);
  const result = await whatsappOrganizationLock(actor.organizationId, async (tx) => {
    const existing = await tx.whatsAppInvoice.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: actor.organizationId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (
        existing.createdById !== actor.id ||
        existing.quantity !== input.quantity ||
        existing.amountMinor !== amount ||
        existing.offerVersion !== input.offerVersion
      )
        throw new AppError("billingPaymentMismatch", "CONFLICT", 409);
      return { invoice: existing, created: false };
    }
    const pending = await tx.whatsAppInvoice.findFirst({
      where: { organizationId: actor.organizationId, pendingSlot: actor.organizationId },
    });
    if (pending) throw new AppError("billingPaymentInProgress", "CONFLICT", 409);
    const invoiceId = `wa_${randomUUID().replaceAll("-", "")}`;
    const invoice = await tx.whatsAppInvoice.create({
      data: {
        id: invoiceId,
        provider: config.provider,
        providerOrderId: config.provider === "GOPAY" ? paymentOrderId("whatsapp", invoiceId) : null,
        organizationId: actor.organizationId,
        createdById: actor.id,
        idempotencyKey: input.idempotencyKey,
        pendingSlot: actor.organizationId,
        quantity: input.quantity,
        amountMinor: amount,
        offerVersion: WHATSAPP_OFFER_VERSION,
        merchantId: config.merchantId,
        isTest: config.mode === "sandbox",
        termsVersion: config.termsVersion,
        termsUrl: config.termsUrl,
        expiresAt: new Date(Date.now() + 15 * 60000),
        processingUntil: new Date(Date.now() + 30000),
        nextCheckAt: new Date(Date.now() + 20000),
      },
    });
    await writeAuditLog(tx, {
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: "WHATSAPP_CHECKOUT_CREATE",
      entity: "WhatsAppInvoice",
      entityId: invoice.id,
      requestId,
      after: {
        quantity: input.quantity,
        amountMinor: amount,
        currency: "KGS",
        offerVersion: WHATSAPP_OFFER_VERSION,
      },
    });
    return { invoice, created: true };
  });
  if (!result.created) return present(result.invoice);
  try {
    const response =
      result.invoice.provider === "GOPAY"
        ? {
            accepted: true as const,
            ...(await initializeGoPay(
              {
                orderId: result.invoice.providerOrderId!,
                amountMinor: result.invoice.amountMinor,
                description: whatsAppPaymentDescription({
                  ...result.invoice,
                  locale: input.locale,
                }),
                isTest: result.invoice.isTest,
                ...(config.publicOrigin.startsWith("https:")
                  ? {
                      returnUrl: `${config.publicOrigin}/operations/integrations/whatsapp-ai?storeId=${encodeURIComponent(storeId)}`,
                    }
                  : {}),
                lifetimeSeconds: 900,
              },
              getGoPayCredentials(result.invoice.merchantId),
            )),
          }
        : await initializeFreedomPayWhatsAppPack({ ...result.invoice, locale: input.locale });
    if (!response.accepted) {
      await prisma.whatsAppInvoice.updateMany({
        where: { id: result.invoice.id, status: "CREATING" },
        data: {
          status: "FAILED",
          pendingSlot: null,
          processingUntil: null,
          lastIssue: "billingPaymentFailed",
        },
      });
    } else {
      // A fast callback can settle before init returns. Never downgrade PAID/REVIEW.
      await prisma.whatsAppInvoice.updateMany({
        where: { id: result.invoice.id, status: "CREATING" },
        data: {
          status: "PENDING",
          processingUntil: null,
          providerPaymentId: response.paymentId,
          checkoutUrl: response.checkoutUrl,
        },
      });
    }
  } catch {
    await prisma.whatsAppInvoice.updateMany({
      where: { id: result.invoice.id, status: "CREATING" },
      data: {
        status: "REVIEW",
        processingUntil: null,
        lastIssue: "billingPaymentUnknown",
        nextCheckAt: new Date(Date.now() + 30000),
      },
    });
  }
  return present(
    await prisma.whatsAppInvoice.findUniqueOrThrow({ where: { id: result.invoice.id } }),
  );
}

function verifyAmount(fields: SignedFields, amount: number) {
  try {
    return kgsToMinor(scalar(fields, "pg_amount") ?? "") === amount;
  } catch {
    return false;
  }
}

export async function applyWhatsAppPayment(input: {
  invoiceId: string;
  fields: SignedFields;
  source: "CALLBACK" | "RECONCILIATION";
}) {
  const seed = await prisma.whatsAppInvoice.findUnique({ where: { id: input.invoiceId } });
  if (!seed) throw new AppError("recordNotFound", "NOT_FOUND", 404);
  const credentials = getPaymentCredentials(seed.merchantId);
  verifyFreedomPay(
    input.source === "CALLBACK" ? RESULT_SCRIPT : "get_status3.php",
    input.fields,
    credentials.secretKey,
  );
  return applyWhatsAppReceipt({
    invoiceId: seed.id,
    source: input.source,
    receipt: freedomPayReceipt(seed, input.fields, input.source),
  });
}

export async function applyWhatsAppReceipt(input: {
  invoiceId: string;
  receipt: VerifiedPaymentReceipt;
  source: "CALLBACK" | "RECONCILIATION";
}) {
  const seed = await prisma.whatsAppInvoice.findUnique({ where: { id: input.invoiceId } });
  if (!seed) throw new AppError("recordNotFound", "NOT_FOUND", 404);
  return whatsappOrganizationLock(seed.organizationId, async (tx) => {
    const invoice = await tx.whatsAppInvoice.findUniqueOrThrow({ where: { id: seed.id } });
    const offer = whatsappOffer(invoice.offerVersion);
    assertPaymentReceipt(invoice, input.receipt);
    if (!offer || invoice.amountMinor !== invoice.quantity * offer.priceMinor)
      throw new AppError("billingPaymentMismatch", "CONFLICT", 409);
    const { paymentId, state, eventKey } = input.receipt;
    const refunded = state === "REFUND_REVIEW",
      settled = state === "PAID",
      failed = state === "FAILED" || state === "EXPIRED";
    await tx.whatsAppPaymentEvent.createMany({
      data: [
        {
          invoiceId: invoice.id,
          eventKey,
          source: input.source,
          state,
          digest: input.receipt.payloadDigest,
        },
      ],
      skipDuplicates: true,
    });
    if (refunded) {
      await tx.whatsAppCreditLot.updateMany({
        where: { invoiceId: invoice.id, organizationId: invoice.organizationId },
        data: { revoked: true },
      });
      return tx.whatsAppInvoice.update({
        where: { id: invoice.id },
        data: {
          status: "REVIEW",
          providerPaymentId: paymentId,
          lastIssue: "REFUND_REVIEW",
          pendingSlot: null,
        },
      });
    }
    if (invoice.lastIssue === "REFUND_REVIEW" || ["PAID", "RESOLVED"].includes(invoice.status))
      return invoice;
    if (settled) {
      const paidAt = new Date();
      await tx.whatsAppCreditLot.upsert({
        where: { invoiceId: invoice.id },
        create: {
          organizationId: invoice.organizationId,
          invoiceId: invoice.id,
          total: invoice.quantity * offer.messages,
          expiresAt: whatsappPackExpiresAt(paidAt),
        },
        update: {},
      });
      await writeAuditLog(tx, {
        organizationId: invoice.organizationId,
        action: "WHATSAPP_PACK_GRANTED",
        entity: "WhatsAppInvoice",
        entityId: invoice.id,
        requestId: `whatsapp-payment:${eventKey}`,
        after: {
          units: invoice.quantity * offer.messages,
          amountMinor: invoice.amountMinor,
          currency: "KGS",
        },
      });
      return tx.whatsAppInvoice.update({
        where: { id: invoice.id },
        data: {
          status: "PAID",
          providerPaymentId: paymentId,
          paidAt,
          pendingSlot: null,
          lastIssue: null,
        },
      });
    }
    if (["FAILED", "EXPIRED", "RESOLVED"].includes(invoice.status)) return invoice;
    return tx.whatsAppInvoice.update({
      where: { id: invoice.id },
      data: {
        status: failed ? "FAILED" : "PENDING",
        ...(input.receipt.checkoutUrl ? { checkoutUrl: input.receipt.checkoutUrl } : {}),
        providerPaymentId: paymentId,
        ...(failed ? { pendingSlot: null } : {}),
        nextCheckAt: new Date(Date.now() + 60000),
        lastIssue: null,
      },
    });
  });
}

export async function verifyWhatsAppInvoiceCanBePaid(invoiceId: string, fields: SignedFields) {
  const invoice = await prisma.whatsAppInvoice.findUnique({ where: { id: invoiceId } });
  if (
    !invoice ||
    invoice.provider !== "FREEDOMPAY" ||
    (invoice.isTest && process.env.VERCEL_ENV === "production") ||
    !["CREATING", "PENDING"].includes(invoice.status) ||
    invoice.expiresAt <= new Date() ||
    !verifyAmount(fields, invoice.amountMinor) ||
    scalar(fields, "pg_currency") !== "KGS" ||
    scalar(fields, "pg_order_id") !== invoice.id ||
    (scalar(fields, "pg_testing_mode") !== undefined &&
      scalar(fields, "pg_testing_mode") !== (invoice.isTest ? "1" : "0")) ||
    !whatsappConfig().salesReady ||
    !whatsappConfig().paymentsApproved ||
    !getSubscriptionPaymentConfig(process.env, "FREEDOMPAY").ready
  )
    throw new AppError("billingPaymentMismatch", "CONFLICT", 409);
  return invoice;
}

export async function checkWhatsAppPayment(actor: WhatsAppActor, invoiceId: string) {
  await whatsappActor(actor, prisma, true);
  const invoice = await prisma.whatsAppInvoice.findFirst({
    where: { id: invoiceId, organizationId: actor.organizationId },
  });
  if (!invoice) throw new AppError("recordNotFound", "NOT_FOUND", 404);
  if (invoice.status !== "PAID" && invoice.lastIssue !== "REFUND_REVIEW")
    await reconcileWhatsAppInvoice(invoice.id);
  return present(await prisma.whatsAppInvoice.findUniqueOrThrow({ where: { id: invoice.id } }));
}

export async function reconcileWhatsAppInvoice(id: string) {
  const token = randomUUID(),
    now = new Date();
  const claimed = await prisma.whatsAppInvoice.updateMany({
    where: {
      id,
      status: { in: ["CREATING", "PENDING", "REVIEW", "FAILED"] },
      nextCheckAt: { lte: now },
      AND: [
        { OR: [{ lastIssue: null }, { lastIssue: { not: "REFUND_REVIEW" } }] },
        { OR: [{ processingUntil: null }, { processingUntil: { lt: now } }] },
      ],
    },
    data: { processingToken: token, processingUntil: new Date(now.getTime() + 60000) },
  });
  if (!claimed.count) return;
  try {
    const invoice = await prisma.whatsAppInvoice.findUniqueOrThrow({ where: { id } });
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
      await applyWhatsAppReceipt({
        invoiceId: id,
        source: "RECONCILIATION",
        receipt: goPayReceipt(invoice, payment),
      });
    } else {
      const fields = await getFreedomPayStatus(invoice);
      await applyWhatsAppPayment({ invoiceId: id, fields, source: "RECONCILIATION" });
    }
  } catch (error) {
    const invoice = await prisma.whatsAppInvoice.findUniqueOrThrow({ where: { id } });
    if (
      invoice.provider === "GOPAY" &&
      !invoice.providerPaymentId &&
      ["CREATING", "REVIEW"].includes(invoice.status) &&
      invoice.createdAt < new Date(Date.now() - 60_000) &&
      error instanceof AppError &&
      error.details?.providerCode === "4041"
    ) {
      await prisma.whatsAppInvoice.updateMany({
        where: { id, processingToken: token, status: { in: ["CREATING", "REVIEW"] } },
        data: { status: "FAILED", pendingSlot: null, lastIssue: "PAYMENT_NOT_CREATED" },
      });
    } else throw error;
  } finally {
    await prisma.whatsAppInvoice.updateMany({
      where: { id, processingToken: token },
      data: {
        processingToken: null,
        processingUntil: null,
        nextCheckAt: new Date(Date.now() + 60000),
      },
    });
  }
}

export async function reconcileWhatsAppPayments() {
  const invoices = await prisma.whatsAppInvoice.findMany({
    where: {
      AND: [
        {
          OR: [
            { status: { in: ["CREATING", "PENDING", "REVIEW"] } },
            { status: "FAILED", createdAt: { gt: new Date(Date.now() - 72 * 60 * 60000) } },
          ],
        },
        { OR: [{ lastIssue: null }, { lastIssue: { not: "REFUND_REVIEW" } }] },
      ],
      nextCheckAt: { lte: new Date() },
    },
    take: 10,
    orderBy: { nextCheckAt: "asc" },
  });
  let cursor = 0,
    checked = 0,
    failed = 0;
  const deadline = Date.now() + 20_000;
  await Promise.all(
    Array.from({ length: Math.min(2, invoices.length) }, async () => {
      while (cursor < invoices.length && Date.now() < deadline) {
        const invoice = invoices[cursor++];
        checked += 1;
        try {
          await reconcileWhatsAppInvoice(invoice.id);
        } catch {
          failed += 1;
        } // A failed query never changes credit or implies payment.
      }
    }),
  );
  return {
    job: "whatsapp-payment-reconcile",
    status: failed ? ("skipped" as const) : ("ok" as const),
    details: {
      checked,
      deferred: invoices.length - checked,
      failed,
      ...(failed ? { reason: "failed" } : {}),
    },
  };
}
