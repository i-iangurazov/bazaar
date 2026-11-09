import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { PlanCode } from "@/lib/billing/plans";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { getOrganizationPlan } from "@/server/services/planLimits";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";
import { releaseLoyaltyForOrder } from "@/server/services/loyalty/apply";
import { releaseReservation } from "@/server/services/loyalty/ledger";
import { contractPlan } from "./contractTerms";
import { assertSubscriptionSelectionReady } from "./subscriptionPreparation";

type Identity = { organizationId: string; actorId: string; plan: PlanCode };
const tokenSchema = z.object({ organizationId: z.string(), actorId: z.string(), plan: z.enum(["STARTER", "BUSINESS", "ENTERPRISE"]),
  digest: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number().int().positive() });
const originalLineSchema = z.object({ lineId: z.string(), qty: z.number().positive(), originalUnitPriceKgs: z.string(), originalLineTotalKgs: z.string() });
const secret = () => {
  if (!process.env.NEXTAUTH_SECRET) throw new AppError("billingPaymentsUnavailable", "CONFLICT", 409);
  return process.env.NEXTAUTH_SECRET;
};
const changed = () => new AppError("billingQuoteChanged", "CONFLICT", 409);
const blocked = () => new AppError("billingDowngradeNeedsPreparation", "CONFLICT", 409, { modules: ["loyaltyReservations"] });
const signature = (body: string) => createHmac("sha256", secret()).update(`trial-preparation-v1:${body}`).digest();
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function issueToken(input: Identity, impact: unknown) {
  const body = Buffer.from(JSON.stringify({ ...input, digest: digest(impact), expiresAt: Date.now() + 15 * 60_000 })).toString("base64url");
  return `${body}.${signature(body).toString("base64url")}`;
}
function verifyToken(token: string, input: Identity) {
  try {
    if (token.length > 3000) throw changed();
    const [body, mac, extra] = token.split(".");
    if (!body || !mac || extra) throw changed();
    const actual = Buffer.from(mac, "base64url"); const expected = signature(body);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw changed();
    const value = tokenSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (value.expiresAt <= Date.now() || value.organizationId !== input.organizationId || value.actorId !== input.actorId || value.plan !== input.plan) throw changed();
    return value;
  } catch { throw changed(); }
}

async function inspect(tx: Prisma.TransactionClient, input: Identity) {
  // Keep checkout/admin/preparation writers serialized while allowing the
  // foreign-key KEY SHARE locks of an already-running loyalty application.
  // FOR UPDATE here would invert org -> order against order -> FK org.
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${input.organizationId} FOR NO KEY UPDATE`;
  const owner = await tx.user.findFirst({ where: { id: input.actorId, organizationId: input.organizationId,
    role: "ADMIN", isOrgOwner: true, isActive: true } });
  if (!owner) throw new AppError("forbidden", "FORBIDDEN", 403);
  const org = await getOrganizationPlan(input.organizationId, tx);
  if (org.lifetimeAccess || org.subscriptionBillingMode !== "SELF_SERVE" || !org.trialOffer ||
    org.subscriptionStatus === "CANCELED" || await tx.subscriptionPeriod.count({ where: { organizationId: org.id } }))
    throw new AppError("billingManualAccessProtected", "CONFLICT", 409);
  if (await tx.subscriptionInvoice.count({ where: { organizationId: org.id, OR: [
    { pendingSlot: org.id }, { status: "REVIEW" }, { status: "PAID" },
  ] } })) throw new AppError("billingPaymentPending", "CONFLICT", 409);
  const target = contractPlan(org.contractTerms, input.plan);
  const [stores, bundles, programs, applications, reservations] = await Promise.all([
    target.features.expiryLots ? [] : tx.store.findMany({ where: { organizationId: org.id, trackExpiryLots: true }, orderBy: { id: "asc" },
      select: { id: true, updatedAt: true } }),
    target.features.bundles ? [] : tx.product.findMany({ where: { organizationId: org.id, isBundle: true, isDeleted: false,
      bundleComponents: { some: {} } }, orderBy: { id: "asc" }, select: { id: true, updatedAt: true } }),
    target.features.loyalty ? [] : tx.loyaltyProgram.findMany({ where: { organizationId: org.id, enabled: true }, orderBy: { id: "asc" },
      select: { id: true, updatedAt: true } }),
    target.features.loyalty ? [] : tx.loyaltyOrderApplication.findMany({ where: { organizationId: org.id, status: "APPLIED" },
      orderBy: { customerOrderId: "asc" }, take: 1001 }),
    target.features.loyalty ? [] : tx.loyaltyReservation.findMany({ where: { organizationId: org.id, status: "ACTIVE" },
      orderBy: [{ accountId: "asc" }, { id: "asc" }], take: 1001 }),
  ]);
  if (applications.length > 1000 || reservations.length > 1000) throw blocked();
  const orderIds = [...new Set([...applications.map(row => row.customerOrderId), ...reservations.flatMap(row => row.customerOrderId ? [row.customerOrderId] : [])])];
  // Locks follow the same order -> account -> reservation ordering as loyalty.
  if (orderIds.length) await tx.$queryRaw`SELECT id FROM "CustomerOrder" WHERE id IN (${Prisma.join(orderIds.sort())}) ORDER BY id FOR UPDATE`;
  const orders = orderIds.length ? await tx.customerOrder.findMany({ where: { id: { in: orderIds }, organizationId: org.id },
    orderBy: { id: "asc" }, include: { lines: { orderBy: { id: "asc" } } } }) : [];
  if (orders.length !== orderIds.length || orders.some(row => row.status !== "DRAFT")) throw blocked();
  const accountIds = [...new Set([...applications.map(row => row.accountId), ...reservations.map(row => row.accountId)])];
  if (accountIds.length) await tx.$queryRaw`SELECT id FROM "LoyaltyAccount"
    WHERE "organizationId"=${org.id} AND id IN (${Prisma.join(accountIds.sort())}) ORDER BY id FOR UPDATE`;
  if (!target.features.loyalty) await tx.$queryRaw`SELECT id FROM "LoyaltyProgram"
    WHERE "organizationId"=${org.id} ORDER BY id FOR UPDATE`;
  // The initial read discovers lock identities. Recheck after obtaining the
  // native order -> account -> programme locks: an in-flight redemption must not produce a
  // confirmation assembled from different versions of financial state.
  const [lockedApplications, lockedReservations] = target.features.loyalty ? [[], []] : await Promise.all([
    tx.loyaltyOrderApplication.findMany({ where: { organizationId: org.id, status: "APPLIED" },
      orderBy: { customerOrderId: "asc" }, take: 1001 }),
    tx.loyaltyReservation.findMany({ where: { organizationId: org.id, status: "ACTIVE" },
      orderBy: [{ accountId: "asc" }, { id: "asc" }], take: 1001 }),
  ]);
  if (digest(applications) !== digest(lockedApplications) || digest(reservations) !== digest(lockedReservations)) throw changed();
  const accounts = accountIds.length ? await tx.loyaltyAccount.findMany({ where: { id: { in: accountIds }, organizationId: org.id },
    orderBy: { id: "asc" } }) : [];
  if (accounts.length !== accountIds.length) throw blocked();
  const draftChanges = applications.map(application => {
    const order = orders.find(row => row.id === application.customerOrderId)!;
    const metadata = application.rulesSnapshot as { version?: number } | null;
    const parsed = z.array(originalLineSchema).safeParse(application.lineDistribution);
    if (metadata?.version !== 2 || !parsed.success) throw blocked();
    const originals = new Map(parsed.data.map(line => [line.lineId, line]));
    if (originals.size !== parsed.data.length || parsed.data.some(line => !order.lines.some(row => row.id === line.lineId))) throw blocked();
    const after = order.lines.reduce((sum, line) => {
      const original = originals.get(line.id);
      if (!original) return sum.plus(line.lineTotalKgs);
      try {
        const restored = line.qty === original.qty ? new Prisma.Decimal(original.originalLineTotalKgs)
          : new Prisma.Decimal(original.originalUnitPriceKgs).mul(line.qty).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        if (!restored.isFinite() || restored.isNegative()) throw blocked();
        return sum.plus(restored);
      } catch { throw blocked(); }
    }, new Prisma.Decimal(0));
    return { orderId: order.id, number: order.number, beforeTotalKgs: order.totalKgs.toFixed(2), afterTotalKgs: after.toFixed(2) };
  });
  const modules = [stores.length ? "expiryLots" : null, bundles.length ? "bundles" : null,
    programs.length ? "loyalty" : null, reservations.length || applications.length ? "loyaltyReservations" : null].filter((value): value is string => value !== null);
  const counts = { stores: stores.length, bundles: bundles.length, loyaltyPrograms: programs.length,
    draftOrders: applications.length, reservations: reservations.length };
  const impact = { stores, bundles, programs, applications, reservations, orders, accounts, target };
  return { org, target, stores, bundles, programs, applications, reservations, modules, counts, draftChanges, impact };
}

export async function previewTrialPreparation(input: Identity) {
  return prisma.$transaction(async tx => {
    const state = await inspect(tx, input);
    return { modules: state.modules, counts: state.counts, draftChanges: state.draftChanges,
      confirmationToken: issueToken(input, state.impact) };
  }, { timeout: 20_000 });
}

export async function prepareTrialSubscription(input: Identity & { confirmationToken: string; requestId: string }) {
  const confirmation = verifyToken(input.confirmationToken, input);
  return prisma.$transaction(async tx => {
    const state = await inspect(tx, input);
    // An exact replay after successful preparation is harmless. A changed,
    // nonempty impact always requires the owner's fresh confirmation.
    if (state.modules.length && confirmation.digest !== digest(state.impact)) throw changed();
    if (state.stores.length) await tx.store.updateMany({ where: { organizationId: input.organizationId, id: { in: state.stores.map(row => row.id) } },
      data: { trackExpiryLots: false } });
    if (state.bundles.length) await tx.product.updateMany({ where: { organizationId: input.organizationId, id: { in: state.bundles.map(row => row.id) } },
      data: { isBundle: false } });
    for (const order of state.draftChanges) await releaseLoyaltyForOrder(tx, { customerOrderId: order.orderId });
    for (const reservation of state.reservations) await releaseReservation(tx, { reservationId: reservation.id });
    if (state.programs.length) await tx.loyaltyProgram.updateMany({ where: { organizationId: input.organizationId, id: { in: state.programs.map(row => row.id) } },
      data: { enabled: false } });
    await assertSubscriptionSelectionReady(await getOrganizationPlan(input.organizationId, tx), state.target, tx);
    if (state.modules.length) await writeAuditLog(tx, { organizationId: input.organizationId, actorId: input.actorId,
      action: "TRIAL_SUBSCRIPTION_PREPARE", entity: "Organization", entityId: input.organizationId,
      before: toJson({ plan: input.plan, counts: state.counts, draftChanges: state.draftChanges }),
      after: toJson({ plan: input.plan, preservesInventory: true, preservesBundleComponents: true, preservesLedger: true }),
      requestId: input.requestId });
    return { modules: [], counts: { stores: 0, bundles: 0, loyaltyPrograms: 0, draftOrders: 0, reservations: 0 },
      draftChanges: [], remaining: [], prepared: true };
  }, { timeout: 20_000 });
}
