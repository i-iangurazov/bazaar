import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { OPENAI_TEXT_PILOT_BUDGET } from "@/server/billing/openAiTextPilot";
import { reserveProviderExpense, settleProviderExpense } from "@/server/billing/providerExpense";
import { getSubscriptionUsage, reserveSubscriptionUsage, settleSubscriptionExpense,
  startSubscriptionUsage } from "@/server/billing/subscriptionUsage";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

(shouldRunDbTests ? describe : describe.skip)("provider expenditure reservations on PostgreSQL", () => {
  beforeEach(resetDatabase);
  const modern = async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    await prisma.organization.update({ where: { id: f.org.id }, data: {
      currentPeriodEndsAt: new Date(Date.now() + 30 * 86400000),
    } });
    await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11" } });
    return f;
  };
  const budget = async (id: string) =>
    (await getSubscriptionUsage(id)).find(r => r.resource === "aiVendorBudgetMinor")!;

  it("settles actual usage once, returns unused estimate and does not consume customer AI operations", async () => {
    const f = await modern();
    const expense = await reserveProviderExpense({ organizationId: f.org.id, kind: "text",
      operationKey: "request", estimatedMinor: 100 });
    expect(await budget(f.org.id)).toMatchObject({ used: 0, reserved: 100 });
    await settleProviderExpense(expense, 12);
    await settleProviderExpense(expense, 90);
    expect(await budget(f.org.id)).toMatchObject({ used: 12, reserved: 0 });
    expect((await getSubscriptionUsage(f.org.id)).find(r => r.resource === "ai"))
      .toMatchObject({ used: 0, reserved: 0 });
  });
  it("does not release an uncertain started request on worker expiry and accepts a late usage receipt", async () => {
    const f = await modern();
    const expense = await reserveProviderExpense({ organizationId: f.org.id, kind: "text",
      operationKey: "lost-response", estimatedMinor: 100 });
    await prisma.subscriptionUsageReservation.update({ where: { id: expense.lease!.id },
      data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await budget(f.org.id)).toMatchObject({ used: 100, reserved: 0 });
    await settleProviderExpense(expense, 7);
    await settleProviderExpense(expense, 7);
    expect(await budget(f.org.id)).toMatchObject({ used: 7, reserved: 0 });
  });
  it("returns an unstarted expired reservation and a known provider rejection", async () => {
    const f = await modern();
    const lease = await reserveSubscriptionUsage({ organizationId: f.org.id,
      resource: "aiVendorBudgetMinor", operationKey: "before-fetch", units: 100 });
    await prisma.subscriptionUsageReservation.update({ where: { id: lease!.id },
      data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await budget(f.org.id)).toMatchObject({ used: 0, reserved: 0 });
    const expense = await reserveProviderExpense({ organizationId: f.org.id, kind: "text",
      operationKey: "rejected", estimatedMinor: 100 });
    await settleProviderExpense(expense, 0);
    expect(await budget(f.org.id)).toMatchObject({ used: 0, reserved: 0 });
  });
  it("serializes the final expenditure allowance before provider execution", async () => {
    const f = await modern();
    const initial = await reserveSubscriptionUsage({ organizationId: f.org.id,
      resource: "aiVendorBudgetMinor", operationKey: "prior", units: 9999 });
    await startSubscriptionUsage(initial);
    await settleSubscriptionExpense(initial, 71999);
    const results = await Promise.allSettled(["last-one", "last-two"].map(operationKey =>
      reserveProviderExpense({ organizationId: f.org.id, kind: "text", operationKey, estimatedMinor: 1 })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect(await budget(f.org.id)).toMatchObject({ limit: 72000, used: 71999, reserved: 1 });
  });
  it("isolates expense settlement by tenant and keeps legacy grants unmetered", async () => {
    const f = await modern();
    const other = await prisma.organization.create({ data: { name: "Legacy" } });
    const expense = await reserveProviderExpense({ organizationId: f.org.id, kind: "text",
      operationKey: "tenant", estimatedMinor: 100 });
    await expect(settleSubscriptionExpense({ ...expense.lease!, organizationId: other.id }, 0)).rejects.toThrow();
    expect(await budget(f.org.id)).toMatchObject({ used: 0, reserved: 100 });
    const oldExpense = await reserveProviderExpense({ organizationId: other.id, kind: "text",
      operationKey: "legacy", estimatedMinor: 100 });
    expect(oldExpense.lease).toBeNull();
    await settleProviderExpense(oldExpense, 12);
    expect(await prisma.subscriptionUsageReservation.count({ where: { organizationId: other.id } })).toBe(0);
  });

  it("reserves the last experimental dollar allowance atomically with the contract allowance", async () => {
    const f = await modern();
    const results = await Promise.allSettled(["openai-one", "openai-two"].map(operationKey =>
      reserveProviderExpense({ organizationId: f.org.id, kind: "text", operationKey, estimatedMinor: 100,
        pilot: { estimatedCents: 3, dailyLimitCents: 3 } })));
    const fulfilled = results.filter(r => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect(await budget(f.org.id)).toMatchObject({ used: 0, reserved: 100 });
    const daily = () => prisma.subscriptionUsageBucket.findFirst({
      where: { organizationId: f.org.id, resource: OPENAI_TEXT_PILOT_BUDGET },
    });
    expect(await daily()).toMatchObject({ used: 0, reserved: 3 });
    await settleProviderExpense(fulfilled[0].value, 30, 1);
    await settleProviderExpense(fulfilled[0].value, 0, 0);
    expect(await daily()).toMatchObject({ used: 1, reserved: 0 });
    expect(await budget(f.org.id)).toMatchObject({ used: 30, reserved: 0 });
  });

  it("counts expired started OpenAI reservations as spent while the result is unknown", async () => {
    const f = await modern();
    const expense = await reserveProviderExpense({ organizationId: f.org.id, kind: "text",
      operationKey: "lost-openai", estimatedMinor: 70, pilot: { estimatedCents: 3, dailyLimitCents: 3 } });
    await prisma.subscriptionUsageReservation.updateMany({
      where: { organizationId: f.org.id }, data: { expiresAt: new Date(Date.now() - 10) },
    });
    await expect(reserveProviderExpense({ organizationId: f.org.id, kind: "text", operationKey: "openai-next",
      estimatedMinor: 100, pilot: { estimatedCents: 1, dailyLimitCents: 3 } })).rejects.toThrow("billingAiProviderBudgetReached");
    expect(await budget(f.org.id)).toMatchObject({ used: 70, reserved: 0 });
    await settleProviderExpense(expense, 30, 1);
    expect(await prisma.subscriptionUsageBucket.findFirst({
      where: { organizationId: f.org.id, resource: OPENAI_TEXT_PILOT_BUDGET },
    })).toMatchObject({ used: 1, reserved: 0 });
  });
});
