import { beforeEach, describe, expect, it } from "vitest";
import { CustomerOrderStatus, CustomerOrderSource, Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("online sales report", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  const onlineOrder = (input: {
    organizationId: string;
    storeId: string;
    number: string;
    status: CustomerOrderStatus;
    createdAt: string;
    completedAt?: string;
    canceledAt?: string;
    totalKgs: number;
    discountKgs?: number;
    source?: CustomerOrderSource;
    saleChannel?: "ONLINE" | "IN_STORE" | null;
  }) =>
    prisma.customerOrder.create({
      data: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        number: input.number,
        status: input.status,
        source: input.source ?? CustomerOrderSource.CATALOG,
        saleChannel: input.saleChannel === undefined ? "ONLINE" : input.saleChannel,
        createdAt: new Date(input.createdAt),
        confirmedAt: new Date(input.createdAt),
        completedAt: input.completedAt ? new Date(input.completedAt) : null,
        canceledAt: input.canceledAt ? new Date(input.canceledAt) : null,
        subtotalKgs: new Prisma.Decimal(input.totalKgs + (input.discountKgs ?? 0)),
        discountKgs: new Prisma.Decimal(input.discountKgs ?? 0),
        totalKgs: new Prisma.Decimal(input.totalKgs),
      },
    });

  it("separates created orders from completed money and never double counts", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const register = await prisma.posRegister.create({
      data: { organizationId: org.id, storeId: store.id, name: "Online register", code: "ONL" },
    });
    const shift = await prisma.registerShift.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        registerId: register.id,
        openedById: adminUser.id,
      },
    });

    // Created online orders in the period.
    await onlineOrder({ organizationId: org.id, storeId: store.id, number: "ON-1", status: "CONFIRMED", createdAt: "2026-09-10T06:00:00Z", totalKgs: 1000, discountKgs: 50 });
    const completed = await onlineOrder({ organizationId: org.id, storeId: store.id, number: "ON-2", status: "COMPLETED", createdAt: "2026-09-11T06:00:00Z", completedAt: "2026-09-12T06:00:00Z", totalKgs: 500, source: CustomerOrderSource.CATALOG });
    await onlineOrder({ organizationId: org.id, storeId: store.id, number: "ON-3", status: "CANCELED", createdAt: "2026-09-15T06:00:00Z", canceledAt: "2026-09-16T06:00:00Z", totalKgs: 700 });
    // In-store order must be excluded from the online report entirely.
    await onlineOrder({ organizationId: org.id, storeId: store.id, number: "STORE-1", status: "COMPLETED", createdAt: "2026-09-13T06:00:00Z", completedAt: "2026-09-13T06:00:00Z", totalKgs: 300, saleChannel: "IN_STORE" });
    // Unknown channel must be counted separately, never merged into ONLINE.
    await onlineOrder({ organizationId: org.id, storeId: store.id, number: "UNKNOWN-1", status: "CONFIRMED", createdAt: "2026-09-14T06:00:00Z", totalKgs: 400, saleChannel: null });
    // Completed in the period but created earlier: counts as a sale, not as a created order.
    await onlineOrder({ organizationId: org.id, storeId: store.id, number: "ON-PRIOR", status: "COMPLETED", createdAt: "2026-08-30T06:00:00Z", completedAt: "2026-09-12T06:00:00Z", totalKgs: 250 });
    // Bishkek day boundary (+06:00): 2026-09-05T00:00 local vs 2026-09-04T23:59 local.
    await onlineOrder({ organizationId: org.id, storeId: store.id, number: "ON-BOUNDARY-NEXT", status: "CONFIRMED", createdAt: "2026-09-04T18:00:00Z", totalKgs: 10 });
    await onlineOrder({ organizationId: org.id, storeId: store.id, number: "ON-BOUNDARY-PREV", status: "CONFIRMED", createdAt: "2026-09-04T17:59:00Z", totalKgs: 20 });

    // September return reduces September; the same sale's October return must not.
    await prisma.saleReturn.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        registerId: register.id,
        shiftId: shift.id,
        originalSaleId: completed.id,
        number: "RET-SEPT",
        status: "COMPLETED",
        completedAt: new Date("2026-09-20T06:00:00Z"),
        createdById: adminUser.id,
        completedById: adminUser.id,
        subtotalKgs: new Prisma.Decimal(100),
        totalKgs: new Prisma.Decimal(100),
      },
    });
    await prisma.saleReturn.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        registerId: register.id,
        shiftId: shift.id,
        originalSaleId: completed.id,
        number: "RET-OCT",
        status: "COMPLETED",
        completedAt: new Date("2026-10-05T06:00:00Z"),
        createdById: adminUser.id,
        completedById: adminUser.id,
        subtotalKgs: new Prisma.Decimal(40),
        totalKgs: new Prisma.Decimal(40),
      },
    });

    // Another organization must never leak into this report.
    const foreign = await prisma.organization.create({ data: { name: "Foreign", plan: "BUSINESS" } });
    const foreignStore = await prisma.store.create({
      data: { organizationId: foreign.id, name: "Foreign store", code: "FGN" },
    });
    await onlineOrder({ organizationId: foreign.id, storeId: foreignStore.id, number: "FOREIGN-1", status: "COMPLETED", createdAt: "2026-09-12T06:00:00Z", completedAt: "2026-09-12T06:00:00Z", totalKgs: 999999 });

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });
    const report = await caller.reports.onlineSales({
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
    });

    // Created block: ON-1, ON-2, ON-3, boundary-next, boundary-prev = 5 (not ON-PRIOR, not store/unknown/foreign).
    expect(report.created.count).toBe(5);
    expect(report.created.totalKgs).toBe(1000 + 500 + 700 + 10 + 20);
    expect(report.created.canceled).toBe(1);
    expect(report.created.completed).toBe(1);
    expect(report.unknownCreatedCount).toBe(1);

    // Sales block: ON-2 + ON-PRIOR = 2 completed online sales; returns are September only.
    expect(report.sales.count).toBe(2);
    expect(report.sales.grossKgs).toBe(500 + 250);
    expect(report.sales.returnsKgs).toBe(100);
    expect(report.sales.netKgs).toBe(500 + 250 - 100);
    // No payment rows exist for these online orders, so money received is explicitly unknown.
    expect(report.sales.paymentsKnown).toBe(false);

    // Boundary: the 18:00Z order lands on 2026-09-05, the 17:59Z order on 2026-09-04.
    const byDate = new Map(report.series.map((point) => [point.date, point]));
    expect(byDate.get("2026-09-05")?.createdCount).toBe(1);
    expect(byDate.get("2026-09-04")?.createdCount).toBe(1);

    // Querying the UNKNOWN channel shows exactly the unclassified order.
    const unknown = await caller.reports.onlineSales({
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      channel: "UNKNOWN",
    });
    expect(unknown.created.count).toBe(1);
    expect(unknown.created.totalKgs).toBe(400);
  });
});
