import { createHash } from "node:crypto";
import type { BillingPaymentProvider } from "@prisma/client";
import { legalPublicationState, LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { LIFETIME_ORGANIZATION_IDS } from "./lifetimeOrganizations";
export type PaymentMode = "disabled" | "sandbox" | "live";

const localHost = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);

export const getSubscriptionPaymentConfig = (
  env: Record<string, string | undefined> = process.env,
  explicitProvider?: BillingPaymentProvider,
) => {
  const mode: PaymentMode = ["sandbox", "live"].includes(env.BILLING_PAYMENTS_MODE ?? "")
    ? (env.BILLING_PAYMENTS_MODE as PaymentMode)
    : "disabled";
  // New Bazaar purchases use GoPay exclusively. A stale/invalid setting must
  // disable checkout, never silently route a new invoice to the former provider.
  // Explicit provider selection is reserved for processing persisted history.
  const selection = env.BILLING_PAYMENT_PROVIDER?.trim().toLowerCase() || "gopay";
  const provider: BillingPaymentProvider = explicitProvider ?? "GOPAY";
  const apiKey = env.GOPAY_API_KEY?.trim() ?? "";
  const apiSecret = env.GOPAY_API_SECRET?.trim() ?? "";
  const webhookSecret = env.GOPAY_WEBHOOK_SECRET?.trim() ?? "";
  const merchantId =
    provider === "GOPAY" ? goPayMerchantId(apiKey) : (env.FREEDOMPAY_MERCHANT_ID?.trim() ?? "");
  const secretKey = env.FREEDOMPAY_SECRET_KEY?.trim() ?? "";
  const sellerName = env.BILLING_SELLER_NAME?.trim() ?? "";
  const termsVersion = env.BILLING_TERMS_VERSION?.trim() ?? "";
  let publicOrigin = "";
  let termsUrl = "";
  let canonicalPublicOrigin = false;
  try {
    const origin = new URL(env.BILLING_PUBLIC_URL ?? "");
    const terms = new URL(env.BILLING_TERMS_URL ?? "");
    const allowLocal = mode === "sandbox" && env.VERCEL_ENV !== "production";
    const allowed = (url: URL) =>
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (allowLocal && url.protocol === "http:" && localHost(url.hostname)));
    if (
      allowed(origin) &&
      allowed(terms) &&
      origin.pathname === "/" &&
      !origin.search &&
      !origin.hash
    ) {
      publicOrigin = origin.origin;
      termsUrl = terms.href;
      canonicalPublicOrigin =
        !origin.port && ["bazaar.kg", "www.bazaar.kg"].includes(origin.hostname);
    }
  } catch {
    // Configuration errors disable new checkout, never the rest of the product.
  }
  const legal = legalPublicationState(env);
  const ready = Boolean(
    mode !== "disabled" &&
    env.HARDENING_EXTERNAL_PROVIDER_MODE !== "disabled" &&
    (explicitProvider || selection === "gopay") &&
    (provider === "GOPAY"
      ? /^[\x21-\x7e]{16,512}$/.test(apiKey) &&
        /^[\x21-\x7e]{16,4096}$/.test(apiSecret) &&
        /^[\x21-\x7e]{16,4096}$/.test(webhookSecret)
      : /^\d{1,20}$/.test(merchantId) && secretKey.length >= 16) &&
    publicOrigin &&
    termsUrl &&
    termsVersion &&
    sellerName &&
    !(mode === "sandbox" && env.VERCEL_ENV === "production") &&
    (mode !== "live" ||
      (env.BILLING_LIVE_ACTIVATION_CONFIRMED === "1" &&
        legal.published &&
        termsVersion === LEGAL_TERMS_VERSION &&
        canonicalPublicOrigin &&
        (!env.VERCEL_ENV || env.VERCEL_ENV === "production") &&
        sellerName === legal.seller.legalName &&
        termsUrl === `${publicOrigin}/legal/offer`)),
  );
  return {
    provider,
    apiKey,
    apiSecret,
    webhookSecret,
    mode,
    ready,
    merchantId,
    secretKey,
    publicOrigin,
    termsUrl,
    termsVersion,
    sellerName,
  };
};

// Applies only to creating new purchases. Persisted invoices keep their own
// provider identity and remain verifiable after the pilot scope changes.
export const canCreateBillingCheckout = (
  organizationId: string,
  env: Record<string, string | undefined> = process.env,
) => {
  const config = getSubscriptionPaymentConfig(env);
  if (!config.ready) return false;
  const pilot = env.BILLING_LIVE_PILOT_ORGANIZATION_ID;
  if (config.mode !== "live" || pilot === undefined || pilot === "") return true;
  return (
    /^[A-Za-z0-9_-]{1,80}$/.test(pilot) &&
    pilot === organizationId &&
    !LIFETIME_ORGANIZATION_IDS.has(organizationId)
  );
};

export const selfServeSignupEnabled = () =>
  // Trial creation and owner reminders must not depend on merchant activation.
  // Checkout independently requires a ready, verified payment configuration.
  process.env.BILLING_SELF_SERVE_SIGNUP === "1";

// Persist only a credential identity, never the API key itself.
export const goPayMerchantId = (apiKey: string) =>
  apiKey ? `gopay:${createHash("sha256").update(apiKey).digest("hex").slice(0, 32)}` : "";

export const getGoPayCredentials = (merchantId: string) => {
  for (const prefix of ["GOPAY_", "GOPAY_PREVIOUS_"]) {
    const apiKey = process.env[`${prefix}API_KEY`]?.trim() ?? "";
    const apiSecret = process.env[`${prefix}API_SECRET`]?.trim() ?? "";
    if (
      /^[\x21-\x7e]{16,512}$/.test(apiKey) &&
      /^[\x21-\x7e]{16,4096}$/.test(apiSecret) &&
      goPayMerchantId(apiKey) === merchantId
    )
      return { apiKey, apiSecret };
  }
  throw new Error("GoPay credentials unavailable for invoice");
};

export const paymentOrderId = (kind: "subscription" | "whatsapp", invoiceId: string) =>
  createHash("sha256").update(`bazaar:${kind}:${invoiceId}`).digest("hex").slice(0, 32);
