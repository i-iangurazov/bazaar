import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { AppError } from "@/server/services/errors";
import { kgsToMinor, minorToKgs } from "./paymentMath";

// GoPay's published v1 API uses the same host for Test and Live. The key selects
// the mode; never request a mode by sending the deprecated testing_mode field.
const API = "https://api.gopay.kg";
export const GOPAY_BODY_LIMIT = 65_536;
export const GOPAY_MAX_AMOUNT_MINOR = 99_999_999;

export type GoPayCredentials = { apiKey: string; apiSecret: string };
export type GoPayStatus = "CREATED" | "COMMITTED" | "FAILED" | "EXPIRED" | "CANCELLED";
export type GoPayReceipt = {
  paymentId: string;
  orderId: string;
  amountMinor: number;
  status: GoPayStatus;
  isTest: boolean;
};
export type GoPayPayment = GoPayReceipt & { checkoutUrl: string };
export type GoPayPaymentEvent =
  | "payment.committed"
  | "payment.failed"
  | "payment.expired"
  | "payment.cancelled";
export type GoPayWebhook =
  | { event: GoPayPaymentEvent; payment: GoPayReceipt; createdAt: string; ignored?: never }
  | { event: string; ignored: true; payment?: never; createdAt?: never };

const invalidResponse = (): never => {
  throw new AppError("billingInvalidProviderResponse");
};
const invalidSignature = (): never => {
  throw new AppError("billingInvalidSignature", "UNAUTHORIZED", 401);
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalidResponse();
  return value as Record<string, unknown>;
};
const jsonObject = (body: string): Record<string, unknown> => {
  if (Buffer.byteLength(body, "utf8") > GOPAY_BODY_LIMIT) return invalidResponse();
  try {
    return object(JSON.parse(body));
  } catch {
    return invalidResponse();
  }
};
const validNonce = (nonce: unknown): nonce is string =>
  typeof nonce === "string" && /^[\x21-\x7e]{1,32}$/.test(nonce);
const validSecret = (secret: unknown): secret is string =>
  typeof secret === "string" && secret.length > 0 && secret.length <= 4096;

// Sign the exact UTF-8 bytes sent on the wire, including the final newline.
export const signGoPay = (nonce: string, body: string, secret: string): string => {
  if (!validNonce(nonce) || !validSecret(secret)) return invalidSignature();
  return createHmac("sha512", secret)
    .update(`${nonce}\n${body}\n`, "utf8")
    .digest("hex")
    .toUpperCase();
};

export const verifyGoPaySignature = (
  body: string,
  headers: { nonce: string | null; signature: string | null },
  secret: string,
): void => {
  if (
    !validNonce(headers.nonce) ||
    !validSecret(secret) ||
    typeof headers.signature !== "string" ||
    !/^[A-F0-9]{128}$/.test(headers.signature)
  )
    return invalidSignature();
  const expected = signGoPay(headers.nonce, body, secret);
  if (!timingSafeEqual(Buffer.from(headers.signature, "hex"), Buffer.from(expected, "hex")))
    return invalidSignature();
};

export const readGoPayBody = async (source: Pick<Request, "headers" | "body">): Promise<string> => {
  if (Number(source.headers.get("content-length") ?? 0) > GOPAY_BODY_LIMIT)
    return invalidResponse();
  const reader = source.body?.getReader();
  if (!reader) return invalidResponse();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > GOPAY_BODY_LIMIT) {
        await reader.cancel();
        return invalidResponse();
      }
      chunks.push(chunk.value);
    }
    // Reject invalid UTF-8 instead of changing bytes before signature validation.
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch (error) {
    if (error instanceof AppError) throw error;
    return invalidResponse();
  } finally {
    reader.releaseLock();
  }
};

const orderId = (value: unknown): string => {
  if (typeof value !== "string" || !/^[\x21-\x7e]{1,32}$/.test(value)) return invalidResponse();
  return value;
};
const paymentId = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) return invalidResponse();
  return value;
};
const statuses: ReadonlySet<string> = new Set([
  "CREATED",
  "COMMITTED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
]);

const parseReceipt = (value: unknown): GoPayReceipt => {
  const data = object(value);
  if (typeof data.amount !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(data.amount))
    return invalidResponse();
  let amountMinor: number;
  try {
    amountMinor = kgsToMinor(data.amount);
  } catch {
    return invalidResponse();
  }
  if (
    amountMinor > GOPAY_MAX_AMOUNT_MINOR ||
    typeof data.status !== "string" ||
    !statuses.has(data.status) ||
    (data.currency !== undefined && data.currency !== "KGS")
  )
    return invalidResponse();
  if (data.testing_mode !== undefined && typeof data.testing_mode !== "boolean")
    return invalidResponse();
  // Only a real JSON boolean is accepted. Missing testing_mode means Live.
  return {
    paymentId: paymentId(data.payment_id),
    orderId: orderId(data.order_id),
    amountMinor,
    status: data.status as GoPayStatus,
    isTest: data.testing_mode === true,
  };
};

export const allowedGoPayCheckoutUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      value.length <= 2000 &&
      url.protocol === "https:" &&
      ["pay.gopay.kg", "payment.gopay.kg"].includes(url.hostname) &&
      !url.port &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};

const parsePayment = (value: unknown): GoPayPayment => {
  const data = object(value);
  const receipt = parseReceipt(data);
  if (typeof data.checkout_url !== "string" || !allowedGoPayCheckoutUrl(data.checkout_url))
    return invalidResponse();
  return { ...receipt, checkoutUrl: data.checkout_url };
};

const call = async (
  path: "/v1/payments" | "/v1/payments/query" | "/v1/payments/cancel",
  fields: Record<string, string | number>,
  credentials: GoPayCredentials,
): Promise<GoPayPayment> => {
  if (
    process.env.HARDENING_EXTERNAL_PROVIDER_MODE === "disabled" ||
    typeof credentials.apiKey !== "string" ||
    !/^[\x21-\x7e]{1,512}$/.test(credentials.apiKey) ||
    !validSecret(credentials.apiSecret)
  )
    throw new AppError("billingPaymentsUnavailable", "CONFLICT", 409);
  const body = JSON.stringify(fields);
  const nonce = randomBytes(16).toString("hex");
  let response: Response;
  try {
    response = await fetch(API + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "GoPay-Api-Key": credentials.apiKey,
        "GoPay-Nonce": nonce,
        "GoPay-Signature": signGoPay(nonce, body, credentials.apiSecret),
      },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new AppError("billingProviderUnavailable", "CONFLICT", 409);
  }
  if (!response.ok) throw new AppError("billingProviderUnavailable", "CONFLICT", 409);
  const result = jsonObject(await readGoPayBody(response));
  if (result.status !== "OK" || result.code !== "0000") {
    // Keep the machine code for reconciliation, but do not expose the provider's
    // arbitrary error text (which can contain request data) to logs or clients.
    if (result.status === "FAIL" && typeof result.code === "string" && /^\d{4}$/.test(result.code))
      throw new AppError("billingProviderUnavailable", "CONFLICT", 409, {
        provider: "GOPAY",
        providerCode: result.code,
      });
    return invalidResponse();
  }
  return parsePayment(result.data);
};

type PaymentLookup = {
  orderId: string;
  providerPaymentId?: string | null;
  isTest: boolean;
};
const lookupFields = (input: PaymentLookup): Record<string, string> => {
  const fields: Record<string, string> = { order_id: orderId(input.orderId) };
  if (input.providerPaymentId) fields.payment_id = paymentId(input.providerPaymentId);
  if (typeof input.isTest !== "boolean") return invalidResponse();
  return fields;
};
const verifyIdentity = (payment: GoPayPayment, input: PaymentLookup): GoPayPayment => {
  if (
    payment.orderId !== input.orderId ||
    (input.providerPaymentId && payment.paymentId !== input.providerPaymentId) ||
    payment.isTest !== input.isTest
  )
    return invalidResponse();
  return payment;
};

const returnUrl = (value: string): string => {
  try {
    const url = new URL(value);
    if (value.length > 2000 || url.protocol !== "https:" || url.username || url.password)
      return invalidResponse();
    return url.toString();
  } catch {
    return invalidResponse();
  }
};

export const initializeGoPay = async (
  input: {
    orderId: string;
    amountMinor: number;
    description: string;
    isTest: boolean;
    returnUrl?: string;
    lifetimeSeconds?: number;
  },
  credentials: GoPayCredentials,
): Promise<GoPayPayment> => {
  if (
    !Number.isSafeInteger(input.amountMinor) ||
    input.amountMinor <= 0 ||
    input.amountMinor > GOPAY_MAX_AMOUNT_MINOR
  )
    throw new AppError("billingInvalidAmount");
  if (
    typeof input.description !== "string" ||
    !input.description.trim() ||
    Array.from(input.description).length > 255 ||
    typeof input.isTest !== "boolean"
  )
    return invalidResponse();
  const fields: Record<string, string | number> = {
    order_id: orderId(input.orderId),
    amount: minorToKgs(input.amountMinor),
    description: input.description,
  };
  if (input.returnUrl) {
    fields.success_url = returnUrl(input.returnUrl);
    fields.failure_url = fields.success_url;
  }
  if (input.lifetimeSeconds !== undefined) {
    if (
      !Number.isInteger(input.lifetimeSeconds) ||
      input.lifetimeSeconds < 300 ||
      input.lifetimeSeconds > 86_400
    )
      return invalidResponse();
    fields.lifetime = input.lifetimeSeconds;
  }
  const payment = verifyIdentity(await call("/v1/payments", fields, credentials), input);
  if (payment.amountMinor !== input.amountMinor) return invalidResponse();
  return payment;
};

export const getGoPayStatus = async (
  input: PaymentLookup,
  credentials: GoPayCredentials,
): Promise<GoPayPayment> =>
  verifyIdentity(await call("/v1/payments/query", lookupFields(input), credentials), input);

// Cancel only stops an UNPAID payment. It is never a refund of a paid payment;
// the published GoPay v1 API does not expose a refund endpoint.
export const cancelGoPayPayment = async (
  input: PaymentLookup,
  credentials: GoPayCredentials,
): Promise<GoPayPayment> => {
  const payment = verifyIdentity(
    await call("/v1/payments/cancel", lookupFields(input), credentials),
    input,
  );
  if (payment.status !== "CANCELLED") return invalidResponse();
  return payment;
};

const eventStatuses: Record<GoPayPaymentEvent, GoPayStatus> = {
  "payment.committed": "COMMITTED",
  "payment.failed": "FAILED",
  "payment.expired": "EXPIRED",
  "payment.cancelled": "CANCELLED",
};

export const parseGoPayWebhook = (
  rawBody: string,
  headers: { nonce: string | null; signature: string | null },
  webhookSecret: string,
): GoPayWebhook => {
  if (Buffer.byteLength(rawBody, "utf8") > GOPAY_BODY_LIMIT) return invalidResponse();
  // events_url uses its own webhook_secret, never the API credential secret.
  verifyGoPaySignature(rawBody, headers, webhookSecret);
  const envelope = jsonObject(rawBody);
  if (typeof envelope.event !== "string" || !/^[a-z][a-z0-9_.]{0,79}$/.test(envelope.event))
    return invalidResponse();
  // Shared webhook endpoints can receive test.ping and other documented event
  // families. Authenticate and acknowledge them without changing any access.
  if (!Object.hasOwn(eventStatuses, envelope.event))
    return { event: envelope.event, ignored: true };
  const event = envelope.event as GoPayPaymentEvent;
  const payment = parseReceipt(envelope.data);
  if (
    payment.status !== eventStatuses[event] ||
    typeof envelope.created_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(envelope.created_at) ||
    !Number.isFinite(Date.parse(envelope.created_at))
  )
    return invalidResponse();
  return { event, payment, createdAt: envelope.created_at };
};
