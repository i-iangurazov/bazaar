import { beforeEach, describe, expect, it } from "vitest";
import { CashDrawerMovementType, StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { adjustStock } from "@/server/services/inventory";
import {
  connectorPullQueue,
  connectorPushResult,
  createConnectorPairingCode,
  pairConnectorDevice,
} from "@/server/services/kkmConnector";

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

  it("handles concurrent draft creation without 500", async () => {
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
      idempotencyKey: "pos-open-concurrent-1",
    });

    const drafts = await Promise.all(
      Array.from({ length: 6 }, () => caller.pos.sales.createDraft({ registerId: register.id })),
    );

    const draftCount = await prisma.customerOrder.count({
      where: {
        organizationId: org.id,
        registerId: register.id,
        isPosSale: true,
        status: "DRAFT",
      },
    });

    const uniqueIds = new Set(drafts.map((draft) => draft.id));
    expect(uniqueIds.size).toBe(1);
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

  it("allows receipt registry only for manager and above", async () => {
    const { org, managerUser, staffUser } = await seedBase();

    const managerCaller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });
    const staffCaller = createTestCaller({
      id: staffUser.id,
      email: staffUser.email,
      role: staffUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });

    const managerResult = await managerCaller.pos.receipts({
      page: 1,
      pageSize: 25,
    });
    expect(managerResult.items).toEqual([]);

    await expect(
      staffCaller.pos.receipts({
        page: 1,
        pageSize: 25,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
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

  it("requires marking codes when store marking mode is REQUIRED_ON_SALE", async () => {
    const { org, store, product, cashierUser, adminUser } = await seedBase();

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 100 },
    });
    await prisma.productComplianceFlags.upsert({
      where: { productId: product.id },
      create: {
        organizationId: org.id,
        productId: product.id,
        requiresMarking: true,
        markingType: "DATAMATRIX",
      },
      update: {
        requiresMarking: true,
        markingType: "DATAMATRIX",
      },
    });
    await prisma.storeComplianceProfile.upsert({
      where: { storeId: store.id },
      create: {
        organizationId: org.id,
        storeId: store.id,
        enableMarking: true,
        markingMode: "REQUIRED_ON_SALE",
      },
      update: {
        enableMarking: true,
        markingMode: "REQUIRED_ON_SALE",
      },
    });

    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 10,
      reason: "seed-marking",
      idempotencyKey: "pos-marking-seed-1",
      requestId: "pos-marking-seed-1",
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
      idempotencyKey: "pos-marking-open-1",
    });

    const sale = await caller.pos.sales.createDraft({ registerId: register.id });
    await caller.pos.sales.addLine({ saleId: sale.id, productId: product.id, qty: 1 });

    await expect(
      caller.pos.sales.complete({
        saleId: sale.id,
        idempotencyKey: "pos-marking-complete-1",
        payments: [{ method: "CASH", amountKgs: 100 }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const fetched = await caller.pos.sales.get({ saleId: sale.id });
    expect(fetched).toBeTruthy();
    const line = fetched?.lines[0];
    expect(line).toBeTruthy();

    await caller.pos.sales.upsertMarkingCodes({
      saleId: sale.id,
      lineId: line!.id,
      codes: ["DM-001-ABC"],
    });

    const completed = await caller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "pos-marking-complete-2",
      payments: [{ method: "CASH", amountKgs: 100 }],
    });

    expect(completed.status).toBe("COMPLETED");

    const captures = await prisma.markingCodeCapture.findMany({
      where: { saleId: sale.id },
    });
    expect(captures).toHaveLength(1);
    expect(captures[0]?.code).toBe("DM-001-ABC");
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

  it("queues connector fiscal receipt and marks it sent through connector workflow", async () => {
    const { org, store, product, cashierUser, adminUser } = await seedBase();

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 100 },
    });
    await prisma.storeComplianceProfile.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        enableKkm: true,
        kkmMode: "CONNECTOR",
        kkmProviderKey: "mkassa",
      },
    });

    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 5,
      reason: "seed",
      idempotencyKey: "pos-seed-kkm-1",
      requestId: "pos-seed-kkm-1",
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
      idempotencyKey: "pos-open-kkm-1",
    });

    const sale = await cashierCaller.pos.sales.createDraft({ registerId: register.id });
    await cashierCaller.pos.sales.addLine({ saleId: sale.id, productId: product.id, qty: 1 });
    await cashierCaller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "pos-sale-complete-kkm-1",
      payments: [{ method: "CASH", amountKgs: 100 }],
    });

    const queuedReceipt = await prisma.fiscalReceipt.findFirst({
      where: { customerOrderId: sale.id },
      select: { id: true, status: true, mode: true },
    });
    expect(queuedReceipt?.status).toBe("QUEUED");
    expect(queuedReceipt?.mode).toBe("CONNECTOR");

    const saleAfterComplete = await prisma.customerOrder.findUnique({
      where: { id: sale.id },
      select: { kkmStatus: true },
    });
    expect(saleAfterComplete?.kkmStatus).toBe("NOT_SENT");

    const pair = await createConnectorPairingCode({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "pair-kkm-1",
    });
    const pairedDevice = await pairConnectorDevice({
      code: pair.code,
      deviceName: "Test Connector",
    });

    const pulled = await connectorPullQueue({ token: pairedDevice.token, limit: 10 });
    expect(pulled).toHaveLength(1);
    expect(pulled[0]?.id).toBe(queuedReceipt?.id);

    await connectorPushResult({
      token: pairedDevice.token,
      receiptId: pulled[0]!.id,
      status: "SENT",
      providerReceiptId: "mkassa-001",
      fiscalNumber: "fiscal-001",
    });
    await connectorPushResult({
      token: pairedDevice.token,
      receiptId: pulled[0]!.id,
      status: "SENT",
      providerReceiptId: "mkassa-001",
      fiscalNumber: "fiscal-001",
    });

    const sentReceipt = await prisma.fiscalReceipt.findUnique({
      where: { id: pulled[0]!.id },
      select: { status: true, providerReceiptId: true, fiscalNumber: true },
    });
    expect(sentReceipt?.status).toBe("SENT");
    expect(sentReceipt?.providerReceiptId).toBe("mkassa-001");
    expect(sentReceipt?.fiscalNumber).toBe("fiscal-001");

    const sentSale = await prisma.customerOrder.findUnique({
      where: { id: sale.id },
      select: { kkmStatus: true, kkmReceiptId: true },
    });
    expect(sentSale?.kkmStatus).toBe("SENT");
    expect(sentSale?.kkmReceiptId).toBe("mkassa-001");
  });

  it("blocks card refund when original sale shift differs", async () => {
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
      idempotencyKey: "pos-seed-card-return-1",
      requestId: "pos-seed-card-return-1",
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
    const managerCaller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });

    await cashierCaller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "pos-open-card-return-1",
    });
    const firstShift = await cashierCaller.pos.shifts.current({ registerId: register.id });
    if (!firstShift) {
      throw new Error("expected first shift");
    }

    const sale = await cashierCaller.pos.sales.createDraft({ registerId: register.id });
    await cashierCaller.pos.sales.addLine({ saleId: sale.id, productId: product.id, qty: 1 });
    await cashierCaller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "pos-sale-card-return-1",
      payments: [{ method: "CARD", amountKgs: 100 }],
    });

    await managerCaller.pos.shifts.close({
      shiftId: firstShift.id,
      closingCashCountedKgs: 0,
      idempotencyKey: "pos-close-card-return-1",
    });
    await cashierCaller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "pos-open-card-return-2",
    });
    const secondShift = await cashierCaller.pos.shifts.current({ registerId: register.id });
    if (!secondShift) {
      throw new Error("expected second shift");
    }

    const saleLine = await prisma.customerOrderLine.findFirst({
      where: { customerOrderId: sale.id },
      select: { id: true },
    });
    if (!saleLine) {
      throw new Error("expected sale line");
    }

    const returnDraft = await cashierCaller.pos.returns.createDraft({
      shiftId: secondShift.id,
      originalSaleId: sale.id,
    });
    await cashierCaller.pos.returns.addLine({
      saleReturnId: returnDraft.id,
      customerOrderLineId: saleLine.id,
      qty: 1,
    });

    await expect(
      managerCaller.pos.returns.complete({
        saleReturnId: returnDraft.id,
        idempotencyKey: "pos-return-card-mismatch-1",
        payments: [{ method: "CARD", amountKgs: 100 }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "posCardRefundShiftMismatch" });
  });

  it("creates manual refund request for transfer refunds without inventory reversal", async () => {
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
      idempotencyKey: "pos-seed-transfer-return-1",
      requestId: "pos-seed-transfer-return-1",
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
    const managerCaller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });

    await cashierCaller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "pos-open-transfer-return-1",
    });
    const shift = await cashierCaller.pos.shifts.current({ registerId: register.id });
    if (!shift) {
      throw new Error("expected open shift");
    }

    const sale = await cashierCaller.pos.sales.createDraft({ registerId: register.id });
    await cashierCaller.pos.sales.addLine({ saleId: sale.id, productId: product.id, qty: 1 });
    await cashierCaller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "pos-sale-transfer-return-1",
      payments: [{ method: "TRANSFER", amountKgs: 100 }],
    });

    const saleLine = await prisma.customerOrderLine.findFirst({
      where: { customerOrderId: sale.id },
      select: { id: true },
    });
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

    const completion = await managerCaller.pos.returns.complete({
      saleReturnId: returnDraft.id,
      idempotencyKey: "pos-return-transfer-manual-1",
      payments: [{ method: "TRANSFER", amountKgs: 100 }],
    });

    expect(completion.manualRequired).toBe(true);
    expect(completion.refundRequestId).toBeTruthy();

    const returnDoc = await prisma.saleReturn.findUnique({
      where: { id: returnDraft.id },
      select: { status: true },
    });
    expect(returnDoc?.status).toBe("CANCELED");

    const request = await prisma.refundRequest.findUnique({
      where: { saleReturnId: returnDraft.id },
      select: { id: true, status: true, reasonCode: true },
    });
    expect(request?.id).toBe(completion.refundRequestId);
    expect(request?.status).toBe("OPEN");
    expect(request?.reasonCode).toBe("MKASSA_QR_MANUAL");

    const refundMovements = await prisma.stockMovement.findMany({
      where: {
        referenceType: "SaleReturn",
        referenceId: returnDraft.id,
        type: StockMovementType.RETURN,
      },
    });
    const refundPayments = await prisma.salePayment.findMany({
      where: { saleReturnId: returnDraft.id, isRefund: true },
    });
    expect(refundMovements).toHaveLength(0);
    expect(refundPayments).toHaveLength(0);
  });
});
