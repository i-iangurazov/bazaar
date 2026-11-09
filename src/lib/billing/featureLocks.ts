import { PLAN_FEATURE_CODES, type PlanFeature } from "./plans";

// Only explicit plan failures become an upgrade prompt. Permission failures,
// provider outages and exhausted usage allowances keep their own recovery.
const featureErrors: Readonly<Record<string, PlanFeature | null>> = {
  featureLockedPlan: null,
  planFeatureUnavailable: null,
  featureLockedImports: "imports",
  featureLockedExports: "exports",
  featureLockedAnalytics: "analytics",
  featureLockedCompliance: "compliance",
  featureLockedSupportToolkit: "supportToolkit",
  featureLockedPos: "pos",
  featureLockedStockCounts: "stockCounts",
  featureLockedPriceTags: "priceTags",
  featureLockedStorePrices: "storePrices",
  featureLockedBundles: "bundles",
  featureLockedExpiryLots: "expiryLots",
  featureLockedCustomerOrders: "customerOrders",
  featureLockedPeriodClose: "periodClose",
  featureLockedKkm: "kkm",
  whatsappPlanRequired: null,
  billingScheduledFeatureRestriction: null,
};

export const featureLockError = (message?: string | null) => {
  const key = message?.replace(/^errors\./, "") ?? "";
  return Object.hasOwn(featureErrors, key) ? { key, feature: featureErrors[key] ?? null } : null;
};

export function featureFromErrorDetails(details: unknown): PlanFeature | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const feature = (details as Record<string, unknown>).feature;
  return typeof feature === "string" && (PLAN_FEATURE_CODES as readonly string[]).includes(feature)
    ? feature as PlanFeature : null;
}

export function isTranslatedFeatureLock(
  description: string,
  translate: { (key: string): string; has?: (key: string) => boolean },
) {
  const separator = description.indexOf(": ");
  const prefix = separator > 0 ? description.slice(0, separator) : null;
  const named = prefix && PLAN_FEATURE_CODES.some(feature => {
    const key = `featureNames.${feature}`;
    return translate.has?.(key) && translate(key) === prefix;
  });
  const message = named ? description.slice(separator + 2) : description;
  return Object.keys(featureErrors).some(key => translate.has?.(key) && message === translate(key));
}
