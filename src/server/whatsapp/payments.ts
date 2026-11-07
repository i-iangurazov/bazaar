import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { getSubscriptionPaymentConfig } from "@/server/billing/paymentConfig";
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

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const present = (v: {
  id: string;
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
    const invoice = await tx.whatsAppInvoice.create({
      data: {
        id: `wa_${randomUUID().replaceAll("-", "")}`,
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
    const response = await initializeFreedomPayWhatsAppPack({
      ...result.invoice,
      locale: input.locale,
    });
    if (!response.accepted) {
      await prisma.whatsAppInvoice.updateMany({
        where: { id: result.invoice.id, status: "CREATING" },
        data: { status: "FAILED", pendingSlot: null, lastIssue: "billingPaymentFailed" },
      });
    } else {
      // A fast callback can settle before init returns. Never downgrade PAID/REVIEW.
      await prisma.whatsAppInvoice.updateMany({
        where: { id: result.invoice.id, status: "CREATING" },
        data: {
          status: "PENDING",
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
  return whatsappOrganizationLock(seed.organizationId, async (tx) => {
    const invoice = await tx.whatsAppInvoice.findUniqueOrThrow({ where: { id: seed.id } });
    const offer = whatsappOffer(invoice.offerVersion);
    const f = input.fields,
      paymentId = scalar(f, "pg_payment_id"),
      orderId = scalar(f, "pg_order_id"),
      testing = scalar(f, "pg_testing_mode");
    if (
      !offer ||
      invoice.amountMinor !== invoice.quantity * offer.priceMinor ||
      !paymentId ||
      !/^[1-9]\d{0,29}$/.test(paymentId) ||
      (invoice.providerPaymentId && invoice.providerPaymentId !== paymentId) ||
      (input.source === "CALLBACK" && orderId !== invoice.id) ||
      (orderId !== undefined && orderId !== invoice.id) ||
      (scalar(f, "pg_merchant_id") !== undefined &&
        scalar(f, "pg_merchant_id") !== invoice.merchantId) ||
      scalar(f, "pg_currency") !== "KGS" ||
      !verifyAmount(f, invoice.amountMinor) ||
      (input.source === "CALLBACK" && testing === undefined) ||
      (testing !== undefined && testing !== (invoice.isTest ? "1" : "0")) ||
      (invoice.isTest && process.env.VERCEL_ENV === "production")
    )
      throw new AppError("billingPaymentMismatch", "CONFLICT", 409);
    const refunded =
      ["pg_refund_amount", "pg_revoke_amount"].some((key) => {
        const value = scalar(f, key);
        return value !== undefined && (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) !== 0);
      }) || ["refunded", "revoked"].includes(scalar(f, "pg_payment_status") ?? "");
    const success =
      input.source === "CALLBACK"
        ? scalar(f, "pg_result") === "1"
        : ["ok", "success"].includes(scalar(f, "pg_payment_status") ?? "");
    const failed =
      input.source === "CALLBACK"
        ? scalar(f, "pg_result") === "0"
        : ["failed", "error", "expired", "incomplete"].includes(
            scalar(f, "pg_payment_status") ?? "",
          );
    const captured = scalar(f, "pg_captured");
    const settled =
      success &&
      captured !== "0" &&
      (scalar(f, "pg_payment_method") !== "bankcard" || captured === "1");
    const state = refunded ? "REFUND_REVIEW" : settled ? "PAID" : failed ? "FAILED" : "PENDING";
    const eventKey = digest([
      invoice.id,
      paymentId,
      state,
      captured,
      scalar(f, "pg_refund_amount"),
      scalar(f, "pg_revoke_amount"),
    ]);
    await tx.whatsAppPaymentEvent.createMany({
      data: [{ invoiceId: invoice.id, eventKey, source: input.source, state, digest: digest(f) }],
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
    if (invoice.lastIssue === "REFUND_REVIEW" || invoice.status === "PAID") return invoice;
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
    return tx.whatsAppInvoice.update({
      where: { id: invoice.id },
      data: {
        status: failed ? "FAILED" : "PENDING",
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
    !["CREATING", "PENDING"].includes(invoice.status) ||
    invoice.expiresAt <= new Date() ||
    !verifyAmount(fields, invoice.amountMinor) ||
    scalar(fields, "pg_currency") !== "KGS" ||
    scalar(fields, "pg_order_id") !== invoice.id ||
    (scalar(fields, "pg_testing_mode") !== undefined &&
      scalar(fields, "pg_testing_mode") !== (invoice.isTest ? "1" : "0")) ||
    !whatsappConfig().salesReady ||
    !whatsappConfig().paymentsApproved ||
    !getSubscriptionPaymentConfig().ready
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
      status: { in: ["CREATING", "PENDING", "REVIEW"] },
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
    const fields = await getFreedomPayStatus(invoice);
    await applyWhatsAppPayment({ invoiceId: id, fields, source: "RECONCILIATION" });
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
  if (!getSubscriptionPaymentConfig().ready) return;
  const invoices = await prisma.whatsAppInvoice.findMany({
    where: {
      status: { in: ["CREATING", "PENDING", "REVIEW"] },
      OR: [{ lastIssue: null }, { lastIssue: { not: "REFUND_REVIEW" } }],
      nextCheckAt: { lte: new Date() },
    },
    take: 10,
    orderBy: { nextCheckAt: "asc" },
  });
  for (const invoice of invoices) {
    try {
      await reconcileWhatsAppInvoice(invoice.id);
    } catch {
      /* Kept for a later verified reconciliation. */
    }
  }
}
