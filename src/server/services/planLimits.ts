import type { OrganizationPlan } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import {
  getFeatureLockedErrorKey,
  getPlanFeatures as getCatalogFeatures,
  getPlanLimits as getCatalogLimits,
  getPlanMonthlyPriceKgs,
  hasFeature,
  type PlanCode,
  type PlanFeature,
  toPlanCode,
} from "@/server/billing/planCatalog";
import { AppError } from "@/server/services/errors";

export type PlanTier = PlanCode;
export type PlanLimits = {
  maxStores: number;
  maxUsers: number;
  maxProducts: number;
};

export type { PlanFeature } from "@/server/billing/planCatalog";

export const toPlanTier = (plan: OrganizationPlan): PlanTier => toPlanCode(plan);

type OrganizationAccessPlan = {
  plan: OrganizationPlan;
  subscriptionStatus: "ACTIVE" | "PAST_DUE" | "CANCELED" | string;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
};

export const hasActivePaidOrApprovedSubscription = (
  org: OrganizationAccessPlan,
  now = new Date(),
) => {
  if (org.subscriptionStatus !== "ACTIVE") {
    return false;
  }

  const currentPeriodActive = !org.currentPeriodEndsAt || org.currentPeriodEndsAt >= now;

  if (org.plan !== "STARTER") {
    return currentPeriodActive;
  }

  if (!org.trialEndsAt) {
    return currentPeriodActive;
  }

  if (!org.currentPeriodEndsAt) {
    return org.trialEndsAt < now;
  }

  return org.trialEndsAt < now && org.currentPeriodEndsAt >= now;
};

export const isTrialExpiredWithoutSubscription = (org: OrganizationAccessPlan, now = new Date()) =>
  Boolean(
    org.trialEndsAt && org.trialEndsAt < now && !hasActivePaidOrApprovedSubscription(org, now),
  );

export const resolveOrganizationAccessState = (org: OrganizationAccessPlan, now = new Date()) => {
  const subscriptionActive = hasActivePaidOrApprovedSubscription(org, now);
  const trialActive = Boolean(org.trialEndsAt && org.trialEndsAt >= now);
  const trialExpired = isTrialExpiredWithoutSubscription(org, now);
  return {
    subscriptionActive,
    trialActive,
    trialExpired,
    hasAccess: subscriptionActive || trialActive,
  };
};

export const getLimitsForPlan = (plan: OrganizationPlan): PlanLimits => {
  const limits = getCatalogLimits(plan);
  return {
    maxStores: limits.maxStores,
    maxUsers: limits.maxActiveUsers,
    maxProducts: limits.maxProducts,
  };
};

export const getPlanFeatures = (plan: OrganizationPlan): readonly PlanFeature[] =>
  getCatalogFeatures(plan);

export const hasPlanFeature = (plan: OrganizationPlan, feature: PlanFeature) =>
  hasFeature(plan, feature);

export const getPlanMonthlyPrice = (plan: OrganizationPlan) => getPlanMonthlyPriceKgs(plan);

export const getOrganizationPlan = async (organizationId: string) => {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      plan: true,
      trialEndsAt: true,
      subscriptionStatus: true,
      currentPeriodEndsAt: true,
    },
  });
  if (!org) {
    throw new AppError("orgNotFound", "NOT_FOUND", 404);
  }
  return org;
};

export const assertTrialActive = async (organizationId: string) => {
  const org = await getOrganizationPlan(organizationId);
  const accessState = resolveOrganizationAccessState(org);
  if (org.subscriptionStatus !== "ACTIVE") {
    throw new AppError("subscriptionInactive", "FORBIDDEN", 403);
  }
  if (accessState.trialExpired) {
    throw new AppError("trialExpired", "FORBIDDEN", 403);
  }
  if (!accessState.hasAccess) {
    throw new AppError("subscriptionInactive", "FORBIDDEN", 403);
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
    count = await prisma.user.count({
      where: { organizationId: input.organizationId, isActive: true },
    });
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
    throw new AppError(getFeatureLockedErrorKey(input.feature), "FORBIDDEN", 403);
  }
  return org;
};
