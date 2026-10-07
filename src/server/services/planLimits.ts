import type { OrganizationPlan, Prisma } from "@prisma/client";

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

  if (org.plan !== "STARTER") {
    return true;
  }

  if (!org.trialEndsAt) {
    return true;
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

export const getOrganizationPlan = async (organizationId: string, db: Prisma.TransactionClient = prisma) => {
  const org = await db.organization.findUnique({
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

export const assertTrialActive = async (organizationId: string, db: Prisma.TransactionClient = prisma) => {
  const org = await getOrganizationPlan(organizationId, db);
  const accessState = resolveOrganizationAccessState(org);
  if (accessState.hasAccess) {
    return org;
  }
  if (org.subscriptionStatus !== "ACTIVE") {
    throw new AppError("subscriptionInactive", "FORBIDDEN", 403);
  }
  if (accessState.trialExpired) {
    throw new AppError("trialExpired", "FORBIDDEN", 403);
  }
  throw new AppError("subscriptionInactive", "FORBIDDEN", 403);
};

export const assertCapacity = async (input: {
  organizationId: string;
  kind: "stores" | "users" | "products";
  add: number;
  db?: Prisma.TransactionClient;
}) => {
  const db = input.db ?? prisma;
  const org = await assertTrialActive(input.organizationId, db);
  const limits = getLimitsForPlan(org.plan);
  const limit =
    input.kind === "stores"
      ? limits.maxStores
      : input.kind === "users"
        ? limits.maxUsers
        : limits.maxProducts;

  let count = 0;
  if (input.kind === "stores") {
    count = await db.store.count({ where: { organizationId: input.organizationId } });
  } else if (input.kind === "users") {
    count = await db.user.count({
      where: { organizationId: input.organizationId, isActive: true },
    });
  } else {
    count = await db.product.count({ where: { organizationId: input.organizationId } });
  }

  if (count + input.add > limit) {
    const errorKey =
      input.kind === "stores"
        ? `planLimitStores${limit}`
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
  db?: Prisma.TransactionClient;
}) => assertCapacity({ ...input, add: 1 });

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
