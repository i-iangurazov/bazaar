import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "@/server/services/errors";

const yes = (value?: string) => value === "1";
export function whatsappConfig(env: Record<string, string | undefined> = process.env) {
  const reasons: string[] = [];
  if (!yes(env.WHATSAPP_AI_ENABLED)) reasons.push("moduleDisabled");
  if (!yes(env.WHATSAPP_PARTNER_APPROVED)) reasons.push("partnerApproval");
  if (!yes(env.WHATSAPP_PRIVACY_APPROVED)) reasons.push("privacyApproval");
  if (!yes(env.WHATSAPP_PARTNER_BILLING_CONFIRMED)) reasons.push("partnerBilling");
  if (!yes(env.WHATSAPP_INBOUND_SPEND_CAP_CONFIRMED)) reasons.push("inboundSpendCap");
  // The ordinary partner login JWT lasts only 24 hours. Require the managed
  // Universal Token for onboarding, with an explicit rotation deadline.
  const partnerToken = env.GUPSHUP_UNIVERSAL_TOKEN?.trim() ?? "";
  const tokenExpiresAt = Date.parse(env.GUPSHUP_UNIVERSAL_TOKEN_EXPIRES_AT ?? "");
  const partnerReady = Boolean(
    partnerToken && Number.isFinite(tokenExpiresAt) && tokenExpiresAt > Date.now() + 60000,
  );
  const key = env.WHATSAPP_ENCRYPTION_KEY?.trim() ?? "";
  if (!/^[a-fA-F0-9]{64}$/.test(key)) reasons.push("encryptionKey");
  let origin = "";
  try {
    const url = new URL(env.WHATSAPP_PUBLIC_URL ?? "");
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    )
      origin = url.origin;
  } catch {
    /* A disabled integration never prevents Bazaar from starting. */
  }
  if (!origin) reasons.push("publicUrl");
  if (env.HARDENING_EXTERNAL_PROVIDER_MODE === "disabled") reasons.push("externalCallsDisabled");
  // An AI outage or onboarding-token rotation must not stop employee replies
  // through an already verified app-scoped connection.
  const transportReady = reasons.length === 0;
  const onboardingReady = transportReady && partnerReady;
  if (!partnerReady) reasons.push("partnerCredentials");
  const salesReady = transportReady && yes(env.WHATSAPP_PILOT_APPROVED);
  const aiReasons: string[] = [];
  if (!env.DEEPSEEK_API_KEY?.trim()) aiReasons.push("deepseekCredentials");
  const dailyBudgetMicros = Number(env.WHATSAPP_DAILY_BUDGET_USD_MICROS ?? 100_000_000);
  if (
    !Number.isSafeInteger(dailyBudgetMicros) ||
    dailyBudgetMicros < 10000 ||
    dailyBudgetMicros > 100_000_000_000
  )
    aiReasons.push("providerBudget");
  if (!yes(env.WHATSAPP_PILOT_APPROVED)) aiReasons.push("pilotApproval");
  return {
    ready: transportReady && aiReasons.length === 0,
    transportReady,
    onboardingReady,
    salesReady,
    reasons: [...reasons, ...aiReasons],
    origin,
    encryptionKey: key,
    partnerToken,
    tokenExpiresAt,
    deepseekKey: env.DEEPSEEK_API_KEY?.trim() ?? "",
    paymentsApproved: yes(env.WHATSAPP_PACK_PAYMENTS_APPROVED),
    dailyBudgetMicros,
  };
}

function encryptionKey() {
  const key = whatsappConfig().encryptionKey;
  if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new AppError("whatsappNotReady", "CONFLICT", 409);
  return Buffer.from(key, "hex");
}
/** Separate key and authenticated tenant binding; no NEXTAUTH_SECRET fallback. */
export function encryptWhatsAppSecret(secret: string, scope: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(scope));
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function decryptWhatsAppSecret(encrypted: string, scope: string) {
  try {
    const [version, iv, tag, data, extra] = encrypted.split(".");
    if (version !== "v1" || !iv || !tag || !data || extra) throw new Error("invalid");
    // Keep former keys only during a controlled rotation; new data always uses the current key.
    const previous = (process.env.WHATSAPP_PREVIOUS_ENCRYPTION_KEYS ?? "")
      .split(",")
      .filter((value) => /^[a-fA-F0-9]{64}$/.test(value))
      .slice(0, 2);
    for (const key of [encryptionKey(), ...previous.map((value) => Buffer.from(value, "hex"))]) {
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
        decipher.setAAD(Buffer.from(scope));
        decipher.setAuthTag(Buffer.from(tag, "base64url"));
        return Buffer.concat([
          decipher.update(Buffer.from(data, "base64url")),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        /* Try only the explicitly configured rotation keys. */
      }
    }
    throw new Error("invalid");
  } catch {
    throw new AppError("whatsappReconnectRequired", "CONFLICT", 409);
  }
}
export function validWhatsAppWebhookSecret(received: string | null, expected: string) {
  if (!received || expected.length < 32 || received.length > 256) return false;
  const a = Buffer.from(received),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
