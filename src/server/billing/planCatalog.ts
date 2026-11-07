import type { OrganizationPlan } from "@prisma/client";
import {
  CURRENT_CATALOG_VERSION, PUBLISHED_CATALOG_VERSION, LEGACY_CATALOG_VERSION, NEW_MONTHLY_PRICES_KGS,
  type SubscriptionCatalogVersion, type SubscriptionExtras, validateSubscriptionExtras,
} from "@/lib/billing/subscriptionPricing";
import { PLAN_CODES, PLAN_FEATURE_CODES, toPlanCode, type PlanCode, type PlanFeature } from "@/lib/billing/plans";

export { PLAN_CODES, toPlanCode } from "@/lib/billing/plans";
export type { PlanCode, PlanFeature } from "@/lib/billing/plans";

export type PlanLimits = {
  maxStores: number;
  maxProducts: number;
  maxActiveUsers: number;
};

export type PlanFeatureMap = Record<PlanFeature, boolean>;

export type PlanDefinition = {
  code: PlanCode;
  limits: PlanLimits;
  features: PlanFeatureMap;
  monthlyPriceKgs: number;
  usageLimits: PlanUsageLimits;
  countArchivedProducts: boolean;
};

export type PlanUsageLimits = {
  ai: number | null;
  images: number | null;
  marketingEmails: number | null;
  externalApi: number | null;
  marketplaceChannels: number | null;
  marketplaceRunsDaily: number | null;
  marketplaceFullRunsDaily: number | null;
};

const LEGACY_PLAN_LIMITS: Record<PlanCode, PlanLimits> = {
  STARTER: {
    maxStores: 1,
    maxProducts: 1000,
    maxActiveUsers: 5,
  },
  BUSINESS: {
    maxStores: 5,
    maxProducts: 5000,
    maxActiveUsers: 10,
  },
  ENTERPRISE: {
    maxStores: 15,
    maxProducts: 20000,
    maxActiveUsers: 20,
  },
};

const LEGACY_PLAN_PRICES_KGS: Record<PlanCode, number> = {
  STARTER: 1750,
  BUSINESS: 4375,
  ENTERPRISE: 8750,
};

const PLAN_FEATURES: Record<PlanCode, Partial<PlanFeatureMap>> = {
  STARTER: {
    imports: false,
    exports: false,
    analytics: false,
    compliance: false,
    supportToolkit: false,
    pos: true,
    stockCounts: false,
    priceTags: true,
    storePrices: false,
    bundles: false,
    expiryLots: false,
    customerOrders: true,
    periodClose: false,
    kkm: false,
  },
  BUSINESS: {
    imports: true,
    exports: true,
    analytics: true,
    compliance: false,
    supportToolkit: false,
    pos: true,
    stockCounts: true,
    priceTags: true,
    storePrices: true,
    bundles: true,
    expiryLots: true,
    customerOrders: true,
    periodClose: true,
    kkm: false,
  },
  ENTERPRISE: {
    imports: true,
    exports: true,
    analytics: true,
    compliance: true,
    supportToolkit: true,
    pos: true,
    stockCounts: true,
    priceTags: true,
    storePrices: true,
    bundles: true,
    expiryLots: true,
    customerOrders: true,
    periodClose: true,
    kkm: true,
  },
};

const FEATURE_ERROR_KEYS: Partial<Record<PlanFeature, string>> = {
  imports: "featureLockedImports",
  exports: "featureLockedExports",
  analytics: "featureLockedAnalytics",
  compliance: "featureLockedCompliance",
  supportToolkit: "featureLockedSupportToolkit",
  pos: "featureLockedPos",
  stockCounts: "featureLockedStockCounts",
  priceTags: "featureLockedPriceTags",
  storePrices: "featureLockedStorePrices",
  bundles: "featureLockedBundles",
  expiryLots: "featureLockedExpiryLots",
  customerOrders: "featureLockedCustomerOrders",
  periodClose: "featureLockedPeriodClose",
  kkm: "featureLockedKkm",
};

const PLAN_PRICE_OVERRIDE_ENV_KEY: Record<PlanCode, string> = {
  STARTER: "PLAN_PRICE_STARTER_KGS",
  BUSINESS: "PLAN_PRICE_BUSINESS_KGS",
  ENTERPRISE: "PLAN_PRICE_ENTERPRISE_KGS",
};

const toPositiveNumber = (value: string | undefined) => {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const NEW_PLAN_LIMITS: Record<PlanCode, PlanLimits> = {
  STARTER: { maxStores: 1, maxProducts: 1000, maxActiveUsers: 2 },
  BUSINESS: { maxStores: 1, maxProducts: 5000, maxActiveUsers: 5 },
  ENTERPRISE: { maxStores: 1, maxProducts: 15000, maxActiveUsers: 15 },
};

export const getPlanLimits = (
  plan: OrganizationPlan | string,
  version: SubscriptionCatalogVersion = LEGACY_CATALOG_VERSION,
  extras?: SubscriptionExtras,
): PlanLimits => {
  const code = toPlanCode(plan);
  if (extras) validateSubscriptionExtras(code, extras);
  const base = (version === CURRENT_CATALOG_VERSION ? NEW_PLAN_LIMITS : LEGACY_PLAN_LIMITS)[code];
  // Add-ons are a new-catalog product. Existing contracts keep their resources.
  const extraStores = version === CURRENT_CATALOG_VERSION ? extras?.stores ?? 0 : 0;
  const reserve = version === CURRENT_CATALOG_VERSION ? extras?.productPacks ?? 0 : 0;
  return { maxStores: base.maxStores + extraStores, maxProducts: base.maxProducts + reserve * 1000,
    maxActiveUsers: base.maxActiveUsers + reserve * 2 };
};

export const getPlanFeatureMap = (
  plan: OrganizationPlan | string,
  version: SubscriptionCatalogVersion = LEGACY_CATALOG_VERSION,
): PlanFeatureMap => {
  const code = toPlanCode(plan);
  const legacy = PLAN_FEATURES[code];
  const flags = Object.fromEntries(PLAN_FEATURE_CODES.map((feature) =>
    [feature, legacy[feature] ?? true])) as PlanFeatureMap;
  if (version === LEGACY_CATALOG_VERSION) return { ...flags, priceBooks: flags.storePrices };
  const managed = code !== "STARTER";
  const advanced = code === "ENTERPRISE";
  return { ...flags,
    stockCounts: true, storePrices: true, supportToolkit: true,
    bundles: advanced, expiryLots: advanced, periodClose: advanced,
    kkm: false,
    bulkProducts: managed, priceBooks: managed, assortments: managed,
    purchaseOrders: managed, replenishment: advanced, loyalty: managed,
    emailMarketing: managed, marketingAutomation: advanced, ownSender: advanced,
    bazaarCatalog: managed, bazaarApi: advanced, marketplaces: advanced,
    bakaiExport: managed, bulkAiContent: managed, imageStudio: managed,
    initialImport: true, rawDataExport: true,
  };
};

export const getPlanUsageLimits = (
  plan: OrganizationPlan | string,
  version: SubscriptionCatalogVersion = LEGACY_CATALOG_VERSION,
): PlanUsageLimits => {
  if (version === LEGACY_CATALOG_VERSION) return { ai: null, images: null, marketingEmails: null,
    externalApi: null, marketplaceChannels: null, marketplaceRunsDaily: null, marketplaceFullRunsDaily: null };
  const code = toPlanCode(plan);
  return {
    ai: { STARTER: 100, BUSINESS: 300, ENTERPRISE: 500 }[code],
    images: { STARTER: 0, BUSINESS: 5, ENTERPRISE: 10 }[code],
    marketingEmails: { STARTER: 0, BUSINESS: 500, ENTERPRISE: 1500 }[code],
    externalApi: code === "ENTERPRISE" ? 10000 : 0,
    marketplaceChannels: code === "ENTERPRISE" ? 1 : 0,
    marketplaceRunsDaily: code === "ENTERPRISE" ? 24 : 0,
    marketplaceFullRunsDaily: code === "ENTERPRISE" ? 1 : 0,
  };
};

export const getPlanFeatures = (plan: OrganizationPlan | string,
  version: SubscriptionCatalogVersion = LEGACY_CATALOG_VERSION): PlanFeature[] => {
  const map = getPlanFeatureMap(plan, version);
  return PLAN_FEATURE_CODES.filter((feature) => map[feature]);
};
export const hasFeature = (plan: OrganizationPlan | string, feature: PlanFeature,
  version: SubscriptionCatalogVersion = LEGACY_CATALOG_VERSION) => getPlanFeatureMap(plan, version)[feature];
export const getFeatureLockedErrorKey = (feature: PlanFeature) => FEATURE_ERROR_KEYS[feature] ?? "featureLockedPlan";

export const getPlanMonthlyPriceKgsOverride = (
  plan: OrganizationPlan | string,
  version: SubscriptionCatalogVersion = PUBLISHED_CATALOG_VERSION,
) => version === LEGACY_CATALOG_VERSION
  ? toPositiveNumber(process.env[PLAN_PRICE_OVERRIDE_ENV_KEY[toPlanCode(plan)]]) : null;

export const getPlanMonthlyPriceKgs = (
  plan: OrganizationPlan | string,
  version: SubscriptionCatalogVersion = PUBLISHED_CATALOG_VERSION,
) => {
  const override = getPlanMonthlyPriceKgsOverride(plan, version);
  if (override !== null) {
    return override;
  }
  return (version === LEGACY_CATALOG_VERSION ? LEGACY_PLAN_PRICES_KGS : NEW_MONTHLY_PRICES_KGS)[toPlanCode(plan)];
};

export const getPlanCatalogEntry = (plan: PlanCode, version: SubscriptionCatalogVersion = PUBLISHED_CATALOG_VERSION): PlanDefinition => ({
  code: plan,
  limits: getPlanLimits(plan, version),
  features: getPlanFeatureMap(plan, version),
  usageLimits: getPlanUsageLimits(plan, version),
  countArchivedProducts: version === LEGACY_CATALOG_VERSION,
  monthlyPriceKgs: getPlanMonthlyPriceKgs(plan, version),
});

export const getPlanCatalogEntries = (version: SubscriptionCatalogVersion = PUBLISHED_CATALOG_VERSION) =>
  PLAN_CODES.map((planCode) => getPlanCatalogEntry(planCode, version));
