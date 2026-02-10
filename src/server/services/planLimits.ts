import type { OrganizationPlan } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";

const STARTER_LIMITS = {
  maxStores: 1,
  maxUsers: 3,
  maxProducts: 1000,
};

const BUSINESS_LIMITS = {
  maxStores: 5,
  maxUsers: 15,
  maxProducts: 50000,
};

const ENTERPRISE_LIMITS = {
  maxStores: 20,
  maxUsers: 60,
  maxProducts: 200000,
};

export type PlanTier = "STARTER" | "BUSINESS" | "ENTERPRISE";
export type PlanLimits = typeof STARTER_LIMITS;

export type PlanFeature =
  | "imports"
  | "exports"
  | "analytics"
  | "compliance"
  | "supportToolkit";

const PLAN_TIER_FEATURES: Record<PlanTier, readonly PlanFeature[]> = {
  STARTER: [],
  BUSINESS: ["imports", "exports", "analytics", "compliance"],
  ENTERPRISE: ["imports", "exports", "analytics", "compliance", "supportToolkit"],
};

const PLAN_MONTHLY_PRICES: Record<PlanTier, number> = {
  STARTER: Number(process.env.PLAN_PRICE_STARTER_KGS ?? "2500"),
  BUSINESS: Number(process.env.PLAN_PRICE_BUSINESS_KGS ?? "8900"),
  ENTERPRISE: Number(process.env.PLAN_PRICE_ENTERPRISE_KGS ?? "19900"),
};

export const toPlanTier = (plan: OrganizationPlan): PlanTier => {
  const value = String(plan);
  if (value === "ENTERPRISE") {
    return "ENTERPRISE";
  }
  if (value === "BUSINESS" || value === "PRO") {
    return "BUSINESS";
  }
  return "STARTER";
};

export const getLimitsForPlan = (plan: OrganizationPlan): PlanLimits => {
  const tier = toPlanTier(plan);
  if (tier === "ENTERPRISE") {
    return ENTERPRISE_LIMITS;
  }
  if (tier === "BUSINESS") {
    return BUSINESS_LIMITS;
  }
  return STARTER_LIMITS;
};

export const getPlanFeatures = (plan: OrganizationPlan): readonly PlanFeature[] =>
  PLAN_TIER_FEATURES[toPlanTier(plan)];

export const hasPlanFeature = (plan: OrganizationPlan, feature: PlanFeature) =>
  getPlanFeatures(plan).includes(feature);

export const getPlanMonthlyPrice = (plan: OrganizationPlan) => PLAN_MONTHLY_PRICES[toPlanTier(plan)];

export const getOrganizationPlan = async (organizationId: string) => {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, plan: true, trialEndsAt: true, subscriptionStatus: true, currentPeriodEndsAt: true },
  });
  if (!org) {
    throw new AppError("orgNotFound", "NOT_FOUND", 404);
  }
  return org;
};

export const assertTrialActive = async (organizationId: string) => {
  const org = await getOrganizationPlan(organizationId);
  if (org.subscriptionStatus !== "ACTIVE") {
    throw new AppError("subscriptionInactive", "FORBIDDEN", 403);
  }
  const now = new Date();
  if (org.trialEndsAt && org.trialEndsAt < now && (!org.currentPeriodEndsAt || org.currentPeriodEndsAt < now)) {
    throw new AppError("trialExpired", "FORBIDDEN", 403);
  }
  return org;
};

export const assertCapacity = async (input: {
  organizationId: string;
  kind: "stores" | "users" | "products";
  add: number;
}) => {
  const org = await assertTrialActive(input.organizationId);
  const limits = getLimitsForPlan(org.plan);
  const limit =
    input.kind === "stores"
      ? limits.maxStores
      : input.kind === "users"
        ? limits.maxUsers
        : limits.maxProducts;

  let count = 0;
  if (input.kind === "stores") {
    count = await prisma.store.count({ where: { organizationId: input.organizationId } });
  } else if (input.kind === "users") {
    count = await prisma.user.count({ where: { organizationId: input.organizationId, isActive: true } });
  } else {
    count = await prisma.product.count({ where: { organizationId: input.organizationId } });
  }

  if (count + input.add > limit) {
    const errorKey =
      input.kind === "stores"
        ? "planLimitStores"
        : input.kind === "users"
          ? "planLimitUsers"
          : "planLimitProducts";
    throw new AppError(errorKey, "CONFLICT", 409);
  }

  return { org, limits, count, limit };
};

export const assertWithinLimits = async (input: {
  organizationId: string;
  kind: "stores" | "users" | "products";
}) => assertCapacity({ organizationId: input.organizationId, kind: input.kind, add: 1 });

export const assertFeatureEnabled = async (input: {
  organizationId: string;
  feature: PlanFeature;
}) => {
  const org = await assertTrialActive(input.organizationId);
  if (!hasPlanFeature(org.plan, input.feature)) {
    throw new AppError("planFeatureUnavailable", "FORBIDDEN", 403);
  }
  return org;
};
