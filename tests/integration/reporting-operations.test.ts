import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { getOperationsReport } from "@/server/services/reporting/operations";
import { getAdminMetrics } from "@/server/services/adminMetrics";
import { resetDatabase, shouldRunDbTests } from "../helpers/db";
import { seedReportingFixture } from "../helpers/reportingFixture";

(shouldRunDbTests ? describe : describe.skip)("operational reporting populations", () => {
  beforeEach(resetDatabase);
  it("preserves price-only receipt corrections and distinguishes write-offs from a mixed movement journal", async () => {
    const f = await seedReportingFixture(prisma);
    await prisma.stockMovement.createMany({
      data: [
        {
          storeId: f.store.id,
          productId: f.tea.id,
          type: "RECEIVE",
          qtyDelta: 0,
          unitCostKgs: 11,
          lineTotalKgs: 18,
          referenceType: "STOCK_RECEIVING",
          createdAt: f.sale.completedAt!,
        },
        {
          storeId: f.store.id,
          productId: f.tea.id,
          type: "WRITE_OFF",
          qtyDelta: -5,
          unitCostKgs: 10,
          lineTotalKgs: 50,
          referenceType: "WRITE_OFF",
          createdAt: f.sale.completedAt!,
        },
        {
          storeId: f.store.id,
          productId: f.tea.id,
          type: "WRITE_OFF",
          qtyDelta: 2,
          unitCostKgs: 10,
          lineTotalKgs: -20,
          referenceType: "WRITE_OFF",
          createdAt: f.sale.completedAt!,
        },
        {
          storeId: f.store.id,
          productId: f.tea.id,
          type: "ADJUSTMENT",
          qtyDelta: -100,
          unitCostKgs: 10,
          lineTotalKgs: -1000,
          createdAt: f.sale.completedAt!,
        },
      ],
    });
    const receipts = await getOperationsReport(
      prisma,
      { ...f.input, view: "receipts" },
      { now: f.now },
    );
    expect(receipts.summary).toMatchObject({ amountKgs: 18, count: 1 });
    expect(receipts.items[0]).toMatchObject({ amountKgs: 18, quantity: 0 });
    const writeOffs = await getOperationsReport(
      prisma,
      { ...f.input, view: "writeOffs" },
      { now: f.now },
    );
    expect(writeOffs.summary).toMatchObject({ amountKgs: 30, count: 2 });
    const journal = await getOperationsReport(
      prisma,
      { ...f.input, view: "movements" },
      { now: f.now },
    );
    expect(journal.summary).toMatchObject({ amountKgs: null, count: 4 });
  });
  it("uses payment date and counts split payments once; drawer withdrawals are separate", async () => {
    const f = await seedReportingFixture(prisma);
    await prisma.salePayment.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        shiftId: f.shift.id,
        customerOrderId: f.sale.id,
        method: "TRANSFER",
        amountKgs: 17,
        createdAt: new Date("2026-09-05T00:00:00Z"),
      },
    });
    await prisma.cashDrawerMovement.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        shiftId: f.shift.id,
        type: "PAY_OUT",
        amountKgs: 15,
        reason: "QA withdrawal",
        createdAt: f.sale.completedAt!,
      },
    });
    const payments = await getOperationsReport(
      prisma,
      { ...f.input, view: "payments", pageSize: 1 },
      { now: f.now },
    );
    expect(payments.summary).toMatchObject({
      amountKgs: 260,
      inflowKgs: 360,
      outflowKgs: 100,
      count: 3,
    });
    expect(payments.items).toHaveLength(1);
    const exported = await getOperationsReport(
      prisma,
      { ...f.input, view: "payments", pageSize: 1, page: 2 },
      { now: f.now, exportAll: true },
    );
    expect(exported.items).toHaveLength(3);
    expect(exported.summary).toEqual(payments.summary);
    const cash = await getOperationsReport(prisma, { ...f.input, view: "cash" }, { now: f.now });
    expect(cash.summary).toMatchObject({ amountKgs: -15, outflowKgs: 15, count: 1 });
  });
  it("includes partial receipts at their actual date, signed corrections, known zero and missing cost", async () => {
    const f = await seedReportingFixture(prisma);
    const supplier = await prisma.supplier.create({
      data: { organizationId: f.org.id, name: "QA Supplier" },
    });
    const po = await prisma.purchaseOrder.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        status: "PARTIALLY_RECEIVED",
        supplierId: supplier.id,
        lines: { create: { productId: f.tea.id, qtyOrdered: 10, qtyReceived: 3, unitCost: 900 } },
      },
    });
    await prisma.stockMovement.createMany({
      data: [
        {
          storeId: f.store.id,
          productId: f.tea.id,
          type: "RECEIVE",
          qtyDelta: 4,
          unitCostKgs: 10,
          lineTotalKgs: 40,
          referenceType: "PURCHASE_ORDER",
          referenceId: po.id,
          createdAt: f.sale.completedAt!,
        },
        {
          storeId: f.store.id,
          productId: f.tea.id,
          type: "RECEIVE",
          qtyDelta: -1,
          unitCostKgs: 10,
          lineTotalKgs: -10,
          referenceType: "PURCHASE_ORDER",
          referenceId: po.id,
          createdAt: f.sale.completedAt!,
        },
        {
          storeId: f.store.id,
          productId: f.gift.id,
          type: "RECEIVE",
          qtyDelta: 2,
          unitCostKgs: 0,
          lineTotalKgs: 0,
          referenceType: "STOCK_RECEIVING",
          createdAt: f.sale.completedAt!,
        },
        {
          storeId: f.otherStore.id,
          productId: f.unknown.id,
          type: "RECEIVE",
          qtyDelta: 1,
          referenceType: "STOCK_RECEIVING",
          createdAt: f.sale.completedAt!,
        },
      ],
    });
    const receipts = await getOperationsReport(
      prisma,
      { ...f.input, view: "receipts" },
      { now: f.now },
    );
    expect(receipts.summary).toMatchObject({
      amountKgs: null,
      knownAmountKgs: 30,
      unknownRows: 1,
      count: 4,
    });
    const suppliers = await getOperationsReport(
      prisma,
      { ...f.input, view: "suppliers" },
      { now: f.now },
    );
    expect(suppliers.items.find((row) => row.id === supplier.id)).toMatchObject({
      amountKgs: 30,
      count: 2,
    });
    expect(suppliers.items.find((row) => row.id === "__unassigned__")).toMatchObject({
      amountKgs: null,
      unknownRows: 1,
    });
    expect(
      (
        await getOperationsReport(
          prisma,
          { ...f.input, storeIds: [f.foreignStore.id], view: "receipts" },
          { now: f.now },
        )
      ).total,
    ).toBe(0);
  });
  it("separates current stock from historical sales and applies warnings to every inventory summary", async () => {
    const f = await seedReportingFixture(prisma);
    await prisma.inventorySnapshot.createMany({
      data: [
        { storeId: f.store.id, productId: f.tea.id, onHand: 5 },
        { storeId: f.otherStore.id, productId: f.gift.id, onHand: -1, allowNegativeStock: true },
      ],
    });
    const stock = await getOperationsReport(
      prisma,
      { ...f.input, view: "stock", dateFrom: "2024-01-01", dateTo: "2024-01-01" },
      { now: f.now },
    );
    expect(stock.meta.currentSnapshot).toBe(true);
    expect(stock.summary).toMatchObject({ amountKgs: 4995, negativeStock: 1, count: 2 });
    const metrics = await getAdminMetrics({ organizationId: f.org.id }, prisma, { now: f.now });
    // The 30-day window also contains the explicitly priced BEFORE/AFTER fixture sales (700 each).
    expect(metrics.sales30d).toMatchObject({
      revenueKgs: 1940,
      grossProfitKgs: null,
      unknownCostLines: 1,
    });
    const warning = await getAdminMetrics(
      { organizationId: f.org.id, warning: "negativeStock" },
      prisma,
      { now: f.now },
    );
    expect(warning.inventory.snapshotCount).toBe(1);
    expect(warning.inventory.summary.totalStockQty).toBe(-1);
    expect(warning.inventory.storeSummaries).toHaveLength(1);
    expect(warning.inventory.products.rows).toHaveLength(1);
    expect(warning.sales30d.revenueKgs).toBe(0);
  });
});
