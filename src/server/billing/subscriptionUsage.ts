import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { getOrganizationPlan, resolveOrganizationAccessState } from "@/server/services/planLimits";
import { AppError } from "@/server/services/errors";
import { withAiOperationBudget } from "./aiOperationBudget";

export const USAGE_RESOURCES = ["ai", "voice", "images", "marketingEmails", "externalApi",
  "marketplaceRunsDaily", "marketplaceFullRunsDaily", "initialImport",
  "aiVendorBudgetMinor", "imageVendorBudgetMinor"] as const;
export type UsageResource = typeof USAGE_RESOURCES[number];
type Organization = Awaited<ReturnType<typeof getOrganizationPlan>>;
export type UsageLease = { id: string; token: string; organizationId: string } | null;

const resourceLimit = (org: Organization, resource: UsageResource) => {
  if (org.lifetimeAccess || org.billingCatalogVersion === "2026-10") return null;
  if (resource === "initialImport") return 1;
  // Internal conservative provider allowance. These units are never charged to
  // customers or offered as another wallet/add-on. Legacy grants are unchanged.
  if (resource === "aiVendorBudgetMinor") return (org.entitlements.usageLimits.ai ?? 0) * 240;
  if (resource === "imageVendorBudgetMinor") return (org.entitlements.usageLimits.images ?? 0) * 10000;
  return org.entitlements.usageLimits[resource === "voice" ? "ai" : resource];
};

export const usageWindow = (input: {
  resource: UsageResource; now: Date; origin: Date; anchorDay?: number; paidEnd?: Date | null;
  trialOrigin?: Date;
}) => {
  const { resource, now } = input;
  if (resource === "initialImport") return { startsAt: new Date(0), endsAt: new Date("9999-01-01T00:00:00Z") };
  if (resource.endsWith("Daily")) {
    // Kyrgyzstan business day (UTC+6), independent of the host machine's zone.
    const shifted = new Date(now.getTime() + 6 * 3_600_000);
    const startsAt = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 6 * 3_600_000);
    return { startsAt, endsAt: new Date(startsAt.getTime() + 86_400_000) };
  }
  const inPrepaidTrial = input.trialOrigin && now < input.origin;
  const origin = inPrepaidTrial ? input.trialOrigin! : input.origin;
  const paidEnd = inPrepaidTrial ? input.origin : input.paidEnd;
  const anchor = inPrepaidTrial ? origin.getUTCDate() : input.anchorDay ?? origin.getUTCDate();
  // Grace does not open an extra month's provider allowance.
  const point = new Date(Math.min(now.getTime(), paidEnd ? paidEnd.getTime() - 1 : Infinity));
  const advance = (months: number) => {
    if (months === 0) return new Date(origin);
    const result = new Date(origin);
    result.setUTCDate(1);
    result.setUTCMonth(origin.getUTCMonth() + months);
    const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(anchor, last));
    return result;
  };
  let months = Math.max(0, (point.getUTCFullYear() - origin.getUTCFullYear()) * 12 + point.getUTCMonth() - origin.getUTCMonth());
  let startsAt = advance(months);
  if (startsAt > point && months > 0) startsAt = advance(--months);
  const endsAt = advance(months + 1);
  return { startsAt, endsAt: paidEnd && paidEnd < endsAt ? paidEnd : endsAt };
};

const windowFor = (org: Organization, resource: UsageResource, now: Date) => usageWindow({
  resource, now, origin: new Date(org.activePurchase?.cycleStartsAt ?? org.createdAt),
  anchorDay: org.activePurchase?.anchorDay,
  paidEnd: org.activePurchase ? new Date(org.activePurchase.cycleEndsAt)
    : org.trialOffer ? org.trialEndsAt : null,
  trialOrigin: org.createdAt,
});
const keyDigest = (key: string) => createHash("sha256").update(key).digest("hex");
const lock = (tx: Prisma.TransactionClient, organizationId: string) =>
  tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;

const releaseRows = async (tx: Prisma.TransactionClient, rows: Array<{ id: string; bucketId: string; units: number }>) => {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.bucketId, (totals.get(row.bucketId) ?? 0) + row.units);
  if (rows.length) await tx.subscriptionUsageReservation.updateMany({
    where: { id: { in: rows.map(row => row.id) }, state: "RESERVED" }, data: { state: "RELEASED" },
  });
  for (const [id, units] of totals) await tx.subscriptionUsageBucket.update({
    where: { id }, data: { reserved: { decrement: units } },
  });
};
const releaseExpired = async (tx: Prisma.TransactionClient, organizationId: string, now: Date) => {
  const rows = await tx.subscriptionUsageReservation.findMany({
    where: { organizationId, state: "RESERVED", expiresAt: { lte: now } },
    select: { id: true, bucketId: true, units: true, resource: true, startedAt: true },
  });
  const uncertain = rows.filter(row => row.resource.endsWith("VendorBudgetMinor") && row.startedAt);
  const uncertainIds = new Set(uncertain.map(row => row.id));
  if (uncertain.length) {
    await tx.subscriptionUsageReservation.updateMany({ where: { id: { in: [...uncertainIds] } },
      data: { state: "COMMITTED" } });
    const totals = new Map<string, number>();
    for (const row of uncertain) totals.set(row.bucketId, (totals.get(row.bucketId) ?? 0) + row.units);
    for (const [id, units] of totals) await tx.subscriptionUsageBucket.update({ where: { id },
      data: { reserved: { decrement: units }, used: { increment: units } } });
  }
  await releaseRows(tx, rows.filter(row => !uncertainIds.has(row.id)));
};

export async function reserveSubscriptionUsage(input: {
  organizationId: string; resource: UsageResource; operationKey: string; units?: number;
}, now = new Date(), db?: Prisma.TransactionClient): Promise<UsageLease> {
  const units = input.units ?? 1;
  if (!Number.isSafeInteger(units) || units < 1 || units > 10000 || !input.operationKey)
    throw new AppError("validationError", "BAD_REQUEST", 400);
  const reserve = async (tx: Prisma.TransactionClient) => {
    await lock(tx, input.organizationId);
    const org = await getOrganizationPlan(input.organizationId, tx);
    const limit = resourceLimit(org, input.resource);
    if (limit === null) return null;
    if (!resolveOrganizationAccessState(org).hasAccess) throw new AppError("subscriptionInactive", "FORBIDDEN", 403);
    await releaseExpired(tx, org.id, now);
    const identity = { organizationId: org.id, resource: input.resource, operationKey: keyDigest(input.operationKey) };
    const prior = await tx.subscriptionUsageReservation.findUnique({
      where: { organizationId_resource_operationKey: identity },
    });
    if (prior && prior.state !== "RELEASED")
      throw new AppError(prior.state === "COMMITTED" ? "billingUsageAlreadyCompleted" : "billingUsageInProgress", "CONFLICT", 409);
    const window = windowFor(org, input.resource, now);
    const bucket = await tx.subscriptionUsageBucket.upsert({
      where: { organizationId_resource_startsAt: { organizationId: org.id, resource: input.resource, startsAt: window.startsAt } },
      create: { organizationId: org.id, resource: input.resource, ...window }, update: { endsAt: window.endsAt },
    });
    if (bucket.used + bucket.reserved + units > limit)
      throw new AppError("billingUsageLimitReached", "CONFLICT", 409, {
        resource: input.resource, limit, remaining: Math.max(0, limit - bucket.used - bucket.reserved),
        resetsAt: window.endsAt.toISOString(),
      });
    const token = randomUUID();
    const data = { bucketId: bucket.id, units, state: "RESERVED", leaseToken: token,
      expiresAt: new Date(now.getTime() + 15 * 60_000), startedAt: null, actualUnits: null };
    const row = prior
      ? await tx.subscriptionUsageReservation.update({ where: { id: prior.id }, data })
      : await tx.subscriptionUsageReservation.create({ data: { ...identity, ...data } });
    await tx.subscriptionUsageBucket.update({ where: { id: bucket.id }, data: { reserved: { increment: units } } });
    return { id: row.id, token, organizationId: org.id };
  };
  return db ? reserve(db) : prisma.$transaction(reserve);
}

// Enqueue a catalogue job atomically: either every selected card gets one
// reservation or the job and all its reservations roll back together.
export async function reserveSubscriptionUsageBatch(input: {
  organizationId: string; resource: UsageResource; operationKeys: string[];
}, db: Prisma.TransactionClient, now = new Date()) {
  if (!input.operationKeys.length || input.operationKeys.length > 5000 ||
    new Set(input.operationKeys).size !== input.operationKeys.length)
    throw new AppError("validationError", "BAD_REQUEST", 400);
  await lock(db, input.organizationId);
  const org = await getOrganizationPlan(input.organizationId, db);
  const limit = resourceLimit(org, input.resource);
  if (limit === null) return;
  if (!resolveOrganizationAccessState(org).hasAccess) throw new AppError("subscriptionInactive", "FORBIDDEN", 403);
  await releaseExpired(db, org.id, now);
  const keys = input.operationKeys.map(keyDigest);
  const identity = { organizationId: org.id, resource: input.resource };
  const prior = await db.subscriptionUsageReservation.findMany({
    where: { ...identity, operationKey: { in: keys } }, select: { id: true, operationKey: true, state: true },
  });
  if (prior.some(row => row.state !== "RELEASED"))
    throw new AppError("billingUsageInProgress", "CONFLICT", 409);
  const window = windowFor(org, input.resource, now);
  const bucket = await db.subscriptionUsageBucket.upsert({
    where: { organizationId_resource_startsAt: { ...identity, startsAt: window.startsAt } },
    create: { ...identity, ...window }, update: { endsAt: window.endsAt },
  });
  const units = keys.length;
  if (bucket.used + bucket.reserved + units > limit)
    throw new AppError("billingUsageLimitReached", "CONFLICT", 409,
      { resource: input.resource, limit, remaining: Math.max(0, limit - bucket.used - bucket.reserved) });
  const data = { bucketId: bucket.id, units: 1, state: "RESERVED", leaseToken: randomUUID(),
    expiresAt: new Date(now.getTime() + 90 * 60_000), startedAt: null };
  if (prior.length) await db.subscriptionUsageReservation.updateMany({
    where: { ...identity, operationKey: { in: prior.map(row => row.operationKey) }, state: "RELEASED" }, data,
  });
  const existing = new Set(prior.map(row => row.operationKey));
  const fresh = keys.filter(key => !existing.has(key));
  if (fresh.length) await db.subscriptionUsageReservation.createMany({
    data: fresh.map(operationKey => ({ ...identity, ...data, operationKey })),
  });
  await db.subscriptionUsageBucket.update({ where: { id: bucket.id }, data: { reserved: { increment: units } } });
}

// Only trusted job workers use this after they own the corresponding job/item
// lease. Replayed HTTP requests never obtain a second provider execution lease.
export async function resumeSubscriptionUsage(input: {
  organizationId: string; resource: UsageResource; operationKey: string;
}): Promise<UsageLease> {
  return prisma.$transaction(async (tx) => {
    await lock(tx, input.organizationId);
    await releaseExpired(tx, input.organizationId, new Date());
    const row = await tx.subscriptionUsageReservation.findUnique({
      where: { organizationId_resource_operationKey: { organizationId: input.organizationId,
        resource: input.resource, operationKey: keyDigest(input.operationKey) } },
    });
    if (!row || row.state === "RELEASED") return reserveSubscriptionUsage(input, new Date(), tx);
    if (row.state === "COMMITTED") throw new AppError("billingUsageAlreadyCompleted", "CONFLICT", 409);
    return { id: row.id, token: row.leaseToken, organizationId: row.organizationId };
  });
}

export async function startSubscriptionUsage(lease: UsageLease) {
  if (!lease) return;
  await prisma.$transaction(async (tx) => {
    await lock(tx, lease.organizationId);
    const row = await tx.subscriptionUsageReservation.updateMany({
      where: { id: lease.id, organizationId: lease.organizationId, leaseToken: lease.token,
        state: "RESERVED", startedAt: null, expiresAt: { gt: new Date() } },
      data: { startedAt: new Date(), expiresAt: new Date(Date.now() + 15 * 60_000) },
    });
    if (row.count !== 1) throw new AppError("billingUsageInProgress", "CONFLICT", 409);
  });
}

export async function settleSubscriptionUsage(lease: UsageLease, success: boolean, db?: Prisma.TransactionClient) {
  if (!lease) return;
  const settle = async (tx: Prisma.TransactionClient) => {
    await lock(tx, lease.organizationId);
    const row = await tx.subscriptionUsageReservation.findFirst({
      where: { id: lease.id, organizationId: lease.organizationId, leaseToken: lease.token },
    });
    if (!row) throw new AppError("billingUsageInProgress", "CONFLICT", 409);
    if (row.state === "RELEASED" && success) throw new AppError("billingUsageExpired", "CONFLICT", 409);
    if (row.state !== "RESERVED") return;
    await tx.subscriptionUsageReservation.update({ where: { id: row.id },
      data: { state: success ? "COMMITTED" : "RELEASED" } });
    await tx.subscriptionUsageBucket.update({ where: { id: row.bucketId },
      data: { reserved: { decrement: row.units }, ...(success ? { used: { increment: row.units } } : {}) } });
  };
  return db ? settle(db) : prisma.$transaction(settle);
}

export async function settleSubscriptionExpense(lease: UsageLease, actualUnits: number) {
  if (!lease) return;
  if (!Number.isSafeInteger(actualUnits) || actualUnits < 0 || actualUnits > 1000000)
    throw new AppError("validationError", "BAD_REQUEST", 400);
  await prisma.$transaction(async (tx) => {
    await lock(tx, lease.organizationId);
    const row = await tx.subscriptionUsageReservation.findFirst({ where: {
      id: lease.id, organizationId: lease.organizationId, leaseToken: lease.token,
    } });
    if (!row) throw new AppError("billingUsageInProgress", "CONFLICT", 409);
    if (row.state === "COMMITTED") {
      if (row.actualUnits === null) {
        await tx.subscriptionUsageReservation.update({ where: { id: row.id }, data: { actualUnits } });
        await tx.subscriptionUsageBucket.update({ where: { id: row.bucketId },
          data: { used: { increment: actualUnits - row.units } } });
      }
      return;
    }
    if (row.state !== "RESERVED") throw new AppError("billingUsageExpired", "CONFLICT", 409);
    await tx.subscriptionUsageReservation.update({ where: { id: row.id },
      data: { state: "COMMITTED", actualUnits } });
    await tx.subscriptionUsageBucket.update({ where: { id: row.bucketId },
      data: { reserved: { decrement: row.units }, used: { increment: actualUnits } } });
  });
}

export async function withSubscriptionUsage<T>(input: {
  organizationId: string; resource: UsageResource; operationKey: string; units?: number;
}, run: () => Promise<T>): Promise<T> {
  const lease = await reserveSubscriptionUsage(input);
  try {
    await startSubscriptionUsage(lease);
    const result = input.resource === "ai"
      ? await withAiOperationBudget({ organizationId: input.organizationId, enabled: lease !== null,
          operationKey: input.operationKey, units: input.units }, run)
      : await run();
    await settleSubscriptionUsage(lease, true);
    return result;
  } catch (error) {
    await settleSubscriptionUsage(lease, false);
    throw error;
  }
}

export async function getSubscriptionUsage(organizationId: string, now = new Date()) {
  const org = await getOrganizationPlan(organizationId);
  if (org.billingCatalogVersion === "2026-11" && !org.lifetimeAccess) {
    await prisma.$transaction(async (tx) => {
      await lock(tx, organizationId);
      await releaseExpired(tx, organizationId, now);
    });
  }
  return Promise.all(USAGE_RESOURCES.map(async (resource) => {
    const limit = resourceLimit(org, resource);
    const window = limit === null ? null : windowFor(org, resource, now);
    const bucket = limit === null ? null : await prisma.subscriptionUsageBucket.findUnique({
      where: { organizationId_resource_startsAt: { organizationId, resource, startsAt: window!.startsAt } },
    });
    return { resource, limit, used: bucket?.used ?? 0, reserved: bucket?.reserved ?? 0,
      remaining: limit === null ? null : Math.max(0, limit - (bucket?.used ?? 0) - (bucket?.reserved ?? 0)),
      resetsAt: window?.endsAt ?? null };
  }));
}

export async function releaseUnusedSubscriptionUsage(input: {
  organizationId: string; resource: UsageResource; operationKeys: string[];
}) {
  await prisma.$transaction(async (tx) => {
    await lock(tx, input.organizationId);
    const rows = await tx.subscriptionUsageReservation.findMany({
      where: { organizationId: input.organizationId, resource: input.resource, state: "RESERVED",
        startedAt: null, operationKey: { in: input.operationKeys.map(keyDigest) } },
      select: { id: true, bucketId: true, units: true },
    });
    await releaseRows(tx, rows);
  });
}

export async function startSubscriptionUsageBatch(input: {
  organizationId: string; resource: UsageResource; operationKeys: string[];
}) {
  if (!input.operationKeys.length) return;
  await prisma.$transaction(async (tx) => {
    await lock(tx, input.organizationId);
    const org = await getOrganizationPlan(input.organizationId, tx);
    if (resourceLimit(org, input.resource) === null) return;
    if (!resolveOrganizationAccessState(org).hasAccess) throw new AppError("subscriptionInactive", "FORBIDDEN", 403);
    await releaseExpired(tx, org.id, new Date());
    const keys = input.operationKeys.map(keyDigest);
    const rows = await tx.subscriptionUsageReservation.findMany({ where: {
      organizationId: org.id, resource: input.resource, operationKey: { in: keys },
    } });
    if (rows.some(row => row.state === "COMMITTED"))
      throw new AppError("billingUsageAlreadyCompleted", "CONFLICT", 409);
    const reserved = new Set(rows.filter(row => row.state === "RESERVED").map(row => row.operationKey));
    const missing = input.operationKeys.filter(key => !reserved.has(keyDigest(key)));
    if (missing.length) await reserveSubscriptionUsageBatch({ ...input, operationKeys: missing }, tx);
    const minimumExpiry = new Date(Date.now() + 90 * 60_000);
    await tx.subscriptionUsageReservation.updateMany({
      where: { organizationId: org.id, resource: input.resource, operationKey: { in: keys },
        state: "RESERVED", expiresAt: { lt: minimumExpiry } },
      data: { expiresAt: minimumExpiry },
    });
    await tx.subscriptionUsageReservation.updateMany({
      where: { organizationId: org.id, resource: input.resource, operationKey: { in: keys }, state: "RESERVED" },
      data: { leaseToken: randomUUID(), startedAt: new Date() },
    });
  });
}

// Email acceptance and quota settlement share the recipient-state transaction.
// If that transaction fails, the provider's idempotency key can be replayed
// while its original quota reservation stays intact.
export async function settleSubscriptionUsageBatch(input: {
  organizationId: string; resource: UsageResource; operationKeys: string[]; success: boolean;
}, db?: Prisma.TransactionClient) {
  if (!input.operationKeys.length) return;
  const settle = async (tx: Prisma.TransactionClient) => {
    await lock(tx, input.organizationId);
    const rows = await tx.subscriptionUsageReservation.findMany({ where: {
      organizationId: input.organizationId, resource: input.resource,
      operationKey: { in: input.operationKeys.map(keyDigest) }, state: "RESERVED",
    }, select: { id: true, bucketId: true, units: true } });
    if (!input.success) return releaseRows(tx, rows);
    const totals = new Map<string, number>();
    for (const row of rows) totals.set(row.bucketId, (totals.get(row.bucketId) ?? 0) + row.units);
    if (rows.length) await tx.subscriptionUsageReservation.updateMany({
      where: { id: { in: rows.map(row => row.id) }, state: "RESERVED" }, data: { state: "COMMITTED" },
    });
    for (const [id, units] of totals) await tx.subscriptionUsageBucket.update({
      where: { id }, data: { reserved: { decrement: units }, used: { increment: units } },
    });
  };
  return db ? settle(db) : prisma.$transaction(settle);
}

// A provider timeout/ACK with a failed local commit is not proof of rejection.
// Keep only started, server-owned email reservations until reconciliation has
// outlived the bucket and its grace period; ordinary crashed reservations still
// use the normal reaper.
export async function holdUncertainSubscriptionUsageBatch(input: {
  organizationId: string; operationKeys: string[];
}, db?: Prisma.TransactionClient) {
  if (!input.operationKeys.length) return;
  const hold = async (tx: Prisma.TransactionClient) => {
    await lock(tx, input.organizationId);
    const rows = await tx.subscriptionUsageReservation.findMany({ where: {
      organizationId: input.organizationId, resource: "marketingEmails", state: "RESERVED",
      startedAt: { not: null }, operationKey: { in: input.operationKeys.map(keyDigest) },
    }, select: { id: true, expiresAt: true, bucket: { select: { endsAt: true } } } });
    const minimum = Date.now() + 48 * 3_600_000;
    for (const row of rows) await tx.subscriptionUsageReservation.update({ where: { id: row.id }, data: {
      expiresAt: new Date(Math.max(row.expiresAt.getTime(), minimum, row.bucket.endsAt.getTime() + 7 * 86_400_000)),
    } });
  };
  return db ? hold(db) : prisma.$transaction(hold);
}
