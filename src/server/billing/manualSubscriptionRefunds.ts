import { Prisma } from "@prisma/client";
import { z } from "zod";

import { businessDateKey } from "@/lib/timezone";
import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { LIFETIME_ORGANIZATION_IDS } from "./lifetimeOrganizations";

const invoiceInclude = {
  organization: {
    select: { id: true, name: true, subscriptionContract: { select: { lifetimeAccess: true } } },
  },
  period: true,
  events: {
    where: { state: "PAID", source: { in: ["CALLBACK", "RECONCILIATION"] } },
    select: { id: true },
    take: 1,
  },
  manualRefunds: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.SubscriptionInvoiceInclude;

type RefundInvoice = Prisma.SubscriptionInvoiceGetPayload<{ include: typeof invoiceInclude }>;
type RefundRecord = RefundInvoice["manualRefunds"][number];

export type ManualSubscriptionRefundInvoiceSummary = {
  invoiceId: string;
  orderId: string;
  organization: { id: string; name: string };
  plan: RefundInvoice["plan"];
  period: { startsAt: Date; endsAt: Date };
  amountMinor: number;
  currency: "KGS";
  paidAt: Date;
  refundedMinor: number;
  remainingRefundableMinor: number;
  refunds: {
    id: string;
    amountMinor: number;
    bankOperationId: string;
    bankTransferredOn: string;
    reason: string;
    recordedById: string;
    proofType: "OPERATOR_ATTESTATION";
    createdAt: Date;
  }[];
};

function fail(message: string, conflict = false): never {
  throw new AppError(message, conflict ? "CONFLICT" : "BAD_REQUEST", conflict ? 409 : 400);
}

const assertEligible = (invoice: RefundInvoice, now = new Date()) => {
  if (
    LIFETIME_ORGANIZATION_IDS.has(invoice.organizationId) ||
    invoice.organization.subscriptionContract?.lifetimeAccess
  )
    throw new AppError("billingLifetimeProtected", "FORBIDDEN", 403);
  if (
    invoice.status !== "PAID" ||
    invoice.provider !== "GOPAY" ||
    invoice.isTest ||
    invoice.currency !== "KGS" ||
    !Number.isSafeInteger(invoice.amountMinor) ||
    invoice.amountMinor <= 0 ||
    !invoice.paidAt ||
    invoice.paidAt > now ||
    !invoice.providerOrderId ||
    !invoice.providerPaymentId ||
    !invoice.events.length ||
    !invoice.period ||
    invoice.period.organizationId !== invoice.organizationId ||
    invoice.period.invoiceId !== invoice.id
  )
    fail("billingManualRefundNotEligible");
};

const summarize = (invoice: RefundInvoice): ManualSubscriptionRefundInvoiceSummary => {
  const refundedMinor = invoice.manualRefunds.reduce((sum, refund) => sum + refund.amountMinor, 0);
  if (!Number.isSafeInteger(refundedMinor) || refundedMinor > invoice.amountMinor)
    fail("billingManualRefundNotEligible");
  return {
    invoiceId: invoice.id,
    orderId: invoice.providerOrderId!,
    organization: { id: invoice.organization.id, name: invoice.organization.name },
    plan: invoice.plan,
    period: { startsAt: invoice.period!.startsAt, endsAt: invoice.period!.endsAt },
    amountMinor: invoice.amountMinor,
    currency: "KGS",
    paidAt: invoice.paidAt!,
    refundedMinor,
    remainingRefundableMinor: invoice.amountMinor - refundedMinor,
    refunds: invoice.manualRefunds.map((refund) => ({
      id: refund.id,
      amountMinor: refund.amountMinor,
      bankOperationId: refund.bankOperationId,
      bankTransferredOn: refund.bankTransferredOn.toISOString().slice(0, 10),
      reason: refund.reason,
      recordedById: refund.recordedById,
      proofType: "OPERATOR_ATTESTATION",
      createdAt: refund.createdAt,
    })),
  };
};

function invoiceNotFound(): never {
  throw new AppError("billingManualRefundInvoiceNotFound", "NOT_FOUND", 404);
}

export async function lookupManualSubscriptionRefundInvoice(input: { orderId: string }) {
  if (typeof input.orderId !== "string") invoiceNotFound();
  const orderId = input.orderId.trim();
  if (!orderId || orderId.length > 128) invoiceNotFound();
  const invoice = await prisma.subscriptionInvoice.findUnique({
    where: { providerOrderId: orderId },
    include: invoiceInclude,
  });
  if (!invoice) invoiceNotFound();
  assertEligible(invoice);
  return summarize(invoice);
}

type RecordInput = {
  invoiceId: string;
  amountMinor: number;
  bankOperationId: string;
  bankTransferredOn: string;
  reason: string;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};

const normalizeInput = (input: RecordInput) => {
  if (
    !Number.isSafeInteger(input.amountMinor) ||
    input.amountMinor <= 0 ||
    input.amountMinor > 2147483647
  )
    fail("billingManualRefundAmountInvalid");
  if (typeof input.bankOperationId !== "string") fail("billingManualRefundBankOperationInvalid");
  const bankOperationId = input.bankOperationId.trim();
  const bankOperationKey = bankOperationId.normalize("NFKC").replace(/\s+/gu, "").toUpperCase();
  if (
    bankOperationId.length < 3 ||
    bankOperationId.length > 120 ||
    bankOperationKey.length < 3 ||
    bankOperationKey.length > 120 ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(bankOperationId)
  )
    fail("billingManualRefundBankOperationInvalid");
  if (typeof input.reason !== "string") fail("billingManualRefundReasonInvalid");
  const reason = input.reason.trim();
  if (
    reason.length < 10 ||
    reason.length > 500 ||
    reason.includes(String.fromCharCode(0)) ||
    /\p{Cs}/u.test(reason)
  )
    fail("billingManualRefundReasonInvalid");
  if (typeof input.idempotencyKey !== "string") fail("billingManualRefundIdempotencyInvalid");
  const idempotencyKey = input.idempotencyKey.trim().toLowerCase();
  if (!z.string().uuid().safeParse(idempotencyKey).success)
    fail("billingManualRefundIdempotencyInvalid");
  if (typeof input.bankTransferredOn !== "string") fail("billingManualRefundDateInvalid");
  const date = new Date(`${input.bankTransferredOn}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.bankTransferredOn) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== input.bankTransferredOn
  )
    fail("billingManualRefundDateInvalid");
  return { ...input, bankOperationId, bankOperationKey, reason, idempotencyKey, date };
};

type NormalizedInput = ReturnType<typeof normalizeInput>;
const sameOperation = (record: RefundRecord, input: NormalizedInput) =>
  record.invoiceId === input.invoiceId &&
  record.amountMinor === input.amountMinor &&
  record.bankOperationKey === input.bankOperationKey &&
  record.bankTransferredOn.toISOString().slice(0, 10) === input.bankTransferredOn &&
  record.reason === input.reason;

/** Records an operator's bank-transfer attestation. It never contacts a bank/provider,
 * changes the payment, adjusts access, or sends another payment notification. */
export async function recordManualSubscriptionRefund(raw: RecordInput) {
  const input = normalizeInput(raw);
  try {
    return await prisma.$transaction(
      async (tx) => {
        const originalOperation = await tx.manualSubscriptionRefund.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (originalOperation && !sameOperation(originalOperation, input))
          fail("billingManualRefundIdempotencyConflict", true);
        const seed = await tx.subscriptionInvoice.findUnique({
          where: { id: input.invoiceId },
          select: { organizationId: true },
        });
        if (!seed) invoiceNotFound();
        // Match the payment/grant lock order and serialize cumulative partial refunds.
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${seed.organizationId} FOR UPDATE`;
        const invoice = await tx.subscriptionInvoice.findUnique({
          where: { id: input.invoiceId },
          include: invoiceInclude,
        });
        if (!invoice) invoiceNotFound();
        assertEligible(invoice);
        const previous = await tx.manualSubscriptionRefund.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (previous) {
          if (!sameOperation(previous, input)) fail("billingManualRefundIdempotencyConflict", true);
          return summarize(invoice);
        }
        const paidDay = businessDateKey(invoice.paidAt!);
        if (
          input.bankTransferredOn < paidDay ||
          input.bankTransferredOn > businessDateKey(new Date())
        )
          fail("billingManualRefundDateInvalid");
        if (
          await tx.manualSubscriptionRefund.findUnique({
            where: { bankOperationKey: input.bankOperationKey },
          })
        )
          fail("billingManualRefundBankOperationUsed", true);
        if (input.amountMinor > summarize(invoice).remainingRefundableMinor)
          fail("billingManualRefundAmountInvalid");
        const record = await tx.manualSubscriptionRefund.create({
          data: {
            organizationId: invoice.organizationId,
            invoiceId: invoice.id,
            amountMinor: input.amountMinor,
            bankOperationId: input.bankOperationId,
            bankOperationKey: input.bankOperationKey,
            bankTransferredOn: input.date,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            recordedById: input.actorId,
            proofType: "OPERATOR_ATTESTATION",
          },
        });
        await writeAuditLog(tx, {
          organizationId: invoice.organizationId,
          actorId: input.actorId,
          action: "SUBSCRIPTION_MANUAL_REFUND_RECORDED",
          entity: "ManualSubscriptionRefund",
          entityId: record.id,
          before: { refundedMinor: summarize(invoice).refundedMinor },
          after: {
            invoiceId: invoice.id,
            orderId: invoice.providerOrderId!,
            amountMinor: record.amountMinor,
            bankOperationId: record.bankOperationId,
            bankTransferredOn: input.bankTransferredOn,
            reason: record.reason,
            recordedById: record.recordedById,
            proofType: record.proofType,
            idempotencyKey: record.idempotencyKey,
            accessChanged: false,
            providerContacted: false,
          },
          requestId: input.requestId,
        });
        return summarize({ ...invoice, manualRefunds: [...invoice.manualRefunds, record] });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  } catch (error) {
    // Unique constraints arbitrate simultaneous attempts on different invoices/orgs.
    // Recover only an identical committed record, never issue another transfer/key.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
      throw error;
    const previous = await prisma.manualSubscriptionRefund.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (previous) {
      if (!sameOperation(previous, input)) fail("billingManualRefundIdempotencyConflict", true);
      const invoice = await prisma.subscriptionInvoice.findUnique({
        where: { id: input.invoiceId },
        include: invoiceInclude,
      });
      if (!invoice) invoiceNotFound();
      assertEligible(invoice);
      return summarize(invoice);
    }
    if (
      await prisma.manualSubscriptionRefund.findUnique({
        where: { bankOperationKey: input.bankOperationKey },
      })
    )
      fail("billingManualRefundBankOperationUsed", true);
    throw error;
  }
}
