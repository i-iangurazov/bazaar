// Shared plan identifiers and presentation order. Prices, limits and grants are
// resolved on the server so public pages use the same configuration as billing.
export const PLAN_CODES = ["STARTER", "BUSINESS", "ENTERPRISE"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const PLAN_FEATURE_CODES = [
  "pos",
  "customerOrders",
  "priceTags",
  "imports",
  "exports",
  "analytics",
  "stockCounts",
  "storePrices",
  "bundles",
  "expiryLots",
  "periodClose",
  "compliance",
  "supportToolkit",
  "kkm",
] as const;
export type PlanFeature = (typeof PLAN_FEATURE_CODES)[number];

export const toPlanCode = (plan: string): PlanCode => {
  if (plan === "ENTERPRISE") return "ENTERPRISE";
  if (plan === "BUSINESS" || plan === "PRO") return "BUSINESS";
  return "STARTER";
};

export const getPlanRank = (plan: string) => PLAN_CODES.indexOf(toPlanCode(plan));
