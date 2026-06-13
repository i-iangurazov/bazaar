import { beforeEach, describe, expect, it } from "vitest";
import { CashDrawerMovementType, PosPaymentMethod, StockMovementType } from "@prisma/client";

import { buildPosPaymentSubmitPayload } from "@/lib/posSaleMath";
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
    const { org, store, cashierUser } = await seedBase({ plan: "BUSINESS" });

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
    const { org, store, cashierUser } = await seedBase({ plan: "BUSINESS" });

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
    const { org, store, cashierUser } = await seedBase({ plan: "BUSINESS" });

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

  it("holds and resumes draft receipts and blocks shift close while held", async () => {
    const { org, store, product, cashierUser } = await seedBase({ plan: "BUSINESS" });

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 125 },
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

    const shift = await caller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "pos-open-held-1",
    });

    const sale = await caller.pos.sales.createDraft({ registerId: register.id });
    await caller.pos.sales.addLine({ saleId: sale.id, productId: product.id, qty: 2 });

    const held = await caller.pos.sales.holdDraft({ saleId: sale.id });
    expect(held.isHeld).toBe(true);
    expect(held.lineCount).toBe(1);

    const activeAfterHold = await caller.pos.sales.activeDraft({ registerId: register.id });
    expect(activeAfterHold).toBeNull();

    const heldOnly = await caller.pos.sales.list({
      registerId: register.id,
      heldState: "held",
      statuses: ["DRAFT"],
      page: 1,
      pageSize: 25,
    });
    expect(heldOnly.items).toHaveLength(1);
    expect(heldOnly.items[0]?.id).toBe(sale.id);
    expect(heldOnly.items[0]?.isHeld).toBe(true);

    const activeOnlyAfterHold = await caller.pos.sales.list({
      registerId: register.id,
      heldState: "active",
      statuses: ["DRAFT"],
      page: 1,
      pageSize: 25,
    });
    expect(activeOnlyAfterHold.items).toHaveLength(0);

    const storeSearch = await caller.pos.sales.list({
      registerId: register.id,
      search: store.code,
      statuses: ["DRAFT"],
      page: 1,
      pageSize: 25,
    });
    expect(storeSearch.items[0]?.id).toBe(sale.id);

    const cashierSearch = await caller.pos.sales.list({
      registerId: register.id,
      search: cashierUser.email,
      statuses: ["DRAFT"],
      page: 1,
      pageSize: 25,
    });
    expect(cashierSearch.items[0]?.id).toBe(sale.id);

    const currentShift = await caller.pos.shifts.current({ registerId: register.id });
    expect(currentShift?.heldReceiptCount).toBe(1);
    expect(currentShift?.heldReceipts[0]?.number).toBe(sale.number);

    await expect(
      caller.pos.shifts.close({
        shiftId: shift.id,
        closingCashCountedKgs: 0,
        idempotencyKey: "pos-close-held-blocked-1",
      }),
    ).rejects.toMatchObject({ message: "posHeldReceiptsOpen", code: "CONFLICT" });

    const resumed = await caller.pos.sales.resumeHeldDraft({
      saleId: sale.id,
      registerId: register.id,
    });
    expect(resumed.isHeld).toBe(false);

    const activeOnlyAfterResume = await caller.pos.sales.list({
      registerId: register.id,
      heldState: "active",
      statuses: ["DRAFT"],
      page: 1,
      pageSize: 25,
    });
    expect(activeOnlyAfterResume.items[0]?.id).toBe(sale.id);

    const activeAfterResume = await caller.pos.sales.activeDraft({ registerId: register.id });
    expect(activeAfterResume?.id).toBe(sale.id);

    const saleDetail = await caller.pos.sales.get({ saleId: sale.id });
    expect(saleDetail?.lines).toHaveLength(1);
    expect(saleDetail?.lines[0]?.qty).toBe(2);
    expect(Number(saleDetail?.totalKgs ?? 0)).toBe(250);

    await caller.pos.sales.cancelDraft({ saleId: sale.id });
    await caller.pos.shifts.close({
      shiftId: shift.id,
      closingCashCountedKgs: 0,
      idempotencyKey: "pos-close-held-cleared-1",
    });

    const closedShift = await prisma.registerShift.findUnique({ where: { id: shift.id } });
    expect(closedShift?.status).toBe("CLOSED");
  });

  it("allows receipt registry only for manager and above", async () => {
    const { org, managerUser, staffUser } = await seedBase({ plan: "BUSINESS" });

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
    const { org, store, cashierUser } = await seedBase({ plan: "BUSINESS" });

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
    const { org, store, product, cashierUser, adminUser } = await seedBase({ plan: "BUSINESS" });

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

  it("completes a transfer sale after quantity and price edits", async () => {
    const { org, store, product, cashierUser, adminUser } = await seedBase({ plan: "BUSINESS" });

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
      reason: "seed-transfer-edits",
      idempotencyKey: "pos-seed-transfer-edits-1",
      requestId: "pos-seed-transfer-edits-1",
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
      idempotencyKey: "pos-open-transfer-edits-1",
    });

    const sale = await caller.pos.sales.createDraft({ registerId: register.id });
    const line = await caller.pos.sales.addLine({ saleId: sale.id, productId: product.id, qty: 1 });
    await caller.pos.sales.updateLine({ lineId: line.id, qty: 3, unitPriceKgs: 125 });

    await caller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "pos-sale-complete-transfer-edits-1",
      payments: [{ method: "TRANSFER", amountKgs: 375 }],
    });

    const dbSale = await prisma.customerOrder.findUnique({ where: { id: sale.id } });
    const payments = await prisma.salePayment.findMany({ where: { customerOrderId: sale.id } });

    expect(dbSale?.status).toBe("COMPLETED");
    expect(Number(dbSale?.totalKgs ?? 0)).toBe(375);
    expect(payments).toHaveLength(1);
    expect(payments[0]?.method).toBe("TRANSFER");
    expect(Number(payments[0]?.amountKgs ?? 0)).toBe(375);
  });

  it("keeps draft totals in sync when multiple products are added concurrently", async () => {
    const { org, store, supplier, product, cashierUser, baseUnit } = await seedBase({
      plan: "BUSINESS",
    });

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 1000 },
    });

    const secondProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "POS-CONCURRENT-2",
        name: "POS Concurrent Product 2",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: 2500,
      },
    });
    const thirdProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "POS-CONCURRENT-3",
        name: "POS Concurrent Product 3",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: 5045,
      },
    });
    await prisma.storeProduct.createMany({
      data: [secondProduct, thirdProduct].map((item) => ({
        organizationId: org.id,
        storeId: store.id,
        productId: item.id,
        isActive: true,
      })),
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
      idempotencyKey: "pos-open-concurrent-line-total-1",
    });

    const productIds = [product.id, secondProduct.id, thirdProduct.id];

    for (let index = 0; index < 10; index += 1) {
      const sale = await caller.pos.sales.createDraft({ registerId: register.id });
      await Promise.all(
        productIds.map((productId) =>
          caller.pos.sales.addLine({
            saleId: sale.id,
            productId,
            qty: 1,
          }),
        ),
      );

      const dbSale = await prisma.customerOrder.findUniqueOrThrow({
        where: { id: sale.id },
        include: { lines: true },
      });
      const lineTotal = dbSale.lines.reduce((sum, line) => sum + Number(line.lineTotalKgs), 0);

      expect(dbSale.lines).toHaveLength(3);
      expect(lineTotal).toBe(8545);
      expect(Number(dbSale.totalKgs)).toBe(lineTotal);

      await caller.pos.sales.complete({
        saleId: sale.id,
        idempotencyKey: `pos-complete-concurrent-line-total-${index + 1}`,
        payments: [{ method: PosPaymentMethod.TRANSFER, amountKgs: lineTotal }],
      });

      const activeDraft = await caller.pos.sales.activeDraft({ registerId: register.id });
      expect(activeDraft).toBeNull();
    }
  });

  it("completes a zero-total POS sale without requiring a payment row", async () => {
    const { org, store, product, cashierUser } = await seedBase({ plan: "BUSINESS" });

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: null },
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
      idempotencyKey: "pos-open-zero-total-1",
    });

    const sale = await caller.pos.sales.createDraft({ registerId: register.id });
    await caller.pos.sales.addLine({ saleId: sale.id, productId: product.id, qty: 1 });

    await caller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "pos-sale-complete-zero-total-1",
      payments: [],
    });

    const dbSale = await prisma.customerOrder.findUnique({ where: { id: sale.id } });
    const payments = await prisma.salePayment.findMany({ where: { customerOrderId: sale.id } });

    expect(dbSale?.status).toBe("COMPLETED");
    expect(Number(dbSale?.totalKgs ?? 0)).toBe(0);
    expect(payments).toHaveLength(0);
  });

  it("completes repeated cashier sales without stale drafts or payment mismatches", async () => {
    const { org, store, supplier, product, cashierUser, adminUser, baseUnit } = await seedBase({
      plan: "BUSINESS",
    });

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 100 },
    });

    const zeroPriceProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "ZERO-1",
        name: "Zero Price Product",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: null,
      },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: zeroPriceProduct.id,
        isActive: true,
      },
    });

    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 500,
      reason: "seed-repeated-pos-sales",
      idempotencyKey: "pos-seed-repeated-sales-1",
      requestId: "pos-seed-repeated-sales-1",
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
      idempotencyKey: "pos-open-repeated-sales-1",
    });

    const runs = [
      { method: "CASH" as const, qty: 1, unitPriceKgs: 100, totalKgs: 100 },
      { method: "TRANSFER" as const, qty: 1, unitPriceKgs: 100, totalKgs: 100 },
      { method: "CASH" as const, qty: 3, unitPriceKgs: 100, totalKgs: 300 },
      { method: "CARD" as const, qty: 2, unitPriceKgs: 125, totalKgs: 250 },
      { method: "TRANSFER" as const, qty: 1, unitPriceKgs: 150, totalKgs: 150 },
      {
        method: "CASH" as const,
        qty: 1,
        unitPriceKgs: 0,
        totalKgs: 0,
        productId: zeroPriceProduct.id,
      },
      { method: "CARD" as const, qty: 50, unitPriceKgs: 100, totalKgs: 5000 },
      { method: "TRANSFER" as const, qty: 1, unitPriceKgs: 100, totalKgs: 100 },
      {
        method: "CASH" as const,
        qty: 2,
        unitPriceKgs: 100,
        totalKgs: 200,
        customerName: "Repeat Customer",
        customerPhone: "+996700000001",
      },
      { method: "TRANSFER" as const, qty: 1, unitPriceKgs: 100, totalKgs: 100 },
    ];

    for (const [index, run] of runs.entries()) {
      const sale = await caller.pos.sales.createDraft({
        registerId: register.id,
        customerName: run.customerName,
        customerPhone: run.customerPhone,
      });
      const line = await caller.pos.sales.addLine({
        saleId: sale.id,
        productId: run.productId ?? product.id,
        qty: 1,
      });

      if (run.qty !== 1 || run.unitPriceKgs !== 100) {
        await caller.pos.sales.updateLine({
          lineId: line.id,
          qty: run.qty,
          unitPriceKgs: run.unitPriceKgs,
        });
      }

      await caller.pos.sales.complete({
        saleId: sale.id,
        idempotencyKey: `pos-repeated-sale-${index + 1}`,
        payments: run.totalKgs > 0 ? [{ method: run.method, amountKgs: run.totalKgs }] : [],
      });

      const activeDraft = await caller.pos.sales.activeDraft({ registerId: register.id });
      expect(activeDraft).toBeNull();
    }

    const completedSales = await prisma.customerOrder.findMany({
      where: {
        organizationId: org.id,
        registerId: register.id,
        isPosSale: true,
        status: "COMPLETED",
      },
      include: { payments: true },
      orderBy: { number: "asc" },
    });

    expect(completedSales).toHaveLength(10);
    completedSales.forEach((sale, index) => {
      const expected = runs[index];
      expect(Number(sale.totalKgs)).toBe(expected.totalKgs);
      const paymentTotal = sale.payments.reduce(
        (sum, payment) => sum + Number(payment.amountKgs),
        0,
      );
      expect(paymentTotal).toBe(expected.totalKgs);
    });
  });

  it("regresses repeated multi-product transfer sales without stale payment mismatch", async () => {
    const { org, store, supplier, product, cashierUser, adminUser, baseUnit } = await seedBase({
      plan: "BUSINESS",
    });

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 100 },
    });

    const secondProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "POS-MISMATCH-2",
        name: "POS Mismatch Product 2",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: 250,
      },
    });
    const thirdProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "POS-MISMATCH-3",
        name: "POS Mismatch Product 3",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: 75,
      },
    });
    await prisma.storeProduct.createMany({
      data: [secondProduct, thirdProduct].map((item) => ({
        organizationId: org.id,
        storeId: store.id,
        productId: item.id,
        isActive: true,
      })),
    });

    for (const [index, productId] of [product.id, secondProduct.id, thirdProduct.id].entries()) {
      await adjustStock({
        organizationId: org.id,
        actorId: adminUser.id,
        storeId: store.id,
        productId,
        qtyDelta: 500,
        reason: "seed-pos-payment-mismatch-regression",
        idempotencyKey: `pos-payment-mismatch-regression-${index + 1}`,
        requestId: `pos-payment-mismatch-regression-${index + 1}`,
      });
    }

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
      idempotencyKey: "pos-open-payment-mismatch-regression-1",
    });

    const productIds = [product.id, secondProduct.id, thirdProduct.id];
    const expectedTotals: number[] = [];

    for (let index = 0; index < 10; index += 1) {
      const sale = await caller.pos.sales.createDraft({ registerId: register.id });
      const [firstLine, secondLine, thirdLine] = await Promise.all(
        productIds.map((productId) =>
          caller.pos.sales.addLine({
            saleId: sale.id,
            productId,
            qty: 1,
          }),
        ),
      );

      await caller.pos.sales.updateLine({
        lineId: firstLine.id,
        qty: 2 + (index % 2),
        unitPriceKgs: 100,
      });
      await caller.pos.sales.updateLine({
        lineId: secondLine.id,
        qty: 1,
        unitPriceKgs: 123.45 + index,
      });
      await caller.pos.sales.updateLine({
        lineId: thirdLine.id,
        qty: 3,
        unitPriceKgs: 42.42,
      });

      const currentSale = await prisma.customerOrder.findUniqueOrThrow({
        where: { id: sale.id },
        include: { lines: true },
      });
      const currentCartTotalKgs = Number(currentSale.totalKgs);
      expectedTotals.push(currentCartTotalKgs);

      const paymentPayload = buildPosPaymentSubmitPayload({
        payments: [
          {
            method: PosPaymentMethod.TRANSFER,
            amount: "1",
            providerRef: "",
          },
        ],
        cartTotalKgs: currentCartTotalKgs,
        currencySource: null,
        singlePaymentDisplayAmount: String(currentCartTotalKgs),
      });

      expect(currentSale.lines).toHaveLength(3);
      expect(paymentPayload.status).toBe("ok");
      expect(paymentPayload.payments).toEqual([
        {
          method: PosPaymentMethod.TRANSFER,
          amountKgs: currentCartTotalKgs,
          providerRef: null,
        },
      ]);
      expect(paymentPayload.paymentTotalMinorUnits).toBe(paymentPayload.cartTotalMinorUnits);

      await caller.pos.sales.complete({
        saleId: sale.id,
        idempotencyKey: `pos-payment-mismatch-regression-sale-${index + 1}`,
        payments: paymentPayload.payments,
      });

      const activeDraft = await caller.pos.sales.activeDraft({ registerId: register.id });
      expect(activeDraft).toBeNull();
    }

    const completedSales = await prisma.customerOrder.findMany({
      where: {
        organizationId: org.id,
        registerId: register.id,
        isPosSale: true,
        status: "COMPLETED",
      },
      include: { payments: true, lines: true },
      orderBy: { number: "asc" },
    });

    expect(completedSales).toHaveLength(10);
    completedSales.forEach((sale, index) => {
      const paymentTotal = sale.payments.reduce(
        (sum, payment) => sum + Number(payment.amountKgs),
        0,
      );
      expect(sale.lines).toHaveLength(3);
      expect(sale.payments).toHaveLength(1);
      expect(sale.payments[0]?.method).toBe(PosPaymentMethod.TRANSFER);
      expect(paymentTotal).toBe(expectedTotals[index]);
      expect(Number(sale.totalKgs)).toBe(expectedTotals[index]);
    });
  });

  it("allows POS sale completion to drive stock negative", async () => {
    const { org, store, product, cashierUser } = await seedBase({ plan: "BUSINESS" });

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 100 },
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
      idempotencyKey: "pos-open-negative-stock-1",
    });

    const sale = await caller.pos.sales.createDraft({ registerId: register.id });
    await caller.pos.sales.addLine({ saleId: sale.id, productId: product.id, qty: 2 });

    await caller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "pos-sale-complete-negative-stock-1",
      payments: [{ method: "CASH", amountKgs: 200 }],
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
    const movement = await prisma.stockMovement.findFirst({
      where: {
        storeId: store.id,
        productId: product.id,
        type: StockMovementType.SALE,
        referenceId: sale.id,
      },
    });

    expect(store.allowNegativeStock).toBe(false);
    expect(snapshot?.onHand).toBe(-2);
    expect(snapshot?.allowNegativeStock).toBe(true);
    expect(movement?.qtyDelta).toBe(-2);
  });

  it("tracks discounted debt sales and settles debt into the active shift", async () => {
    const { org, store, product, cashierUser, adminUser } = await seedBase({ plan: "BUSINESS" });

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
      reason: "seed-debt",
      idempotencyKey: "pos-seed-debt-1",
      requestId: "pos-seed-debt-1",
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
      idempotencyKey: "pos-open-debt-1",
    });

    const sale = await caller.pos.sales.createDraft({ registerId: register.id });
    await caller.pos.sales.addLine({ saleId: sale.id, productId: product.id, qty: 2 });
    const discounted = await caller.pos.sales.updateDiscount({
      saleId: sale.id,
      discountKgs: 50,
    });

    expect(discounted.subtotalKgs).toBe(200);
    expect(discounted.discountKgs).toBe(50);
    expect(discounted.totalKgs).toBe(150);

    await caller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "pos-sale-complete-debt-1",
      debtCustomerName: "Debt Customer",
      payments: [],
    });

    const openDebts = await caller.pos.debts.list({
      storeId: store.id,
      page: 1,
      pageSize: 25,
    });
    expect(openDebts.items).toHaveLength(1);
    expect(openDebts.items[0]).toMatchObject({
      id: sale.id,
      debtCustomerName: "Debt Customer",
      discountKgs: 50,
      totalKgs: 150,
    });

    const paymentsBeforeSettlement = await prisma.salePayment.count({
      where: { customerOrderId: sale.id },
    });
    expect(paymentsBeforeSettlement).toBe(0);

    await caller.pos.debts.settle({
      saleId: sale.id,
      registerId: register.id,
      idempotencyKey: "pos-debt-settle-1",
    });
    await caller.pos.debts.settle({
      saleId: sale.id,
      registerId: register.id,
      idempotencyKey: "pos-debt-settle-1",
    });

    const dbSale = await prisma.customerOrder.findUnique({ where: { id: sale.id } });
    const payments = await prisma.salePayment.findMany({ where: { customerOrderId: sale.id } });
    const remainingDebts = await caller.pos.debts.list({
      storeId: store.id,
      page: 1,
      pageSize: 25,
    });

    expect(dbSale?.isDebt).toBe(true);
    expect(dbSale?.debtSettledAt).toBeTruthy();
    expect(payments).toHaveLength(1);
    expect(Number(payments[0]?.amountKgs ?? 0)).toBe(150);
    expect(remainingDebts.items).toHaveLength(0);
  });

  it("keeps POS sale, payment, shift and cash movement currency snapshots after store currency changes", async () => {
    const { org, store, product, cashierUser, adminUser } = await seedBase({ plan: "BUSINESS" });

    await prisma.store.update({
      where: { id: store.id },
      data: { currencyCode: "USD", currencyRateKgsPerUnit: 89.5 },
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 895 },
    });

    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 5,
      reason: "seed-currency-snapshot",
      idempotencyKey: "pos-seed-currency-snapshot-1",
      requestId: "pos-seed-currency-snapshot-1",
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
      openingCashKgs: 895,
      idempotencyKey: "pos-open-currency-snapshot-1",
    });
    const shift = await caller.pos.shifts.current({ registerId: register.id });
    if (!shift) {
      throw new Error("expected open shift");
    }

    const sale = await caller.pos.sales.createDraft({ registerId: register.id });
    await caller.pos.sales.addLine({ saleId: sale.id, productId: product.id, qty: 1 });
    await caller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "pos-sale-complete-currency-snapshot-1",
      payments: [{ method: "CARD", amountKgs: 895 }],
    });
    await caller.pos.cash.record({
      shiftId: shift.id,
      type: CashDrawerMovementType.PAY_IN,
      amountKgs: 179,
      reason: "float",
      idempotencyKey: "pos-cash-currency-snapshot-1",
    });

    await prisma.store.update({
      where: { id: store.id },
      data: { currencyCode: "KGS", currencyRateKgsPerUnit: 1 },
    });

    const listedSales = await caller.pos.sales.list({
      registerId: register.id,
      statuses: ["COMPLETED"],
      page: 1,
      pageSize: 25,
    });
    const listedShifts = await caller.pos.shifts.list({
      registerId: register.id,
      page: 1,
      pageSize: 25,
    });
    const dbPayment = await prisma.salePayment.findFirst({
      where: { customerOrderId: sale.id },
    });
    const dbMovement = await prisma.cashDrawerMovement.findFirst({
      where: { shiftId: shift.id },
    });

    expect(listedSales.items[0]?.currencyCode).toBe("USD");
    expect(Number(listedSales.items[0]?.currencyRateKgsPerUnit ?? 0)).toBe(89.5);
    expect(listedSales.items[0]?.payments[0]?.currencyCode).toBe("USD");
    expect(listedShifts.items[0]?.currencyCode).toBe("USD");
    expect(dbPayment?.currencyCode).toBe("USD");
    expect(dbMovement?.currencyCode).toBe("USD");
  });

  it("adds the same product line by increasing quantity instead of duplicate error", async () => {
    const { org, store, product, cashierUser, adminUser } = await seedBase({ plan: "BUSINESS" });

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
      reason: "seed-duplicate-merge",
      idempotencyKey: "pos-seed-duplicate-merge-1",
      requestId: "pos-seed-duplicate-merge-1",
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
      idempotencyKey: "pos-open-duplicate-merge-1",
    });

    const sale = await caller.pos.sales.createDraft({ registerId: register.id });
    await caller.pos.sales.addLine({ saleId: sale.id, productId: product.id, qty: 1 });
    await caller.pos.sales.addLine({ saleId: sale.id, productId: product.id, qty: 2 });

    const fetched = await caller.pos.sales.get({ saleId: sale.id });
    expect(fetched).toBeTruthy();
    expect(fetched?.lines).toHaveLength(1);
    expect(fetched?.lines[0]?.qty).toBe(3);
    expect(fetched?.totalKgs).toBe(300);
  });

  it("updates POS sale line unit price without changing catalog price", async () => {
    const { org, store, product, cashierUser } = await seedBase({ plan: "BUSINESS" });

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 100 },
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
      idempotencyKey: "pos-open-edit-line-price-1",
    });

    const sale = await caller.pos.sales.createDraft({ registerId: register.id });
    const line = await caller.pos.sales.addLine({ saleId: sale.id, productId: product.id, qty: 2 });

    await caller.pos.sales.updateLine({ lineId: line.id, unitPriceKgs: 125 });

    const fetched = await caller.pos.sales.get({ saleId: sale.id });
    expect(fetched?.lines[0]).toMatchObject({
      qty: 2,
      unitPriceKgs: 125,
      lineTotalKgs: 250,
    });
    expect(fetched?.subtotalKgs).toBe(250);
    expect(fetched?.totalKgs).toBe(250);

    const productAfterEdit = await prisma.product.findUnique({
      where: { id: product.id },
      select: { basePriceKgs: true },
    });
    expect(Number(productAfterEdit?.basePriceKgs)).toBe(100);
  });

  it("requires marking codes when store marking mode is REQUIRED_ON_SALE", async () => {
    const { org, store, product, cashierUser, adminUser } = await seedBase({ plan: "BUSINESS" });

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

  it("lets cashier complete returns idempotently and restores inventory", async () => {
    const { org, store, product, cashierUser, adminUser } = await seedBase({
      plan: "BUSINESS",
    });

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

    const saleLine = await prisma.customerOrderLine.findFirst({
      where: { customerOrderId: sale.id },
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

    await cashierCaller.pos.returns.complete({
      saleReturnId: returnDraft.id,
      idempotencyKey: "pos-return-complete-1",
      payments: [{ method: "CASH", amountKgs: 100 }],
    });
    await cashierCaller.pos.returns.complete({
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
    const { org, store, product, cashierUser, adminUser } = await seedBase({
      plan: "BUSINESS",
    });
    await prisma.userStoreAccess.createMany({
      data: [{ organizationId: org.id, userId: cashierUser.id, storeId: store.id }],
      skipDuplicates: true,
    });

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

    await expect(
      cashierCaller.pos.shifts.close({
        shiftId: shift.id,
        closingCashCountedKgs: 130,
        idempotencyKey: "pos-shift-close-missing-note-1",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "posShiftDifferenceNoteRequired",
    });

    const close = await cashierCaller.pos.shifts.close({
      shiftId: shift.id,
      closingCashCountedKgs: 130,
      notes: "Cash counted short at close",
      idempotencyKey: "pos-shift-close-1",
    });

    expect(close.expectedCashKgs).toBe(140);
    expect(close.discrepancyKgs).toBe(-10);
  });

  it("blocks cashier from closing shifts outside assigned stores", async () => {
    const { org, store, cashierUser, adminUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.userStoreAccess.createMany({
      data: [{ organizationId: org.id, userId: cashierUser.id, storeId: store.id }],
      skipDuplicates: true,
    });
    const otherStore = await prisma.store.create({
      data: { organizationId: org.id, name: "Other Store", code: "OTHER" },
    });
    const otherRegister = await prisma.posRegister.create({
      data: {
        organizationId: org.id,
        storeId: otherStore.id,
        name: "Other Register",
        code: "OTHER",
      },
    });
    const otherShift = await prisma.registerShift.create({
      data: {
        organizationId: org.id,
        storeId: otherStore.id,
        registerId: otherRegister.id,
        openedById: adminUser.id,
        openingCashKgs: 0,
      },
    });
    const cashierCaller = createTestCaller({
      id: cashierUser.id,
      email: cashierUser.email,
      role: cashierUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });

    await expect(
      cashierCaller.pos.shifts.close({
        shiftId: otherShift.id,
        closingCashCountedKgs: 0,
        idempotencyKey: "pos-shift-close-other-store",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "storeAccessDenied",
    });
  });

  it("blocks connector workflow when kkm feature is locked", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });

    await expect(
      createConnectorPairingCode({
        organizationId: org.id,
        storeId: store.id,
        actorId: adminUser.id,
        requestId: "pair-kkm-locked-1",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "featureLockedKkm",
    });
  });

  it("queues connector fiscal receipt and marks it sent through connector workflow", async () => {
    const { org, store, product, cashierUser, adminUser } = await seedBase({ plan: "ENTERPRISE" });

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
    const { org, store, product, cashierUser, managerUser, adminUser } = await seedBase({
      plan: "BUSINESS",
    });

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
    const adminCaller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
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

    await adminCaller.pos.shifts.close({
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

  it("completes transfer inventory returns while flagging the money refund as manual", async () => {
    const { org, store, product, cashierUser, managerUser, adminUser } = await seedBase({
      plan: "BUSINESS",
    });

    await prisma.store.update({
      where: { id: store.id },
      data: { currencyCode: "USD", currencyRateKgsPerUnit: 89.5 },
    });
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
      select: { status: true, currencyCode: true, currencyRateKgsPerUnit: true },
    });
    expect(returnDoc?.status).toBe("COMPLETED");
    expect(returnDoc?.currencyCode).toBe("USD");
    expect(Number(returnDoc?.currencyRateKgsPerUnit ?? 0)).toBe(89.5);

    const request = await prisma.refundRequest.findUnique({
      where: { saleReturnId: returnDraft.id },
      select: {
        id: true,
        status: true,
        reasonCode: true,
        currencyCode: true,
        currencyRateKgsPerUnit: true,
      },
    });
    expect(request?.id).toBe(completion.refundRequestId);
    expect(request?.status).toBe("OPEN");
    expect(request?.reasonCode).toBe("MKASSA_QR_MANUAL");
    expect(request?.currencyCode).toBe("USD");
    expect(Number(request?.currencyRateKgsPerUnit ?? 0)).toBe(89.5);

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
    expect(refundMovements).toHaveLength(1);
    expect(Number(refundMovements[0]?.qtyDelta ?? 0)).toBe(1);
    expect(refundPayments).toHaveLength(1);
    expect(refundPayments[0]?.method).toBe(PosPaymentMethod.TRANSFER);
    expect(Number(refundPayments[0]?.amountKgs ?? 0)).toBe(100);

    const snapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    expect(snapshot?.onHand).toBe(10);
  });
});
