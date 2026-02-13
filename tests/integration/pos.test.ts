import { beforeEach, describe, expect, it } from "vitest";
import { CashDrawerMovementType, StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { adjustStock } from "@/server/services/inventory";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("pos", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("reuses existing draft for cashier and register", async () => {
    const { org, store, cashierUser } = await seedBase();

    const register = await prisma.posRegister.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Front Desk",
        code: "FRONT",
      },
    });

    const caller = createTestCaller({
      id: cashierUser.id,
      email: cashierUser.email,
      role: cashierUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });

    await caller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "pos-open-reuse-1",
    });

    const firstDraft = await caller.pos.sales.createDraft({ registerId: register.id });
    const secondDraft = await caller.pos.sales.createDraft({ registerId: register.id });

    const draftCount = await prisma.customerOrder.count({
      where: {
        organizationId: org.id,
        registerId: register.id,
        isPosSale: true,
        status: "DRAFT",
      },
    });

    expect(secondDraft.id).toBe(firstDraft.id);
    expect(draftCount).toBe(1);
  });

  it("filters sales list by statuses", async () => {
    const { org, store, cashierUser } = await seedBase();

    const register = await prisma.posRegister.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Front Desk",
        code: "FRONT",
      },
    });

    const caller = createTestCaller({
      id: cashierUser.id,
      email: cashierUser.email,
      role: cashierUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });

    await caller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "pos-open-filter-1",
    });

    await caller.pos.sales.createDraft({ registerId: register.id });

    const completedOnly = await caller.pos.sales.list({
      registerId: register.id,
      statuses: ["COMPLETED"],
      page: 1,
      pageSize: 25,
    });
    const draftOnly = await caller.pos.sales.list({
      registerId: register.id,
      statuses: ["DRAFT"],
      page: 1,
      pageSize: 25,
    });

    expect(completedOnly.items).toHaveLength(0);
    expect(draftOnly.items).toHaveLength(1);
  });

  it("enforces one open shift per register", async () => {
    const { org, store, cashierUser } = await seedBase();

    const register = await prisma.posRegister.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Front Desk",
        code: "FRONT",
      },
    });

    const caller = createTestCaller({
      id: cashierUser.id,
      email: cashierUser.email,
      role: cashierUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });

    await caller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "pos-open-1",
    });

    await expect(
      caller.pos.shifts.open({
        registerId: register.id,
        openingCashKgs: 100,
        idempotencyKey: "pos-open-2",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("completes sale idempotently with inventory and payments", async () => {
    const { org, store, product, cashierUser, adminUser } = await seedBase();

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 100 },
    });

    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 10,
      reason: "seed",
      idempotencyKey: "pos-seed-1",
      requestId: "pos-seed-1",
    });

    const register = await prisma.posRegister.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Front Desk",
        code: "FRONT",
      },
    });

    const caller = createTestCaller({
      id: cashierUser.id,
      email: cashierUser.email,
      role: cashierUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });

    await caller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "pos-open-3",
    });

    const sale = await caller.pos.sales.createDraft({ registerId: register.id });
    await caller.pos.sales.addLine({ saleId: sale.id, productId: product.id, qty: 2 });

    await caller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "pos-sale-complete-1",
      payments: [{ method: "CASH", amountKgs: 200 }],
    });
    await caller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "pos-sale-complete-1",
      payments: [{ method: "CASH", amountKgs: 200 }],
    });

    const dbSale = await prisma.customerOrder.findUnique({ where: { id: sale.id } });
    const movements = await prisma.stockMovement.findMany({
      where: {
        storeId: store.id,
        productId: product.id,
        type: StockMovementType.SALE,
        referenceId: sale.id,
      },
    });
    const payments = await prisma.salePayment.findMany({ where: { customerOrderId: sale.id } });
    const snapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });

    expect(dbSale?.status).toBe("COMPLETED");
    expect(movements).toHaveLength(1);
    expect(movements[0]?.qtyDelta).toBe(-2);
    expect(payments).toHaveLength(1);
    expect(Number(payments[0]?.amountKgs ?? 0)).toBe(200);
    expect(snapshot?.onHand).toBe(8);
  });

  it("completes return idempotently and restores inventory", async () => {
    const { org, store, product, cashierUser, managerUser, adminUser } = await seedBase();

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 100 },
    });

    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 10,
      reason: "seed",
      idempotencyKey: "pos-seed-2",
      requestId: "pos-seed-2",
    });

    const register = await prisma.posRegister.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Front Desk",
        code: "FRONT",
      },
    });

    const cashierCaller = createTestCaller({
      id: cashierUser.id,
      email: cashierUser.email,
      role: cashierUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });

    await cashierCaller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "pos-open-4",
    });

    const shift = await cashierCaller.pos.shifts.current({ registerId: register.id });
    if (!shift) {
      throw new Error("expected open shift");
    }

    const sale = await cashierCaller.pos.sales.createDraft({ registerId: register.id });
    await cashierCaller.pos.sales.addLine({ saleId: sale.id, productId: product.id, qty: 2 });
    await cashierCaller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "pos-sale-complete-2",
      payments: [{ method: "CASH", amountKgs: 200 }],
    });

    const saleLine = await prisma.customerOrderLine.findFirst({ where: { customerOrderId: sale.id } });
    if (!saleLine) {
      throw new Error("expected sale line");
    }

    const returnDraft = await cashierCaller.pos.returns.createDraft({
      shiftId: shift.id,
      originalSaleId: sale.id,
    });

    await cashierCaller.pos.returns.addLine({
      saleReturnId: returnDraft.id,
      customerOrderLineId: saleLine.id,
      qty: 1,
    });

    const managerCaller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });

    await managerCaller.pos.returns.complete({
      saleReturnId: returnDraft.id,
      idempotencyKey: "pos-return-complete-1",
      payments: [{ method: "CASH", amountKgs: 100 }],
    });
    await managerCaller.pos.returns.complete({
      saleReturnId: returnDraft.id,
      idempotencyKey: "pos-return-complete-1",
      payments: [{ method: "CASH", amountKgs: 100 }],
    });

    const movements = await prisma.stockMovement.findMany({
      where: {
        storeId: store.id,
        productId: product.id,
        type: StockMovementType.RETURN,
        referenceId: returnDraft.id,
      },
    });
    const payments = await prisma.salePayment.findMany({
      where: { saleReturnId: returnDraft.id, isRefund: true },
    });
    const snapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });

    expect(movements).toHaveLength(1);
    expect(movements[0]?.qtyDelta).toBe(1);
    expect(payments).toHaveLength(1);
    expect(Number(payments[0]?.amountKgs ?? 0)).toBe(100);
    expect(snapshot?.onHand).toBe(9);
  });

  it("closes shift with expected cash and discrepancy", async () => {
    const { org, store, product, cashierUser, managerUser, adminUser } = await seedBase();

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 100 },
    });

    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 5,
      reason: "seed",
      idempotencyKey: "pos-seed-3",
      requestId: "pos-seed-3",
    });

    const register = await prisma.posRegister.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Front Desk",
        code: "FRONT",
      },
    });

    const cashierCaller = createTestCaller({
      id: cashierUser.id,
      email: cashierUser.email,
      role: cashierUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });

    await cashierCaller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 50,
      idempotencyKey: "pos-open-5",
    });

    const shift = await cashierCaller.pos.shifts.current({ registerId: register.id });
    if (!shift) {
      throw new Error("expected open shift");
    }

    const sale = await cashierCaller.pos.sales.createDraft({ registerId: register.id });
    await cashierCaller.pos.sales.addLine({ saleId: sale.id, productId: product.id, qty: 1 });
    await cashierCaller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "pos-sale-complete-3",
      payments: [{ method: "CASH", amountKgs: 100 }],
    });

    await cashierCaller.pos.cash.record({
      shiftId: shift.id,
      type: CashDrawerMovementType.PAY_IN,
      amountKgs: 10,
      reason: "float",
      idempotencyKey: "pos-cash-in-1",
    });
    await cashierCaller.pos.cash.record({
      shiftId: shift.id,
      type: CashDrawerMovementType.PAY_OUT,
      amountKgs: 20,
      reason: "pickup",
      idempotencyKey: "pos-cash-out-1",
    });

    const managerCaller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });

    const close = await managerCaller.pos.shifts.close({
      shiftId: shift.id,
      closingCashCountedKgs: 130,
      idempotencyKey: "pos-shift-close-1",
    });

    expect(close.expectedCashKgs).toBe(140);
    expect(close.discrepancyKgs).toBe(-10);
  });
});
