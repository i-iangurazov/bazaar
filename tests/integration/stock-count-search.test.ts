import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("stock count product selection", () => {
  beforeEach(resetDatabase);

  const fixture = async () => {
    const f = await seedBase({ plan: "ENTERPRISE" });
    await prisma.product.update({
      where: { id: f.product.id },
      data: {
        name: "Терка малая",
        sku: "COUNT-1",
        barcodes: { create: { organizationId: f.org.id, value: "2900000000002" } },
      },
    });
    const other = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        name: "Терка большая",
        sku: "COUNT-2",
        unit: f.baseUnit.code,
        baseUnitId: f.baseUnit.id,
        storeProducts: { create: { organizationId: f.org.id, storeId: f.store.id } },
        barcodes: { create: { organizationId: f.org.id, value: "COUNT-1" } },
      },
    });
    await prisma.inventorySnapshot.create({
      data: {
        storeId: f.store.id,
        productId: f.product.id,
        variantKey: "BASE",
        onHand: 5,
      },
    });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id, isOrgOwner: true });
    const count = await caller.stockCounts.create({ storeId: f.store.id });
    return { ...f, other, caller, count };
  };

  it("finds names, selects the exact product despite an overlapping barcode, and retains scanner increments", async () => {
    const f = await fixture();
    const quick = await f.caller.products.searchQuick({ q: "терка", storeId: f.store.id });
    expect(new Set(quick.map((p) => p.id))).toEqual(new Set([f.product.id, f.other.id]));
    const lookup = await f.caller.products.lookupScan({ q: "терка", storeId: f.store.id });
    expect(new Set(lookup.items.map((p) => p.id))).toEqual(new Set([f.product.id, f.other.id]));
    const input = {
      stockCountId: f.count.id,
      storeId: f.store.id,
      barcodeOrQuery: "COUNT-1",
      productId: f.product.id,
      idempotencyKey: randomUUID(),
    };
    const selected = await f.caller.stockCounts.addOrUpdateLineByScan(input);
    expect(selected).toMatchObject({ productId: f.product.id, countedQty: 1, expectedOnHand: 5 });
    const retry = await f.caller.stockCounts.addOrUpdateLineByScan(input);
    expect(retry.countedQty).toBe(1);
    const scanned = await f.caller.stockCounts.addOrUpdateLineByScan({
      stockCountId: f.count.id,
      storeId: f.store.id,
      barcodeOrQuery: "2900000000002",
      idempotencyKey: randomUUID(),
    });
    expect(scanned).toMatchObject({ productId: f.product.id, countedQty: 2, expectedOnHand: 5 });
    expect(await prisma.stockCountLine.count({ where: { stockCountId: f.count.id } })).toBe(1);
    const stock = await prisma.inventorySnapshot.findFirst({
      where: {
        storeId: f.store.id,
        productId: f.product.id,
      },
    });
    expect(stock?.onHand).toBe(5);
    expect(await prisma.stockMovement.count({ where: { referenceId: f.count.id } })).toBe(0);
  });

  it("rejects reuse of a selection idempotency key for a different product", async () => {
    const f = await fixture();
    const input = {
      stockCountId: f.count.id,
      storeId: f.store.id,
      barcodeOrQuery: "COUNT-1",
      productId: f.product.id,
      idempotencyKey: randomUUID(),
    };
    await f.caller.stockCounts.addOrUpdateLineByScan(input);
    await expect(
      f.caller.stockCounts.addOrUpdateLineByScan({ ...input, productId: f.other.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.stockCountLine.count({ where: { stockCountId: f.count.id } })).toBe(1);
  });

  it("restricts name and barcode lookup to the chosen authorized store and rejects hidden selections", async () => {
    const f = await fixture();
    const otherStore = await prisma.store.create({
      data: {
        organizationId: f.org.id,
        name: "Other",
        code: "OTHER",
      },
    });
    await prisma.storeProduct.updateMany({
      where: { productId: f.other.id },
      data: { isActive: false },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: f.org.id,
        storeId: otherStore.id,
        productId: f.other.id,
      },
    });
    expect(
      (await f.caller.products.searchQuick({ q: "терка", storeId: f.store.id })).map((p) => p.id),
    ).toEqual([f.product.id]);
    expect(
      (await f.caller.products.lookupScan({ q: "COUNT-2", storeId: f.store.id })).items,
    ).toEqual([]);
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    await expect(
      manager.products.lookupScan({ q: "терка", storeId: otherStore.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const productId of [f.other.id, "missing-product"]) {
      await expect(
        f.caller.stockCounts.addOrUpdateLineByScan({
          stockCountId: f.count.id,
          storeId: f.store.id,
          barcodeOrQuery: "COUNT-1",
          productId,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await prisma.product.update({ where: { id: f.product.id }, data: { isDeleted: true } });
    await expect(
      f.caller.stockCounts.addOrUpdateLineByScan({
        stockCountId: f.count.id,
        storeId: f.store.id,
        barcodeOrQuery: "COUNT-1",
        productId: f.product.id,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.stockCountLine.count({ where: { stockCountId: f.count.id } })).toBe(0);
  });
});
