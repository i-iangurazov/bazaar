import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { getSalesReport, reportViews } from "@/server/services/reporting/sales";
import { resetDatabase, shouldRunDbTests } from "../helpers/db";
import { seedReportingFixture } from "../helpers/reportingFixture";
import { fillMissingSalesCosts } from "@/server/services/reporting/fillMissingSalesCosts";

const describeDb = shouldRunDbTests ? describe : describe.skip;
describeDb("canonical business reporting", () => {
  beforeEach(resetDatabase);
  it("explicitly fills only missing costs in the authorized report scope and preserves snapshots", async () => {
    const f = await seedReportingFixture(prisma);
    const actor = { id: f.adminUser.id, organizationId: f.org.id };
    const input = { dateFrom: f.input.dateFrom, dateTo: f.input.dateTo };
    await expect(
      fillMissingSalesCosts(
        { id: f.cashierUser.id, organizationId: f.org.id },
        input,
        "cost-fill-cashier",
      ),
    ).rejects.toMatchObject({ message: "forbidden" });
    expect(
      await fillMissingSalesCosts(
        actor,
        { ...input, storeId: f.store.id },
        "cost-fill-other-store",
      ),
    ).toEqual({ updatedLines: 0 });
    await expect(
      fillMissingSalesCosts(actor, { ...input, storeId: f.foreignStore.id }, "cost-fill-forbidden"),
    ).rejects.toMatchObject({ message: "storeAccessDenied" });
    expect(
      await fillMissingSalesCosts(actor, { ...input, productId: f.tea.id }, "cost-fill-known"),
    ).toEqual({ updatedLines: 0 });
    expect(await fillMissingSalesCosts(actor, input, "cost-fill-selected-period")).toEqual({
      updatedLines: 1,
    });
    const report = await getSalesReport(prisma, f.input, { now: f.now });
    expect(report.totals).toMatchObject({
      unknownCostLines: 0,
      zeroCostLines: 1,
      costKgs: 121,
      grossProfitKgs: 419,
      coveragePercent: 100,
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: f.org.id, action: "SALES_MISSING_COST_FILLED" },
    });
    expect(audit.after).toMatchObject({ source: "current_product_cost", count: 1 });
    await prisma.productCost.updateMany({
      where: { organizationId: f.org.id },
      data: { avgCostKgs: 9999 },
    });
    expect(await fillMissingSalesCosts(actor, input, "cost-fill-repeat")).toEqual({
      updatedLines: 0,
    });
    expect((await getSalesReport(prisma, f.input, { now: f.now })).totals).toEqual(report.totals);
  });
  it("uses the exact variant cost and leaves conflicting historical costs for manual review", async () => {
    const f = await seedReportingFixture(prisma);
    const actor = { id: f.adminUser.id, organizationId: f.org.id };
    const input = { dateFrom: f.input.dateFrom, dateTo: f.input.dateTo };
    const variant = await prisma.productVariant.create({
      data: { productId: f.unknown.id, name: "Variant with its own cost", attributes: {} },
    });
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: f.uncostedSale.id },
    });
    await prisma.customerOrderLine.update({
      where: { id: line.id },
      data: { variantId: variant.id, variantKey: variant.id },
    });
    expect(await fillMissingSalesCosts(actor, input, "cost-fill-no-base-fallback")).toEqual({
      updatedLines: 0,
    });
    await prisma.productCost.create({
      data: {
        organizationId: f.org.id,
        productId: f.unknown.id,
        variantId: variant.id,
        variantKey: variant.id,
        avgCostKgs: 15,
      },
    });
    expect(await fillMissingSalesCosts(actor, input, "cost-fill-variant")).toEqual({
      updatedLines: 1,
    });
    const filled = await prisma.customerOrderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(Number(filled.unitCostKgs)).toBe(15);
    expect(Number(filled.lineCostTotalKgs)).toBe(15);
    await prisma.customerOrderLine.update({
      where: { id: line.id },
      data: { unitCostKgs: 11, lineCostTotalKgs: 10 },
    });
    expect(await fillMissingSalesCosts(actor, input, "cost-fill-conflict")).toEqual({
      updatedLines: 0,
    });
    const preserved = await prisma.customerOrderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(Number(preserved.unitCostKgs)).toBe(11);
    expect(Number(preserved.lineCostTotalKgs)).toBe(10);
  });
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
