import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { StockMovementType } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import {
  applyStockMovement,
  receiveStock,
  setStockOnHand,
  recomputeInventorySnapshots,
  transferStock,
  postStockReceiving,
  editStockMovementDocument,
  archiveStockMovementDocument,
  bulkSetOnHand,
} from "@/server/services/inventory";
import {
  createStockCount,
  addOrUpdateLineByScan,
  applyStockCount,
} from "@/server/services/stockCounts";
import {
  createPurchaseOrder,
  approvePurchaseOrder,
  receivePurchaseOrder,
} from "@/server/services/purchaseOrders";
import { runProductImport, rollbackImportBatch } from "@/server/services/imports";
import { addBundleComponent, assembleBundle } from "@/server/services/bundles";
import { getStockoutsReport } from "@/server/services/reports";
import { createStore, updateStorePolicy } from "@/server/services/stores";
import {
  createCustomerOrderDraft,
  updateCustomerOrderLine,
  removeCustomerOrderLine,
  cancelCustomerOrder,
} from "@/server/services/salesOrders";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
describeDb("stock correctness regression", () => {
  beforeEach(resetDatabase);
  const fixture = async () => {
    const base = await seedBase({ plan: "ENTERPRISE" });
    await prisma.store.update({ where: { id: base.store.id }, data: { trackExpiryLots: true } });
    const input = {
      storeId: base.store.id,
      productId: base.product.id,
      organizationId: base.org.id,
      actorId: base.adminUser.id,
      requestId: randomUUID(),
    };
    const snapshot = () =>
      prisma.inventorySnapshot.findUniqueOrThrow({
        where: {
          storeId_productId_variantKey: {
            storeId: base.store.id,
            productId: base.product.id,
            variantKey: "BASE",
          },
        },
      });
    const move = (qtyDelta: number) =>
      prisma.$transaction((tx) =>
        applyStockMovement(tx, {
          ...input,
          qtyDelta,
          type: StockMovementType.SALE,
        }),
      );
    const receive = (qtyReceived: number) =>
      receiveStock({ ...input, qtyReceived, unitCost: 0, idempotencyKey: randomUUID() });
    const check = async (
      expected: number,
      storeId = base.store.id,
      productId = base.product.id,
    ) => {
      const [stock, journal, lots] = await Promise.all([
        prisma.inventorySnapshot.findUniqueOrThrow({
          where: { storeId_productId_variantKey: { storeId, productId, variantKey: "BASE" } },
        }),
        prisma.stockMovement.aggregate({
          where: { storeId, productId, variantId: null },
          _sum: { qtyDelta: true },
        }),
        prisma.stockLot.aggregate({
          where: { storeId, productId, variantId: null },
          _sum: { onHandQty: true },
        }),
      ]);
      expect(stock.onHand).toBe(expected);
      expect(journal._sum.qtyDelta).toBe(expected);
      expect(lots._sum.onHandQty).toBe(expected);
    };
    return { ...base, input, snapshot, move, receive, check };
  };

  it("rejects stale absolute edits, including quantity restored after intervening movements", async () => {
    const f = await fixture();
    await f.receive(12);
    const before = await f.snapshot();
    await f.move(-1);
    await f.move(1);
    await expect(
      setStockOnHand({
        ...f.input,
        expectedOnHand: 12,
        expectedVersion: before.version,
        targetOnHand: 18,
        reason: "Counted",
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await f.check(12);
  });

  it("serializes concurrent absolute edits and replays the same request exactly once", async () => {
    const f = await fixture();
    await f.receive(12);
    const before = await f.snapshot();
    const input = {
      ...f.input,
      expectedOnHand: 12,
      expectedVersion: before.version,
      targetOnHand: 18,
      reason: "Counted",
      idempotencyKey: randomUUID(),
    };
    const results = await Promise.all([setStockOnHand(input), setStockOnHand(input)]);
    expect(results[0].onHand).toBe(18);
    expect(results[1].onHand).toBe(18);
    await expect(setStockOnHand({ ...input, targetOnHand: 19 })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await f.check(18);
    const next = await f.snapshot();
    const competing = await Promise.allSettled(
      [19, 20].map((targetOnHand) =>
        setStockOnHand({
          ...input,
          targetOnHand,
          expectedOnHand: 18,
          expectedVersion: next.version,
          idempotencyKey: randomUUID(),
        }),
      ),
    );
    expect(competing.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(competing.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it.each(["bulk", "import"] as const)(
    "computes %s absolute quantity after a concurrent sale commits",
    async (mode) => {
      const f = await fixture();
      await f.receive(10);
      const before = await f.snapshot();
      let release!: () => void;
      let locked!: () => void;
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const sale = prisma.$transaction(
        async (tx) => {
          await applyStockMovement(tx, { ...f.input, qtyDelta: -3, type: StockMovementType.SALE });
          locked();
          await gate;
        },
        { timeout: 15_000 },
      );
      await ready;
      const setting =
        mode === "bulk"
          ? bulkSetOnHand({
              ...f.input,
              snapshotIds: [before.id],
              targetOnHand: 20,
              reason: "Counted",
              idempotencyKey: randomUUID(),
            })
          : runProductImport({
              ...f.input,
              source: "csv",
              stockBehavior: "set",
              rows: [
                { sku: f.product.sku, name: f.product.name, unit: f.baseUnit.code, stockQty: 20 },
              ],
            });
      let waiting = false;
      try {
        // Prove overlap using PostgreSQL's lock wait, without relying on a sleep
        // to choose the interleaving of the two inventory transactions.
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const [{ count }] = await prisma.$queryRaw<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()
        `;
          if (count > 0) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waiting).toBe(true);
      } finally {
        release();
      }
      await Promise.all([sale, setting]);
      await f.check(20);
    },
  );

  it("keeps fractional pack input when it converts to an integer base quantity", async () => {
    const f = await fixture();
    const pack = await prisma.productPack.create({
      data: {
        organizationId: f.org.id,
        productId: f.product.id,
        packName: "Box",
        multiplierToBase: 10,
      },
    });
    await receiveStock({
      ...f.input,
      qtyReceived: 0.5,
      packId: pack.id,
      unitCost: 0,
      idempotencyKey: randomUUID(),
    });
    await f.check(5);
    await expect(
      receiveStock({
        ...f.input,
        qtyReceived: 0.15,
        packId: pack.id,
        unitCost: 0,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ message: "invalidQuantity" });
    await f.check(5);
  });

  it("keeps zero/negative sales and partial replenishment valid, including an open purchase order", async () => {
    const f = await fixture();
    await f.move(-5);
    await f.receive(2);
    await f.check(-3);
    const po = await createPurchaseOrder({
      ...f.input,
      lines: [{ productId: f.product.id, qtyOrdered: 10, unitCost: 0 }],
      submit: true,
    });
    expect((await f.snapshot()).onOrder).toBe(10);
    await approvePurchaseOrder({ ...f.input, purchaseOrderId: po.id });
    await receivePurchaseOrder({
      ...f.input,
      purchaseOrderId: po.id,
      lines: [{ lineId: po.lines[0].id, qtyReceived: 2 }],
      idempotencyKey: randomUUID(),
    });
    await f.check(-1);
    await recomputeInventorySnapshots(f.input);
    expect((await f.snapshot()).onOrder).toBe(8);
  });

  it("clones physical stock with history/lots but never copies another store's purchase commitments", async () => {
    const f = await fixture();
    await f.receive(5);
    await createPurchaseOrder({
      ...f.input,
      submit: true,
      lines: [{ productId: f.product.id, qtyOrdered: 10 }],
    });
    const cloned = await createStore({
      ...f.input,
      name: "Cloned",
      code: "CLONE",
      allowNegativeStock: false,
      trackExpiryLots: true,
      cloneFromStoreId: f.store.id,
      copyInventory: true,
    });
    const cloneStock = await prisma.inventorySnapshot.findFirstOrThrow({
      where: { storeId: cloned.id, productId: f.product.id },
    });
    expect(cloneStock.onOrder).toBe(0);
    await f.check(5, cloned.id);
    await f.move(-10);
    await updateStorePolicy({ ...f.input, allowNegativeStock: false, trackExpiryLots: true });
    await f.check(-5);
  });

  it("initializes only unallocated lot coverage when expiry tracking is enabled or re-enabled", async () => {
    const f = await fixture();
    await updateStorePolicy({ ...f.input, allowNegativeStock: false, trackExpiryLots: false });
    await f.receive(10);
    expect(await prisma.stockLot.count()).toBe(0);
    await updateStorePolicy({ ...f.input, allowNegativeStock: false, trackExpiryLots: true });
    await f.check(10);
    await updateStorePolicy({ ...f.input, allowNegativeStock: false, trackExpiryLots: false });
    await f.move(-3);
    await updateStorePolicy({ ...f.input, allowNegativeStock: false, trackExpiryLots: true });
    await f.check(7);
    const lots = await prisma.stockLot.findMany({ where: { productId: f.product.id } });
    expect(lots).toEqual([expect.objectContaining({ expiryDate: null, onHandQty: 7 })]);
    expect(await prisma.auditLog.count({ where: { action: "STOCK_LOT_TRACKING_BASELINE" } })).toBe(2);
    expect(await prisma.stockMovement.count()).toBe(2);
  });

  it("updates already-deducted API orders and reverses signed corrections on cancellation", async () => {
    const f = await fixture();
    await f.receive(10);
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 100 } });
    const order = await createCustomerOrderDraft({
      ...f.input,
      lines: [{ productId: f.product.id, qty: 4 }],
    });
    await prisma.customerOrder.update({ where: { id: order.id }, data: { source: "API" } });
    await prisma.$transaction((tx) =>
      applyStockMovement(tx, {
        ...f.input,
        qtyDelta: -4,
        type: StockMovementType.SALE,
        referenceType: "CustomerOrder",
        referenceId: order.id,
      }),
    );
    const line = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id },
    });
    await updateCustomerOrderLine({ ...f.input, lineId: line.id, qty: 2 });
    await f.check(8);
    await updateCustomerOrderLine({ ...f.input, lineId: line.id, qty: 6 });
    await f.check(4);
    await removeCustomerOrderLine({ ...f.input, lineId: line.id });
    await f.check(10);
    await cancelCustomerOrder({ ...f.input, customerOrderId: order.id });
    await f.check(10);
  });

  it("applies a count once without erasing a sale after counting, and serializes scanner increments", async () => {
    const f = await fixture();
    await f.receive(10);
    const count = await createStockCount(f.input);
    await addOrUpdateLineByScan({
      ...f.input,
      stockCountId: count.id,
      barcodeOrQuery: f.product.sku,
      mode: "set",
      countedQty: 12,
      idempotencyKey: randomUUID(),
    });
    await f.move(-3);
    await Promise.all(
      [1, 2].map(() =>
        applyStockCount({ ...f.input, stockCountId: count.id, idempotencyKey: randomUUID() }),
      ),
    );
    await f.check(9);
    expect(
      await prisma.stockMovement.count({
        where: { referenceType: "STOCK_COUNT", referenceId: count.id },
      }),
    ).toBe(1);
    const next = await createStockCount(f.input);
    await Promise.all(
      Array.from({ length: 6 }, () =>
        addOrUpdateLineByScan({
          ...f.input,
          stockCountId: next.id,
          barcodeOrQuery: f.product.sku,
          mode: "increment",
          idempotencyKey: randomUUID(),
        }),
      ),
    );
    expect(
      (await prisma.stockCountLine.findFirstOrThrow({ where: { stockCountId: next.id } }))
        .countedQty,
    ).toBe(6);
  });

  it("rolls back product-import stock using compensating deltas while preserving later sales", async () => {
    const f = await fixture();
    await f.receive(10);
    const imported = await runProductImport({
      ...f.input,
      source: "csv",
      stockBehavior: "set",
      rows: [{ sku: f.product.sku, name: f.product.name, unit: f.baseUnit.code, stockQty: 20 }],
    });
    await f.check(20);
    await f.move(-3);
    await rollbackImportBatch({ ...f.input, batchId: imported.batch.id });
    await f.check(7);
    await expect(
      rollbackImportBatch({ ...f.input, batchId: imported.batch.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("keeps the expiry bucket when a transfer is edited and moved to a different destination", async () => {
    const f = await fixture();
    const expiryDate = new Date("2030-01-01T00:00:00Z");
    await receiveStock({
      ...f.input,
      qtyReceived: 10,
      expiryDate,
      unitCost: 0,
      idempotencyKey: randomUUID(),
    });
    const b = await prisma.store.create({
      data: { organizationId: f.org.id, name: "B", code: "B", trackExpiryLots: true },
    });
    const c = await prisma.store.create({
      data: { organizationId: f.org.id, name: "C", code: "C", trackExpiryLots: true },
    });
    const transfer = await transferStock({
      ...f.input,
      fromStoreId: f.store.id,
      toStoreId: b.id,
      qty: 4,
      expiryDate,
      idempotencyKey: randomUUID(),
    });
    const edit = {
      ...f.input,
      documentType: "TRANSFER" as const,
      referenceType: "TRANSFER",
      referenceId: transfer.transferId,
      lines: [{ productId: f.product.id, quantity: 6 }],
    };
    await editStockMovementDocument({ ...edit, idempotencyKey: randomUUID() });
    await f.check(4);
    await f.check(6, b.id);
    await editStockMovementDocument({
      ...edit,
      destinationStoreId: c.id,
      idempotencyKey: randomUUID(),
    });
    await f.check(4);
    await f.check(0, b.id);
    await f.check(6, c.id);
    const lots = await prisma.stockLot.findMany({ where: { productId: f.product.id } });
    expect(lots).toHaveLength(3);
    for (const lot of lots) expect(lot.expiryDate).toEqual(expiryDate);
  });

  it("refuses to manufacture an opening balance from an incomplete journal", async () => {
    const f = await fixture();
    await f.receive(10);
    await prisma.inventorySnapshot.update({
      where: { id: (await f.snapshot()).id },
      data: { onHand: 11 },
    });
    await expect(recomputeInventorySnapshots(f.input)).rejects.toMatchObject({
      message: "inventoryReconciliationRequired",
    });
    expect((await f.snapshot()).onHand).toBe(11);
  });

  it("reports historical stockouts without shifting them by later receipts", async () => {
    const f = await fixture();
    const now = Date.now();
    for (const [qtyDelta, days] of [
      [10, 3],
      [-10, 2],
      [100, 0],
    ]) {
      await prisma.$transaction((tx) =>
        applyStockMovement(tx, {
          ...f.input,
          qtyDelta,
          type: qtyDelta < 0 ? StockMovementType.SALE : StockMovementType.RECEIVE,
          movementDate: new Date(now - days * 86_400_000),
        }),
      );
    }
    const report = await getStockoutsReport({
      organizationId: f.org.id,
      storeId: f.store.id,
      from: new Date(now - 4 * 86_400_000),
      to: new Date(now - 86_400_000),
    });
    expect(report.items).toEqual([
      expect.objectContaining({ productId: f.product.id, count: 1, onHand: 100 }),
    ]);
  });

  it("enforces roles, store/tenant/variant identity and integer base quantities at the API", async () => {
    const f = await fixture();
    await f.receive(10);
    const stock = await f.snapshot();
    const input = {
      storeId: f.store.id,
      productId: f.product.id,
      expectedOnHand: 10,
      expectedVersion: stock.version,
      targetOnHand: 0,
      reason: "Counted",
      idempotencyKey: randomUUID(),
    };
    for (const user of [f.staffUser, f.cashierUser]) {
      await expect(
        createTestCaller({ ...user, organizationId: f.org.id }).inventory.setOnHand(input),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    await expect(
      manager.inventory.setOnHand({ ...input, targetOnHand: 1.5 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const foreign = await prisma.organization.create({ data: { name: "Unrelated org" } });
    const foreignStore = await prisma.store.create({
      data: { organizationId: foreign.id, name: "Other", code: "OTHER" },
    });
    await expect(
      manager.inventory.setOnHand({ ...input, storeId: foreignStore.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await manager.inventory.setOnHand(input);
    await f.check(0);
    const variant = await prisma.productVariant.create({
      data: { productId: f.product.id, name: "Blue", attributes: {} },
    });
    await manager.inventory.setOnHand({
      ...input,
      variantId: variant.id,
      expectedOnHand: 0,
      expectedVersion: 0,
      targetOnHand: -2,
      idempotencyKey: randomUUID(),
    });
    expect((await f.snapshot()).onHand).toBe(0);
    expect(
      (await prisma.inventorySnapshot.findFirstOrThrow({ where: { variantId: variant.id } }))
        .onHand,
    ).toBe(-2);
  });

  it("rolls back a partial transaction and refuses editing an archived document from an old tab", async () => {
    const f = await fixture();
    await f.receive(10);
    const before = await f.snapshot();
    await expect(
      prisma.$transaction(async (tx) => {
        await applyStockMovement(tx, { ...f.input, qtyDelta: -3, type: StockMovementType.SALE });
        throw new Error("simulated downstream document failure");
      }),
    ).rejects.toThrow("simulated downstream document failure");
    await f.check(10);
    expect((await f.snapshot()).version).toBe(before.version);
    const received = await postStockReceiving({
      ...f.input,
      lines: [{ productId: f.product.id, quantity: 2, unitCost: 0 }],
      idempotencyKey: randomUUID(),
    });
    const document = {
      ...f.input,
      documentType: "STOCK_RECEIVING" as const,
      referenceType: "STOCK_RECEIVING",
      referenceId: received.receivingId,
    };
    await archiveStockMovementDocument({ ...document, idempotencyKey: randomUUID() });
    await f.check(12); // Archiving is historical visibility, not cancellation.
    await expect(
      editStockMovementDocument({
        ...document,
        lines: [{ productId: f.product.id, quantity: 5, unitCostKgs: 0 }],
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ message: "productMovementDocumentAlreadyArchived" });
    await f.check(12);
  });

  it("keeps real document flow and assembly ledger/lots consistent across stores", async () => {
    const f = await fixture();
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 100 } });
    const receiving = await postStockReceiving({
      ...f.input,
      lines: [{ productId: f.product.id, quantity: 20, unitCost: 0 }],
      idempotencyKey: randomUUID(),
    });
    await f.check(20);
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const register = await prisma.posRegister.create({
      data: { organizationId: f.org.id, storeId: f.store.id, name: "Test", code: "TEST" },
    });
    const shift = await caller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: randomUUID(),
    });
    const sale = await caller.pos.sales.createDraft({ registerId: register.id });
    const saleLine = await caller.pos.sales.addLine({
      saleId: sale.id,
      productId: f.product.id,
      qty: 5,
    });
    await f.check(20);
    await caller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: randomUUID(),
      payments: [{ method: "CASH", amountKgs: 500 }],
    });
    await f.check(15);
    const returned = await caller.pos.returns.createDraft({
      shiftId: shift.id,
      originalSaleId: sale.id,
    });
    await caller.pos.returns.addLine({
      saleReturnId: returned.id,
      customerOrderLineId: saleLine.id,
      qty: 2,
    });
    await caller.pos.returns.complete({
      saleReturnId: returned.id,
      idempotencyKey: randomUUID(),
      payments: [{ method: "CASH", amountKgs: 200 }],
    });
    await f.check(17);
    const other = await prisma.store.create({
      data: { organizationId: f.org.id, name: "B", code: "B", trackExpiryLots: true },
    });
    await transferStock({
      ...f.input,
      fromStoreId: f.store.id,
      toStoreId: other.id,
      qty: 4,
      idempotencyKey: randomUUID(),
    });
    await f.check(13);
    await f.check(4, other.id);
    const stock = await f.snapshot();
    await setStockOnHand({
      ...f.input,
      expectedOnHand: 13,
      expectedVersion: stock.version,
      targetOnHand: 14,
      reason: "Counted",
      idempotencyKey: randomUUID(),
    });
    await editStockMovementDocument({
      ...f.input,
      documentType: "STOCK_RECEIVING",
      referenceType: "STOCK_RECEIVING",
      referenceId: receiving.receivingId,
      lines: [{ productId: f.product.id, quantity: 22, unitCostKgs: 0 }],
      idempotencyKey: randomUUID(),
    });
    await f.check(16);
    const bundle = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        sku: "BUNDLE",
        name: "Bundle",
        unit: f.baseUnit.code,
        baseUnitId: f.baseUnit.id,
      },
    });
    await addBundleComponent({
      ...f.input,
      bundleProductId: bundle.id,
      componentProductId: f.product.id,
      qty: 3,
    });
    await assembleBundle({
      ...f.input,
      bundleProductId: bundle.id,
      qty: 2,
      idempotencyKey: randomUUID(),
    });
    await f.check(10);
    await f.check(2, f.store.id, bundle.id);
    const product = await caller.products.list({ storeId: f.store.id });
    expect(product.items.find((item) => item.id === f.product.id)?.onHandQty).toBe(10);
  });
});
