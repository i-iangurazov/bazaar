import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { getLogger } from "@/server/logging";
import { reportsRouter } from "@/server/trpc/routers/reports";
import { adminMetricsRouter } from "@/server/trpc/routers/adminMetrics";
import { getSalesReport } from "@/server/services/reporting/sales";
import { editCompletedSaleReturn } from "@/server/services/pos";
import { withReportRead } from "@/server/services/reporting/access";
import { resetDatabase, shouldRunDbTests } from "../helpers/db";
import { seedReportingFixture } from "../helpers/reportingFixture";

const context = (user: User) => ({
  prisma,
  user: {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId!,
    isOrgOwner: user.isOrgOwner,
    isPlatformOwner: false,
  },
  impersonator: null,
  impersonationSessionId: null,
  ip: "127.0.0.1",
  requestId: randomUUID(),
  logger: getLogger("reporting-test"),
});
(shouldRunDbTests ? describe : describe.skip)("reporting cost evidence and authorization", () => {
  beforeEach(resetDatabase);
  it("retains cent-exact historical total across successive partial returns", async () => {
    const f = await seedReportingFixture(prisma),
      line = f.sale.lines.find((row) => row.productId === f.tea.id)!;
    await prisma.customerOrderLine.update({
      where: { id: line.id },
      data: { unitCostKgs: null, lineCostTotalKgs: 1 },
    });
    for (let i = 2; i <= 3; i++)
      await prisma.saleReturn.create({
        data: {
          organizationId: f.org.id,
          storeId: f.store.id,
          registerId: f.register.id,
          shiftId: f.shift.id,
          originalSaleId: f.sale.id,
          number: `REPORT-RETURN-${i}`,
          createdById: f.adminUser.id,
          status: "COMPLETED",
          completedAt: new Date(`2026-09-03T0${i}:00:00Z`),
          subtotalKgs: 100,
          totalKgs: 100,
          lines: {
            create: {
              customerOrderLineId: line.id,
              productId: f.tea.id,
              qty: 1,
              unitPriceKgs: 100,
              lineTotalKgs: 100,
            },
          },
        },
      });
    const report = await getSalesReport(
      prisma,
      { ...f.input, view: "documents", kind: "return", sort: "name", direction: "asc" },
      { now: f.now },
    );
    expect(report.items.map((row) => row.costKgs)).toEqual([-0.33, -0.34, -0.33]);
    expect(report.totals.costKgs).toBe(-1);
    expect(report.totals.derivedReturnCostLines).toBe(3);
  });
  it("never accepts today's cost on a return whose original historical cost is unknown", async () => {
    const f = await seedReportingFixture(prisma),
      line = f.sale.lines.find((row) => row.productId === f.tea.id)!;
    await prisma.customerOrderLine.update({
      where: { id: line.id },
      data: { unitCostKgs: null, lineCostTotalKgs: null },
    });
    const report = await getSalesReport(prisma, { ...f.input, kind: "return" }, { now: f.now });
    expect(report.totals).toMatchObject({
      costKgs: null,
      unknownCostLines: 1,
      grossProfitKgs: null,
      knownProfitKgs: 0,
    });
    const returnLine = await prisma.saleReturnLine.findFirstOrThrow({
      where: { saleReturnId: f.saleReturn.id },
    });
    const request = {
      organizationId: f.org.id,
      saleReturnId: f.saleReturn.id,
      actorId: f.adminUser.id,
      user: context(f.adminUser).user,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      lines: [
        {
          lineId: returnLine.id,
          customerOrderLineId: line.id,
          productId: f.tea.id,
          qty: 1,
          unitPriceKgs: 100,
        },
      ],
    };
    await editCompletedSaleReturn(request);
    const saved = await prisma.saleReturnLine.findUniqueOrThrow({ where: { id: returnLine.id } });
    expect(saved.unitCostKgs).toBeNull();
    expect(saved.lineCostTotalKgs).toBeNull();
    await editCompletedSaleReturn(request);
    expect(await prisma.saleReturnLine.count({ where: { saleReturnId: f.saleReturn.id } })).toBe(1);
    await prisma.customerOrderLine.update({
      where: { id: line.id },
      data: { unitCostKgs: 0, lineCostTotalKgs: 0 },
    });
    await editCompletedSaleReturn({ ...request, idempotencyKey: randomUUID() });
    expect(
      Number(
        (await prisma.saleReturnLine.findUniqueOrThrow({ where: { id: returnLine.id } }))
          .unitCostKgs,
      ),
    ).toBe(0);
  });
  it("enforces roles, fresh grants, strict arguments, organization and export access on the server", async () => {
    const f = await seedReportingFixture(prisma);
    const input = { dateFrom: f.input.dateFrom, dateTo: f.input.dateTo, channel: "all" as const };
    for (const user of [f.staffUser, f.cashierUser]) {
      const api = reportsRouter.createCaller(context(user));
      await expect(api.sales(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(api.salesExport(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        api.operations({ ...input, channel: undefined, view: "stock" } as never),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const manager = reportsRouter.createCaller(context(f.managerUser));
    const admin = reportsRouter.createCaller(context(f.adminUser));
    expect((await manager.sales(input)).totals.netSalesKgs).toBe(460);
    expect((await admin.sales(input)).totals.netSalesKgs).toBe(540);
    await expect(manager.sales({ ...input, storeId: f.otherStore.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(admin.sales({ ...input, storeId: f.foreignStore.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      admin.sales({ ...input, organizationId: "forged" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      adminMetricsRouter.createCaller(context(f.managerUser)).get(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      adminMetricsRouter.createCaller(context(f.adminUser)).get({ storeId: f.foreignStore.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const exported = await admin.salesExport({ ...input, pageSize: 1 });
    expect(exported.items).toHaveLength(3);
    await prisma.userStoreAccess.deleteMany({ where: { userId: f.managerUser.id } });
    expect((await manager.sales(input)).totals.netSalesKgs).toBe(0);
    await prisma.user.update({ where: { id: f.managerUser.id }, data: { isActive: false } });
    await expect(manager.sales(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("holds a consistent report snapshot during concurrent writes and rechecks export authorization", async () => {
    const f = await seedReportingFixture(prisma);
    const result = await withReportRead(context(f.adminUser).user, {}, async (tx) => {
      const first = await getSalesReport(tx, f.input, { now: f.now });
      await prisma.customerOrder.update({
        where: { id: f.uncostedSale.id },
        data: { status: "CANCELED" },
      });
      const second = await getSalesReport(tx, f.input, { now: f.now });
      expect(second.totals).toEqual(first.totals);
      return second;
    });
    expect(result.totals.netSalesKgs).toBe(540);
    expect((await getSalesReport(prisma, f.input, { now: f.now })).totals.netSalesKgs).toBe(460);
    await expect(
      withReportRead(context(f.adminUser).user, { export: true }, async (tx) => {
        const report = await getSalesReport(tx, f.input, { now: f.now });
        await prisma.user.update({ where: { id: f.adminUser.id }, data: { isActive: false } });
        return report;
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
