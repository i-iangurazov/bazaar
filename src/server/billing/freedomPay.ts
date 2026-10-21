import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";

import { AppError } from "@/server/services/errors";
import { getSubscriptionPaymentConfig } from "./paymentConfig";
import { minorToKgs } from "./paymentMath";

export type SignedValue = string | SignedValue[] | { [key: string]: SignedValue };
export type SignedFields = Record<string, SignedValue>;
const API = "https://api.freedompay.kg/";
export const RESULT_SCRIPT = "result";
export const CHECK_SCRIPT = "check";
export const PAYMENT_BODY_LIMIT = 65_536;

const values = (value: SignedValue): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(values);
  return Object.keys(value)
    .sort()
    .flatMap((key) => values(value[key]));
};

// Freedom Pay's prescribed wire protocol is MD5(script;sorted values;secret).
// Include unknown signed fields; never reserialize amounts or decoded text.
export const signFreedomPay = (script: string, fields: SignedFields, secret: string) =>
  createHash("md5")
    .update(
      [
        script,
        ...Object.keys(fields)
          .filter((key) => key !== "pg_sig")
          .sort()
          .flatMap((key) => values(fields[key])),
        secret,
      ].join(";"),
      "utf8",
    )
    .digest("hex");

export const scalar = (fields: SignedFields, key: string) => {
  const value = fields[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new AppError("billingInvalidProviderResponse");
  return value;
};

export const verifyFreedomPay = (script: string, fields: SignedFields, secret: string) => {
  const signature = scalar(fields, "pg_sig");
  if (!secret || !scalar(fields, "pg_salt") || !signature || !/^[a-f0-9]{32}$/.test(signature))
    throw new AppError("billingInvalidSignature", "UNAUTHORIZED", 401);
  const expected = signFreedomPay(script, fields, secret);
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex")))
    throw new AppError("billingInvalidSignature", "UNAUTHORIZED", 401);
};

type XmlNode = Record<string, XmlNode[] | string>;
const xmlFields = (nodes: XmlNode[]): SignedFields => {
  const result: SignedFields = Object.create(null);
  for (const node of nodes) {
    for (const [key, children] of Object.entries(node)) {
      if (key === "#text") {
        if (typeof children === "string" && children.trim())
          throw new AppError("billingInvalidProviderResponse");
        continue;
      }
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) || !Array.isArray(children))
        throw new AppError("billingInvalidProviderResponse");
      let value: SignedValue;
      if (children.every((child) => Object.keys(child).every((k) => k === "#text"))) {
        value = children.map((child) => child["#text"] ?? "").join("");
      } else value = xmlFields(children);
      if (Object.hasOwn(result, key)) {
        const previous = result[key];
        result[key] = Array.isArray(previous) ? [...previous, value] : [previous, value];
      } else result[key] = value;
    }
  }
  return result;
};

export const parseFreedomPayXml = (body: string): SignedFields => {
  if (
    Buffer.byteLength(body, "utf8") > PAYMENT_BODY_LIMIT ||
    /<!DOCTYPE|<!ENTITY|<!--/i.test(body) ||
    XMLValidator.validate(body) !== true
  )
    throw new AppError("billingInvalidProviderResponse");
  try {
    const parser = new XMLParser({
      preserveOrder: true,
      ignoreDeclaration: true,
      ignoreAttributes: false,
      parseTagValue: false,
      trimValues: false,
    });
    const root = parser.parse(body) as XmlNode[];
    const meaningful = root.filter(
      (node) => !(typeof node["#text"] === "string" && !node["#text"].trim()),
    );
    if (
      meaningful.length !== 1 ||
      Object.keys(meaningful[0]).length !== 1 ||
      !Array.isArray(meaningful[0].response)
    )
      throw new Error("invalidRoot");
    return xmlFields(meaningful[0].response);
  } catch {
    throw new AppError("billingInvalidProviderResponse");
  }
};

export const readPaymentBody = async (request: Pick<Request, "headers" | "body">) => {
  if (Number(request.headers.get("content-length") ?? 0) > PAYMENT_BODY_LIMIT)
    throw new AppError("billingInvalidProviderResponse");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("billingInvalidProviderResponse");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > PAYMENT_BODY_LIMIT) {
      await reader.cancel();
      throw new AppError("billingInvalidProviderResponse");
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks).toString("utf8");
};

export const parsePaymentNotification = async (request: Request): Promise<SignedFields> => {
  const type = request.headers.get("content-type") ?? "";
  const body = await readPaymentBody(request);
  if (!/^(application\/x-www-form-urlencoded|multipart\/form-data)(?:;|$)/i.test(type))
    throw new AppError("billingInvalidProviderResponse");
  const form = await new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": type },
    body,
  }).formData();
  const fields: SignedFields = Object.create(null);
  for (const [key, value] of form.entries()) {
    if (
      typeof value !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9_]{0,80}$/.test(key) ||
      Object.hasOwn(fields, key) ||
      Object.keys(fields).length >= 100
    )
      throw new AppError("billingInvalidProviderResponse");
    fields[key] = value;
  }
  return fields;
};

export const allowedCheckoutUrl = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["api.freedompay.kg", "freedompay.kg"].includes(url.hostname)
    );
  } catch {
    return false;
  }
};

export const getPaymentCredentials = (merchantId: string) => {
  const config = getSubscriptionPaymentConfig();
  if (!config.secretKey || config.merchantId !== merchantId)
    throw new AppError("billingPaymentsUnavailable", "CONFLICT", 409);
  return config;
};

const call = async (script: string, fields: Record<string, string>, secret: string) => {
  if (process.env.HARDENING_EXTERNAL_PROVIDER_MODE === "disabled")
    throw new AppError("billingPaymentsUnavailable", "CONFLICT", 409);
  const params = { ...fields, pg_salt: randomBytes(16).toString("hex") };
  const body = new URLSearchParams({ ...params, pg_sig: signFreedomPay(script, params, secret) });
  const response = await fetch(API + script, {
    method: "POST",
    body,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new AppError("billingProviderUnavailable", "CONFLICT", 409);
  const result = parseFreedomPayXml(await readPaymentBody(response));
  verifyFreedomPay(script, result, secret);
  return result;
};

export const initializeFreedomPay = async (input: {
  id: string;
  merchantId: string;
  amountMinor: number;
  plan: string;
  isTest: boolean;
  locale: string;
}) => {
  const config = getPaymentCredentials(input.merchantId);
  const returnUrl = `${config.publicOrigin}/billing?invoice=${encodeURIComponent(input.id)}`;
  const fields = await call(
    "init_payment.php",
    {
      pg_merchant_id: input.merchantId,
      pg_order_id: input.id,
      pg_amount: minorToKgs(input.amountMinor),
      pg_currency: "KGS",
      pg_description: `Bazaar ${input.plan}: 1 month`,
      pg_testing_mode: input.isTest ? "1" : "0",
      pg_lifetime: "900",
      pg_postpone_payment: "0",
      pg_request_method: "POST",
      pg_check_url: `${config.publicOrigin}/api/billing/freedompay/check`,
      pg_result_url: `${config.publicOrigin}/api/billing/freedompay/result`,
      pg_success_url: returnUrl,
      pg_failure_url: returnUrl,
      pg_success_url_method: "GET",
      pg_failure_url_method: "GET",
      pg_language: input.locale === "en" ? "en" : "ru",
    },
    config.secretKey,
  );
  if (scalar(fields, "pg_status") !== "ok") return { accepted: false as const };
  const paymentId = scalar(fields, "pg_payment_id");
  const checkoutUrl = scalar(fields, "pg_redirect_url");
  if (
    !paymentId ||
    !/^[1-9]\d{0,29}$/.test(paymentId) ||
    !checkoutUrl ||
    !allowedCheckoutUrl(checkoutUrl)
  )
    throw new AppError("billingInvalidProviderResponse");
  return { accepted: true as const, paymentId, checkoutUrl };
};

export const getFreedomPayStatus = async (input: {
  id: string;
  merchantId: string;
  providerPaymentId: string | null;
}) => {
  const config = getPaymentCredentials(input.merchantId);
  return call(
    "get_status3.php",
    {
      pg_merchant_id: input.merchantId,
      ...(input.providerPaymentId
        ? { pg_payment_id: input.providerPaymentId }
        : { pg_order_id: input.id }),
    },
    config.secretKey,
  );
};

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
export const paymentAcknowledgement = (script: string, secret: string, accepted: boolean) => {
  const fields = {
    pg_status: accepted ? "ok" : "error",
    pg_description: accepted ? "Notification accepted" : "Notification not accepted",
    pg_salt: randomBytes(16).toString("hex"),
  };
  const signed = { ...fields, pg_sig: signFreedomPay(script, fields, secret) };
  return `<?xml version="1.0" encoding="utf-8"?><response>${Object.entries(signed)
    .map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`)
    .join("")}</response>`;
};
