import type { OrganizationPlan, Prisma } from "@prisma/client";
import { LEGACY_PLAN_FEATURE_CODES } from "@/lib/billing/plans";

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
import {
  LEGACY_CATALOG_VERSION, catalogVersion, EMPTY_SUBSCRIPTION_EXTRAS,
  type SubscriptionCatalogVersion, type SubscriptionExtras,
} from "@/lib/billing/subscriptionPricing";
import { LIFETIME_ORGANIZATION_IDS } from "@/server/billing/lifetimeOrganizations";
import { contractPlan, createContractTerms, readContractTerms } from "@/server/billing/contractTerms";
import { readPurchaseSnapshot } from "@/server/billing/purchaseSnapshot";
import { AppError } from "@/server/services/errors";
import { readTrialOffer } from "@/server/billing/trialPolicy";

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
  lifetimeAccess?: boolean;
  subscriptionStatus: "ACTIVE" | "PAST_DUE" | "CANCELED" | string;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  subscriptionBillingMode?: "MANUAL" | "SELF_SERVE";
  billingCatalogVersion?: string;
};

export const hasActivePaidOrApprovedSubscription = (
  org: OrganizationAccessPlan,
  now = new Date(),
) => {
  if (org.lifetimeAccess) return true;
  if (org.subscriptionStatus !== "ACTIVE") {
    return false;
  }

  if (org.subscriptionBillingMode === "SELF_SERVE" || org.billingCatalogVersion === "2026-11") {
    return Boolean(org.currentPeriodEndsAt && org.currentPeriodEndsAt >= now &&
      (!org.trialEndsAt || org.currentPeriodEndsAt > org.trialEndsAt));
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
  const trialActive = Boolean(org.trialEndsAt && org.trialEndsAt >= now &&
    (org.subscriptionBillingMode !== "SELF_SERVE" || org.subscriptionStatus === "ACTIVE"));
  const trialExpired = isTrialExpiredWithoutSubscription(org, now);
  const paidEnd = org.currentPeriodEndsAt;
  const graceEndsAt = org.billingCatalogVersion === "2026-11" && !org.lifetimeAccess &&
    paidEnd && (!org.trialEndsAt || paidEnd > org.trialEndsAt)
    ? new Date(paidEnd.getTime() + 7 * 86_400_000) : null;
  const inGrace = !subscriptionActive && !trialActive &&
    ["ACTIVE", "PAST_DUE"].includes(org.subscriptionStatus) && Boolean(graceEndsAt && graceEndsAt > now);
  return {
    subscriptionActive,
    trialActive,
    trialExpired,
    inGrace,
    graceEndsAt,
    hasAccess: subscriptionActive || trialActive || inGrace,
  };
};

export const getLimitsForPlan = (
  plan: OrganizationPlan,
  version: SubscriptionCatalogVersion = LEGACY_CATALOG_VERSION,
  extras?: SubscriptionExtras,
): PlanLimits => {
  const limits = getCatalogLimits(plan, version, extras);
  return {
    maxStores: limits.maxStores,
    maxUsers: limits.maxActiveUsers,
    maxProducts: limits.maxProducts,
  };
};

export const getPlanFeatures = (plan: OrganizationPlan, version: SubscriptionCatalogVersion = LEGACY_CATALOG_VERSION): readonly PlanFeature[] =>
  getCatalogFeatures(plan, version);

export const hasPlanFeature = (plan: OrganizationPlan, feature: PlanFeature) =>
  hasFeature(plan, feature);

export const getPlanMonthlyPrice = (plan: OrganizationPlan, version: SubscriptionCatalogVersion = LEGACY_CATALOG_VERSION) => getPlanMonthlyPriceKgs(plan, version);

export const getOrganizationPlan = async (organizationId: string, db: Prisma.TransactionClient = prisma) => {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    include: { subscriptionContract: true },
  });
  if (!org) {
    throw new AppError("orgNotFound", "NOT_FOUND", 404);
  }
  const lifetimeAccess = Boolean(org.subscriptionContract?.lifetimeAccess || LIFETIME_ORGANIZATION_IDS.has(org.id));
  const latestPeriod = org.subscriptionBillingMode === "SELF_SERVE" && !lifetimeAccess
    ? await db.subscriptionPeriod.findFirst({
        where: { organizationId, startsAt: { lte: new Date() } },
        orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      }) : null;
  const activePeriod = latestPeriod && latestPeriod.endsAt > new Date() ? latestPeriod : null;
  const initialTrialPurchase = !latestPeriod && org.subscriptionBillingMode === "SELF_SERVE" && org.trialEndsAt && org.trialEndsAt >= new Date()
    ? await db.subscriptionPeriod.findFirst({
        where: { organizationId, startsAt: org.trialEndsAt }, orderBy: { startsAt: "asc" },
      }) : null;
  // A new trial remains the same preview until its original end, even when a
  // future paid period has already been purchased. This matches database guards
  // and avoids removing sampled features on early payment for a lower tier.
  const hasPreview = Boolean(org.subscriptionContract?.trialOffer) && !lifetimeAccess &&
    org.subscriptionBillingMode === "SELF_SERVE";
  const futurePurchase = readPurchaseSnapshot(initialTrialPurchase?.purchaseSnapshot);
  const purchase = readPurchaseSnapshot((latestPeriod ?? (hasPreview ? null : initialTrialPurchase))?.purchaseSnapshot);
  const version = catalogVersion(org.subscriptionContract?.catalogVersion);
  const terms = readContractTerms(org.subscriptionContract?.termsSnapshot) ?? createContractTerms(version);
  if (terms.catalogVersion !== version) throw new AppError("billingContractNeedsReview", "CONFLICT", 409);
  const plan = purchase?.plan ?? org.plan;
  const extras = purchase?.extras ?? EMPTY_SUBSCRIPTION_EXTRAS;
  const trialOffer = !lifetimeAccess && org.subscriptionBillingMode === "SELF_SERVE" &&
    version === "2026-11" && !purchase ? readTrialOffer(org.subscriptionContract?.trialOffer) : null;
  const entitlements = purchase?.entitlements ?? trialOffer?.entitlements ?? contractPlan(terms, plan, extras);
  return {
    ...org,
    plan,
    storedPlan: org.plan,
    lifetimeAccess,
    billingCatalogVersion: version,
    subscriptionExtras: extras,
    contractTerms: terms,
    entitlements,
    trialOffer,
    activeSubscriptionPeriod: activePeriod,
    activePurchase: purchase ?? (trialOffer ? futurePurchase : null),
  };
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
  const limits = await getCapacityLimits(org, db);
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
    count = await db.product.count({ where: { organizationId: input.organizationId,
      ...(org.entitlements.countArchivedProducts ? {} : { isDeleted: false }) } });
  }

  if (count + input.add > limit) {
    const errorKey =
      input.kind === "stores"
        ? ([1, 5, 15].includes(limit) ? `planLimitStores${limit}` : "planLimitStores")
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
  const existingGate = (LEGACY_PLAN_FEATURE_CODES as readonly string[]).includes(input.feature) || input.feature === "priceBooks";
  const org = existingGate ? await assertTrialActive(input.organizationId) : await getOrganizationPlan(input.organizationId);
  if (!existingGate && org.billingCatalogVersion !== LEGACY_CATALOG_VERSION &&
    !resolveOrganizationAccessState(org).hasAccess)
    throw new AppError("subscriptionInactive", "FORBIDDEN", 403);
  const effectiveFeature = input.feature === "priceBooks" && org.billingCatalogVersion === LEGACY_CATALOG_VERSION
    ? "storePrices" : input.feature;
  if (!org.entitlements.features[effectiveFeature]) {
    throw new AppError(getFeatureLockedErrorKey(effectiveFeature), "FORBIDDEN", 403, { feature: effectiveFeature });
  }
  return org;
};

export const getOrganizationLimits = (org: { entitlements: { limits: { maxStores: number; maxProducts: number; maxActiveUsers: number } } }): PlanLimits => ({
  maxStores: org.entitlements.limits.maxStores,
  maxProducts: org.entitlements.limits.maxProducts,
  maxUsers: org.entitlements.limits.maxActiveUsers,
});

export const getCapacityLimits = async (org: Awaited<ReturnType<typeof getOrganizationPlan>>,
  db: Prisma.TransactionClient = prisma): Promise<PlanLimits> => {
  const limits = getOrganizationLimits(org);
  if (org.lifetimeAccess || org.billingCatalogVersion === LEGACY_CATALOG_VERSION) return limits;
  const scheduled = await db.subscriptionPeriod.findMany({
    where: { organizationId: org.id, startsAt: { gt: new Date() } }, select: { plan: true, purchaseSnapshot: true },
  });
  for (const period of scheduled) {
    const purchase = readPurchaseSnapshot(period.purchaseSnapshot);
    const next = purchase?.entitlements ?? contractPlan(org.contractTerms, period.plan, purchase?.extras);
    limits.maxStores = Math.min(limits.maxStores, next.limits.maxStores);
    limits.maxProducts = Math.min(limits.maxProducts, next.limits.maxProducts);
    limits.maxUsers = Math.min(limits.maxUsers, next.limits.maxActiveUsers);
  }
  const pending = await db.subscriptionInvoice.findMany({ where: { organizationId: org.id,
    status: { in: ["CREATING", "PENDING", "REVIEW"] }, pendingSlot: org.id },
    select: { plan: true, purchaseSnapshot: true } });
  for (const invoice of pending) {
    const purchase = readPurchaseSnapshot(invoice.purchaseSnapshot);
    if (!purchase) continue;
    const next = purchase.entitlements ?? contractPlan(org.contractTerms, invoice.plan, purchase.extras);
    limits.maxStores = Math.min(limits.maxStores, next.limits.maxStores);
    limits.maxProducts = Math.min(limits.maxProducts, next.limits.maxProducts);
    limits.maxUsers = Math.min(limits.maxUsers, next.limits.maxActiveUsers);
  }
  return limits;
};

// Configurations that would make an already purchased downgrade unsafe must be
// completed or removed first. Reading historical records does not use this gate.
export const assertFeatureCanBeConfigured = async (organizationId: string, feature: PlanFeature,
  db: Prisma.TransactionClient = prisma) => {
  await db.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
  const org = await getOrganizationPlan(organizationId, db);
  if (org.lifetimeAccess || org.billingCatalogVersion === LEGACY_CATALOG_VERSION) return org;
  if (!resolveOrganizationAccessState(org).hasAccess) throw new AppError("subscriptionInactive", "FORBIDDEN", 403);
  if (!org.entitlements.features[feature]) throw new AppError(getFeatureLockedErrorKey(feature), "FORBIDDEN", 403);
  const scheduled = await db.subscriptionPeriod.findMany({
    where: { organizationId, startsAt: { gt: new Date() } }, select: { plan: true, purchaseSnapshot: true },
  });
  for (const period of scheduled) {
    const purchase = readPurchaseSnapshot(period.purchaseSnapshot);
    const next = purchase?.entitlements ?? contractPlan(org.contractTerms, period.plan, purchase?.extras);
    if (!next.features[feature]) throw new AppError("billingScheduledFeatureRestriction", "CONFLICT", 409, { feature });
  }
  const pending = await db.subscriptionInvoice.findMany({ where: { organizationId,
    status: { in: ["CREATING", "PENDING", "REVIEW"] }, pendingSlot: organizationId },
    select: { plan: true, purchaseSnapshot: true } });
  for (const invoice of pending) {
    const purchase = readPurchaseSnapshot(invoice.purchaseSnapshot);
    const next = purchase?.entitlements ?? contractPlan(org.contractTerms, invoice.plan, purchase?.extras);
    if (!next.features[feature]) throw new AppError("billingScheduledFeatureRestriction", "CONFLICT", 409, { feature });
  }
  return org;
};
