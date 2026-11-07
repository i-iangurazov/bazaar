import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createContractTerms } from "@/server/billing/contractTerms";
import { getOrganizationPlan } from "@/server/services/planLimits";
import { reserveSubscriptionUsage, startSubscriptionUsage, settleSubscriptionUsage,
  getSubscriptionUsage, withSubscriptionUsage } from "@/server/billing/subscriptionUsage";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const seedModern = async (plan: "STARTER" | "BUSINESS" | "ENTERPRISE" = "STARTER") => {
  const f = await seedBase({ plan });
  await prisma.organization.update({ where: { id: f.org.id }, data: {
    currentPeriodEndsAt: new Date(Date.now() + 30 * 86400000),
  } });
  await prisma.user.updateMany({ where: { organizationId: f.org.id, id: { not: f.adminUser.id } }, data: { isActive: false } });
  await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11",
    termsSnapshot: createContractTerms("2026-11") } });
  return f;
};

(shouldRunDbTests ? describe : describe.skip)("immutable contracts and atomic quota/capacity on PostgreSQL", () => {
  beforeEach(resetDatabase);
  it("initializes legacy terms once and protects the complete price/feature snapshot", async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    const contract = await prisma.subscriptionContract.create({ data: { organizationId: f.org.id } });
    expect(contract.termsSnapshot).toMatchObject({ version: 1, plans: { BUSINESS: {
      monthlyPriceKgs: 4375, limits: { maxStores: 5, maxActiveUsers: 10 },
      features: { bundles: true, expiryLots: true, periodClose: true } } } });
    await expect(prisma.subscriptionContract.update({ where: { organizationId: f.org.id },
      data: { termsSnapshot: createContractTerms("2026-11") } })).rejects.toThrow();
    expect((await getOrganizationPlan(f.org.id)).entitlements.monthlyPriceKgs).toBe(4375);
  });
  it("admits only one concurrent activation for the last user slot", async () => {
    const f = await seedModern();
    const disabled = await prisma.user.findMany({ where: { organizationId: f.org.id, isActive: false }, take: 2 });
    const results = await Promise.allSettled(disabled.map(user => prisma.user.update({ where: { id: user.id }, data: { isActive: true } })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.user.count({ where: { organizationId: f.org.id, isActive: true } })).toBe(2);
    await expect(prisma.store.create({ data: { organizationId: f.org.id, name: "Unpaid warehouse", code: "EXTRA" } })).rejects.toThrow();
    expect(await prisma.store.count({ where: { organizationId: f.org.id } })).toBe(1);
  });
  it("counts active product cards, and protects restore from exceeding the limit", async () => {
    const f = await seedModern();
    await prisma.product.createMany({ data: Array.from({ length: 999 }, (_, i) => ({ organizationId: f.org.id,
      name: `Position ${i}`, sku: `CAP-${i}`, unit: f.baseUnit.code, baseUnitId: f.baseUnit.id })) });
    const archived = await prisma.product.create({ data: { organizationId: f.org.id, name: "Archived", sku: "ARCH",
      unit: f.baseUnit.code, baseUnitId: f.baseUnit.id, isDeleted: true } });
    await expect(prisma.product.update({ where: { id: archived.id }, data: { isDeleted: false } })).rejects.toThrow();
    await prisma.product.update({ where: { id: f.product.id }, data: { isDeleted: true } });
    await prisma.product.update({ where: { id: archived.id }, data: { isDeleted: false } });
    expect(await prisma.product.count({ where: { organizationId: f.org.id, isDeleted: false } })).toBe(1000);
    expect(await prisma.product.count({ where: { organizationId: f.org.id } })).toBe(1001);
  });
  it("reserves the last AI operation exactly once under concurrency and does not reset on retry", async () => {
    const f = await seedModern();
    const batch = await reserveSubscriptionUsage({ organizationId: f.org.id, resource: "ai", operationKey: "batch", units: 99 });
    const results = await Promise.allSettled(["last-a", "last-b"].map(operationKey =>
      reserveSubscriptionUsage({ organizationId: f.org.id, resource: "ai", operationKey })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const last = results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<typeof batch>;
    await startSubscriptionUsage(batch); await settleSubscriptionUsage(batch, true);
    await startSubscriptionUsage(last.value); await settleSubscriptionUsage(last.value, true);
    await settleSubscriptionUsage(last.value, true);
    const usage = (await getSubscriptionUsage(f.org.id)).find(r => r.resource === "ai")!;
    expect(usage).toMatchObject({ limit: 100, used: 100, reserved: 0, remaining: 0 });
    await expect(reserveSubscriptionUsage({ organizationId: f.org.id, resource: "ai", operationKey: "batch" }))
      .rejects.toThrow("billingUsageAlreadyCompleted");
  });
  it("releases failed work and lets the same operation retry without double consumption", async () => {
    const f = await seedModern("BUSINESS");
    const input = { organizationId: f.org.id, resource: "images" as const, operationKey: randomUUID() };
    await expect(withSubscriptionUsage(input, async () => { throw new Error("Synthetic provider failure"); }))
      .rejects.toThrow("Synthetic provider failure");
    expect((await getSubscriptionUsage(f.org.id)).find(r => r.resource === "images"))
      .toMatchObject({ used: 0, reserved: 0, remaining: 5 });
    await withSubscriptionUsage(input, async () => "image");
    expect((await getSubscriptionUsage(f.org.id)).find(r => r.resource === "images"))
      .toMatchObject({ used: 1, reserved: 0, remaining: 4 });
  });
  it("blocks an unavailable resource before a provider can run and isolates organizations", async () => {
    const f = await seedModern();
    let called = false;
    await expect(withSubscriptionUsage({ organizationId: f.org.id, resource: "images", operationKey: "blocked" },
      async () => { called = true; })).rejects.toThrow("billingUsageLimitReached");
    expect(called).toBe(false);
    expect(await prisma.subscriptionUsageReservation.count()).toBe(0);
    const second = await prisma.organization.create({ data: { name: "Other tenant", plan: "BUSINESS",
      currentPeriodEndsAt: new Date(Date.now() + 30 * 86400000),
      subscriptionContract: { create: { catalogVersion: "2026-11" } } } });
    const lease = await reserveSubscriptionUsage({ organizationId: second.id, resource: "images", operationKey: "blocked" });
    await expect(settleSubscriptionUsage({ ...lease!, organizationId: f.org.id }, true)).rejects.toThrow();
    expect((await getSubscriptionUsage(second.id)).find(r => r.resource === "images")?.reserved).toBe(1);
    await settleSubscriptionUsage(lease, false);
  });
  it("leaves legacy and lifetime-like unlimited contracts outside new quota billing", async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, lifetimeAccess: true } });
    const lease = await reserveSubscriptionUsage({ organizationId: f.org.id, resource: "ai", operationKey: "free", units: 10000 });
    expect(lease).toBeNull();
    expect(await prisma.subscriptionUsageBucket.count()).toBe(0);
  });
});
