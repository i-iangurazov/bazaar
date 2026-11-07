import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { LEGACY_CATALOG_VERSION } from "@/lib/billing/subscriptionPricing";
import { LEGACY_PLAN_FEATURE_CODES, type PlanFeature } from "@/lib/billing/plans";
import { getFeatureLockedErrorKey } from "./planCatalog";
import {
  getOrganizationPlan,
  resolveOrganizationAccessState,
  assertTrialActive,
} from "@/server/services/planLimits";
import { AppError } from "@/server/services/errors";

// Expiry changes a new subscription to read-only. It does not hide the owner's
// historical records or undo an already closed period. Old contract access
// rules stay unchanged.
export async function assertReadableFeature(
  organizationId: string,
  feature: PlanFeature,
  db: Prisma.TransactionClient = prisma,
) {
  const org = await getOrganizationPlan(organizationId, db);
  const existingGate = (LEGACY_PLAN_FEATURE_CODES as readonly string[]).includes(feature);
  if (
    ((org.billingCatalogVersion === LEGACY_CATALOG_VERSION && existingGate) ||
      (org.billingCatalogVersion !== LEGACY_CATALOG_VERSION &&
        org.subscriptionStatus === "CANCELED")) &&
    !resolveOrganizationAccessState(org).hasAccess
  )
    throw new AppError("subscriptionInactive", "FORBIDDEN", 403);
  if (!org.entitlements.features[feature])
    throw new AppError(getFeatureLockedErrorKey(feature), "FORBIDDEN", 403);
  return org;
}

export async function assertProductImportAccess(organizationId: string, readOnly = false) {
  const org = readOnly
    ? await getOrganizationPlan(organizationId)
    : await assertTrialActive(organizationId);
  const initialOnly =
    org.billingCatalogVersion !== LEGACY_CATALOG_VERSION &&
    !org.entitlements.features.imports &&
    org.entitlements.features.initialImport;
  if (!org.entitlements.features.imports && !initialOnly)
    throw new AppError("featureLockedImports", "FORBIDDEN", 403);
  if (
    readOnly &&
    org.subscriptionStatus === "CANCELED" &&
    !resolveOrganizationAccessState(org).hasAccess
  )
    throw new AppError("subscriptionInactive", "FORBIDDEN", 403);
  return { org, initialOnly };
}

export async function assertProductExportAccess(input: {
  organizationId: string;
  actorId?: string;
  db?: Prisma.TransactionClient;
}) {
  const db = input.db ?? prisma;
  const org = await getOrganizationPlan(input.organizationId, db);
  if (org.billingCatalogVersion === LEGACY_CATALOG_VERSION || org.entitlements.features.exports)
    return;
  const actor = input.actorId
    ? await db.user.findFirst({
        where: { id: input.actorId, organizationId: input.organizationId, isActive: true },
        select: { role: true, isOrgOwner: true },
      })
    : null;
  if (!actor || (actor.role !== "ADMIN" && !actor.isOrgOwner))
    throw new AppError("forbidden", "FORBIDDEN", 403);
  if (!org.entitlements.features.rawDataExport)
    throw new AppError("featureLockedExports", "FORBIDDEN", 403);
}
