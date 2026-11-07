import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { AppError } from "./errors";
import {
  getOrganizationPlan,
  resolveOrganizationAccessState,
  assertFeatureCanBeConfigured,
} from "./planLimits";
import {
  reserveSubscriptionUsage,
  settleSubscriptionUsageBatch,
} from "@/server/billing/subscriptionUsage";

export const MARKETPLACE_CHANNELS = ["MMARKET", "BAKAI", "OMARKET"] as const;
export type MarketplaceChannel = (typeof MARKETPLACE_CHANNELS)[number];
const isGrandfathered = (org: Awaited<ReturnType<typeof getOrganizationPlan>>) =>
  org.lifetimeAccess || org.billingCatalogVersion === "2026-10";

export async function assertMarketplaceFeature(
  organizationId: string,
  mode: "LIVE" | "FILE" = "LIVE",
  db: Prisma.TransactionClient = prisma,
) {
  const org = await getOrganizationPlan(organizationId, db);
  if (isGrandfathered(org)) return org;
  if (!org.entitlements.features[mode === "LIVE" ? "marketplaces" : "bakaiExport"])
    throw new AppError("featureLockedPlan", "FORBIDDEN", 403);
  if (!resolveOrganizationAccessState(org).hasAccess)
    throw new AppError("subscriptionInactive", "FORBIDDEN", 403);
  return org;
}

async function channelBusy(
  db: Prisma.TransactionClient,
  organizationId: string,
  channel: MarketplaceChannel,
) {
  if (channel === "MMARKET") {
    const [connection, jobs] = await Promise.all([
      db.mMarketIntegration.findUnique({
        where: { orgId: organizationId },
        select: { apiTokenEncrypted: true },
      }),
      db.mMarketExportJob.count({
        where: { orgId: organizationId, status: { in: ["QUEUED", "RUNNING"] } },
      }),
    ]);
    return Boolean(connection?.apiTokenEncrypted || jobs);
  }
  if (channel === "BAKAI") {
    const [connection, jobs] = await Promise.all([
      db.bakaiStoreIntegration.findUnique({
        where: { orgId: organizationId },
        select: { apiTokenEncrypted: true },
      }),
      db.bakaiStoreExportJob.count({
        where: {
          orgId: organizationId,
          jobType: "API_SYNC",
          status: { in: ["QUEUED", "RUNNING"] },
        },
      }),
    ]);
    return Boolean(connection?.apiTokenEncrypted || jobs);
  }
  const [connection, jobs] = await Promise.all([
    db.oMarketIntegration.findUnique({
      where: { orgId: organizationId },
      select: { apiTokenEncrypted: true },
    }),
    db.oMarketExportJob.count({
      where: { orgId: organizationId, status: { in: ["QUEUED", "RUNNING"] } },
    }),
  ]);
  return Boolean(connection?.apiTokenEncrypted || jobs);
}

export async function claimMarketplaceChannel(
  organizationId: string,
  channel: MarketplaceChannel,
  db?: Prisma.TransactionClient,
) {
  const claim = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
    const org = await assertMarketplaceFeature(organizationId, "LIVE", tx);
    if (isGrandfathered(org)) return;
    const selected = org.subscriptionContract
      ?.selectedMarketplaceChannel as MarketplaceChannel | null;
    if (selected === channel) return;
    if (selected && (await channelBusy(tx, organizationId, selected)))
      throw new AppError("billingMarketplaceChannelInUse", "CONFLICT", 409);
    // Also catches configuration created by an older application after rollback.
    for (const other of MARKETPLACE_CHANNELS)
      if (other !== channel && (await channelBusy(tx, organizationId, other)))
        throw new AppError("billingMarketplaceChannelInUse", "CONFLICT", 409);
    await assertFeatureCanBeConfigured(organizationId, "marketplaces", tx);
    await tx.subscriptionContract.update({
      where: { organizationId },
      data: { selectedMarketplaceChannel: channel },
    });
  };
  return db ? claim(db) : prisma.$transaction(claim);
}

export async function releaseMarketplaceChannelIfUnused(
  organizationId: string,
  channel: MarketplaceChannel,
  db: Prisma.TransactionClient,
) {
  await db.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
  const org = await getOrganizationPlan(organizationId, db);
  if (
    isGrandfathered(org) ||
    org.subscriptionContract?.selectedMarketplaceChannel !== channel ||
    (await channelBusy(db, organizationId, channel))
  )
    return;
  await db.subscriptionContract.update({
    where: { organizationId },
    data: { selectedMarketplaceChannel: null },
  });
}

/** Called only after successful local preflight, immediately before external exchange. */
export async function authorizeMarketplaceExchange(input: {
  organizationId: string;
  channel: MarketplaceChannel;
  jobId: string;
  full: boolean;
}) {
  const org = await assertMarketplaceFeature(input.organizationId);
  if (isGrandfathered(org)) return;
  await claimMarketplaceChannel(input.organizationId, input.channel);
  await prisma.$transaction(async (tx) => {
    const runKey = `marketplace:${input.channel}:${input.jobId}`;
    const fullKey = `${runKey}:full`;
    await reserveSubscriptionUsage(
      {
        organizationId: input.organizationId,
        resource: "marketplaceRunsDaily",
        operationKey: runKey,
      },
      new Date(),
      tx,
    );
    if (input.full)
      await reserveSubscriptionUsage(
        {
          organizationId: input.organizationId,
          resource: "marketplaceFullRunsDaily",
          operationKey: fullKey,
        },
        new Date(),
        tx,
      );
    // A started exchange, including a rejected provider response, counts once.
    // Provider retries within this job never call this authorization a second time.
    await settleSubscriptionUsageBatch(
      {
        organizationId: input.organizationId,
        resource: "marketplaceRunsDaily",
        operationKeys: [runKey],
        success: true,
      },
      tx,
    );
    if (input.full)
      await settleSubscriptionUsageBatch(
        {
          organizationId: input.organizationId,
          resource: "marketplaceFullRunsDaily",
          operationKeys: [fullKey],
          success: true,
        },
        tx,
      );
  });
}
