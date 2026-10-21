export type PaymentMode = "disabled" | "sandbox" | "live";

const localHost = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);

export const getSubscriptionPaymentConfig = (
  env: Record<string, string | undefined> = process.env,
) => {
  const mode: PaymentMode = ["sandbox", "live"].includes(env.BILLING_PAYMENTS_MODE ?? "")
    ? (env.BILLING_PAYMENTS_MODE as PaymentMode)
    : "disabled";
  const merchantId = env.FREEDOMPAY_MERCHANT_ID?.trim() ?? "";
  const secretKey = env.FREEDOMPAY_SECRET_KEY?.trim() ?? "";
  const sellerName = env.BILLING_SELLER_NAME?.trim() ?? "";
  const termsVersion = env.BILLING_TERMS_VERSION?.trim() ?? "";
  let publicOrigin = "";
  let termsUrl = "";
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
    }
  } catch {
    // Configuration errors disable new checkout, never the rest of the product.
  }
  const ready = Boolean(
    mode !== "disabled" &&
    env.HARDENING_EXTERNAL_PROVIDER_MODE !== "disabled" &&
    /^\d{1,20}$/.test(merchantId) &&
    secretKey.length >= 16 &&
    publicOrigin &&
    termsUrl &&
    termsVersion &&
    sellerName &&
    !(mode === "sandbox" && env.VERCEL_ENV === "production") &&
    (mode !== "live" || env.BILLING_LIVE_ACTIVATION_CONFIRMED === "1"),
  );
  return { mode, ready, merchantId, secretKey, publicOrigin, termsUrl, termsVersion, sellerName };
};

export const selfServeSignupEnabled = () =>
  process.env.BILLING_SELF_SERVE_SIGNUP === "1" && getSubscriptionPaymentConfig().ready;
