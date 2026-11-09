import { createHash } from "node:crypto";
import type { BillingPaymentProvider } from "@prisma/client";
import { AppError } from "@/server/services/errors";
import { scalar, type SignedFields } from "./freedomPay";
import { kgsToMinor } from "./paymentMath";
import type { GoPayPayment } from "./gopay";

export type PaymentInvoiceIdentity = {
  id: string;
  provider: BillingPaymentProvider;
  providerOrderId: string | null;
  merchantId: string;
  providerPaymentId: string | null;
  amountMinor: number;
  currency: string;
  isTest: boolean;
};
export type VerifiedPaymentReceipt = {
  provider: BillingPaymentProvider;
  merchantId: string;
  orderId: string;
  paymentId: string;
  amountMinor: number;
  currency: "KGS";
  isTest: boolean;
  state: "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "REFUND_REVIEW";
  payloadDigest: string;
  eventKey: string;
  checkoutUrl?: string;
};
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const mismatch = () => new AppError("billingPaymentMismatch", "CONFLICT", 409);

export function assertPaymentReceipt(
  invoice: PaymentInvoiceIdentity,
  receipt: VerifiedPaymentReceipt,
) {
  if (
    invoice.provider !== receipt.provider ||
    invoice.merchantId !== receipt.merchantId ||
    (invoice.providerOrderId ?? invoice.id) !== receipt.orderId ||
    (invoice.providerPaymentId && invoice.providerPaymentId !== receipt.paymentId) ||
    invoice.currency !== "KGS" ||
    receipt.currency !== "KGS" ||
    !Number.isSafeInteger(receipt.amountMinor) ||
    receipt.amountMinor !== invoice.amountMinor ||
    invoice.isTest !== receipt.isTest ||
    (invoice.isTest && process.env.VERCEL_ENV === "production")
  )
    throw mismatch();
}

// Caller must already verify the FreedomPay signature (webhook or status API).
export function freedomPayReceipt(
  invoice: PaymentInvoiceIdentity,
  fields: SignedFields,
  source: "CALLBACK" | "RECONCILIATION",
): VerifiedPaymentReceipt {
  const paymentId = scalar(fields, "pg_payment_id"),
    orderId = scalar(fields, "pg_order_id"),
    mode = scalar(fields, "pg_testing_mode");
  if (
    invoice.provider !== "FREEDOMPAY" ||
    !paymentId ||
    !/^[1-9]\d{0,29}$/.test(paymentId) ||
    (source === "CALLBACK" && (orderId === undefined || mode === undefined)) ||
    (mode !== undefined && !["0", "1"].includes(mode)) ||
    scalar(fields, "pg_currency") !== "KGS"
  )
    throw mismatch();
  let amountMinor: number;
  try {
    amountMinor = kgsToMinor(scalar(fields, "pg_amount") ?? "");
  } catch {
    throw mismatch();
  }
  const status = scalar(fields, "pg_payment_status"),
    captured = scalar(fields, "pg_captured");
  const refunded =
    ["pg_refund_amount", "pg_revoke_amount"].some((key) => {
      const value = scalar(fields, key);
      return value !== undefined && (!/^-?\d+(?:\.\d{1,2})?$/.test(value) || Number(value) !== 0);
    }) || ["revoked", "refunded"].includes(status ?? "");
  const success =
    source === "CALLBACK"
      ? scalar(fields, "pg_result") === "1"
      : ["ok", "success"].includes(status ?? "");
  const failed =
    source === "CALLBACK"
      ? scalar(fields, "pg_result") === "0"
      : ["failed", "error", "revoked", "incomplete", "expired"].includes(status ?? "");
  const settled =
    success &&
    captured !== "0" &&
    (scalar(fields, "pg_payment_method") !== "bankcard" || captured === "1");
  const state = refunded
    ? "REFUND_REVIEW"
    : settled
      ? "PAID"
      : failed
        ? ["expired", "incomplete"].includes(status ?? "")
          ? "EXPIRED"
          : "FAILED"
        : "PENDING";
  const receipt: VerifiedPaymentReceipt = {
    provider: "FREEDOMPAY",
    merchantId: scalar(fields, "pg_merchant_id") ?? invoice.merchantId,
    orderId: orderId ?? invoice.id,
    paymentId,
    amountMinor,
    currency: "KGS",
    isTest: mode === undefined ? invoice.isTest : mode === "1",
    state,
    payloadDigest: digest(fields),
    eventKey: digest([
      invoice.id,
      paymentId,
      state,
      captured,
      scalar(fields, "pg_refund_amount"),
      scalar(fields, "pg_revoke_amount"),
    ]),
  };
  assertPaymentReceipt(invoice, receipt);
  return receipt;
}

// GoPay status is queried over authenticated TLS; an incoming event alone never grants access.
export function goPayReceipt(
  invoice: PaymentInvoiceIdentity,
  payment: GoPayPayment,
): VerifiedPaymentReceipt {
  const state =
    payment.status === "COMMITTED"
      ? "PAID"
      : payment.status === "EXPIRED"
        ? "EXPIRED"
        : ["CANCELLED", "FAILED"].includes(payment.status)
          ? "FAILED"
          : "PENDING";
  const receipt: VerifiedPaymentReceipt = {
    provider: "GOPAY",
    merchantId: invoice.merchantId,
    orderId: payment.orderId,
    paymentId: payment.paymentId,
    amountMinor: payment.amountMinor,
    currency: "KGS",
    isTest: payment.isTest,
    state,
    payloadDigest: digest(payment),
    eventKey: digest(["GOPAY", invoice.id, payment.paymentId, state]),
    checkoutUrl: payment.checkoutUrl,
  };
  assertPaymentReceipt(invoice, receipt);
  return receipt;
}
