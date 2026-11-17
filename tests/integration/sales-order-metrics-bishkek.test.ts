import { randomUUID } from "node:crypto";
import type { Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { adjustStock } from "@/server/services/inventory";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const asUser = (user: {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
  isOrgOwner?: boolean | null;
}) => ({ ...user, organizationId: user.organizationId!, isOrgOwner: Boolean(user.isOrgOwner) });

async function fixture() {
  const f = await seedBase({ plan: "ENTERPRISE" });
  await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 100 } });
  await prisma.storePrice.create({
    data: {
      organizationId: f.org.id,
      storeId: f.store.id,
      productId: f.product.id,
      variantKey: "BASE",
      priceKgs: 100,
    },
  });
  await prisma.productCost.create({
    data: {
      organizationId: f.org.id,
      productId: f.product.id,
      variantKey: "BASE",
      avgCostKgs: 30,
    },
  });
  await adjustStock({
    organizationId: f.org.id,
    actorId: f.adminUser.id,
    storeId: f.store.id,
    productId: f.product.id,
    qtyDelta: 100,
    reason: "metrics fixture",
    idempotencyKey: randomUUID(),
    requestId: randomUUID(),
  });
  const api = createTestCaller(asUser(f.adminUser));
  return { ...f, api };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

/**
 * Creates a completed non-POS sale and pins its completedAt to an exact instant.
 * The grouping must follow the Bishkek business calendar, not the UTC date.
 */
async function saleAt(f: Fixture, completedAt: string) {
  const order = await f.api.salesOrders.createSale({
    storeId: f.store.id,
    idempotencyKey: randomUUID(),
    lines: [{ productId: f.product.id, qty: 1 }],
  });
  await prisma.customerOrder.update({
    where: { id: order.id },
    data: { completedAt: new Date(completedAt) },
  });
  return order.id;
}

describeDb("sales order metrics use the Bishkek business calendar (BZR-07)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("groups a 00:30 Bishkek sale by its local day across a UTC and year boundary", async () => {
    const f = await fixture();
    // 2026-12-31 23:30 Bishkek = 2026-12-31T17:30Z
    await saleAt(f, "2026-12-31T17:30:00.000Z");
    // 2027-01-01 00:30 Bishkek = 2026-12-31T18:30Z (previous UTC day and year)
    await saleAt(f, "2026-12-31T18:30:00.000Z");

    const metrics = await f.api.salesOrders.metrics({
      fromDay: "2026-12-31",
      toDay: "2027-01-01",
      groupBy: "day",
    });

    expect(metrics.revenueSeries).toEqual([
      { date: "2026-12-31", revenueKgs: 100 },
      { date: "2027-01-01", revenueKgs: 100 },
    ]);
    expect(metrics.summary.totalRevenueKgs).toBe(200);
    expect(metrics.summary.ordersCount).toBe(2);
  });

  it("starts every week on Monday derived from the Bishkek date key", async () => {
    const f = await fixture();
    // Sunday 2027-01-03 23:30 Bishkek = 2027-01-03T17:30Z
    await saleAt(f, "2027-01-03T17:30:00.000Z");
    // Monday 2027-01-04 00:30 Bishkek = 2027-01-03T18:30Z (same UTC date)
    await saleAt(f, "2027-01-03T18:30:00.000Z");

    const metrics = await f.api.salesOrders.metrics({
      fromDay: "2026-12-28",
      toDay: "2027-01-04",
      groupBy: "week",
    });

    expect(metrics.revenueSeries).toEqual([
      { date: "2026-12-28", revenueKgs: 100 },
      { date: "2027-01-04", revenueKgs: 100 },
    ]);
    expect(metrics.profitSeries).toEqual([
      { date: "2026-12-28", profitKgs: 70 },
      { date: "2027-01-04", profitKgs: 70 },
    ]);
    expect(metrics.summary.totalRevenueKgs).toBe(200);
  });

  it("keeps the series sums equal to the summary for a multi-day range", async () => {
    const f = await fixture();
    for (const completedAt of [
      "2026-12-31T18:30:00.000Z", // 2027-01-01 00:30 Bishkek
      "2027-01-01T18:30:00.000Z", // 2027-01-02 00:30 Bishkek
      "2027-01-02T18:30:00.000Z", // 2027-01-03 00:30 Bishkek
      "2027-01-04T18:30:00.000Z", // 2027-01-05 00:30 Bishkek
    ]) {
      await saleAt(f, completedAt);
    }

    const metrics = await f.api.salesOrders.metrics({
      fromDay: "2027-01-01",
      toDay: "2027-01-05",
      groupBy: "day",
    });
    expect(metrics.revenueSeries).toHaveLength(4);
    expect(metrics.summary).toMatchObject({
      totalRevenueKgs: 400,
      totalCostKgs: 120,
      totalProfitKgs: 280,
      ordersCount: 4,
    });
    const sum = (values: number[]) =>
      Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;
    expect(sum(metrics.revenueSeries.map((row) => row.revenueKgs))).toBe(
      metrics.summary.totalRevenueKgs,
    );
    expect(sum(metrics.costSeries.map((row) => row.costKgs))).toBe(metrics.summary.totalCostKgs);
    expect(sum(metrics.profitSeries.map((row) => row.profitKgs))).toBe(
      metrics.summary.totalProfitKgs,
    );

    const weekly = await f.api.salesOrders.metrics({
      fromDay: "2027-01-01",
      toDay: "2027-01-05",
      groupBy: "week",
    });
    expect(sum(weekly.revenueSeries.map((row) => row.revenueKgs))).toBe(
      weekly.summary.totalRevenueKgs,
    );
    // Jan 1-3 belong to the week starting Monday 2026-12-28, Jan 5 to 2027-01-04.
    expect(weekly.revenueSeries).toEqual([
      { date: "2026-12-28", revenueKgs: 300 },
      { date: "2027-01-04", revenueKgs: 100 },
    ]);
  });
});
