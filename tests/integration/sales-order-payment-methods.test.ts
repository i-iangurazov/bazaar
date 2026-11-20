import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("payment methods in the customer orders list", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lists actual receipts by method, including split and partial payments", async () => {
    const { org, store, cashierUser } = await seedBase({ plan: "ENTERPRISE" });
    const api = createTestCaller({ ...cashierUser, organizationId: org.id });
    const register = await prisma.posRegister.create({
      data: { organizationId: org.id, storeId: store.id, name: "Test register", code: "PAYMENTS" },
    });
    const shift = await api.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: randomUUID(),
    });
    const otherStore = await prisma.store.create({
      data: { organizationId: org.id, name: "Unassigned store", code: "UNASSIGNED" },
    });
    const baseOrder = {
      organizationId: org.id,
      storeId: store.id,
      status: "COMPLETED",
      subtotalKgs: 500,
      totalKgs: 500,
    } as const;
    const paid = await prisma.customerOrder.create({
      data: { ...baseOrder, number: "ORDER-001" },
    });
    const historical = await prisma.customerOrder.create({
      data: { ...baseOrder, number: "ORDER-002", createdAt: new Date("2024-01-01T10:00:00Z") },
    });
    await prisma.customerOrder.create({
      data: { ...baseOrder, number: "ORDER-000", storeId: otherStore.id },
    });

    for (const [method, amountKgs] of [
      ["CASH", 90],
      ["CASH", 15.5],
      ["CARD", 40],
      ["TRANSFER", 12.25],
      ["OTHER", 3],
    ] as const) {
      await api.salesOrders.recordPayment({
        customerOrderId: paid.id,
        shiftId: shift.id,
        method,
        amountKgs,
        idempotencyKey: randomUUID(),
      });
    }
    const ledgerEntry = {
      organizationId: org.id,
      storeId: store.id,
      customerOrderId: paid.id,
      shiftId: shift.id,
      method: "CASH",
    } as const;
    await prisma.salePayment.createMany({
      data: [
        { ...ledgerEntry, amountKgs: 20, settlementStatus: "OFFSET" },
        { ...ledgerEntry, amountKgs: 15, settlementStatus: "PENDING", isRefund: true },
        { ...ledgerEntry, amountKgs: 15, settlementStatus: "VOID", isRefund: true },
        { ...ledgerEntry, amountKgs: 10, settlementStatus: "ACTUAL", isRefund: true },
        { ...ledgerEntry, amountKgs: 0, method: "OTHER", customerOrderId: historical.id },
      ],
    });
    await prisma.registerShift.update({
      where: { id: shift.id },
      data: { status: "CLOSED", closedAt: new Date(), closedById: cashierUser.id },
    });

    const sort = { sortBy: "number", sortDirection: "asc", pageSize: 1 } as const;
    await expect(api.salesOrders.list({ ...sort, page: 1 })).resolves.toMatchObject({
      total: 2,
      items: [
        {
          id: paid.id,
          totalKgs: 500,
          receivedPayments: [
            { method: "CASH", amountKgs: 105.5 },
            { method: "CARD", amountKgs: 40 },
            { method: "TRANSFER", amountKgs: 12.25 },
            { method: "OTHER", amountKgs: 3 },
          ],
        },
      ],
    });
    await expect(api.salesOrders.list({ ...sort, page: 2 })).resolves.toMatchObject({
      total: 2,
      items: [{ id: historical.id, receivedPayments: [] }],
    });
  });
});
