import { beforeEach, describe, expect, it } from "vitest";
import { getSalesReport } from "@/server/services/reporting/sales";
import { businessDateKey } from "@/lib/timezone";
import { prisma } from "@/server/db/prisma";
import {
  adjustStock,
  postStockReceiving,
  postStockWriteOff,
  transferStock,
  setStockOnHand,
} from "@/server/services/inventory";
import {
  approvePurchaseOrder,
  createPurchaseOrder,
  receivePurchaseOrder,
} from "@/server/services/purchaseOrders";
import {
  addOrUpdateLineByScan,
  applyStockCount,
  createStockCount,
} from "@/server/services/stockCounts";
import { resolveBaseQuantity } from "@/server/services/uom";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const dbDescribe = shouldRunDbTests ? describe : describe.skip;
dbDescribe("fractional quantities across stock and checkout", () => {
  beforeEach(resetDatabase);
  async function fixture() {
    const f = await seedBase({ plan: "BUSINESS" });
    await prisma.unit.update({
      where: { id: f.baseUnit.id },
      data: { code: "kg", labelRu: "кг", labelKg: "кг", quantityPrecision: 3 },
    });
    await prisma.product.update({
      where: { id: f.product.id },
      data: { unit: "kg", basePriceKgs: 400 },
    });
    const user = f.adminUser;
    const caller = createTestCaller({
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: f.org.id,
      isOrgOwner: true,
    });
    const context = { organizationId: f.org.id, actorId: user.id, requestId: "fractional-qa" };
    const stock = () =>
      prisma.inventorySnapshot.findUniqueOrThrow({
        where: {
          storeId_productId_variantKey: {
            storeId: f.store.id,
            productId: f.product.id,
            variantKey: "BASE",
          },
        },
      });
    return { ...f, caller, context, stock };
  }
  it("duplicates fractional base and variant stock, costs and minimums exactly once", async () => {
    const f = await fixture();
    const variant = await prisma.productVariant.create({
      data: { productId: f.product.id, name: "Small", attributes: {} },
    });
    await postStockReceiving({
      ...f.context,
      storeId: f.store.id,
      lines: [
        { productId: f.product.id, quantity: 3.5, unitCost: 100 },
        { productId: f.product.id, variantId: variant.id, quantity: 1.5, unitCost: 90 },
      ],
      idempotencyKey: "fraction-duplicate-stock",
    });
    await prisma.reorderPolicy.create({
      data: { storeId: f.store.id, productId: f.product.id, minStock: 0.5, minOrderQty: 0.3, leadTimeDays: 1, reviewPeriodDays: 1, safetyStockDays: 0 },
    });
    const input = {
      productId: f.product.id, storeId: f.store.id, name: "Weighted copy",
      copyInventory: true, copyCost: true, copyPrice: true, copyVariants: true,
      copyImages: false, copySku: false, idempotencyKey: "fraction-duplicate-product",
    };
    const copy = await f.caller.products.duplicate(input);
    expect((await f.caller.products.duplicate(input)).productId).toBe(copy.productId);
    const saved = await prisma.product.findUniqueOrThrow({
      where: { id: copy.productId },
      include: { inventorySnapshots: true, variants: true, productCosts: true, reorderPolicies: true, barcodes: true },
    });
    expect(saved.baseUnitId).toBe(f.baseUnit.id);
    expect(saved.sku).not.toBe(f.product.sku);
    expect(Number(saved.basePriceKgs)).toBe(400);
    expect(saved.barcodes).toHaveLength(0);
    expect(saved.variants).toHaveLength(1);
    expect(saved.inventorySnapshots.find(row => row.variantKey === "BASE")?.onHand).toBe(3.5);
    expect(saved.inventorySnapshots.find(row => row.variantId === saved.variants[0].id)?.onHand).toBe(1.5);
    expect(saved.productCosts.find(row => row.variantKey === "BASE")?.costBasisQty).toBe(3.5);
    expect(Number(saved.productCosts.find(row => row.variantKey === "BASE")?.avgCostKgs)).toBe(100);
    expect(saved.productCosts.find(row => row.variantId === saved.variants[0].id)?.costBasisQty).toBe(1.5);
    expect(saved.reorderPolicies[0]).toMatchObject({ minStock: 0.5, minOrderQty: 0.3 });
    expect((await f.stock()).onHand).toBe(3.5);
    expect(await prisma.product.count({ where: { name: input.name } })).toBe(1);
  });
  it("receives, sells 1.5 kg and returns 0.3 + 1.2 kg once with matching cash, cost and stock", async () => {
    const f = await fixture();
    await postStockReceiving({
      ...f.context,
      storeId: f.store.id,
      lines: [{ productId: f.product.id, quantity: 3.5, unitCost: 100 }],
      idempotencyKey: "fraction-receiving",
    });
    const register = await prisma.posRegister.create({
      data: { organizationId: f.org.id, storeId: f.store.id, name: "Weight", code: "WEIGHT" },
    });
    const shift = await f.caller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "fraction-open-shift",
    });
    const sale = await f.caller.pos.sales.createDraft({ registerId: register.id });
    const line = await f.caller.pos.sales.addLine({
      saleId: sale.id,
      productId: f.product.id,
      qty: 1.5,
    });
    expect(line.qty).toBe(1.5);
    const saleInput = {
      saleId: sale.id,
      idempotencyKey: "fraction-complete-sale",
      payments: [{ method: "CASH" as const, amountKgs: 600 }],
    };
    await f.caller.pos.sales.complete(saleInput);
    await f.caller.pos.sales.complete(saleInput);
    expect((await f.stock()).onHand).toBe(2);
    const savedLine = await prisma.customerOrderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(Number(savedLine.lineTotalKgs)).toBe(600);
    expect(Number(savedLine.lineCostTotalKgs)).toBe(150);
    for (const [qty, amount] of [
      [0.3, 120],
      [1.2, 480],
    ]) {
      const ret = await f.caller.pos.returns.createDraft({
        originalSaleId: sale.id,
        shiftId: shift.id,
      });
      await f.caller.pos.returns.addLine({
        saleReturnId: ret.id,
        customerOrderLineId: line.id,
        qty,
      });
      const input = {
        saleReturnId: ret.id,
        idempotencyKey: `fraction-return-${qty}`,
        payments: [{ method: "CASH" as const, amountKgs: amount }],
      };
      await f.caller.pos.returns.complete(input);
      await f.caller.pos.returns.complete(input);
      expect((await f.stock()).onHand).toBe(qty === 0.3 ? 2.3 : 3.5);
    }
    const excess = await f.caller.pos.returns.createDraft({
      originalSaleId: sale.id,
      shiftId: shift.id,
    });
    await expect(
      f.caller.pos.returns.addLine({
        saleReturnId: excess.id,
        customerOrderLineId: line.id,
        qty: 0.001,
      }),
    ).rejects.toThrow();
    expect(
      Number(
        (await prisma.registerShift.findUniqueOrThrow({ where: { id: shift.id } })).expectedCashKgs,
      ),
    ).toBe(0);
    const date = businessDateKey(new Date());
    const report = await getSalesReport(prisma, {
      organizationId: f.org.id,
      storeIds: [f.store.id],
      dateFrom: date,
      dateTo: date,
    });
    expect(report.totals).toMatchObject({
      quantitySold: 1.5,
      quantityReturned: 1.5,
      grossSalesKgs: 600,
      returnsKgs: 600,
      netSalesKgs: 0,
      costKgs: 0,
      unknownCostLines: 0,
    });
  });
  it("rounds repeated stock changes, transfers, writeoffs and counts without residual stock", async () => {
    const f = await fixture();
    for (const qty of [0.1, 0.2])
      await adjustStock({
        ...f.context,
        storeId: f.store.id,
        productId: f.product.id,
        qtyDelta: qty,
        reason: "weighted stock",
        idempotencyKey: `fraction-adjust-${qty}`,
      });
    expect((await f.stock()).onHand).toBe(0.3);
    await setStockOnHand({
      ...f.context,
      storeId: f.store.id,
      productId: f.product.id,
      targetOnHand: 1.5,
      reason: "weighted count",
      expectedVersion: (await f.stock()).version,
      expectedOnHand: (await f.stock()).onHand,
      idempotencyKey: "fraction-set-stock",
    });
    const other = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Other", code: "OTH" },
    });
    await transferStock({
      ...f.context,
      fromStoreId: f.store.id,
      toStoreId: other.id,
      lines: [{ productId: f.product.id, qty: 0.4 }],
      idempotencyKey: "fraction-transfer",
    });
    expect((await f.stock()).onHand).toBe(1.1);
    await postStockWriteOff({
      ...f.context,
      storeId: f.store.id,
      reason: "Другое",
      lines: [{ productId: f.product.id, qty: 0.1 }],
      idempotencyKey: "fraction-writeoff",
    });
    expect((await f.stock()).onHand).toBe(1);
    const count = await createStockCount({ ...f.context, storeId: f.store.id });
    await addOrUpdateLineByScan({
      ...f.context,
      stockCountId: count.id,
      storeId: f.store.id,
      barcodeOrQuery: "TEST-1",
      mode: "set",
      countedQty: 2.125,
    });
    await applyStockCount({
      ...f.context,
      stockCountId: count.id,
      idempotencyKey: "fraction-count",
    });
    expect((await f.stock()).onHand).toBe(2.125);
  });
  it("partially receives fractional purchase orders without leaving on-order residue", async () => {
    const f = await fixture();
    const po = await createPurchaseOrder({
      ...f.context,
      storeId: f.store.id,
      supplierId: f.supplier.id,
      submit: true,
      lines: [{ productId: f.product.id, qtyOrdered: 1.5, unitCost: 100 }],
    });
    await approvePurchaseOrder({ ...f.context, purchaseOrderId: po.id });
    for (const qty of [0.3, 1.2])
      await receivePurchaseOrder({
        ...f.context,
        purchaseOrderId: po.id,
        lines: [{ lineId: po.lines[0].id, qtyReceived: qty }],
        idempotencyKey: `fraction-po-${qty}`,
      });
    expect((await f.stock()).onHand).toBe(1.5);
    expect((await f.stock()).onOrder).toBe(0);
    const saved = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: po.id },
      include: { lines: true },
    });
    expect(saved.status).toBe("RECEIVED");
    expect(saved.lines[0].qtyReceived).toBe(1.5);
  });
  it("rejects fractional pieces and excess precision atomically and retains exact pack conversion", async () => {
    const f = await fixture();
    await prisma.unit.update({ where: { id: f.baseUnit.id }, data: { quantityPrecision: 0 } });
    await expect(
      postStockReceiving({
        ...f.context,
        storeId: f.store.id,
        lines: [{ productId: f.product.id, quantity: 0.3, unitCost: 100 }],
        idempotencyKey: "fraction-invalid-piece",
      }),
    ).rejects.toThrow();
    expect(await prisma.stockMovement.count()).toBe(0);
    const register = await prisma.posRegister.create({
      data: { organizationId: f.org.id, storeId: f.store.id, name: "Pieces", code: "PCS" },
    });
    await f.caller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "piece-fraction-shift",
    });
    const sale = await f.caller.pos.sales.createDraft({ registerId: register.id });
    await expect(
      f.caller.pos.sales.addLine({ saleId: sale.id, productId: f.product.id, qty: 1.5 }),
    ).rejects.toThrow("wholeQuantityRequired");
    expect(await prisma.customerOrderLine.count({ where: { customerOrderId: sale.id } })).toBe(0);

    await expect(
      adjustStock({
        ...f.context,
        storeId: f.store.id,
        productId: f.product.id,
        qtyDelta: 0.0001,
        reason: "invalid precision",
        idempotencyKey: "fraction-invalid-precision",
      }),
    ).rejects.toThrow();
    const pack = await prisma.productPack.create({
      data: {
        organizationId: f.org.id,
        productId: f.product.id,
        packName: "100 pieces",
        multiplierToBase: 100,
      },
    });
    expect(
      await prisma.$transaction((tx) =>
        resolveBaseQuantity(tx, {
          organizationId: f.org.id,
          productId: f.product.id,
          baseUnitId: f.baseUnit.id,
          packId: pack.id,
          qty: 0.29,
          mode: "receiving",
        }),
      ),
    ).toBe(29);
  });
});
