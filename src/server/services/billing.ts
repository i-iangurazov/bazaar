import { prisma } from "@/server/db/prisma";
import {
  getLimitsForPlan,
  getPlanFeatures,
  getPlanMonthlyPrice,
  toPlanTier,
} from "@/server/services/planLimits";

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

  const [stores, users, products] = await Promise.all([
    prisma.store.count({ where: { organizationId: org.id } }),
    prisma.user.count({ where: { organizationId: org.id, isActive: true } }),
    prisma.product.count({ where: { organizationId: org.id } }),
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
  };
};
