import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { getSalesReport, reportViews } from "@/server/services/reporting/sales";
import { resetDatabase, shouldRunDbTests } from "../helpers/db";
import { seedReportingFixture } from "../helpers/reportingFixture";

const describeDb = shouldRunDbTests ? describe : describe.skip;
describeDb("canonical business reporting", () => {
  beforeEach(resetDatabase);
  it("reconciles discounted documents, return dates and historical costs without multiplying split payments", async () => {
    const f = await seedReportingFixture(prisma);
    const report = await getSalesReport(prisma, f.input, { now: f.now });
    expect(report.totals).toMatchObject({
      grossSalesKgs: 640,
      returnsKgs: 100,
      netSalesKgs: 540,
      knownCostKgs: 44,
      costKgs: null,
      grossProfitKgs: null,
      knownProfitKgs: 416,
      receiptCount: 3,
      returnCount: 1,
      lineCount: 5,
      unknownCostLines: 1,
      zeroCostLines: 1,
      coveragePercent: 80,
      discountKgs: 100,
      averageReceiptKgs: 213.33,
    });
    expect(report.items.find((row) => row.productId === f.tea.id)).toMatchObject({
      grossSalesKgs: 470,
      returnsKgs: 100,
      netSalesKgs: 370,
      costKgs: 44,
      grossProfitKgs: 326,
      quantitySold: 5,
      quantityReturned: 1,
    });
    expect(report.items.find((row) => row.productId === f.gift.id)).toMatchObject({
      costKgs: 0,
      grossProfitKgs: 90,
      marginPercent: 100,
      markupPercent: null,
    });
    expect(report.series.reduce((total, day) => total + day.netSalesKgs, 0)).toBe(540);
    expect(report.items.reduce((total, row) => total + row.netSalesKgs, 0)).toBe(540);
    await prisma.productCost.updateMany({
      where: { organizationId: f.org.id },
      data: { avgCostKgs: 12345 },
    });
    expect((await getSalesReport(prisma, f.input, { now: f.now })).totals).toEqual(report.totals);
  });
  it("uses one filtered population for every dimension and a complete export beyond the visible page", async () => {
    const f = await seedReportingFixture(prisma);
    for (const view of reportViews.filter((view) => view !== "costGaps")) {
      const report = await getSalesReport(prisma, { ...f.input, view }, { now: f.now });
      expect(report.totals.netSalesKgs, view).toBe(540);
      expect(
        report.items.reduce((sum, row) => sum + row.netSalesKgs, 0),
        view,
      ).toBe(540);
    }
    const page = await getSalesReport(prisma, { ...f.input, pageSize: 1 }, { now: f.now });
    const exported = await getSalesReport(
      prisma,
      { ...f.input, pageSize: 1, page: 2 },
      { now: f.now, exportAll: true },
    );
    expect(page.items).toHaveLength(1);
    expect(exported.items).toHaveLength(3);
    expect(exported.totals).toEqual(page.totals);
    const filtered = await getSalesReport(
      prisma,
      { ...f.input, category: "Чай", search: "историческая" },
      { now: f.now },
    );
    expect(filtered.totals).toMatchObject({
      netSalesKgs: 370,
      costKgs: 44,
      grossProfitKgs: 326,
      unknownCostLines: 0,
      discountKgs: 90,
    });
    const gaps = await getSalesReport(prisma, { ...f.input, view: "costGaps" }, { now: f.now });
    expect(gaps.items).toHaveLength(1);
    expect(gaps.items[0].documentId).toBe(f.uncostedSale.id);
  });
  it("keeps separate POS/order populations, preserves return-only periods, and scopes organizations and stores", async () => {
    const f = await seedReportingFixture(prisma);
    const pos = await getSalesReport(prisma, { ...f.input, channel: "pos" }, { now: f.now });
    expect(pos.totals).toMatchObject({ grossSalesKgs: 440, netSalesKgs: 340, receiptCount: 2 });
    const orders = await getSalesReport(prisma, { ...f.input, channel: "orders" }, { now: f.now });
    expect(orders.totals).toMatchObject({
      netSalesKgs: 200,
      costKgs: 24,
      grossProfitKgs: 176,
      returnCount: 0,
    });
    const returns = await getSalesReport(
      prisma,
      { ...f.input, dateFrom: "2026-09-03" },
      { now: f.now },
    );
    expect(returns.totals).toMatchObject({
      netSalesKgs: -100,
      costKgs: -10,
      grossProfitKgs: -90,
      marginPercent: null,
      averageReceiptKgs: null,
    });
    const scoped = await getSalesReport(
      prisma,
      { ...f.input, storeIds: [f.store.id, f.foreignStore.id] },
      { now: f.now },
    );
    expect(scoped.totals).toMatchObject({ netSalesKgs: 460, costKgs: 44, grossProfitKgs: 416 });
    expect(
      (await getSalesReport(prisma, { ...f.input, storeIds: [] }, { now: f.now })).totals
        .netSalesKgs,
    ).toBe(0);
  });
});
