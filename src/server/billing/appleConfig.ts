import { z } from "zod";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";

export const APPLE_BUNDLE_ID = "kg.bazaar.app";
export const APPLE_MANAGEMENT_URL = "https://apps.apple.com/account/subscriptions";
export const APPLE_WHATSAPP_OFFER_VERSION = "2026-11-ios-nonexpiring-v1";
export const appleProductTypeSchema = z.enum(["AUTO_RENEWABLE", "NON_RENEWING", "CONSUMABLE"]);
export type AppleProductType = z.infer<typeof appleProductTypeSchema>;
export const appleProductMappingSchema = z.object({
  offerKey: z.string().min(1).max(400),
  productId: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
  productType: appleProductTypeSchema,
  approved: z.literal(true),
  subscriptionGroupId: z.string().min(1).max(100).optional(),
  // Consumable WhatsApp purchases have their own non-expiring Apple terms.
  appleOfferVersion: z.literal(APPLE_WHATSAPP_OFFER_VERSION).optional(),
}).strict();
export type AppleProductMapping = z.infer<typeof appleProductMappingSchema>;

/** A fail-closed, reviewed mapping. Catalog values are service valuations, never Apple prices. */
export function appleBillingConfig(env: Record<string, string | undefined> = process.env) {
  const mode = env.APPLE_BILLING_MODE === "live" ? "live" : env.APPLE_BILLING_MODE === "sandbox" ? "sandbox" : "off";
  const environment = mode === "sandbox" ? "Sandbox" : "Production";
  let catalog: AppleProductMapping[] = [];
  let catalogValid = false;
  try {
    catalog = z.array(appleProductMappingSchema).min(1).max(2000).parse(JSON.parse(env.APPLE_BILLING_CATALOG_JSON ?? "[]"));
    catalogValid = new Set(catalog.map((v) => v.offerKey)).size === catalog.length &&
      new Set(catalog.map((v) => v.productId)).size === catalog.length &&
      catalog.every((v) => v.productType !== "AUTO_RENEWABLE" || Boolean(v.subscriptionGroupId)) &&
      catalog.every((v) => v.productType !== "CONSUMABLE" || v.appleOfferVersion === APPLE_WHATSAPP_OFFER_VERSION) &&
      catalog.filter((v) => v.productType === "AUTO_RENEWABLE").length <= 100 &&
      new Set(catalog.filter((v) => v.productType === "AUTO_RENEWABLE").map((v) => v.subscriptionGroupId)).size <= 1;
  } catch { /* Missing or unreviewed product mapping never enables checkout. */ }
  const appAppleId = Number(env.APPLE_APP_ID);
  const appId = Number.isSafeInteger(appAppleId) && appAppleId > 0 ? appAppleId : undefined;
  const keyId = env.APPLE_IAP_KEY_ID?.trim() ?? "";
  const issuerId = env.APPLE_IAP_ISSUER_ID?.trim() ?? "";
  const privateKey = env.APPLE_IAP_PRIVATE_KEY?.replace(/\\n/g, "\n") ?? "";
  const apiReady = Boolean(keyId && issuerId && privateKey.includes("PRIVATE KEY") && appId);
  const termsVersion = env.APPLE_BILLING_TERMS_VERSION?.trim() ?? "";
  const termsUrl = "https://www.bazaar.kg/legal/offer";
  const termsReady = termsVersion === LEGAL_TERMS_VERSION && env.APPLE_BILLING_TERMS_APPROVED === "true";
  const ready = mode !== "off" && catalogValid && apiReady && termsReady && env.APPLE_BILLING_SALES_APPROVED === "true";
  return { mode, environment, catalog: catalogValid ? catalog : [], catalogValid, appAppleId: appId,
    keyId, issuerId, privateKey, apiReady, termsVersion, termsUrl, ready,
    unavailableReason: ready ? null : "appleUnavailable",
    sandboxOrganizations: new Set((env.APPLE_BILLING_SANDBOX_ORGANIZATION_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
  };
}


/** Deployment-owned synthetic/review organizations can use Apple's sandbox on
 * the live app. Never infer this choice from client fields or an unverified JWS. */
export function appleEnvironmentForOrganization(organizationId: string,
  config: ReturnType<typeof appleBillingConfig> = appleBillingConfig()): "Production" | "Sandbox" {
  return config.mode === "sandbox" || config.sandboxOrganizations.has(organizationId) ? "Sandbox" : "Production";
}
