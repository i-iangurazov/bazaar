import { CashDrawerMovementType, PosPaymentMethod, Role, StockMovementType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const kkmRuntime = vi.hoisted(() => ({
  calls: [] as Array<{ providerCommandId: string; receiptId?: string; storeId: string }>,
  externalEffects: new Map<
    string,
    {
      providerReceiptId: string;
      fiscalNumber: string;
      fiscalizedAt: Date;
      printedAt: Date;
      rawJson: { mock: boolean; externalEffectNumber: number };
    }
  >(),
  mode: "fail" as "fail" | "success",
  gate: null as Promise<void> | null,
  afterEffect: null as null | ((input: { providerCommandId: string }) => Promise<void>),
  supportsIdempotentFiscalization: true,
}));

vi.mock("@/server/kkm/registry", () => ({
  getKkmAdapter: () => ({
    supportsIdempotentFiscalization: kkmRuntime.supportsIdempotentFiscalization,
    health: async () => ({ ok: true }),
    fiscalizeReceipt: async (
      draft: { receiptId?: string; storeId: string },
      context: { providerCommandId: string },
    ) => {
      kkmRuntime.calls.push({
        providerCommandId: context.providerCommandId,
        receiptId: draft.receiptId,
        storeId: draft.storeId,
      });
      if (kkmRuntime.gate) {
        await kkmRuntime.gate;
      }
      if (kkmRuntime.mode === "fail") {
        throw new Error("mock-kkm-failure");
      }
      const existing = kkmRuntime.externalEffects.get(context.providerCommandId);
      if (existing) {
        return existing;
      }
      const now = new Date("2026-07-22T00:00:00.000Z");
      const externalEffectNumber = kkmRuntime.externalEffects.size + 1;
      const result = {
        providerReceiptId: `mock-provider-${externalEffectNumber}`,
        fiscalNumber: `mock-fiscal-${externalEffectNumber}`,
        fiscalizedAt: now,
        printedAt: now,
        rawJson: { mock: true, externalEffectNumber },
      };
      kkmRuntime.externalEffects.set(context.providerCommandId, result);
      await kkmRuntime.afterEffect?.({ providerCommandId: context.providerCommandId });
      return result;
    },
  }),
}));

import { prisma } from "@/server/db/prisma";
import { adjustStock } from "@/server/services/inventory";
import { processAdapterFiscalReceipt, runKkmRetryJob } from "@/server/services/kkmConnector";

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
    kkmRuntime.externalEffects.clear();
    kkmRuntime.mode = "fail";
    kkmRuntime.gate = null;
    kkmRuntime.afterEffect = null;
    kkmRuntime.supportsIdempotentFiscalization = true;
    await resetDatabase();
  });

  it("HARD-A1-001 scopes POS reads to assigned stores and permits an assigned-store control", async () => {
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
    const scopedShifts = await managerCaller.pos.shifts.list({ page: 1, pageSize: 20 });
    const returns = await managerCaller.pos.returns.list({
      registerId: secondary.register.id,
      page: 1,
      pageSize: 25,
    });
    await expect(
      managerCaller.pos.shifts.list({
        storeId: secondary.store.id,
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    await expect(
      managerCaller.pos.shifts.xReport({ shiftId: secondary.shift.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    await expect(
      managerCaller.pos.returns.get({ saleReturnId: saleReturn.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    await expect(
      managerCaller.pos.debts.list({
        storeId: secondary.store.id,
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    await expect(
      managerCaller.pos.receipts({
        storeId: secondary.store.id,
        page: 1,
        pageSize: 25,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    await expect(
      managerCaller.pos.kkm.receipts({
        storeId: secondary.store.id,
        page: 1,
        pageSize: 25,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    const afterCounts = await Promise.all([
      prisma.registerShift.count(),
      prisma.customerOrder.count(),
      prisma.saleReturn.count(),
      prisma.fiscalReceipt.count(),
    ]);

    expect(scopedShifts.items.some((item) => item.id === secondary.shift.id)).toBe(false);
    expect(returns.items.some((item) => item.id === saleReturn.id)).toBe(false);
    expect(afterCounts).toEqual(beforeCounts);

    await prisma.userStoreAccess.create({
      data: {
        organizationId: org.id,
        userId: managerUser.id,
        storeId: secondary.store.id,
      },
    });
    const [xReport, returnDetail, debts, receipts, fiscal] = await Promise.all([
      managerCaller.pos.shifts.xReport({ shiftId: secondary.shift.id }),
      managerCaller.pos.returns.get({ saleReturnId: saleReturn.id }),
      managerCaller.pos.debts.list({ storeId: secondary.store.id, page: 1, pageSize: 20 }),
      managerCaller.pos.receipts({ storeId: secondary.store.id, page: 1, pageSize: 25 }),
      managerCaller.pos.kkm.receipts({ storeId: secondary.store.id, page: 1, pageSize: 25 }),
    ]);
    expect(xReport.shift.store.id).toBe(secondary.store.id);
    expect(returnDetail?.store.id).toBe(secondary.store.id);
    expect(debts.items.some((item) => item.id === debtSale.sale.id)).toBe(true);
    expect(receipts.items.some((item) => item.id === completedSale.sale.id)).toBe(true);
    expect(fiscal.items.some((item) => item.id === fiscalReceipt.id)).toBe(true);
  });

  it("HARD-A1-002 rejects inaccessible-store POS mutations before durable/provider effects", async () => {
    const { org, store, product, adminUser, managerUser, cashierUser } = await seedBase({
      plan: "ENTERPRISE",
    });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    const adminCaller = callerFor(adminUser);
    const managerCaller = callerFor(managerUser);
    const cashierCaller = callerFor(cashierUser);
    const secondary = await createSecondaryStore({
      organizationId: org.id,
      productId: product.id,
      caller: adminCaller,
      key: "p0002",
    });
    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: secondary.store.id,
      productId: product.id,
      qtyDelta: 2,
      reason: "HARD-A1-002 positive-control stock",
      idempotencyKey: "hard-a1-002-stock",
      requestId: "hard-a1-002-stock",
    });
    const access = await prisma.userStoreAccess.findMany({
      where: { userId: cashierUser.id },
      select: { storeId: true },
    });
    expect(access.map((entry) => entry.storeId)).toEqual([store.id]);
    await prisma.storeComplianceProfile.create({
      data: {
        organizationId: org.id,
        storeId: secondary.store.id,
        enableKkm: true,
        kkmMode: "ADAPTER",
        kkmProviderKey: "mock",
      },
    });

    const draft = await adminCaller.pos.sales.createDraft({ registerId: secondary.register.id });
    const line = await adminCaller.pos.sales.addLine({
      saleId: draft.id,
      productId: product.id,
      qty: 1,
    });
    const beforeMarking = await prisma.markingCodeCapture.count({
      where: { saleId: draft.id },
    });
    await expect(
      cashierCaller.pos.sales.upsertMarkingCodes({
        saleId: draft.id,
        lineId: line.id,
        codes: ["B0-A1-002-MARK"],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    const afterMarking = await prisma.markingCodeCapture.findMany({
      where: { saleId: draft.id },
    });
    await adminCaller.pos.sales.cancelDraft({ saleId: draft.id });

    const beforeCash = await prisma.cashDrawerMovement.count({
      where: { shiftId: secondary.shift.id },
    });
    await expect(
      cashierCaller.pos.cash.record({
        shiftId: secondary.shift.id,
        type: CashDrawerMovementType.PAY_IN,
        amountKgs: 10,
        reason: "Cross-store cash mutation",
        idempotencyKey: "hard-a1-002-cash",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
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
    await expect(
      cashierCaller.pos.returns.createDraft({
        shiftId: secondary.shift.id,
        originalSaleId: completedSale.sale.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    const afterReturns = await prisma.saleReturn.count({
      where: { originalSaleId: completedSale.sale.id },
    });
    const adminReturn = await adminCaller.pos.returns.createDraft({
      shiftId: secondary.shift.id,
      originalSaleId: completedSale.sale.id,
    });
    await expect(
      cashierCaller.pos.returns.addLine({
        saleReturnId: adminReturn.id,
        customerOrderLineId: completedSale.line.id,
        qty: 1,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    const adminReturnLine = await adminCaller.pos.returns.addLine({
      saleReturnId: adminReturn.id,
      customerOrderLineId: completedSale.line.id,
      qty: 1,
    });
    await expect(
      cashierCaller.pos.returns.updateLine({ returnLineId: adminReturnLine.id, qty: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    await expect(
      cashierCaller.pos.returns.removeLine({ returnLineId: adminReturnLine.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    const refundPaymentsBefore = await prisma.salePayment.count({
      where: { saleReturnId: adminReturn.id },
    });
    await expect(
      managerCaller.pos.returns.complete({
        saleReturnId: adminReturn.id,
        idempotencyKey: "hard-a1-002-return-complete",
        payments: [{ method: PosPaymentMethod.CASH, amountKgs: completedSale.totalKgs }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    const [persistedReturn, persistedReturnLine, refundPaymentsAfter] = await Promise.all([
      prisma.saleReturn.findUniqueOrThrow({ where: { id: adminReturn.id } }),
      prisma.saleReturnLine.findUniqueOrThrow({ where: { id: adminReturnLine.id } }),
      prisma.salePayment.count({ where: { saleReturnId: adminReturn.id } }),
    ]);

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
    await expect(
      cashierCaller.pos.debts.settle({
        saleId: debtSale.sale.id,
        registerId: secondary.register.id,
        method: PosPaymentMethod.CASH,
        idempotencyKey: "hard-a1-002-settle",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    const settledDebt = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: debtSale.sale.id },
      include: { payments: true },
    });

    const failedReceipt = await prisma.fiscalReceipt.findFirstOrThrow({
      where: { customerOrderId: completedSale.sale.id },
    });
    const providerCallsBefore = kkmRuntime.calls.length;
    await expect(
      managerCaller.pos.sales.retryKkm({ saleId: completedSale.sale.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    await expect(
      managerCaller.pos.kkm.retryReceipt({ receiptId: failedReceipt.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    const receiptAfter = await prisma.fiscalReceipt.findUniqueOrThrow({
      where: { id: failedReceipt.id },
    });

    expect(beforeMarking).toBe(0);
    expect(afterMarking).toHaveLength(0);
    expect(beforeCash).toBe(0);
    expect(afterCash).toBe(0);
    expect(beforeReturns).toBe(0);
    expect(afterReturns).toBe(0);
    expect(persistedReturn.status).toBe("DRAFT");
    expect(persistedReturnLine.qty).toBe(1);
    expect(refundPaymentsAfter).toBe(refundPaymentsBefore);
    expect(paymentsBeforeSettlement).toBe(0);
    expect(settledDebt.debtSettledById).toBeNull();
    expect(settledDebt.payments).toHaveLength(0);
    expect(kkmRuntime.calls).toHaveLength(providerCallsBefore);
    expect(receiptAfter.status).toBe(failedReceipt.status);
    expect(receiptAfter.attemptCount).toBe(failedReceipt.attemptCount);

    await prisma.userStoreAccess.createMany({
      data: [
        {
          organizationId: org.id,
          userId: cashierUser.id,
          storeId: secondary.store.id,
        },
        {
          organizationId: org.id,
          userId: managerUser.id,
          storeId: secondary.store.id,
        },
      ],
    });
    const assignedDraft = await cashierCaller.pos.sales.createDraft({
      registerId: secondary.register.id,
    });
    const assignedLine = await cashierCaller.pos.sales.addLine({
      saleId: assignedDraft.id,
      productId: product.id,
      qty: 1,
    });
    await cashierCaller.pos.sales.upsertMarkingCodes({
      saleId: assignedDraft.id,
      lineId: assignedLine.id,
      codes: ["B1-A1-002-ASSIGNED"],
    });
    const assignedCash = await cashierCaller.pos.cash.record({
      shiftId: secondary.shift.id,
      type: CashDrawerMovementType.PAY_IN,
      amountKgs: 10,
      reason: "Assigned-store cash mutation",
      idempotencyKey: "hard-a1-002-cash",
    });
    const assignedReturn = await cashierCaller.pos.returns.createDraft({
      shiftId: secondary.shift.id,
      originalSaleId: completedSale.sale.id,
    });
    await cashierCaller.pos.debts.settle({
      saleId: debtSale.sale.id,
      registerId: secondary.register.id,
      method: PosPaymentMethod.CASH,
      idempotencyKey: "hard-a1-002-settle",
    });
    await managerCaller.pos.sales.retryKkm({ saleId: completedSale.sale.id });
    await managerCaller.pos.kkm.retryReceipt({ receiptId: failedReceipt.id });
    const [assignedMarkings, assignedDebt] = await Promise.all([
      prisma.markingCodeCapture.count({ where: { saleId: assignedDraft.id } }),
      prisma.customerOrder.findUniqueOrThrow({
        where: { id: debtSale.sale.id },
        include: { payments: true },
      }),
    ]);
    expect(assignedMarkings).toBe(1);
    expect(assignedCash.storeId).toBe(secondary.store.id);
    expect(assignedReturn.storeId).toBe(secondary.store.id);
    expect(assignedDebt.debtSettledById).toBe(cashierUser.id);
    expect(assignedDebt.payments).toHaveLength(1);
    expect(kkmRuntime.calls).toHaveLength(providerCallsBefore + 1);
  });

  it("HARD-A1-003 enforces operation RBAC and preserves allowed controls", async () => {
    const { org, store, product, adminUser, managerUser, staffUser, cashierUser } = await seedBase({
      plan: "BUSINESS",
    });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 1,
      reason: "HARD-A1-003 positive-control stock",
      idempotencyKey: "hard-a1-003-stock",
      requestId: "hard-a1-003-stock",
    });
    const adminCaller = callerFor(adminUser);
    const managerCaller = callerFor(managerUser);
    const staffCaller = callerFor(staffUser);
    const cashierCaller = callerFor(cashierUser);

    const registersBefore = await prisma.posRegister.count({ where: { storeId: store.id } });
    await expect(
      managerCaller.pos.registers.create({
        storeId: store.id,
        name: "Manager-created register",
        code: "MGR-P0",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const registersAfterDeniedCreate = await prisma.posRegister.count({
      where: { storeId: store.id },
    });
    const managerRegister = await adminCaller.pos.registers.create({
      storeId: store.id,
      name: "Admin-created register",
      code: "ADM-P0",
    });
    await expect(
      managerCaller.pos.registers.update({
        registerId: managerRegister.id,
        name: "Manager-updated register",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      managerCaller.pos.registers.delete({ registerId: managerRegister.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const registerAfterDeniedMutations = await prisma.posRegister.findUniqueOrThrow({
      where: { id: managerRegister.id },
    });
    const adminUpdatedRegister = await adminCaller.pos.registers.update({
      registerId: managerRegister.id,
      name: "Admin-updated register",
    });
    const deletableRegister = await adminCaller.pos.registers.create({
      storeId: store.id,
      name: "Admin deletable register",
      code: "ADM-DEL",
    });
    await adminCaller.pos.registers.delete({ registerId: deletableRegister.id });
    const deletedRegister = await prisma.posRegister.findUnique({
      where: { id: deletableRegister.id },
    });
    const secondCashier = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: "shift-closer@test.local",
        name: "Shift Closer",
        passwordHash: "hash",
        role: Role.CASHIER,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.userStoreAccess.create({
      data: { organizationId: org.id, userId: secondCashier.id, storeId: store.id },
    });
    const secondCashierCaller = callerFor(secondCashier);
    const cashierShift = await cashierCaller.pos.shifts.open({
      registerId: managerRegister.id,
      openingCashKgs: 0,
      idempotencyKey: "hard-a1-003-cashier-open",
    });
    const closed = await secondCashierCaller.pos.shifts.close({
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
    await staffCaller.pos.returns.complete({
      saleReturnId: returnDraft.id,
      idempotencyKey: "hard-a1-003-staff-return",
      payments: [{ method: PosPaymentMethod.CASH, amountKgs: original.totalKgs }],
    });
    const returnAfter = await prisma.saleReturn.findUniqueOrThrow({
      where: { id: returnDraft.id },
    });

    expect(registersBefore).toBe(0);
    expect(registersAfterDeniedCreate).toBe(registersBefore);
    expect(managerRegister.storeId).toBe(store.id);
    expect(registerAfterDeniedMutations.name).toBe("Admin-created register");
    expect(adminUpdatedRegister.name).toBe("Admin-updated register");
    expect(deletedRegister).toBeNull();
    expect(closed.status).toBe("CLOSED");
    expect(persistedClosedShift.openedById).toBe(cashierUser.id);
    expect(persistedClosedShift.closedById).toBe(secondCashier.id);
    expect(returnAfter.status).toBe("COMPLETED");
    expect(returnAfter.completedById).toBe(staffUser.id);
  });

  it("HARD-A1-001/002 reject cross-organization and tampered shift identifiers without writes", async () => {
    const { managerUser, cashierUser } = await seedBase({ plan: "BUSINESS" });
    const foreignOrg = await prisma.organization.create({
      data: { name: "Foreign POS organization", plan: "BUSINESS" },
    });
    const foreignAdmin = await prisma.user.create({
      data: {
        organizationId: foreignOrg.id,
        email: "foreign-pos-admin@test.local",
        name: "Foreign POS Admin",
        passwordHash: "hash",
        role: Role.ADMIN,
        isOrgOwner: true,
        emailVerifiedAt: new Date(),
      },
    });
    const foreignStore = await prisma.store.create({
      data: {
        organizationId: foreignOrg.id,
        name: "Foreign POS Store",
        code: "FOREIGN-POS",
      },
    });
    const foreignRegister = await prisma.posRegister.create({
      data: {
        organizationId: foreignOrg.id,
        storeId: foreignStore.id,
        name: "Foreign register",
        code: "FOREIGN-REG",
      },
    });
    const foreignShift = await prisma.registerShift.create({
      data: {
        organizationId: foreignOrg.id,
        storeId: foreignStore.id,
        registerId: foreignRegister.id,
        openedById: foreignAdmin.id,
        openingCashKgs: 0,
      },
    });
    const managerCaller = callerFor(managerUser);
    const cashierCaller = callerFor(cashierUser);
    const beforeCash = await prisma.cashDrawerMovement.count({
      where: { shiftId: foreignShift.id },
    });

    await expect(
      managerCaller.pos.shifts.xReport({ shiftId: foreignShift.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "posShiftNotFound" });
    await expect(
      managerCaller.pos.shifts.list({
        storeId: foreignStore.id,
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    await expect(
      cashierCaller.pos.cash.record({
        shiftId: foreignShift.id,
        type: CashDrawerMovementType.PAY_IN,
        amountKgs: 10,
        reason: "Foreign shift tamper",
        idempotencyKey: "hard-a1-cross-org-cash",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "posShiftNotFound" });

    const afterCash = await prisma.cashDrawerMovement.count({
      where: { shiftId: foreignShift.id },
    });
    expect(afterCash).toBe(beforeCash);
  });

  it("HARD-A1-004 requires an audited ownership transfer before another cashier edits or completes a draft", async () => {
    const { org, store, product, adminUser, cashierUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 2,
      reason: "HARD-A1-004 positive-control stock",
      idempotencyKey: "hard-a1-004-stock",
      requestId: "hard-a1-004-stock",
    });
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
    await expect(
      secondCaller.pos.sales.updateNotes({
        saleId: active.id,
        notes: "unauthorized cashier update",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "posSaleOwnerMismatch" });
    await expect(
      secondCaller.pos.sales.addLine({ saleId: active.id, productId: product.id, qty: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "posSaleOwnerMismatch" });
    await expect(
      secondCaller.pos.sales.updateLine({ lineId: activeLine.id, qty: 2 }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "posSaleOwnerMismatch" });
    await expect(
      secondCaller.pos.sales.updateDiscount({ saleId: active.id, discountKgs: 10 }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "posSaleOwnerMismatch" });
    await expect(
      secondCaller.pos.sales.updateCustomer({ saleId: active.id, customerId: null }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "posSaleOwnerMismatch" });
    await expect(secondCaller.pos.sales.holdDraft({ saleId: active.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "posSaleOwnerMismatch",
    });
    await expect(secondCaller.pos.sales.cancelDraft({ saleId: active.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "posSaleOwnerMismatch",
    });
    await expect(
      secondCaller.pos.sales.upsertMarkingCodes({
        saleId: active.id,
        lineId: activeLine.id,
        codes: ["UNAUTHORIZED-CODE"],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "posSaleOwnerMismatch" });
    await expect(
      secondCaller.pos.sales.complete({
        saleId: active.id,
        idempotencyKey: "hard-a1-004-active-rejected",
        payments: [{ method: PosPaymentMethod.CASH, amountKgs: 100 }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "posSaleOwnerMismatch" });
    const activeRejected = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: active.id },
      include: { payments: true },
    });
    expect(activeRejected).toMatchObject({
      status: "DRAFT",
      notes: null,
      createdById: cashierUser.id,
    });
    expect(Number(activeRejected.discountKgs)).toBe(0);
    expect(activeRejected.payments).toHaveLength(0);
    expect(
      await prisma.customerOrderLine.findUniqueOrThrow({ where: { id: activeLine.id } }),
    ).toMatchObject({
      qty: 1,
    });
    expect(await prisma.markingCodeCapture.count({ where: { saleId: active.id } })).toBe(0);
    expect(
      await prisma.stockMovement.count({ where: { referenceId: active.id, type: "SALE" } }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { entityId: active.id, action: "POS_SALE_COMPLETE" },
      }),
    ).toBe(0);
    expect(
      await prisma.idempotencyKey.count({
        where: { key: "hard-a1-004-active-rejected", route: "pos.sales.complete" },
      }),
    ).toBe(0);

    const transfer = await secondCaller.pos.sales.transferDraft({
      saleId: active.id,
      reason: "Cashier handover",
      idempotencyKey: "hard-a1-004-transfer",
    });
    const transferReplay = await secondCaller.pos.sales.transferDraft({
      saleId: active.id,
      reason: "Cashier handover",
      idempotencyKey: "hard-a1-004-transfer",
    });
    expect(transfer).toEqual(transferReplay);
    expect(transfer).toMatchObject({ ownerId: secondCashier.id, transferred: true });
    const transferAudits = await prisma.auditLog.findMany({
      where: { entityId: active.id, action: "POS_SALE_OWNERSHIP_TRANSFER" },
    });
    expect(transferAudits).toHaveLength(1);
    expect(transferAudits[0]?.actorId).toBe(secondCashier.id);
    expect(transferAudits[0]?.before).toMatchObject({ ownerId: cashierUser.id });
    expect(transferAudits[0]?.after).toMatchObject({
      ownerId: secondCashier.id,
      reason: "Cashier handover",
    });

    await secondCaller.pos.sales.updateNotes({ saleId: active.id, notes: "authorized handover" });
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
    const heldMutationResults = await Promise.allSettled([
      firstCaller.pos.sales.updateNotes({
        saleId: held.id,
        notes: "held owner edit must wait for resume",
      }),
      firstCaller.pos.sales.complete({
        saleId: held.id,
        idempotencyKey: "hard-a1-004-held-owner-rejected",
        payments: [{ method: PosPaymentMethod.CASH, amountKgs: 100 }],
      }),
      secondCaller.pos.sales.updateNotes({
        saleId: held.id,
        notes: "held second cashier edit must wait for resume",
      }),
      secondCaller.pos.sales.complete({
        saleId: held.id,
        idempotencyKey: "hard-a1-004-held-rejected",
        payments: [{ method: PosPaymentMethod.CASH, amountKgs: 100 }],
      }),
    ]);
    expect(
      heldMutationResults.map((result) =>
        result.status === "rejected"
          ? {
              status: result.status,
              code: result.reason?.code,
              message: result.reason?.message,
            }
          : { status: result.status },
      ),
    ).toEqual(
      Array.from({ length: 4 }, () => ({
        status: "rejected",
        code: "CONFLICT",
        message: "posSaleNotEditable",
      })),
    );
    expect(
      await prisma.idempotencyKey.count({
        where: {
          key: {
            in: ["hard-a1-004-held-owner-rejected", "hard-a1-004-held-rejected"],
          },
          route: "pos.sales.complete",
        },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { entityId: held.id, action: "POS_SALE_COMPLETE" },
      }),
    ).toBe(0);
    const resumed = await secondCaller.pos.sales.resumeHeldDraft({
      saleId: held.id,
      registerId: runtime.register.id,
    });
    expect(resumed.isHeld).toBe(false);
    const resumeAudit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: held.id, action: "POS_SALE_RESUME_HELD" },
    });
    expect(resumeAudit.actorId).toBe(secondCashier.id);
    expect(resumeAudit.before).toMatchObject({ ownerId: cashierUser.id, isHeld: true });
    expect(resumeAudit.after).toMatchObject({ ownerId: secondCashier.id, isHeld: false });
    await secondCaller.pos.sales.updateNotes({
      saleId: held.id,
      notes: "explicitly resumed before checkout",
    });
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
    expect(activeAfter.notes).toBe("authorized handover");
    expect(activeAfter.createdById).toBe(secondCashier.id);
    expect(activeAfter.updatedById).toBe(secondCashier.id);
    expect(activeAfter.payments[0]?.createdById).toBe(secondCashier.id);
    expect(heldBefore.isHeld).toBe(true);
    expect(heldBefore.createdById).toBe(cashierUser.id);
    expect(heldAfter.status).toBe("COMPLETED");
    expect(heldAfter.isHeld).toBe(false);
    expect(heldAfter.notes).toBe("explicitly resumed before checkout");
    expect(heldAfter.createdById).toBe(secondCashier.id);
    expect(heldAfter.payments[0]?.createdById).toBe(secondCashier.id);
    expect(
      await prisma.stockMovement.aggregate({
        where: { referenceId: { in: [active.id, held.id] }, type: "SALE" },
        _sum: { qtyDelta: true },
        _count: { _all: true },
      }),
    ).toMatchObject({ _sum: { qtyDelta: -2 }, _count: { _all: 2 } });
  });

  it("HARD-A1-005 serializes concurrent full-quantity returns at the source sale line", async () => {
    const { org, store, product, adminUser, managerUser, cashierUser } = await seedBase({
      plan: "BUSINESS",
    });
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
    const approverCaller = callerFor(managerUser);
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
    let readyCount = 0;
    let releaseStart!: () => void;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const completeAfterStartGate = async (saleReturnId: string, idempotencyKey: string) => {
      readyCount += 1;
      if (readyCount === 2) {
        releaseStart();
      }
      await startGate;
      return approverCaller.pos.returns.complete({
        saleReturnId,
        idempotencyKey,
        payments: [{ method: PosPaymentMethod.CASH, amountKgs: 500 }],
      });
    };

    const completions = await Promise.allSettled([
      completeAfterStartGate(returnOne.id, "hard-a1-005-return-one"),
      completeAfterStartGate(returnTwo.id, "hard-a1-005-return-two"),
    ]);

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
    const fulfilled = completions.filter((item) => item.status === "fulfilled");
    const rejected = completions.filter((item) => item.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: { code: "CONFLICT", message: "posReturnQtyExceeded" },
    });
    expect(returns.map((item) => item.status).sort()).toEqual(["COMPLETED", "DRAFT"]);
    expect(returnedQty._sum.qty).toBe(5);
    expect(Number(refunded._sum.amountKgs)).toBe(500);
    expect(snapshotAfter.onHand).toBe(10);
    expect(returnMovements).toHaveLength(1);
    expect(returnMovements.reduce((sum, movement) => sum + movement.qtyDelta, 0)).toBe(5);
  });

  it("HARD-A1-006 blocks shift close until active, held, and return drafts are resolved", async () => {
    const { org, store, product, adminUser, cashierUser, managerUser } = await seedBase({
      plan: "BUSINESS",
    });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    const caller = callerFor(cashierUser);
    const managerCaller = callerFor(managerUser);
    const runtime = await createRegisterAndShift({
      organizationId: org.id,
      storeId: store.id,
      caller,
      key: "p0006",
    });
    const heldDraft = await caller.pos.sales.createDraft({ registerId: runtime.register.id });
    await caller.pos.sales.addLine({ saleId: heldDraft.id, productId: product.id, qty: 1 });
    await caller.pos.sales.holdDraft({ saleId: heldDraft.id });
    const activeDraft = await caller.pos.sales.createDraft({ registerId: runtime.register.id });
    await caller.pos.sales.addLine({ saleId: activeDraft.id, productId: product.id, qty: 1 });

    const blockers = await caller.pos.shifts.current({ registerId: runtime.register.id });
    expect(blockers).toMatchObject({
      heldReceiptCount: 1,
      activeReceiptCount: 1,
      returnDraftCount: 0,
    });
    expect(blockers?.heldReceipts.map((receipt) => receipt.id)).toContain(heldDraft.id);
    expect(blockers?.activeReceipts).toContainEqual(
      expect.objectContaining({ id: activeDraft.id, ownedByCurrentUser: true }),
    );

    await expect(
      managerCaller.pos.shifts.close({
        shiftId: runtime.shift.id,
        closingCashCountedKgs: 0,
        idempotencyKey: "hard-a1-006-close",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "posShiftDraftsOpen" });
    const [openShift, drafts, closeAudits, closeKeys] = await Promise.all([
      prisma.registerShift.findUniqueOrThrow({ where: { id: runtime.shift.id } }),
      prisma.customerOrder.findMany({
        where: { id: { in: [heldDraft.id, activeDraft.id] } },
        orderBy: { isHeld: "asc" },
      }),
      prisma.auditLog.count({
        where: { entityId: runtime.shift.id, action: "POS_SHIFT_CLOSE" },
      }),
      prisma.idempotencyKey.count({
        where: { key: "hard-a1-006-close", route: "pos.shifts.close" },
      }),
    ]);
    expect(openShift.status).toBe("OPEN");
    expect(drafts).toHaveLength(2);
    expect(drafts.every((draft) => draft.status === "DRAFT")).toBe(true);
    expect(drafts.map((draft) => draft.isHeld).sort()).toEqual([false, true]);
    expect(closeAudits).toBe(0);
    expect(closeKeys).toBe(0);

    await caller.pos.sales.cancelDraft({ saleId: activeDraft.id });
    await caller.pos.sales.cancelDraft({ saleId: heldDraft.id });
    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 1,
      reason: "HARD-A1-006 return recovery fixture",
      idempotencyKey: "hard-a1-006-stock",
      requestId: "hard-a1-006-stock",
    });
    const returnSource = await createAndCompleteSale({
      caller,
      registerId: runtime.register.id,
      productId: product.id,
      key: "hard-a1-006-return-source",
    });
    const returnDraft = await caller.pos.returns.createDraft({
      shiftId: runtime.shift.id,
      originalSaleId: returnSource.sale.id,
    });
    await caller.pos.returns.addLine({
      saleReturnId: returnDraft.id,
      customerOrderLineId: returnSource.line.id,
      qty: 1,
    });
    await expect(
      managerCaller.pos.shifts.close({
        shiftId: runtime.shift.id,
        closingCashCountedKgs: 0,
        idempotencyKey: "hard-a1-006-close",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "posShiftDraftsOpen" });
    expect(
      await prisma.saleReturn.findUniqueOrThrow({ where: { id: returnDraft.id } }),
    ).toMatchObject({
      status: "DRAFT",
    });
    expect(
      await prisma.idempotencyKey.count({
        where: { key: "hard-a1-006-close", route: "pos.shifts.close" },
      }),
    ).toBe(0);

    const stockBeforeCancel = await prisma.inventorySnapshot.findUniqueOrThrow({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    const returnBlockers = await caller.pos.shifts.current({ registerId: runtime.register.id });
    expect(returnBlockers).toMatchObject({ returnDraftCount: 1 });
    expect(returnBlockers?.returnDrafts).toContainEqual(
      expect.objectContaining({ id: returnDraft.id, canCancel: true }),
    );
    await caller.pos.returns.cancel({
      saleReturnId: returnDraft.id,
      idempotencyKey: "hard-a1-006-return-cancel",
    });
    await caller.pos.returns.cancel({
      saleReturnId: returnDraft.id,
      idempotencyKey: "hard-a1-006-return-cancel",
    });
    const stockAfterCancel = await prisma.inventorySnapshot.findUniqueOrThrow({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    expect(stockAfterCancel.onHand).toBe(stockBeforeCancel.onHand);
    expect(
      await prisma.auditLog.count({
        where: { entityId: returnDraft.id, action: "POS_RETURN_CANCEL" },
      }),
    ).toBe(1);

    await caller.pos.shifts.close({
      shiftId: runtime.shift.id,
      closingCashCountedKgs: 100,
      idempotencyKey: "hard-a1-006-close",
    });
    expect(
      await prisma.registerShift.findUniqueOrThrow({ where: { id: runtime.shift.id } }),
    ).toMatchObject({ status: "CLOSED", closedById: cashierUser.id });
    expect(
      await prisma.auditLog.count({
        where: { entityId: runtime.shift.id, action: "POS_SHIFT_CLOSE" },
      }),
    ).toBe(1);
    expect(
      await prisma.idempotencyKey.count({
        where: { key: "hard-a1-006-close", route: "pos.shifts.close" },
      }),
    ).toBe(1);
  });

  it("HARD-A1-006 serializes return draft creation against shift close", async () => {
    const { org, store, product, adminUser, cashierUser, managerUser } = await seedBase({
      plan: "BUSINESS",
    });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 1,
      reason: "HARD-A1-006 shift/return race fixture",
      idempotencyKey: "hard-a1-006-race-stock",
      requestId: "hard-a1-006-race-stock",
    });
    const caller = callerFor(cashierUser);
    const managerCaller = callerFor(managerUser);
    const runtime = await createRegisterAndShift({
      organizationId: org.id,
      storeId: store.id,
      caller,
      key: "p0006race",
    });
    const source = await createAndCompleteSale({
      caller,
      registerId: runtime.register.id,
      productId: product.id,
      key: "hard-a1-006-race-source",
    });

    let announceLock!: () => void;
    let releaseLock!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      announceLock = resolve;
    });
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockOwner = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM "RegisterShift" WHERE id = ${runtime.shift.id} FOR UPDATE
        `;
        announceLock();
        await lockGate;
      },
      { timeout: 10_000 },
    );
    await lockAcquired;

    const observeFor = async (promise: Promise<unknown>) =>
      Promise.race([
        promise.then(
          () => "fulfilled" as const,
          () => "rejected" as const,
        ),
        new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 75)),
      ]);
    const closeAttempt = managerCaller.pos.shifts.close({
      shiftId: runtime.shift.id,
      closingCashCountedKgs: source.totalKgs,
      idempotencyKey: "hard-a1-006-race-close",
    });
    const closeWhileLocked = await observeFor(closeAttempt);
    const returnAttempt = caller.pos.returns.createDraft({
      shiftId: runtime.shift.id,
      originalSaleId: source.sale.id,
    });
    const returnWhileLocked = await observeFor(returnAttempt);

    releaseLock();
    await lockOwner;
    const [closeResult, returnResult] = await Promise.allSettled([closeAttempt, returnAttempt]);

    expect(closeWhileLocked).toBe("pending");
    expect(returnWhileLocked).toBe("pending");
    expect(closeResult).toMatchObject({
      status: "fulfilled",
      value: { status: "CLOSED" },
    });
    expect(returnResult).toMatchObject({
      status: "rejected",
      reason: { code: "CONFLICT", message: "posShiftNotOpen" },
    });
    expect(
      await prisma.registerShift.findUniqueOrThrow({ where: { id: runtime.shift.id } }),
    ).toMatchObject({ status: "CLOSED", closedById: managerUser.id });
    expect(
      await prisma.saleReturn.count({
        where: { shiftId: runtime.shift.id, status: "DRAFT" },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: org.id, action: "POS_RETURN_CREATE" },
      }),
    ).toBe(0);
    expect(
      await prisma.idempotencyKey.count({
        where: { key: "hard-a1-006-race-close", route: "pos.shifts.close" },
      }),
    ).toBe(1);
  });

  it("HARD-A1-007 blocks register deactivation until operational and recoverable state is resolved", async () => {
    const { org, store, product, adminUser, cashierUser } = await seedBase({ plan: "BUSINESS" });
    const cashierCaller = callerFor(cashierUser);
    const adminCaller = callerFor(adminUser);
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
    const before = await prisma.posRegister.findUniqueOrThrow({
      where: { id: runtime.register.id },
    });

    const expectDeactivationBlocked = async () => {
      await expect(
        adminCaller.pos.registers.update({
          registerId: runtime.register.id,
          isActive: false,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: "posRegisterDeactivationBlocked" });
      expect(
        await prisma.posRegister.findUniqueOrThrow({ where: { id: runtime.register.id } }),
      ).toMatchObject({ isActive: true });
      expect(
        await prisma.auditLog.count({
          where: { entityId: runtime.register.id, action: "POS_REGISTER_UPDATE" },
        }),
      ).toBe(0);
    };

    await expectDeactivationBlocked();
    expect(before.isActive).toBe(true);
    expect(
      await prisma.registerShift.findUniqueOrThrow({ where: { id: runtime.shift.id } }),
    ).toMatchObject({ status: "OPEN" });
    expect(await prisma.customerOrder.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject(
      {
        status: "DRAFT",
        createdById: cashierUser.id,
      },
    );

    await cashierCaller.pos.sales.cancelDraft({ saleId: draft.id });
    await adminCaller.pos.shifts.close({
      shiftId: runtime.shift.id,
      closingCashCountedKgs: 0,
      idempotencyKey: "hard-a1-007-close",
    });

    await prisma.customerOrder.update({
      where: { id: draft.id },
      data: {
        status: "COMPLETED",
        isDebt: true,
        debtCustomerName: "Recovery fixture",
        debtSettledAt: null,
      },
    });
    await expectDeactivationBlocked();
    await prisma.customerOrder.update({
      where: { id: draft.id },
      data: { debtSettledAt: new Date() },
    });

    const returnDraft = await prisma.saleReturn.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        registerId: runtime.register.id,
        shiftId: runtime.shift.id,
        originalSaleId: draft.id,
        number: "HARD-A1-007-RETURN",
        createdById: cashierUser.id,
      },
    });
    await expectDeactivationBlocked();
    await prisma.saleReturn.update({
      where: { id: returnDraft.id },
      data: { status: "CANCELED", canceledAt: new Date() },
    });

    const failedReceipt = await prisma.fiscalReceipt.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        customerOrderId: draft.id,
        status: "FAILED",
        mode: "ADAPTER",
        idempotencyKey: "hard-a1-007-fiscal",
        payloadJson: { saleId: draft.id },
      },
    });
    await expectDeactivationBlocked();
    await prisma.fiscalReceipt.update({
      where: { id: failedReceipt.id },
      data: { status: "SENT", sentAt: new Date() },
    });

    await adminCaller.pos.registers.update({
      registerId: runtime.register.id,
      isActive: false,
    });
    const [after, entry, activeRegisters, updateAudits] = await Promise.all([
      prisma.posRegister.findUniqueOrThrow({ where: { id: runtime.register.id } }),
      cashierCaller.pos.entry({ registerId: runtime.register.id }),
      cashierCaller.pos.registers.list({ storeId: store.id, status: "active" }),
      prisma.auditLog.count({
        where: { entityId: runtime.register.id, action: "POS_REGISTER_UPDATE" },
      }),
    ]);
    expect(after.isActive).toBe(false);
    expect(entry.selectedRegister).toBeNull();
    expect(entry.currentShift).toBeNull();
    expect(entry.registers.some((register) => register.id === runtime.register.id)).toBe(false);
    expect(activeRegisters.some((register) => register.id === runtime.register.id)).toBe(false);
    expect(updateAudits).toBe(1);
  });

  it("HARD-A1-008 allows POS checkout to create negative stock without duplicate side effects", async () => {
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
    const [persistedStore, snapshot, persistedSale, movements, payments, completionAudits, keys] =
      await Promise.all([
        prisma.store.findUniqueOrThrow({ where: { id: store.id } }),
        prisma.inventorySnapshot.findUnique({
          where: {
            storeId_productId_variantKey: {
              storeId: store.id,
              productId: product.id,
              variantKey: "BASE",
            },
          },
        }),
        prisma.customerOrder.findUniqueOrThrow({ where: { id: sale.id } }),
        prisma.stockMovement.findMany({
          where: { type: StockMovementType.SALE, referenceId: sale.id },
        }),
        prisma.salePayment.findMany({ where: { customerOrderId: sale.id } }),
        prisma.auditLog.count({
          where: { action: "POS_SALE_COMPLETE", entity: "CustomerOrder", entityId: sale.id },
        }),
        prisma.idempotencyKey.count({
          where: {
            key: "hard-a1-008-complete",
            route: "pos.sales.complete",
            userId: cashierUser.id,
          },
        }),
      ]);

    expect(snapshotsBefore).toBe(0);
    expect(persistedStore.allowNegativeStock).toBe(false);
    expect(snapshot?.onHand).toBe(-2);
    expect(snapshot?.allowNegativeStock).toBe(true);
    expect(persistedSale.status).toBe("COMPLETED");
    expect(persistedSale.completedAt).not.toBeNull();
    expect(persistedSale.completedEventId).toBe("hard-a1-008-complete");
    expect(movements).toHaveLength(1);
    expect(movements[0]?.qtyDelta).toBe(-2);
    expect(payments).toHaveLength(1);
    expect(completionAudits).toBe(1);
    expect(keys).toBe(1);
  });

  it("HARD-A1-009 claims one retry and reconciles concurrent and repeated callers", async () => {
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
    expect(failedReceipt.attemptCount).toBe(1);
    expect(kkmRuntime.calls).toHaveLength(1);
    expect(kkmRuntime.calls[0]?.providerCommandId).toBe(failedReceipt.idempotencyKey);

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
    const idempotencyCountBefore = await prisma.idempotencyKey.count({
      where: {
        key: "hard-a1-009-original-complete-sale",
        route: "pos.sales.complete",
        userId: cashierUser.id,
      },
    });

    const manualRetry = managerCaller.pos.kkm.retryReceipt({ receiptId: failedReceipt.id });
    await waitForKkmCalls(1);
    const processing = await prisma.fiscalReceipt.findUniqueOrThrow({
      where: { id: failedReceipt.id },
    });
    const workerResult = await runKkmRetryJob();
    expect(kkmRuntime.calls).toHaveLength(1);
    expect(workerResult.details).toMatchObject({ processed: 0, sent: 0, failed: 0 });
    releaseProvider();
    const manualResult = await manualRetry;
    const [repeatReceiptResult, repeatSaleResult] = await Promise.all([
      managerCaller.pos.kkm.retryReceipt({ receiptId: failedReceipt.id }),
      managerCaller.pos.sales.retryKkm({ saleId: original.sale.id }),
    ]);
    const [
      persisted,
      persistedSale,
      retryAudits,
      workerAudits,
      posRetryAudits,
      idempotencyCountAfter,
    ] = await Promise.all([
      prisma.fiscalReceipt.findUniqueOrThrow({ where: { id: failedReceipt.id } }),
      prisma.customerOrder.findUniqueOrThrow({ where: { id: original.sale.id } }),
      prisma.auditLog.findMany({
        where: { entityId: failedReceipt.id, action: "KKM_RECEIPT_RETRY" },
      }),
      prisma.auditLog.count({
        where: { entityId: failedReceipt.id, action: "KKM_RECEIPT_RETRY_JOB" },
      }),
      prisma.auditLog.count({
        where: { entityId: original.sale.id, action: "POS_KKM_RETRY" },
      }),
      prisma.idempotencyKey.count({
        where: {
          key: "hard-a1-009-original-complete-sale",
          route: "pos.sales.complete",
          userId: cashierUser.id,
        },
      }),
    ]);

    expect(processing.status).toBe("PROCESSING");
    expect(processing.attemptCount).toBe(2);
    expect(processing.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now());
    expect(kkmRuntime.calls).toHaveLength(1);
    expect(kkmRuntime.calls[0]?.providerCommandId).toBe(failedReceipt.idempotencyKey);
    expect(new Set(kkmRuntime.calls.map((call) => call.receiptId))).toEqual(
      new Set([original.sale.number]),
    );
    expect(manualResult.status).toBe("SENT");
    expect(repeatReceiptResult.status).toBe("SENT");
    expect(repeatSaleResult).toMatchObject({ kkmStatus: "SENT", retried: false });
    expect(persisted.status).toBe("SENT");
    expect(persisted.attemptCount).toBe(2);
    expect(persisted.providerReceiptId).toBe("mock-provider-1");
    expect(persisted.nextAttemptAt).toBeNull();
    expect(persistedSale).toMatchObject({
      kkmStatus: "SENT",
      kkmReceiptId: "mock-provider-1",
    });
    expect(retryAudits).toHaveLength(1);
    expect(retryAudits[0]?.before).toMatchObject({ status: "FAILED", attemptCount: 1 });
    expect(retryAudits[0]?.after).toMatchObject({
      status: "SENT",
      attemptCount: 2,
      providerReceiptId: "mock-provider-1",
    });
    expect(workerAudits).toBe(0);
    expect(posRetryAudits).toBe(0);
    expect(idempotencyCountBefore).toBe(1);
    expect(idempotencyCountAfter).toBe(idempotencyCountBefore);
  });

  it("HARD-A1-009 reconciles a failed concurrent retry and preserves its backoff", async () => {
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
      qtyDelta: 1,
      reason: "HARD-A1-009 failed retry fixture",
      idempotencyKey: "hard-a1-009-failed-stock",
      requestId: "hard-a1-009-failed-stock",
    });
    const cashierCaller = callerFor(cashierUser);
    const managerCaller = callerFor(managerUser);
    const runtime = await createRegisterAndShift({
      organizationId: org.id,
      storeId: store.id,
      caller: cashierCaller,
      key: "p0009f",
    });
    const original = await createAndCompleteSale({
      caller: cashierCaller,
      registerId: runtime.register.id,
      productId: product.id,
      key: "hard-a1-009-failed",
    });
    const failedReceipt = await prisma.fiscalReceipt.findFirstOrThrow({
      where: { customerOrderId: original.sale.id },
    });
    expect(failedReceipt).toMatchObject({ status: "FAILED", attemptCount: 1 });
    expect(kkmRuntime.calls[0]?.providerCommandId).toBe(failedReceipt.idempotencyKey);
    kkmRuntime.calls.length = 0;
    let releaseProvider!: () => void;
    kkmRuntime.gate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });

    const firstRetry = managerCaller.pos.kkm.retryReceipt({ receiptId: failedReceipt.id });
    await waitForKkmCalls(1);
    const secondRetry = managerCaller.pos.kkm.retryReceipt({ receiptId: failedReceipt.id });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    const processing = await prisma.fiscalReceipt.findUniqueOrThrow({
      where: { id: failedReceipt.id },
    });
    expect(kkmRuntime.calls).toHaveLength(1);
    expect(kkmRuntime.calls[0]?.providerCommandId).toBe(failedReceipt.idempotencyKey);
    releaseProvider();
    const [firstResult, secondResult] = await Promise.all([firstRetry, secondRetry]);
    const repeatedResult = await managerCaller.pos.kkm.retryReceipt({
      receiptId: failedReceipt.id,
    });
    const workerResult = await runKkmRetryJob();
    const [persisted, persistedSale, audits, idempotencyKeys] = await Promise.all([
      prisma.fiscalReceipt.findUniqueOrThrow({ where: { id: failedReceipt.id } }),
      prisma.customerOrder.findUniqueOrThrow({ where: { id: original.sale.id } }),
      prisma.auditLog.findMany({
        where: { entityId: failedReceipt.id, action: "KKM_RECEIPT_RETRY" },
      }),
      prisma.idempotencyKey.count({
        where: {
          key: "hard-a1-009-failed-complete-sale",
          route: "pos.sales.complete",
          userId: cashierUser.id,
        },
      }),
    ]);

    expect(processing).toMatchObject({ status: "PROCESSING", attemptCount: 2 });
    expect(firstResult).toMatchObject({ status: "FAILED", errorMessage: "mock-kkm-failure" });
    expect(secondResult).toEqual(firstResult);
    expect(repeatedResult).toEqual(firstResult);
    expect(workerResult.details).toMatchObject({ processed: 0, sent: 0, failed: 0 });
    expect(kkmRuntime.calls).toHaveLength(1);
    expect(persisted).toMatchObject({
      status: "FAILED",
      attemptCount: 2,
      lastError: "mock-kkm-failure",
    });
    expect(persisted.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now());
    expect(persistedSale).toMatchObject({ kkmStatus: "FAILED", kkmReceiptId: null });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.before).toMatchObject({ status: "FAILED", attemptCount: 1 });
    expect(audits[0]?.after).toMatchObject({ status: "FAILED", attemptCount: 2 });
    expect(idempotencyKeys).toBe(1);
  });

  it("HARD-A1-009 claims a queued checkout receipt before the provider call", async () => {
    const { org, store, product, adminUser, cashierUser } = await seedBase({
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
      qtyDelta: 1,
      reason: "HARD-A1-009 queued checkout fixture",
      idempotencyKey: "hard-a1-009-queued-stock",
      requestId: "hard-a1-009-queued-stock",
    });
    const cashierCaller = callerFor(cashierUser);
    const runtime = await createRegisterAndShift({
      organizationId: org.id,
      storeId: store.id,
      caller: cashierCaller,
      key: "p0009q",
    });
    const sale = await cashierCaller.pos.sales.createDraft({ registerId: runtime.register.id });
    await cashierCaller.pos.sales.addLine({ saleId: sale.id, productId: product.id, qty: 1 });
    kkmRuntime.mode = "success";
    let releaseProvider!: () => void;
    kkmRuntime.gate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });

    const completion = cashierCaller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "hard-a1-009-queued-complete",
      payments: [{ method: PosPaymentMethod.CASH, amountKgs: 100 }],
    });
    await waitForKkmCalls(1);
    const processing = await prisma.fiscalReceipt.findFirstOrThrow({
      where: { customerOrderId: sale.id },
    });
    const workerResult = await runKkmRetryJob();
    expect(workerResult.details).toMatchObject({ processed: 0, sent: 0, failed: 0 });
    expect(kkmRuntime.calls).toHaveLength(1);
    releaseProvider();
    await completion;

    const [persisted, persistedSale, retryAudits, idempotencyKeys] = await Promise.all([
      prisma.fiscalReceipt.findUniqueOrThrow({ where: { id: processing.id } }),
      prisma.customerOrder.findUniqueOrThrow({ where: { id: sale.id } }),
      prisma.auditLog.count({
        where: {
          entityId: { in: [sale.id, processing.id] },
          action: { in: ["POS_KKM_RETRY", "KKM_RECEIPT_RETRY", "KKM_RECEIPT_RETRY_JOB"] },
        },
      }),
      prisma.idempotencyKey.count({
        where: {
          key: "hard-a1-009-queued-complete",
          route: "pos.sales.complete",
          userId: cashierUser.id,
        },
      }),
    ]);
    expect(processing).toMatchObject({ status: "PROCESSING", attemptCount: 1 });
    expect(kkmRuntime.calls[0]?.providerCommandId).toBe(processing.idempotencyKey);
    expect(processing.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now());
    expect(persisted).toMatchObject({
      status: "SENT",
      attemptCount: 1,
      providerReceiptId: "mock-provider-1",
      nextAttemptAt: null,
    });
    expect(persistedSale).toMatchObject({
      kkmStatus: "SENT",
      kkmReceiptId: "mock-provider-1",
    });
    expect(kkmRuntime.calls).toHaveLength(1);
    expect(retryAudits).toBe(0);
    expect(idempotencyKeys).toBe(1);
  });

  it("HARD-A1-009 reclaims a stale processing receipt exactly once", async () => {
    const { org, store, product, adminUser, cashierUser } = await seedBase({
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
      qtyDelta: 1,
      reason: "HARD-A1-009 stale claim fixture",
      idempotencyKey: "hard-a1-009-stale-stock",
      requestId: "hard-a1-009-stale-stock",
    });
    const cashierCaller = callerFor(cashierUser);
    const runtime = await createRegisterAndShift({
      organizationId: org.id,
      storeId: store.id,
      caller: cashierCaller,
      key: "p0009s",
    });
    const original = await createAndCompleteSale({
      caller: cashierCaller,
      registerId: runtime.register.id,
      productId: product.id,
      key: "hard-a1-009-stale",
    });
    const failedReceipt = await prisma.fiscalReceipt.findFirstOrThrow({
      where: { customerOrderId: original.sale.id },
    });
    expect(failedReceipt).toMatchObject({ status: "FAILED", attemptCount: 1 });
    expect(kkmRuntime.calls[0]?.providerCommandId).toBe(failedReceipt.idempotencyKey);
    await prisma.fiscalReceipt.update({
      where: { id: failedReceipt.id },
      data: {
        status: "PROCESSING",
        nextAttemptAt: new Date(0),
        attemptCount: { increment: 1 },
      },
    });
    kkmRuntime.calls.length = 0;
    kkmRuntime.mode = "success";
    let releaseProvider!: () => void;
    kkmRuntime.gate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });

    const firstWorker = runKkmRetryJob();
    await waitForKkmCalls(1);
    const processing = await prisma.fiscalReceipt.findUniqueOrThrow({
      where: { id: failedReceipt.id },
    });
    const secondWorker = await runKkmRetryJob();
    expect(secondWorker.details).toMatchObject({ processed: 0, sent: 0, failed: 0 });
    expect(kkmRuntime.calls).toHaveLength(1);
    expect(kkmRuntime.calls[0]?.providerCommandId).toBe(failedReceipt.idempotencyKey);
    releaseProvider();
    const firstWorkerResult = await firstWorker;
    const repeatedWorker = await runKkmRetryJob();
    const [persisted, persistedSale, workerAudits] = await Promise.all([
      prisma.fiscalReceipt.findUniqueOrThrow({ where: { id: failedReceipt.id } }),
      prisma.customerOrder.findUniqueOrThrow({ where: { id: original.sale.id } }),
      prisma.auditLog.findMany({
        where: { entityId: failedReceipt.id, action: "KKM_RECEIPT_RETRY_JOB" },
      }),
    ]);

    expect(processing).toMatchObject({ status: "PROCESSING", attemptCount: 3 });
    expect(processing.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now());
    expect(firstWorkerResult.details).toMatchObject({ processed: 1, sent: 1, failed: 0 });
    expect(repeatedWorker.details).toMatchObject({ processed: 0, sent: 0, failed: 0 });
    expect(kkmRuntime.calls).toHaveLength(1);
    expect(persisted).toMatchObject({
      status: "SENT",
      attemptCount: 3,
      providerReceiptId: "mock-provider-1",
      nextAttemptAt: null,
    });
    expect(persistedSale).toMatchObject({
      kkmStatus: "SENT",
      kkmReceiptId: "mock-provider-1",
    });
    expect(workerAudits).toHaveLength(1);
    expect(workerAudits[0]?.before).toMatchObject({ status: "PROCESSING", attemptCount: 2 });
    expect(workerAudits[0]?.after).toMatchObject({ status: "SENT", attemptCount: 3 });
  });

  it("HARD-A1-009 fails closed before a non-idempotent adapter can be called", async () => {
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
      qtyDelta: 1,
      reason: "HARD-A1-009 unsupported adapter fixture",
      idempotencyKey: "hard-a1-009-unsupported-stock",
      requestId: "hard-a1-009-unsupported-stock",
    });
    const cashierCaller = callerFor(cashierUser);
    const managerCaller = callerFor(managerUser);
    const runtime = await createRegisterAndShift({
      organizationId: org.id,
      storeId: store.id,
      caller: cashierCaller,
      key: "p0009u",
    });
    kkmRuntime.mode = "success";
    kkmRuntime.supportsIdempotentFiscalization = false;

    const original = await createAndCompleteSale({
      caller: cashierCaller,
      registerId: runtime.register.id,
      productId: product.id,
      key: "hard-a1-009-unsupported",
    });
    const initial = await prisma.fiscalReceipt.findFirstOrThrow({
      where: { customerOrderId: original.sale.id },
    });
    const manualResult = await managerCaller.pos.kkm.retryReceipt({ receiptId: initial.id });
    await prisma.fiscalReceipt.update({
      where: { id: initial.id },
      data: { nextAttemptAt: new Date(0) },
    });
    const scheduledResult = await runKkmRetryJob();
    await prisma.fiscalReceipt.update({
      where: { id: initial.id },
      data: { status: "PROCESSING", nextAttemptAt: new Date(0) },
    });
    const staleResult = await runKkmRetryJob();
    const [persisted, persistedSale, audits] = await Promise.all([
      prisma.fiscalReceipt.findUniqueOrThrow({ where: { id: initial.id } }),
      prisma.customerOrder.findUniqueOrThrow({ where: { id: original.sale.id } }),
      prisma.auditLog.findMany({
        where: {
          entityId: initial.id,
          action: { in: ["KKM_RECEIPT_RETRY", "KKM_RECEIPT_RETRY_JOB"] },
        },
      }),
    ]);

    expect(initial).toMatchObject({
      status: "FAILED",
      attemptCount: 1,
      lastError: "kkmAdapterIdempotencyUnsupported",
    });
    expect(manualResult).toMatchObject({
      status: "FAILED",
      errorMessage: "kkmAdapterIdempotencyUnsupported",
    });
    expect(scheduledResult.details).toMatchObject({ processed: 1, sent: 0, failed: 1 });
    expect(staleResult.details).toMatchObject({ processed: 1, sent: 0, failed: 1 });
    expect(persisted).toMatchObject({
      status: "FAILED",
      attemptCount: 4,
      lastError: "kkmAdapterIdempotencyUnsupported",
    });
    expect(persistedSale).toMatchObject({ kkmStatus: "FAILED", kkmReceiptId: null });
    expect(audits).toHaveLength(3);
    expect(kkmRuntime.calls).toHaveLength(0);
    expect(kkmRuntime.externalEffects.size).toBe(0);
  });

  it("HARD-A1-009 reuses one provider command after a lost DB finalization", async () => {
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
      qtyDelta: 1,
      reason: "HARD-A1-009 provider/DB boundary fixture",
      idempotencyKey: "hard-a1-009-provider-db-stock",
      requestId: "hard-a1-009-provider-db-stock",
    });
    const cashierCaller = callerFor(cashierUser);
    const runtime = await createRegisterAndShift({
      organizationId: org.id,
      storeId: store.id,
      caller: cashierCaller,
      key: "p0009db",
    });
    const original = await createAndCompleteSale({
      caller: cashierCaller,
      registerId: runtime.register.id,
      productId: product.id,
      key: "hard-a1-009-provider-db",
    });
    const receipt = await prisma.fiscalReceipt.findFirstOrThrow({
      where: { customerOrderId: original.sale.id },
    });
    expect(receipt).toMatchObject({ status: "FAILED", attemptCount: 1 });
    expect(kkmRuntime.calls[0]?.providerCommandId).toBe(receipt.idempotencyKey);

    kkmRuntime.calls.length = 0;
    kkmRuntime.mode = "success";
    let invalidatedFinalizeCount = 0;
    kkmRuntime.afterEffect = async ({ providerCommandId }) => {
      expect(providerCommandId).toBe(receipt.idempotencyKey);
      invalidatedFinalizeCount += 1;
      await prisma.fiscalReceipt.update({
        where: { id: receipt.id },
        data: {
          status: "PROCESSING",
          attemptCount: { increment: 1 },
          nextAttemptAt: new Date(0),
        },
      });
    };

    const lostFinalize = await processAdapterFiscalReceipt({
      receiptId: receipt.id,
      trigger: "manual",
      waitForInProgress: false,
      audit: {
        actorId: managerUser.id,
        action: "KKM_RECEIPT_RETRY",
        entity: "FiscalReceipt",
        requestId: "hard-a1-009-provider-db-lost-finalize",
      },
    });
    kkmRuntime.afterEffect = null;
    const staleBeforeRecovery = await prisma.fiscalReceipt.findUniqueOrThrow({
      where: { id: receipt.id },
    });
    const workerResult = await runKkmRetryJob();
    const [persisted, persistedSale, manualAudits, workerAudits, completionKeys] =
      await Promise.all([
        prisma.fiscalReceipt.findUniqueOrThrow({ where: { id: receipt.id } }),
        prisma.customerOrder.findUniqueOrThrow({ where: { id: original.sale.id } }),
        prisma.auditLog.count({
          where: { entityId: receipt.id, action: "KKM_RECEIPT_RETRY" },
        }),
        prisma.auditLog.findMany({
          where: { entityId: receipt.id, action: "KKM_RECEIPT_RETRY_JOB" },
        }),
        prisma.idempotencyKey.count({
          where: {
            key: "hard-a1-009-provider-db-complete-sale",
            route: "pos.sales.complete",
            userId: cashierUser.id,
          },
        }),
      ]);
    const providerResult = kkmRuntime.externalEffects.get(receipt.idempotencyKey);

    expect(lostFinalize).toMatchObject({ providerCalled: true, finalized: false });
    expect(staleBeforeRecovery).toMatchObject({ status: "PROCESSING", attemptCount: 3 });
    expect(staleBeforeRecovery.nextAttemptAt?.getTime()).toBe(0);
    expect(workerResult.details).toMatchObject({ processed: 1, sent: 1, failed: 0 });
    expect(kkmRuntime.calls).toHaveLength(2);
    expect(new Set(kkmRuntime.calls.map((call) => call.providerCommandId))).toEqual(
      new Set([receipt.idempotencyKey]),
    );
    expect(kkmRuntime.externalEffects.size).toBe(1);
    expect(invalidatedFinalizeCount).toBe(1);
    expect(providerResult?.providerReceiptId).toBe("mock-provider-1");
    expect(persisted).toMatchObject({
      status: "SENT",
      attemptCount: 4,
      providerReceiptId: providerResult?.providerReceiptId,
      fiscalNumber: providerResult?.fiscalNumber,
      nextAttemptAt: null,
    });
    expect(persistedSale).toMatchObject({
      kkmStatus: "SENT",
      kkmReceiptId: providerResult?.providerReceiptId,
    });
    expect(manualAudits).toBe(0);
    expect(workerAudits).toHaveLength(1);
    expect(workerAudits[0]?.before).toMatchObject({
      status: "PROCESSING",
      attemptCount: 3,
    });
    expect(workerAudits[0]?.after).toMatchObject({
      status: "SENT",
      attemptCount: 4,
      providerReceiptId: providerResult?.providerReceiptId,
    });
    expect(completionKeys).toBe(1);
  });

  it("HARD-A1-012 blocks POS KKM retry for inactive register history without side effects", async () => {
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
      qtyDelta: 1,
      reason: "HARD-A1-012 inactive register retry fixture",
      idempotencyKey: "hard-a1-012-stock",
      requestId: "hard-a1-012-stock",
    });
    const cashierCaller = callerFor(cashierUser);
    const managerCaller = callerFor(managerUser);
    const runtime = await createRegisterAndShift({
      organizationId: org.id,
      storeId: store.id,
      caller: cashierCaller,
      key: "p0012",
    });
    const original = await createAndCompleteSale({
      caller: cashierCaller,
      registerId: runtime.register.id,
      productId: product.id,
      key: "hard-a1-012-original",
    });
    const failedReceipt = await prisma.fiscalReceipt.findFirstOrThrow({
      where: { customerOrderId: original.sale.id },
    });
    expect(failedReceipt).toMatchObject({ status: "FAILED", attemptCount: 1 });
    expect(kkmRuntime.calls).toHaveLength(1);

    await managerCaller.pos.shifts.close({
      shiftId: runtime.shift.id,
      closingCashCountedKgs: original.totalKgs,
      idempotencyKey: "hard-a1-012-close",
    });
    // Simulates a retained legacy/recovery record. Normal deactivation is correctly blocked while
    // a recoverable fiscal receipt exists, but read-only history must remain safe if such data does.
    await prisma.posRegister.update({
      where: { id: runtime.register.id },
      data: { isActive: false },
    });

    const [saleBefore, receiptBefore, retryAuditsBefore] = await Promise.all([
      prisma.customerOrder.findUniqueOrThrow({ where: { id: original.sale.id } }),
      prisma.fiscalReceipt.findUniqueOrThrow({ where: { id: failedReceipt.id } }),
      prisma.auditLog.count({
        where: { entityId: original.sale.id, action: "POS_KKM_RETRY" },
      }),
    ]);
    const providerCallsBefore = kkmRuntime.calls.length;
    const providerEffectsBefore = kkmRuntime.externalEffects.size;

    await expect(
      managerCaller.pos.sales.retryKkm({ saleId: original.sale.id }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "posRegisterInactive" });

    const [saleAfter, receiptAfter, retryAuditsAfter] = await Promise.all([
      prisma.customerOrder.findUniqueOrThrow({ where: { id: original.sale.id } }),
      prisma.fiscalReceipt.findUniqueOrThrow({ where: { id: failedReceipt.id } }),
      prisma.auditLog.count({
        where: { entityId: original.sale.id, action: "POS_KKM_RETRY" },
      }),
    ]);
    expect(kkmRuntime.calls).toHaveLength(providerCallsBefore);
    expect(kkmRuntime.externalEffects.size).toBe(providerEffectsBefore);
    expect(retryAuditsAfter).toBe(retryAuditsBefore);
    expect(saleAfter).toEqual(saleBefore);
    expect(receiptAfter).toEqual(receiptBefore);
  });
});
