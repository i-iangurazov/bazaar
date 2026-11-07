import type { Prisma } from "@prisma/client";
import type { PlanDefinition } from "./planCatalog";
import type { getOrganizationPlan } from "@/server/services/planLimits";
import { AppError } from "@/server/services/errors";

export async function assertSubscriptionSelectionReady(
  org: Awaited<ReturnType<typeof getOrganizationPlan>>,
  target: PlanDefinition,
  db: Prisma.TransactionClient,
) {
  const organizationId = org.id;
  const [stores, users, products] = await Promise.all([
    db.store.count({ where: { organizationId } }),
    db.user.count({ where: { organizationId, isActive: true } }),
    db.product.count({ where: { organizationId,
      ...(target.countArchivedProducts ? {} : { isDeleted: false }) } }),
  ]);
  if (stores > target.limits.maxStores || users > target.limits.maxActiveUsers || products > target.limits.maxProducts)
    throw new AppError("billingSelectionBelowUsage", "CONFLICT", 409);
  const removed = (feature: keyof PlanDefinition["features"]) =>
    org.entitlements.features[feature] && !target.features[feature];
  const checks = await Promise.all([
    removed("expiryLots") ? db.store.count({ where: { organizationId, trackExpiryLots: true } }) : 0,
    removed("bundles") ? db.product.count({ where: { organizationId, isBundle: true, isDeleted: false,
      bundleComponents: { some: {} } } }) : 0,
    removed("loyalty") ? db.loyaltyProgram.count({ where: { organizationId, enabled: true } }) : 0,
    removed("loyalty") ? db.loyaltyReservation.count({ where: { organizationId, status: "ACTIVE" } }) : 0,
    removed("marketingAutomation") ? db.emailAutomation.count({ where: { organizationId, status: "ACTIVE" } }) : 0,
    removed("emailMarketing") ? db.emailCampaignRecipient.count({ where: { organizationId,
      status: { in: ["QUEUED", "SENDING"] } } }) : 0,
    removed("ownSender") ? db.emailSenderIdentity.count({ where: { organizationId, archivedAt: null } }) : 0,
    removed("marketplaces") ? db.mMarketIntegration.count({ where: { orgId: organizationId,
      apiTokenEncrypted: { not: null } } }) : 0,
    removed("marketplaces") ? db.bakaiStoreIntegration.count({ where: { orgId: organizationId,
      apiTokenEncrypted: { not: null } } }) : 0,
    removed("marketplaces") ? db.oMarketIntegration.count({ where: { orgId: organizationId,
      apiTokenEncrypted: { not: null } } }) : 0,
    removed("marketplaces") ? db.mMarketExportJob.count({ where: { orgId: organizationId,
      status: { in: ["QUEUED", "RUNNING"] } } }) : 0,
    removed("marketplaces") ? db.bakaiStoreExportJob.count({ where: { orgId: organizationId,
      jobType: "API_SYNC", status: { in: ["QUEUED", "RUNNING"] } } }) : 0,
    removed("marketplaces") ? db.oMarketExportJob.count({ where: { orgId: organizationId,
      status: { in: ["QUEUED", "RUNNING"] } } }) : 0,
  ]);
  const fields = ["expiryLots", "bundles", "loyalty", "loyaltyReservations", "marketingAutomation",
    "marketingQueue", "ownSender", "mMarket", "bakaiStore", "oMarket",
    "mMarketQueue", "bakaiStoreApiQueue", "oMarketQueue"];
  const modules = fields.filter((_, index) => checks[index] > 0);
  if (modules.length) throw new AppError("billingDowngradeNeedsPreparation", "CONFLICT", 409, { modules });
}
