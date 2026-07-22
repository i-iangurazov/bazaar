import {
  CashDrawerMovementType,
  PosPaymentMethod,
  Role,
  StockMovementType,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const kkmRuntime = vi.hoisted(() => ({
  calls: [] as Array<{ receiptId?: string; storeId: string }>,
  mode: "fail" as "fail" | "success",
  gate: null as Promise<void> | null,
}));

vi.mock("@/server/kkm/registry", () => ({
  getKkmAdapter: () => ({
    health: async () => ({ ok: true }),
    fiscalizeReceipt: async (draft: { receiptId?: string; storeId: string }) => {
      const callNumber = kkmRuntime.calls.length + 1;
      kkmRuntime.calls.push({ receiptId: draft.receiptId, storeId: draft.storeId });
      if (kkmRuntime.mode === "fail") {
        throw new Error("mock-kkm-failure");
      }
      if (kkmRuntime.gate) {
        await kkmRuntime.gate;
      }
      const now = new Date("2026-07-22T00:00:00.000Z");
      return {
        providerReceiptId: `mock-provider-${callNumber}`,
        fiscalNumber: `mock-fiscal-${callNumber}`,
        fiscalizedAt: now,
        printedAt: now,
        rawJson: { mock: true, callNumber },
      };
    },
  }),
}));

import { prisma } from "@/server/db/prisma";
import { adjustStock } from "@/server/services/inventory";
import { runKkmRetryJob } from "@/server/services/kkmConnector";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

type TestUser = {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
  isOrgOwner?: boolean;
};

const callerFor = (user: TestUser) => {
  if (!user.organizationId) {
    throw new Error("expected organization user");
  }
  return createTestCaller({
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    isOrgOwner: Boolean(user.isOrgOwner),
  });
};

type TestCaller = ReturnType<typeof createTestCaller>;

const createRegisterAndShift = async (input: {
  organizationId: string;
  storeId: string;
  caller: TestCaller;
  key: string;
}) => {
  const register = await prisma.posRegister.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      name: `Register ${input.key}`,
      code: input.key.toUpperCase(),
    },
  });
  const shift = await input.caller.pos.shifts.open({
    registerId: register.id,
    openingCashKgs: 0,
    idempotencyKey: `${input.key}-open-shift`,
  });
  return { register, shift };
};

const createSecondaryStore = async (input: {
  organizationId: string;
  productId: string;
  caller: TestCaller;
  key: string;
}) => {
  const store = await prisma.store.create({
    data: {
      organizationId: input.organizationId,
      name: `Secondary ${input.key}`,
      code: input.key.toUpperCase(),
    },
  });
  await prisma.storeProduct.create({
    data: {
      organizationId: input.organizationId,
      storeId: store.id,
      productId: input.productId,
      isActive: true,
    },
  });
  const runtime = await createRegisterAndShift({
    organizationId: input.organizationId,
    storeId: store.id,
    caller: input.caller,
    key: input.key,
  });
  return { store, ...runtime };
};

const createAndCompleteSale = async (input: {
  caller: TestCaller;
  registerId: string;
  productId: string;
  key: string;
  qty?: number;
  unitPriceKgs?: number;
  debtCustomerName?: string;
}) => {
  const sale = await input.caller.pos.sales.createDraft({ registerId: input.registerId });
  const line = await input.caller.pos.sales.addLine({
    saleId: sale.id,
    productId: input.productId,
    qty: input.qty ?? 1,
  });
  if (input.unitPriceKgs !== undefined) {
    await input.caller.pos.sales.updateLine({
      lineId: line.id,
      qty: input.qty ?? 1,
      unitPriceKgs: input.unitPriceKgs,
    });
  }
  const before = await prisma.customerOrder.findUniqueOrThrow({
    where: { id: sale.id },
    select: { totalKgs: true },
  });
  const totalKgs = Number(before.totalKgs);
  const completed = await input.caller.pos.sales.complete({
    saleId: sale.id,
    idempotencyKey: `${input.key}-complete-sale`,
    debtCustomerName: input.debtCustomerName ?? null,
    payments: input.debtCustomerName
      ? []
      : [{ method: PosPaymentMethod.CASH, amountKgs: totalKgs }],
    clientState: { visibleCartLineCount: 1, visibleCartTotalKgs: totalKgs },
  });
  return { sale, line, completed, totalKgs };
};

const waitForKkmCalls = async (count: number) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (kkmRuntime.calls.length >= count) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`expected ${count} mock KKM calls, received ${kkmRuntime.calls.length}`);
};

describeDb("Agent 1 P0 runtime verification", () => {
  beforeEach(async () => {
    kkmRuntime.calls.length = 0;
    kkmRuntime.mode = "fail";
    kkmRuntime.gate = null;
    await resetDatabase();
  });

  it("HARD-A1-001 exposes inaccessible-store POS records through tRPC reads", async () => {
    const { org, store, product, adminUser, managerUser } = await seedBase({
      plan: "ENTERPRISE",
    });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    const adminCaller = callerFor(adminUser);
    const managerCaller = callerFor(managerUser);
    const secondary = await createSecondaryStore({
      organizationId: org.id,
      productId: product.id,
      caller: adminCaller,
      key: "p0001",
    });
    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: secondary.store.id,
      productId: product.id,
      qtyDelta: 20,
      reason: "HARD-A1-001 fixture",
      idempotencyKey: "hard-a1-001-stock",
      requestId: "hard-a1-001-stock",
    });
    const completedSale = await createAndCompleteSale({
      caller: adminCaller,
      registerId: secondary.register.id,
      productId: product.id,
      key: "hard-a1-001-cash",
    });
    const debtSale = await createAndCompleteSale({
      caller: adminCaller,
      registerId: secondary.register.id,
      productId: product.id,
      key: "hard-a1-001-debt",
      debtCustomerName: "Store A2 debtor",
    });
    const saleReturn = await adminCaller.pos.returns.createDraft({
      shiftId: secondary.shift.id,
      originalSaleId: completedSale.sale.id,
    });
    await adminCaller.pos.returns.addLine({
      saleReturnId: saleReturn.id,
      customerOrderLineId: completedSale.line.id,
      qty: 1,
    });
    const fiscalReceipt = await prisma.fiscalReceipt.create({
      data: {
        organizationId: org.id,
        storeId: secondary.store.id,
        customerOrderId: completedSale.sale.id,
        mode: "ADAPTER",
        status: "FAILED",
        providerKey: "mock",
        idempotencyKey: "hard-a1-001-fiscal",
        payloadJson: {
          storeId: secondary.store.id,
          receiptId: completedSale.sale.number,
          lines: [{ sku: product.sku, name: product.name, qty: 1, priceKgs: 100 }],
        },
      },
    });

    const access = await prisma.userStoreAccess.findMany({
      where: { userId: managerUser.id },
      select: { storeId: true },
    });
    expect(access.map((entry) => entry.storeId)).toEqual([store.id]);
    expect(access.some((entry) => entry.storeId === secondary.store.id)).toBe(false);

    const beforeCounts = await Promise.all([
      prisma.registerShift.count(),
      prisma.customerOrder.count(),
      prisma.saleReturn.count(),
      prisma.fiscalReceipt.count(),
    ]);
    const shifts = await managerCaller.pos.shifts.list({
      storeId: secondary.store.id,
      page: 1,
      pageSize: 20,
    });
    const xReport = await managerCaller.pos.shifts.xReport({ shiftId: secondary.shift.id });
    const returns = await managerCaller.pos.returns.list({
      registerId: secondary.register.id,
      page: 1,
      pageSize: 25,
    });
    const returnDetail = await managerCaller.pos.returns.get({ saleReturnId: saleReturn.id });
    const debts = await managerCaller.pos.debts.list({
      storeId: secondary.store.id,
      page: 1,
      pageSize: 20,
    });
    const receipts = await managerCaller.pos.receipts({
      storeId: secondary.store.id,
      page: 1,
      pageSize: 25,
    });
    const fiscal = await managerCaller.pos.kkm.receipts({
      storeId: secondary.store.id,
      page: 1,
      pageSize: 25,
    });
    const afterCounts = await Promise.all([
      prisma.registerShift.count(),
      prisma.customerOrder.count(),
      prisma.saleReturn.count(),
      prisma.fiscalReceipt.count(),
    ]);

    expect(shifts.items.some((item) => item.id === secondary.shift.id)).toBe(true);
    expect(xReport.shift.store.id).toBe(secondary.store.id);
    expect(returns.items.some((item) => item.id === saleReturn.id)).toBe(true);
    expect(returnDetail?.store.id).toBe(secondary.store.id);
    expect(debts.items.some((item) => item.id === debtSale.sale.id)).toBe(true);
    expect(receipts.items.some((item) => item.id === completedSale.sale.id)).toBe(true);
    expect(fiscal.items.some((item) => item.id === fiscalReceipt.id)).toBe(true);
    expect(afterCounts).toEqual(beforeCounts);
  });

  it("HARD-A1-002 permits inaccessible-store marking, cash, return, and debt writes", async () => {
    const { org, store, product, adminUser, cashierUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    const adminCaller = callerFor(adminUser);
    const cashierCaller = callerFor(cashierUser);
    const secondary = await createSecondaryStore({
      organizationId: org.id,
      productId: product.id,
      caller: adminCaller,
      key: "p0002",
    });
    const access = await prisma.userStoreAccess.findMany({
      where: { userId: cashierUser.id },
      select: { storeId: true },
    });
    expect(access.map((entry) => entry.storeId)).toEqual([store.id]);

    const draft = await adminCaller.pos.sales.createDraft({ registerId: secondary.register.id });
    const line = await adminCaller.pos.sales.addLine({
      saleId: draft.id,
      productId: product.id,
      qty: 1,
    });
    const beforeMarking = await prisma.markingCodeCapture.count({
      where: { saleId: draft.id },
    });
    await cashierCaller.pos.sales.upsertMarkingCodes({
      saleId: draft.id,
      lineId: line.id,
      codes: ["B0-A1-002-MARK"],
    });
    const afterMarking = await prisma.markingCodeCapture.findMany({
      where: { saleId: draft.id },
    });
    await adminCaller.pos.sales.cancelDraft({ saleId: draft.id });

    const beforeCash = await prisma.cashDrawerMovement.count({
      where: { shiftId: secondary.shift.id },
    });
    const cash = await cashierCaller.pos.cash.record({
      shiftId: secondary.shift.id,
      type: CashDrawerMovementType.PAY_IN,
      amountKgs: 10,
      reason: "Cross-store cash mutation",
      idempotencyKey: "hard-a1-002-cash",
    });
    const afterCash = await prisma.cashDrawerMovement.count({
      where: { shiftId: secondary.shift.id },
    });

    const completedSale = await createAndCompleteSale({
      caller: adminCaller,
      registerId: secondary.register.id,
      productId: product.id,
      key: "hard-a1-002-return-source",
    });
    const beforeReturns = await prisma.saleReturn.count({
      where: { originalSaleId: completedSale.sale.id },
    });
    const crossStoreReturn = await cashierCaller.pos.returns.createDraft({
      shiftId: secondary.shift.id,
      originalSaleId: completedSale.sale.id,
    });
    const afterReturns = await prisma.saleReturn.count({
      where: { originalSaleId: completedSale.sale.id },
    });

    const debtSale = await createAndCompleteSale({
      caller: adminCaller,
      registerId: secondary.register.id,
      productId: product.id,
      key: "hard-a1-002-debt",
      debtCustomerName: "Cross-store debt",
    });
    const paymentsBeforeSettlement = await prisma.salePayment.count({
      where: { customerOrderId: debtSale.sale.id },
    });
    await cashierCaller.pos.debts.settle({
      saleId: debtSale.sale.id,
      registerId: secondary.register.id,
      method: PosPaymentMethod.CASH,
      idempotencyKey: "hard-a1-002-settle",
    });
    const settledDebt = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: debtSale.sale.id },
      include: { payments: true },
    });

    expect(beforeMarking).toBe(0);
    expect(afterMarking).toHaveLength(1);
    expect(afterMarking[0]?.storeId).toBe(secondary.store.id);
    expect(afterMarking[0]?.capturedById).toBe(cashierUser.id);
    expect(beforeCash).toBe(0);
    expect(afterCash).toBe(1);
    expect(cash.storeId).toBe(secondary.store.id);
    expect(cash.createdById).toBe(cashierUser.id);
    expect(beforeReturns).toBe(0);
    expect(afterReturns).toBe(1);
    expect(crossStoreReturn.storeId).toBe(secondary.store.id);
    expect(crossStoreReturn.createdById).toBe(cashierUser.id);
    expect(paymentsBeforeSettlement).toBe(0);
    expect(settledDebt.debtSettledById).toBe(cashierUser.id);
    expect(settledDebt.payments).toHaveLength(1);
    expect(settledDebt.payments[0]?.storeId).toBe(secondary.store.id);
  });

  it("HARD-A1-003 executes register, shift-close, and refund operations with disallowed roles", async () => {
    const { org, store, product, adminUser, managerUser, staffUser, cashierUser } = await seedBase({
      plan: "BUSINESS",
    });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    const adminCaller = callerFor(adminUser);
    const managerCaller = callerFor(managerUser);
    const staffCaller = callerFor(staffUser);
    const cashierCaller = callerFor(cashierUser);

    const registersBefore = await prisma.posRegister.count({ where: { storeId: store.id } });
    const managerRegister = await managerCaller.pos.registers.create({
      storeId: store.id,
      name: "Manager-created register",
      code: "MGR-P0",
    });
    const registersAfter = await prisma.posRegister.count({ where: { storeId: store.id } });
    const cashierShift = await cashierCaller.pos.shifts.open({
      registerId: managerRegister.id,
      openingCashKgs: 0,
      idempotencyKey: "hard-a1-003-cashier-open",
    });
    const closed = await cashierCaller.pos.shifts.close({
      shiftId: cashierShift.id,
      closingCashCountedKgs: 0,
      idempotencyKey: "hard-a1-003-cashier-close",
    });
    const persistedClosedShift = await prisma.registerShift.findUniqueOrThrow({
      where: { id: cashierShift.id },
    });

    const returnRuntime = await createRegisterAndShift({
      organizationId: org.id,
      storeId: store.id,
      caller: adminCaller,
      key: "p0003ret",
    });
    const original = await createAndCompleteSale({
      caller: adminCaller,
      registerId: returnRuntime.register.id,
      productId: product.id,
      key: "hard-a1-003-original",
    });
    const returnDraft = await staffCaller.pos.returns.createDraft({
      shiftId: returnRuntime.shift.id,
      originalSaleId: original.sale.id,
    });
    await staffCaller.pos.returns.addLine({
      saleReturnId: returnDraft.id,
      customerOrderLineId: original.line.id,
      qty: 1,
    });
    const returnBefore = await prisma.saleReturn.findUniqueOrThrow({
      where: { id: returnDraft.id },
    });
    await staffCaller.pos.returns.complete({
      saleReturnId: returnDraft.id,
      idempotencyKey: "hard-a1-003-staff-return",
      payments: [{ method: PosPaymentMethod.CASH, amountKgs: original.totalKgs }],
    });
    const returnAfter = await prisma.saleReturn.findUniqueOrThrow({
      where: { id: returnDraft.id },
    });

    expect(registersBefore).toBe(0);
    expect(registersAfter).toBe(1);
    expect(managerRegister.storeId).toBe(store.id);
    expect(closed.status).toBe("CLOSED");
    expect(persistedClosedShift.closedById).toBe(cashierUser.id);
    expect(returnBefore.status).toBe("DRAFT");
    expect(returnAfter.status).toBe("COMPLETED");
    expect(returnAfter.completedById).toBe(staffUser.id);
  });

  it("HARD-A1-004 lets another cashier complete active and held drafts and rewrites attribution", async () => {
    const { org, store, product, cashierUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    const secondCashier = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: "cashier-two@test.local",
        name: "Cashier Two",
        passwordHash: "hash",
        role: Role.CASHIER,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.userStoreAccess.create({
      data: {
        organizationId: org.id,
        userId: secondCashier.id,
        storeId: store.id,
      },
    });
    const firstCaller = callerFor(cashierUser);
    const secondCaller = callerFor(secondCashier);
    const runtime = await createRegisterAndShift({
      organizationId: org.id,
      storeId: store.id,
      caller: firstCaller,
      key: "p0004",
    });

    const active = await firstCaller.pos.sales.createDraft({ registerId: runtime.register.id });
    const activeLine = await firstCaller.pos.sales.addLine({
      saleId: active.id,
      productId: product.id,
      qty: 1,
    });
    const activeBefore = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: active.id },
    });
    await secondCaller.pos.sales.updateNotes({ saleId: active.id, notes: "changed by cashier two" });
    await secondCaller.pos.sales.complete({
      saleId: active.id,
      idempotencyKey: "hard-a1-004-active-complete",
      payments: [{ method: PosPaymentMethod.CASH, amountKgs: 100 }],
    });
    const activeAfter = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: active.id },
      include: { payments: true, lines: true },
    });

    const held = await firstCaller.pos.sales.createDraft({ registerId: runtime.register.id });
    await firstCaller.pos.sales.addLine({
      saleId: held.id,
      productId: product.id,
      qty: 1,
    });
    await firstCaller.pos.sales.holdDraft({ saleId: held.id });
    const heldBefore = await prisma.customerOrder.findUniqueOrThrow({ where: { id: held.id } });
    await secondCaller.pos.sales.complete({
      saleId: held.id,
      idempotencyKey: "hard-a1-004-held-complete",
      payments: [{ method: PosPaymentMethod.CASH, amountKgs: 100 }],
    });
    const heldAfter = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: held.id },
      include: { payments: true },
    });

    expect(activeBefore.createdById).toBe(cashierUser.id);
    expect(activeLine.customerOrderId).toBe(active.id);
    expect(activeAfter.status).toBe("COMPLETED");
    expect(activeAfter.notes).toBe("changed by cashier two");
    expect(activeAfter.createdById).toBe(secondCashier.id);
    expect(activeAfter.updatedById).toBe(secondCashier.id);
    expect(activeAfter.payments[0]?.createdById).toBe(secondCashier.id);
    expect(heldBefore.isHeld).toBe(true);
    expect(heldBefore.createdById).toBe(cashierUser.id);
    expect(heldAfter.status).toBe("COMPLETED");
    expect(heldAfter.isHeld).toBe(true);
    expect(heldAfter.createdById).toBe(secondCashier.id);
    expect(heldAfter.payments[0]?.createdById).toBe(secondCashier.id);
  });

  it("HARD-A1-005 completes two stale full-quantity returns and over-restores stock/refunds", async () => {
    const { org, store, product, adminUser, cashierUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 10,
      reason: "HARD-A1-005 fixture",
      idempotencyKey: "hard-a1-005-stock",
      requestId: "hard-a1-005-stock",
    });
    const caller = callerFor(cashierUser);
    const runtime = await createRegisterAndShift({
      organizationId: org.id,
      storeId: store.id,
      caller,
      key: "p0005",
    });
    const original = await createAndCompleteSale({
      caller,
      registerId: runtime.register.id,
      productId: product.id,
      key: "hard-a1-005-original",
      qty: 5,
    });
    const returnOne = await caller.pos.returns.createDraft({
      shiftId: runtime.shift.id,
      originalSaleId: original.sale.id,
    });
    const returnTwo = await caller.pos.returns.createDraft({
      shiftId: runtime.shift.id,
      originalSaleId: original.sale.id,
    });
    await caller.pos.returns.addLine({
      saleReturnId: returnOne.id,
      customerOrderLineId: original.line.id,
      qty: 5,
    });
    await caller.pos.returns.addLine({
      saleReturnId: returnTwo.id,
      customerOrderLineId: original.line.id,
      qty: 5,
    });

    const snapshotBefore = await prisma.inventorySnapshot.findUniqueOrThrow({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    await caller.pos.returns.complete({
      saleReturnId: returnOne.id,
      idempotencyKey: "hard-a1-005-return-one",
      payments: [{ method: PosPaymentMethod.CASH, amountKgs: 500 }],
    });
    await caller.pos.returns.complete({
      saleReturnId: returnTwo.id,
      idempotencyKey: "hard-a1-005-return-two",
      payments: [{ method: PosPaymentMethod.CASH, amountKgs: 500 }],
    });

    const [returns, returnedQty, refunded, snapshotAfter, returnMovements] = await Promise.all([
      prisma.saleReturn.findMany({
        where: { id: { in: [returnOne.id, returnTwo.id] } },
        orderBy: { id: "asc" },
      }),
      prisma.saleReturnLine.aggregate({
        where: { saleReturn: { originalSaleId: original.sale.id, status: "COMPLETED" } },
        _sum: { qty: true },
      }),
      prisma.salePayment.aggregate({
        where: { customerOrderId: original.sale.id, isRefund: true },
        _sum: { amountKgs: true },
      }),
      prisma.inventorySnapshot.findUniqueOrThrow({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
      prisma.stockMovement.findMany({
        where: {
          type: StockMovementType.RETURN,
          referenceId: { in: [returnOne.id, returnTwo.id] },
        },
      }),
    ]);

    expect(snapshotBefore.onHand).toBe(5);
    expect(returns.map((item) => item.status)).toEqual(["COMPLETED", "COMPLETED"]);
    expect(returnedQty._sum.qty).toBe(10);
    expect(Number(refunded._sum.amountKgs)).toBe(1000);
    expect(snapshotAfter.onHand).toBe(15);
    expect(returnMovements.reduce((sum, movement) => sum + movement.qtyDelta, 0)).toBe(10);
  });

  it("HARD-A1-006 closes a shift with an active draft and leaves checkout blocked", async () => {
    const { org, store, product, cashierUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    const caller = callerFor(cashierUser);
    const runtime = await createRegisterAndShift({
      organizationId: org.id,
      storeId: store.id,
      caller,
      key: "p0006",
    });
    const draft = await caller.pos.sales.createDraft({ registerId: runtime.register.id });
    await caller.pos.sales.addLine({ saleId: draft.id, productId: product.id, qty: 1 });
    const before = await prisma.customerOrder.findUniqueOrThrow({ where: { id: draft.id } });

    await caller.pos.shifts.close({
      shiftId: runtime.shift.id,
      closingCashCountedKgs: 0,
      idempotencyKey: "hard-a1-006-close",
    });
    const [closedShift, orphanedDraft] = await Promise.all([
      prisma.registerShift.findUniqueOrThrow({ where: { id: runtime.shift.id } }),
      prisma.customerOrder.findUniqueOrThrow({ where: { id: draft.id } }),
    ]);
    const paymentCountBefore = await prisma.salePayment.count({
      where: { customerOrderId: draft.id },
    });
    await expect(
      caller.pos.sales.complete({
        saleId: draft.id,
        idempotencyKey: "hard-a1-006-complete",
        payments: [{ method: PosPaymentMethod.CASH, amountKgs: 100 }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "posShiftClosed" });
    const paymentCountAfter = await prisma.salePayment.count({
      where: { customerOrderId: draft.id },
    });

    expect(before.status).toBe("DRAFT");
    expect(before.isHeld).toBe(false);
    expect(closedShift.status).toBe("CLOSED");
    expect(orphanedDraft.status).toBe("DRAFT");
    expect(orphanedDraft.shiftId).toBe(runtime.shift.id);
    expect(paymentCountAfter).toBe(paymentCountBefore);
  });

  it("HARD-A1-007 deactivates a register with an open shift/draft and removes it from POS entry", async () => {
    const { org, store, product, managerUser, cashierUser } = await seedBase({ plan: "BUSINESS" });
    const cashierCaller = callerFor(cashierUser);
    const managerCaller = callerFor(managerUser);
    const runtime = await createRegisterAndShift({
      organizationId: org.id,
      storeId: store.id,
      caller: cashierCaller,
      key: "p0007",
    });
    const draft = await cashierCaller.pos.sales.createDraft({ registerId: runtime.register.id });
    await cashierCaller.pos.sales.addLine({
      saleId: draft.id,
      productId: product.id,
      qty: 1,
    });
    const before = await prisma.posRegister.findUniqueOrThrow({ where: { id: runtime.register.id } });

    await managerCaller.pos.registers.update({
      registerId: runtime.register.id,
      isActive: false,
    });
    const [after, shift, persistedDraft, entry, activeRegisters] = await Promise.all([
      prisma.posRegister.findUniqueOrThrow({ where: { id: runtime.register.id } }),
      prisma.registerShift.findUniqueOrThrow({ where: { id: runtime.shift.id } }),
      prisma.customerOrder.findUniqueOrThrow({ where: { id: draft.id } }),
      cashierCaller.pos.entry({ registerId: runtime.register.id }),
      cashierCaller.pos.registers.list({ storeId: store.id, status: "active" }),
    ]);

    expect(before.isActive).toBe(true);
    expect(after.isActive).toBe(false);
    expect(shift.status).toBe("OPEN");
    expect(persistedDraft.status).toBe("DRAFT");
    expect(entry.selectedRegister).toBeNull();
    expect(entry.currentShift).toBeNull();
    expect(entry.registers.some((register) => register.id === runtime.register.id)).toBe(false);
    expect(activeRegisters.some((register) => register.id === runtime.register.id)).toBe(false);
  });

  it("HARD-A1-008 bypasses the store negative-stock policy and persists permissive state", async () => {
    const { org, store, product, cashierUser } = await seedBase({
      plan: "BUSINESS",
      allowNegativeStock: false,
    });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    const caller = callerFor(cashierUser);
    const runtime = await createRegisterAndShift({
      organizationId: org.id,
      storeId: store.id,
      caller,
      key: "p0008",
    });
    const sale = await caller.pos.sales.createDraft({ registerId: runtime.register.id });
    await caller.pos.sales.addLine({ saleId: sale.id, productId: product.id, qty: 2 });
    const snapshotsBefore = await prisma.inventorySnapshot.count({
      where: { storeId: store.id, productId: product.id },
    });

    await caller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "hard-a1-008-complete",
      payments: [{ method: PosPaymentMethod.CASH, amountKgs: 200 }],
    });
    const [persistedStore, snapshot, completed, movement, payments] = await Promise.all([
      prisma.store.findUniqueOrThrow({ where: { id: store.id } }),
      prisma.inventorySnapshot.findUniqueOrThrow({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
      prisma.customerOrder.findUniqueOrThrow({ where: { id: sale.id } }),
      prisma.stockMovement.findFirstOrThrow({
        where: { type: StockMovementType.SALE, referenceId: sale.id },
      }),
      prisma.salePayment.findMany({ where: { customerOrderId: sale.id } }),
    ]);

    expect(snapshotsBefore).toBe(0);
    expect(persistedStore.allowNegativeStock).toBe(false);
    expect(snapshot.onHand).toBe(-2);
    expect(snapshot.allowNegativeStock).toBe(true);
    expect(completed.status).toBe("COMPLETED");
    expect(movement.qtyDelta).toBe(-2);
    expect(payments).toHaveLength(1);
  });

  it("HARD-A1-009 invokes the mocked fiscal provider twice for one concurrent retry", async () => {
    const { org, store, product, adminUser, managerUser, cashierUser } = await seedBase({
      plan: "ENTERPRISE",
    });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    await prisma.storeComplianceProfile.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        enableKkm: true,
        kkmMode: "ADAPTER",
        kkmProviderKey: "mock",
      },
    });
    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 5,
      reason: "HARD-A1-009 fixture",
      idempotencyKey: "hard-a1-009-stock",
      requestId: "hard-a1-009-stock",
    });
    const cashierCaller = callerFor(cashierUser);
    const managerCaller = callerFor(managerUser);
    const runtime = await createRegisterAndShift({
      organizationId: org.id,
      storeId: store.id,
      caller: cashierCaller,
      key: "p0009",
    });
    const original = await createAndCompleteSale({
      caller: cashierCaller,
      registerId: runtime.register.id,
      productId: product.id,
      key: "hard-a1-009-original",
    });
    const failedReceipt = await prisma.fiscalReceipt.findFirstOrThrow({
      where: { customerOrderId: original.sale.id },
    });
    expect(failedReceipt.status).toBe("FAILED");
    expect(kkmRuntime.calls).toHaveLength(1);

    await prisma.fiscalReceipt.update({
      where: { id: failedReceipt.id },
      data: { nextAttemptAt: new Date(0) },
    });
    kkmRuntime.calls.length = 0;
    kkmRuntime.mode = "success";
    let releaseProvider!: () => void;
    kkmRuntime.gate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });

    const manualRetry = managerCaller.pos.kkm.retryReceipt({ receiptId: failedReceipt.id });
    await waitForKkmCalls(1);
    const workerRetry = runKkmRetryJob();
    await waitForKkmCalls(2);
    releaseProvider();
    const [manualResult, workerResult] = await Promise.all([manualRetry, workerRetry]);
    const persisted = await prisma.fiscalReceipt.findUniqueOrThrow({
      where: { id: failedReceipt.id },
    });

    expect(kkmRuntime.calls).toHaveLength(2);
    expect(new Set(kkmRuntime.calls.map((call) => call.receiptId))).toEqual(
      new Set([original.sale.number]),
    );
    expect(manualResult.status).toBe("SENT");
    expect(workerResult.details).toMatchObject({ processed: 1, sent: 1 });
    expect(persisted.status).toBe("SENT");
    expect(persisted.attemptCount).toBe(3);
    expect(["mock-provider-1", "mock-provider-2"]).toContain(persisted.providerReceiptId);
  });
});
