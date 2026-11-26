import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createProduct, importProducts } from "@/server/services/products";
import { adjustStock, bulkSetOnHand } from "@/server/services/inventory";
import { previewStoreStockReset, resetStoreStock } from "@/server/services/inventoryStockReset";
import { toJson } from "@/server/services/json";
import {
  addOrUpdateLineByScan,
  applyStockCount,
  createStockCount,
  removeLine,
  setLineCountedQty,
} from "@/server/services/stockCounts";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const stockCountFixture = async () => {
  const base = await seedBase({ allowNegativeStock: true, plan: "ENTERPRISE" });
  const context = {
    storeId: base.store.id,
    organizationId: base.org.id,
    actorId: base.adminUser.id,
  };
  const operation = () => ({ ...context, requestId: randomUUID(), idempotencyKey: randomUUID() });
  const snapshot = (productId: string) => prisma.inventorySnapshot.findUniqueOrThrow({
    where: { storeId_productId_variantKey: { storeId: base.store.id, productId, variantKey: "BASE" } },
  });
  const scan = (stockCountId: string, barcodeOrQuery: string, countedQty: number) =>
    addOrUpdateLineByScan({ ...operation(), stockCountId, barcodeOrQuery, countedQty, mode: "set" });
  const adjust = (productId: string, qtyDelta: number) =>
    adjustStock({ ...operation(), productId, qtyDelta, reason: "Test adjustment" });
  const apply = (stockCountId: string) => applyStockCount({ ...operation(), stockCountId });
  return { ...base, operation, snapshot, scan, adjust, apply };
};

describeDb("stock counts", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("applies counts idempotently", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase();

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-stock-count-product",
      sku: "SC-100",
      name: "Counted Product",
      baseUnitId: baseUnit.id,
      barcodes: ["BC-COUNT-1"],
    });

    await adjustStock({
      storeId: store.id,
      productId: product.id,
      qtyDelta: 5,
      reason: "Seed stock",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-stock-count-seed",
      idempotencyKey: "idem-stock-count-seed",
    });

    const count = await createStockCount({
      storeId: store.id,
      notes: "Cycle count",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-stock-count-create",
    });

    const line = await addOrUpdateLineByScan({
      stockCountId: count.id,
      storeId: store.id,
      barcodeOrQuery: "BC-COUNT-1",
      mode: "set",
      countedQty: 7,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-stock-count-line",
    });

    expect(line.countedQty).toBe(7);

    await applyStockCount({
      stockCountId: count.id,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-stock-count-apply-1",
      idempotencyKey: "idem-stock-count-apply",
    });

    await applyStockCount({
      stockCountId: count.id,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-stock-count-apply-2",
      idempotencyKey: "idem-stock-count-apply",
    });

    const movements = await prisma.stockMovement.findMany({
      where: {
        storeId: store.id,
        productId: product.id,
        referenceType: "STOCK_COUNT",
        referenceId: count.id,
      },
    });

    expect(movements).toHaveLength(1);

    const snapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });

    expect(snapshot?.onHand).toBe(7);
  });

  it("keeps a historical count pending after bulk zero and applies only after recounting the affected lines", async () => {
    const f = await stockCountFixture();
    const second = await createProduct({ ...f.operation(), sku: "COUNT-2", name: "Second item", baseUnitId: f.baseUnit.id });
    const unaffected = await createProduct({ ...f.operation(), sku: "COUNT-3", name: "Other item", baseUnitId: f.baseUnit.id });
    await f.adjust(f.product.id, -2);
    await f.adjust(second.id, -9);
    await f.adjust(unaffected.id, 5);

    const count = await createStockCount(f.operation());
    const firstLine = await f.scan(count.id, f.product.sku, 0);
    const secondLine = await f.scan(count.id, second.sku, 0);
    await f.scan(count.id, unaffected.sku, 6);
    // Existing lines predate the stock baseline recorded in the first-scan audit.
    for (const line of [firstLine, secondLine]) {
      await prisma.auditLog.updateMany({
        where: { entity: "StockCountLine", entityId: line.id, action: "STOCK_COUNT_LINE_SET" },
        data: { after: toJson(line) },
      });
    }

    await bulkSetOnHand({
      ...f.operation(),
      snapshotIds: [(await f.snapshot(f.product.id)).id, (await f.snapshot(second.id)).id],
      targetOnHand: 0,
      reason: "Reset counted items",
    });
    await setLineCountedQty({ ...f.operation(), lineId: firstLine.id, countedQty: 1 });

    await expect(f.apply(count.id)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "stockCountStaleLines",
      details: { staleLineIds: expect.arrayContaining([firstLine.id, secondLine.id]) },
    });
    expect((await prisma.stockCount.findUniqueOrThrow({ where: { id: count.id } })).status).toBe("IN_PROGRESS");
    expect(await prisma.stockMovement.count({ where: { referenceType: "STOCK_COUNT", referenceId: count.id } })).toBe(0);
    expect((await f.snapshot(f.product.id)).onHand).toBe(0);
    expect((await f.snapshot(second.id)).onHand).toBe(0);
    expect((await f.snapshot(unaffected.id)).onHand).toBe(5);

    await removeLine({ ...f.operation(), lineId: firstLine.id });
    await removeLine({ ...f.operation(), lineId: secondLine.id });
    await f.scan(count.id, f.product.sku, 0);
    await f.scan(count.id, second.sku, 0);
    await expect(f.apply(count.id)).resolves.toMatchObject({ applied: true, adjustments: 1 });
    expect((await f.snapshot(unaffected.id)).onHand).toBe(6);
  });

  it("allows only one of two concurrent counts of the same stock to apply", async () => {
    const f = await stockCountFixture();
    const a = await createStockCount(f.operation());
    const b = await createStockCount(f.operation());
    await f.scan(a.id, f.product.sku, 2);
    await f.scan(b.id, f.product.sku, 2);

    const attempts = await Promise.allSettled([f.apply(a.id), f.apply(b.id)]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.find((attempt) => attempt.status === "rejected")).toMatchObject({
      reason: { code: "CONFLICT", message: "stockCountStaleLines" },
    });
    expect((await f.snapshot(f.product.id)).onHand).toBe(2);
    expect(await prisma.stockMovement.count({ where: { referenceType: "STOCK_COUNT" } })).toBe(1);
  });

  it("rejects a previous discrepancy after another count confirms stock without an adjustment", async () => {
    const f = await stockCountFixture();
    await f.adjust(f.product.id, 5);
    const older = await createStockCount(f.operation());
    const line = await f.scan(older.id, f.product.sku, 3);
    const newer = await createStockCount(f.operation());
    await f.scan(newer.id, f.product.sku, 5);
    await expect(f.apply(newer.id)).resolves.toMatchObject({ adjustments: 0 });

    await expect(f.apply(older.id)).rejects.toMatchObject({
      message: "stockCountStaleLines", details: { staleLineIds: [line.id] },
    });
    expect((await f.snapshot(f.product.id)).onHand).toBe(5);
  });

  it("rejects counts made before an intentional no-op store reset only in that store", async () => {
    const f = await stockCountFixture();
    const otherStore = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Other store", code: "OTHER" },
    });
    const otherCount = await createStockCount({ ...f.operation(), storeId: otherStore.id });
    await addOrUpdateLineByScan({
      ...f.operation(), storeId: otherStore.id, stockCountId: otherCount.id,
      barcodeOrQuery: f.product.sku, countedQty: 1, mode: "set",
    });

    await f.adjust(f.product.id, -2);
    const count = await createStockCount(f.operation());
    const line = await f.scan(count.id, f.product.sku, 0);
    await f.adjust(f.product.id, 2);
    const preview = await previewStoreStockReset(f.operation());
    await expect(resetStoreStock({
      ...f.operation(), previewToken: preview.previewToken, reason: "Deliberately confirmed zero",
    })).resolves.toMatchObject({ updatedCount: 0 });

    await expect(f.apply(count.id)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "stockCountStaleLines",
      details: { staleLineIds: [line.id] },
    });
    expect((await f.snapshot(f.product.id)).onHand).toBe(0);
    await expect(f.apply(otherCount.id)).resolves.toMatchObject({ adjustments: 1 });
  });

  it("preserves additive imports and rejects even a no-op absolute stock import made since counting", async () => {
    const f = await stockCountFixture();
    await f.adjust(f.product.id, 10);
    const importStock = (stockBehavior: "add" | "set", stockQty: number) => importProducts({
      ...f.operation(),
      mode: "update_selected",
      updateMask: ["stockQty"],
      stockBehavior,
      rows: [{ sku: f.product.sku, name: f.product.name, unit: f.baseUnit.code, stockQty }],
    });
    const current = await createStockCount(f.operation());
    await f.scan(current.id, f.product.sku, 12);
    await importStock("add", 5);
    await expect(f.apply(current.id)).resolves.toMatchObject({ adjustments: 1 });
    expect((await f.snapshot(f.product.id)).onHand).toBe(17);

    const outdated = await createStockCount(f.operation());
    const line = await f.scan(outdated.id, f.product.sku, 20);
    await importStock("set", 17);
    await expect(f.apply(outdated.id)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "stockCountStaleLines",
      details: { staleLineIds: [line.id] },
    });
    expect((await f.snapshot(f.product.id)).onHand).toBe(17);
  });
});
