import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { buildShiftReportRows, type StoreSummary } from "@/server/services/exports";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("shift X/Z export settlement", () => {
  beforeEach(resetDatabase);

  it("reports only ACTUAL settlement rows in cash, refund and expected-cash fields", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const register = await prisma.posRegister.create({
      data: { organizationId: org.id, storeId: store.id, name: "Export register", code: "EXP-1" },
    });
    const openedAt = new Date("2026-08-01T09:00:00Z");
    const shift = await prisma.registerShift.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        registerId: register.id,
        openedById: adminUser.id,
        openingCashKgs: 10,
        openedAt,
      },
    });
    const sale = await prisma.customerOrder.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        registerId: register.id,
        shiftId: shift.id,
        number: "EXP-POS-1",
        status: "COMPLETED",
        isPosSale: true,
        completedAt: openedAt,
        createdAt: openedAt,
        createdById: adminUser.id,
        subtotalKgs: 100,
        totalKgs: 100,
      },
    });
    const basePayment = {
      organizationId: org.id,
      storeId: store.id,
      shiftId: shift.id,
      customerOrderId: sale.id,
      method: "CASH" as const,
      createdAt: openedAt,
    };
    await prisma.salePayment.createMany({
      data: [
        { ...basePayment, amountKgs: 100, isRefund: false, settlementStatus: "ACTUAL" },
        { ...basePayment, amountKgs: 50, isRefund: false, settlementStatus: "OFFSET" },
        { ...basePayment, amountKgs: 30, isRefund: true, settlementStatus: "ACTUAL" },
        { ...basePayment, amountKgs: 40, isRefund: true, settlementStatus: "PENDING" },
        { ...basePayment, amountKgs: 25, isRefund: true, settlementStatus: "OFFSET" },
        { ...basePayment, amountKgs: 10, isRefund: true, settlementStatus: "VOID" },
      ],
    });
    const stored = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    const summary: StoreSummary = {
      id: stored.id,
      name: stored.name,
      code: stored.code,
      currencyCode: stored.currencyCode ?? "KGS",
      currencyRateKgsPerUnit: stored.currencyRateKgsPerUnit ?? new Prisma.Decimal(1),
    };

    const rows = await buildShiftReportRows(
      org.id,
      summary,
      new Date(openedAt.getTime() - 86_400_000),
      new Date(openedAt.getTime() + 86_400_000),
      "x",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      shiftId: shift.id,
      salesCount: 1,
      salesTotalKgs: 100,
      cashSalesKgs: 100,
      cashRefundsKgs: 30,
      nonCashRefundsKgs: 0,
      openingCashKgs: 10,
      expectedCashKgs: 80,
    });

    await prisma.registerShift.update({
      where: { id: shift.id },
      data: { status: "CLOSED", closedAt: new Date(openedAt.getTime() + 3_600_000), closedById: adminUser.id },
    });
    const closedRows = await buildShiftReportRows(
      org.id,
      summary,
      new Date(openedAt.getTime() - 86_400_000),
      new Date(openedAt.getTime() + 86_400_000),
      "z",
    );
    expect(closedRows).toHaveLength(1);
    expect(closedRows[0]).toMatchObject({
      shiftId: shift.id,
      reportType: "SHIFT_Z",
      status: "CLOSED",
      cashSalesKgs: 100,
      cashRefundsKgs: 30,
      expectedCashKgs: 80,
    });
  });
});
