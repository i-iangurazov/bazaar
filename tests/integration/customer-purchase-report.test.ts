import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { getSalesReport } from "@/server/services/reporting/sales";
import { resetDatabase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";
import { seedReportingFixture } from "../helpers/reportingFixture";

(shouldRunDbTests ? describe : describe.skip)("customer purchases and commercial channels", () => {
  beforeEach(resetDatabase);
  async function fixture() {
    const f = await seedReportingFixture(prisma);
    const customer = await prisma.customer.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        name: "Customer One",
        email: "report@example.invalid",
      },
    });
    const second = await prisma.customer.create({
      data: {
        organizationId: f.org.id,
        storeId: f.otherStore.id,
        name: "Customer Two",
        email: "second@example.invalid",
      },
    });
    await prisma.customerOrder.update({
      where: { id: f.sale.id },
      data: { customerId: customer.id, saleChannel: "ONLINE" },
    });
    await prisma.customerOrder.update({
      where: { id: f.order.id },
      data: { saleChannel: "IN_STORE" },
    }); // historical contact only
    const api = (user = f.adminUser) => createTestCaller({ ...user, organizationId: f.org.id });
    return { ...f, customer, second, api, selected: { ...f.input, customerId: customer.id } };
  }
  it("reconciles exact spend, quantities, distinct receipts, channel filters and full exports", async () => {
    const f = await fixture();
    const report = await getSalesReport(
      prisma,
      { ...f.selected, sort: "quantity", pageSize: 1 },
      { now: f.now },
    );
    expect(report.customer?.id).toBe(f.customer.id);
    expect(report.totals).toMatchObject({
      grossSalesKgs: 560,
      returnsKgs: 100,
      netSalesKgs: 460,
      receiptCount: 2,
      returnCount: 1,
    });
    expect(report.items[0]).toMatchObject({
      productId: f.tea.id,
      quantitySold: 5,
      quantityReturned: 1,
      grossSalesKgs: 470,
      netSalesKgs: 370,
    });
    const exported = await f
      .api()
      .reports.salesExport({
        dateFrom: f.input.dateFrom,
        dateTo: f.input.dateTo,
        customerId: f.customer.id,
        pageSize: 1,
      });
    expect(exported.items).toHaveLength(2);
    expect(exported.totals.netSalesKgs).toBe(460);
    for (const [saleChannel, net, receipts] of [
      ["ONLINE", 260, 1],
      ["IN_STORE", 200, 1],
      ["UNKNOWN", 0, 0],
    ] as const) {
      const filtered = await getSalesReport(prisma, { ...f.selected, saleChannel }, { now: f.now });
      expect(filtered.totals).toMatchObject({ netSalesKgs: net, receiptCount: receipts });
    }
    expect(
      (await getSalesReport(prisma, { ...f.input, saleChannel: "UNKNOWN" }, { now: f.now })).totals
        .netSalesKgs,
    ).toBe(80);
    const receipts = await getSalesReport(
      prisma,
      { ...f.selected, view: "documents", kind: "sale", pageSize: 1, sort: "date" },
      { now: f.now },
    );
    expect(receipts.total).toBe(2);
    expect(receipts.items[0]).toMatchObject({
      documentId: f.order.id,
      storeId: f.store.id,
      saleChannel: "IN_STORE",
      status: "COMPLETED",
    });
    const secondPage = await getSalesReport(
      prisma,
      { ...f.selected, view: "documents", kind: "sale", pageSize: 1, page: 2, sort: "date" },
      { now: f.now },
    );
    expect(secondPage.items[0]).toMatchObject({
      documentId: f.sale.id,
      saleChannel: "ONLINE",
      eventAt: "2026-09-01T18:00:00.000Z",
    });
  });
  it("uses Bishkek date boundaries under a non-UTC session, a 50-day interval, and refund event dates", async () => {
    const f = await fixture();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Asia/Shanghai'`;
      expect((await getSalesReport(tx, f.selected, { now: f.now })).totals.netSalesKgs).toBe(460);
      const firstDay = await getSalesReport(
        tx,
        { ...f.selected, dateTo: "2026-09-02" },
        { now: f.now },
      );
      expect(firstDay.totals).toMatchObject({
        grossSalesKgs: 560,
        returnsKgs: 0,
        netSalesKgs: 560,
      });
      const refundDay = await getSalesReport(
        tx,
        { ...f.selected, dateFrom: "2026-09-03" },
        { now: f.now },
      );
      expect(refundDay.totals).toMatchObject({
        grossSalesKgs: 0,
        returnsKgs: 100,
        netSalesKgs: -100,
        receiptCount: 0,
      });
    });
    const fiftyDays = await getSalesReport(
      prisma,
      { ...f.selected, dateFrom: "2026-07-16", dateTo: "2026-09-03" },
      { now: f.now },
    );
    expect(fiftyDays.series).toHaveLength(50);
    expect(fiftyDays.totals.netSalesKgs).toBe(460);
  });
  it("keeps stable IDs, rejects ambiguous historical contacts, and never assigns anonymous or same-name receipts", async () => {
    const f = await fixture();
    await prisma.customer.update({
      where: { id: f.customer.id },
      data: { email: "changed@example.invalid", name: "Renamed" },
    });
    expect((await getSalesReport(prisma, f.selected, { now: f.now })).totals.netSalesKgs).toBe(260);
    await prisma.customer.update({
      where: { id: f.customer.id },
      data: { email: "report@example.invalid" },
    });
    await prisma.customer.update({
      where: { id: f.second.id },
      data: { email: "REPORT@example.invalid" },
    });
    expect((await getSalesReport(prisma, f.selected, { now: f.now })).totals.netSalesKgs).toBe(260);
    expect(
      (await getSalesReport(prisma, { ...f.input, customerId: f.second.id }, { now: f.now })).totals
        .receiptCount,
    ).toBe(0);
    const noPurchases = await prisma.customer.create({
      data: { organizationId: f.org.id, storeId: f.store.id, name: f.sale.customerName! },
    });
    const empty = await getSalesReport(
      prisma,
      { ...f.input, customerId: noPurchases.id },
      { now: f.now },
    );
    expect(empty.items).toEqual([]);
    expect(empty.totals.netSalesKgs).toBe(0);
  });
  it("scopes a shared customer's rows, exports and selection to permitted stores and preserves history after catalogue changes", async () => {
    const f = await fixture();
    await prisma.customerOrder.update({
      where: { id: f.uncostedSale.id },
      data: { customerId: f.customer.id },
    });
    const input = { dateFrom: f.input.dateFrom, dateTo: f.input.dateTo, customerId: f.customer.id };
    const manager = f.api(f.managerUser);
    expect((await manager.reports.sales(input)).totals.netSalesKgs).toBe(460);
    expect((await manager.reports.salesExport(input)).totals.netSalesKgs).toBe(460);
    expect((await f.api().reports.sales(input)).totals.netSalesKgs).toBe(540);
    expect(
      (await manager.reports.customerOptions({ page: 1 })).items.map((c) => c.id),
    ).not.toContain(f.second.id);
    await expect(manager.reports.sales({ ...input, customerId: f.second.id })).rejects.toThrow(
      "customerNotFound",
    );
    const foreign = await prisma.customer.create({
      data: {
        organizationId: f.foreignStore.organizationId,
        storeId: f.foreignStore.id,
        name: "Foreign",
      },
    });
    await expect(f.api().reports.sales({ ...input, customerId: foreign.id })).rejects.toThrow(
      "customerNotFound",
    );
    const before = await f.api().reports.sales(input);
    const change = {
      action: "SHARE" as const,
      sourceStoreId: f.store.id,
      targetStoreIds: [f.otherStore.id],
      scope: "ALL" as const,
      includeFuture: true,
      productIds: [],
      mutual: false,
    };
    const preview = await f.api().stores.previewAssortmentShare(change);
    await f
      .api()
      .stores.applyAssortmentShare({
        change,
        previewToken: preview.previewToken,
        idempotencyKey: randomUUID(),
      });
    await prisma.product.update({
      where: { id: f.tea.id },
      data: { isDeleted: true, basePriceKgs: 99999 },
    });
    expect((await f.api().reports.sales(input)).totals).toEqual(before.totals);
  });
});
