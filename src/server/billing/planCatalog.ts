import type { OrganizationPlan } from "@prisma/client";

export const PLAN_CODES = ["STARTER", "BUSINESS", "ENTERPRISE"] as const;

export type PlanCode = (typeof PLAN_CODES)[number];

export type PlanFeature =
  | "imports"
  | "exports"
  | "analytics"
  | "compliance"
  | "supportToolkit"
  | "pos"
  | "stockCounts"
  | "priceTags"
  | "storePrices"
  | "bundles"
  | "expiryLots"
  | "customerOrders"
  | "periodClose"
  | "kkm";

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
};

const PLAN_LIMITS: Record<PlanCode, PlanLimits> = {
  STARTER: {
    maxStores: 1,
    maxProducts: 100,
    maxActiveUsers: 5,
  },
  BUSINESS: {
    maxStores: 3,
    maxProducts: 500,
    maxActiveUsers: 10,
  },
  ENTERPRISE: {
    maxStores: 10,
    maxProducts: 1000,
    maxActiveUsers: 20,
  },
};

const PLAN_PRICES_KGS: Record<PlanCode, number> = {
  STARTER: 1750,
  BUSINESS: 4375,
  ENTERPRISE: 8750,
};

const PLAN_FEATURES: Record<PlanCode, PlanFeatureMap> = {
  STARTER: {
    imports: false,
    exports: false,
    analytics: false,
    compliance: false,
    supportToolkit: false,
    pos: false,
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

const FEATURE_ERROR_KEYS: Record<PlanFeature, string> = {
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

export const toPlanCode = (plan: OrganizationPlan | string): PlanCode => {
  const value = String(plan);
  if (value === "ENTERPRISE") {
    return "ENTERPRISE";
  }
  if (value === "BUSINESS" || value === "PRO") {
    return "BUSINESS";
  }
  return "STARTER";
};

export const getPlanLimits = (plan: OrganizationPlan | string): PlanLimits => {
  return PLAN_LIMITS[toPlanCode(plan)];
};

export const getPlanFeatureMap = (plan: OrganizationPlan | string): PlanFeatureMap => {
  return PLAN_FEATURES[toPlanCode(plan)];
};

export const getPlanFeatures = (plan: OrganizationPlan | string): PlanFeature[] => {
  const map = getPlanFeatureMap(plan);
  return (Object.keys(map) as PlanFeature[]).filter((feature) => map[feature]);
};

export const hasFeature = (plan: OrganizationPlan | string, feature: PlanFeature) => {
  return getPlanFeatureMap(plan)[feature] === true;
};

export const getFeatureLockedErrorKey = (feature: PlanFeature) => FEATURE_ERROR_KEYS[feature];

export const getPlanMonthlyPriceKgsOverride = (plan: OrganizationPlan | string) => {
  const key = PLAN_PRICE_OVERRIDE_ENV_KEY[toPlanCode(plan)];
  return toPositiveNumber(process.env[key]);
};

export const getPlanMonthlyPriceKgs = (plan: OrganizationPlan | string) => {
  const override = getPlanMonthlyPriceKgsOverride(plan);
  if (override !== null) {
    return override;
  }
  return PLAN_PRICES_KGS[toPlanCode(plan)];
};

export const getPlanCatalogEntry = (plan: PlanCode): PlanDefinition => ({
  code: plan,
  limits: PLAN_LIMITS[plan],
  features: PLAN_FEATURES[plan],
});

export const getPlanCatalogEntries = () => PLAN_CODES.map((planCode) => getPlanCatalogEntry(planCode));
