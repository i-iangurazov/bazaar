import {
  OrganizationSubscriptionStatus,
  PlanUpgradeRequestStatus,
} from "@prisma/client";
import type { OrganizationPlan } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";
import {
  getLimitsForPlan,
  type PlanTier,
  getPlanFeatures,
  getPlanMonthlyPrice,
  toPlanTier,
} from "@/server/services/planLimits";

const PLAN_RANK: Record<PlanTier, number> = {
  STARTER: 1,
  BUSINESS: 2,
  ENTERPRISE: 3,
};

const normalizeOptional = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const getPlanCatalog = () => {
  const tiers: PlanTier[] = ["STARTER", "BUSINESS", "ENTERPRISE"];
  return tiers.map((tier) => {
    const plan = tier as OrganizationPlan;
    return {
      plan,
      planTier: tier,
      limits: getLimitsForPlan(plan),
      features: getPlanFeatures(plan),
      monthlyPriceKgs: getPlanMonthlyPrice(plan),
    };
  });
};

export const getBillingSummary = async (input: { organizationId: string }) => {
  const org = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: {
      id: true,
      name: true,
      plan: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      currentPeriodEndsAt: true,
      createdAt: true,
    },
  });
  if (!org) {
    return null;
  }

  const [stores, users, products, upgradeRequests] = await Promise.all([
    prisma.store.count({ where: { organizationId: org.id } }),
    prisma.user.count({ where: { organizationId: org.id, isActive: true } }),
    prisma.product.count({ where: { organizationId: org.id } }),
    prisma.planUpgradeRequest.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        currentPlan: true,
        requestedPlan: true,
        status: true,
        message: true,
        reviewNote: true,
        createdAt: true,
        reviewedAt: true,
      },
    }),
  ]);

  const limits = getLimitsForPlan(org.plan);
  const now = new Date();
  const trialExpired =
    Boolean(org.trialEndsAt && org.trialEndsAt < now && (!org.currentPeriodEndsAt || org.currentPeriodEndsAt < now));

  return {
    organizationId: org.id,
    plan: org.plan,
    planTier: toPlanTier(org.plan),
    subscriptionStatus: org.subscriptionStatus,
    trialEndsAt: org.trialEndsAt,
    currentPeriodEndsAt: org.currentPeriodEndsAt,
    trialExpired,
    usage: { stores, users, products },
    limits,
    features: getPlanFeatures(org.plan),
    monthlyPriceKgs: getPlanMonthlyPrice(org.plan),
    planCatalog: getPlanCatalog(),
    upgradeRequests,
    pendingUpgradeRequest:
      upgradeRequests.find((request) => request.status === PlanUpgradeRequestStatus.PENDING) ?? null,
  };
};

export const requestPlanUpgrade = async (input: {
  organizationId: string;
  requestedById: string;
  requestedPlan: OrganizationPlan;
  message?: string | null;
  requestId: string;
}) =>
  prisma.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true, plan: true },
    });
    if (!org) {
      throw new AppError("orgNotFound", "NOT_FOUND", 404);
    }

    const currentTier = toPlanTier(org.plan);
    const requestedTier = toPlanTier(input.requestedPlan);
    if (PLAN_RANK[requestedTier] <= PLAN_RANK[currentTier]) {
      throw new AppError("planUpgradeMustBeHigher", "CONFLICT", 409);
    }

    const pendingRequest = await tx.planUpgradeRequest.findFirst({
      where: {
        organizationId: input.organizationId,
        status: PlanUpgradeRequestStatus.PENDING,
      },
      select: { id: true },
    });
    if (pendingRequest) {
      throw new AppError("planUpgradeRequestPending", "CONFLICT", 409);
    }

    const created = await tx.planUpgradeRequest.create({
      data: {
        organizationId: input.organizationId,
        requestedById: input.requestedById,
        currentPlan: org.plan,
        requestedPlan: input.requestedPlan,
        message: normalizeOptional(input.message),
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.requestedById,
      action: "BILLING_UPGRADE_REQUEST_CREATE",
      entity: "PlanUpgradeRequest",
      entityId: created.id,
      before: toJson(null),
      after: toJson(created),
      requestId: input.requestId,
    });

    return created;
  });

export const listPendingPlanUpgradeRequests = async () =>
  prisma.planUpgradeRequest.findMany({
    where: { status: PlanUpgradeRequestStatus.PENDING },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      organizationId: true,
      currentPlan: true,
      requestedPlan: true,
      message: true,
      createdAt: true,
      organization: {
        select: {
          name: true,
        },
      },
      requestedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

export const reviewPlanUpgradeRequest = async (input: {
  requestId: string;
  status: "APPROVED" | "REJECTED";
  reviewNote?: string | null;
  reviewedById: string;
  requestAuditId: string;
}) =>
  prisma.$transaction(async (tx) => {
    const existing = await tx.planUpgradeRequest.findUnique({
      where: { id: input.requestId },
      include: {
        organization: true,
      },
    });
    if (!existing) {
      throw new AppError("planUpgradeRequestNotFound", "NOT_FOUND", 404);
    }
    if (existing.status !== PlanUpgradeRequestStatus.PENDING) {
      throw new AppError("planUpgradeRequestNotPending", "CONFLICT", 409);
    }

    const updatedRequest = await tx.planUpgradeRequest.update({
      where: { id: input.requestId },
      data: {
        status: input.status,
        reviewNote: normalizeOptional(input.reviewNote),
        reviewedAt: new Date(),
        reviewedById: input.reviewedById,
      },
    });

    let updatedOrganization = null;
    if (input.status === PlanUpgradeRequestStatus.APPROVED) {
      const now = new Date();
      const fallbackPeriod = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      updatedOrganization = await tx.organization.update({
        where: { id: existing.organizationId },
        data: {
          plan: existing.requestedPlan,
          subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE,
          currentPeriodEndsAt:
            existing.organization.currentPeriodEndsAt &&
            existing.organization.currentPeriodEndsAt > now
              ? existing.organization.currentPeriodEndsAt
              : fallbackPeriod,
        },
      });
    }

    await writeAuditLog(tx, {
      organizationId: existing.organizationId,
      actorId: input.reviewedById,
      action: "PLATFORM_UPGRADE_REQUEST_REVIEW",
      entity: "PlanUpgradeRequest",
      entityId: existing.id,
      before: toJson(existing),
      after: toJson(updatedRequest),
      requestId: input.requestAuditId,
    });

    if (updatedOrganization) {
      await writeAuditLog(tx, {
        organizationId: existing.organizationId,
        actorId: input.reviewedById,
        action: "PLATFORM_BILLING_PLAN_UPDATE",
        entity: "Organization",
        entityId: updatedOrganization.id,
        before: toJson(existing.organization),
        after: toJson(updatedOrganization),
        requestId: input.requestAuditId,
      });
    }

    return {
      request: updatedRequest,
      organization: updatedOrganization,
    };
  });
