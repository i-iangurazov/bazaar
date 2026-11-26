import { randomUUID } from "node:crypto";
import { StockMovementType } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { applyStockMovement } from "@/server/services/inventory";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("stock zeroing", () => {
  beforeEach(resetDatabase);

  const fixture = async () => {
    const base = await seedBase({ plan: "ENTERPRISE" });
    const admin = createTestCaller({ ...base.adminUser, organizationId: base.org.id });
    const otherStore = await prisma.store.create({
      data: { organizationId: base.org.id, name: "Other store", code: "OTHER" },
    });
    const addProduct = (sku: string) => prisma.product.create({
      data: { organizationId: base.org.id, baseUnitId: base.baseUnit.id, unit: base.baseUnit.code, name: sku, sku },
    });
    const addVariant = () => prisma.productVariant.create({
      data: { productId: base.product.id, attributes: {} },
    });
    const post = (qtyDelta: number, overrides: {
      productId?: string; storeId?: string; variantId?: string; expiryDate?: Date;
    } = {}) => prisma.$transaction((tx) => applyStockMovement(tx, {
      storeId: base.store.id,
      productId: base.product.id,
      organizationId: base.org.id,
      actorId: base.adminUser.id,
      qtyDelta,
      type: StockMovementType.ADJUSTMENT,
      allowNegativeStock: true,
      ...overrides,
    }));
    const resetInput = (previewToken: string) => ({
      storeId: base.store.id,
      reason: "New opening inventory",
      previewToken,
      idempotencyKey: randomUUID(),
    });
    return { ...base, admin, otherStore, addProduct, addVariant, post, resetInput };
  };

  it("zeros active, archived and inactive inventory and every existing lot with matching ledger entries", async () => {
    const f = await fixture();
    const archived = await f.addProduct("ARCHIVED");
    const variant = await f.addVariant();
    const { snapshot: visible } = await f.post(4);
    await prisma.store.update({ where: { id: f.store.id }, data: { trackExpiryLots: true } });
    const expiryDate = new Date("2030-01-01T00:00:00.000Z");
    await f.post(6, { expiryDate });
    await f.post(8, { productId: archived.id, expiryDate });
    await f.post(-8, { productId: archived.id });
    await f.post(-3, { variantId: variant.id });
    await f.post(11, { storeId: f.otherStore.id });
    await prisma.inventorySnapshot.update({ where: { id: visible.id }, data: { onOrder: 13 } });
    await prisma.product.update({ where: { id: archived.id }, data: { isDeleted: true } });
    await prisma.productVariant.update({ where: { id: variant.id }, data: { isActive: false } });
    await prisma.storeProduct.updateMany({
      where: { storeId: f.store.id, productId: archived.id }, data: { isActive: false, isHidden: true },
    });

    const preview = await f.admin.inventory.previewStoreStockReset({ storeId: f.store.id });
    expect(preview).toMatchObject({ snapshotCount: 3, nonZeroCount: 3, hiddenNonZeroCount: 2 });
    const input = f.resetInput(preview.previewToken);
    const result = await f.admin.inventory.resetStoreStock(input);
    expect(result).toEqual({ storeId: f.store.id, requestedCount: 3, updatedCount: 3 });
    await expect(f.admin.inventory.resetStoreStock(input)).resolves.toEqual(result);
    await expect(f.admin.inventory.resetStoreStock({ ...input, reason: "Different reason" })).rejects.toMatchObject({ code: "CONFLICT" });

    const balances = await prisma.inventorySnapshot.findMany({ where: { storeId: f.store.id } });
    expect(balances.map((snapshot) => snapshot.onHand)).toEqual([0, 0, 0]);
    expect(balances.find((snapshot) => snapshot.id === visible.id)?.onOrder).toBe(13);
    expect(await prisma.inventorySnapshot.findFirst({ where: { storeId: f.otherStore.id } })).toMatchObject({ onHand: 11 });
    expect(await prisma.stockLot.count({ where: { storeId: f.store.id, onHandQty: { not: 0 } } })).toBe(0);
    const journal = await prisma.stockMovement.groupBy({
      by: ["productId", "variantId"], where: { storeId: f.store.id }, _sum: { qtyDelta: true },
    });
    expect(journal).toHaveLength(3);
    expect(journal.map((row) => row._sum.qtyDelta)).toEqual([0, 0, 0]);
    const resetMovements = await prisma.stockMovement.findMany({
      where: { storeId: f.store.id, referenceType: "STORE_STOCK_RESET" },
    });
    expect(resetMovements.filter((movement) => movement.stockLotId)).toHaveLength(4);
    expect(resetMovements.filter((movement) => !movement.stockLotId).map((movement) => movement.qtyDelta)).toEqual([-4]);
    expect(new Set(resetMovements.map((movement) => movement.referenceId)).size).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "INVENTORY_STORE_RESET", entityId: f.store.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "INVENTORY_STORE_RESET_LINE", organizationId: f.org.id } })).toBe(3);
    expect(await prisma.product.findUnique({ where: { id: archived.id } })).toMatchObject({ isDeleted: true });
    expect(await prisma.productVariant.findUnique({ where: { id: variant.id } })).toMatchObject({ isActive: false });
    expect(await prisma.storeProduct.findFirst({ where: { storeId: f.store.id, productId: archived.id } }))
      .toMatchObject({ isActive: false, isHidden: true });
  });

  it("zeros only the selected balances even when an inactive already-zero variant shares the selection", async () => {
    const f = await fixture();
    await prisma.store.update({ where: { id: f.store.id }, data: { trackExpiryLots: true } });
    const active = await f.addVariant();
    const inactive = await f.addVariant();
    const { snapshot: selected } = await f.post(7, { variantId: active.id, expiryDate: new Date("2030-01-01") });
    const { snapshot: empty } = await f.post(0, { variantId: inactive.id });
    const { snapshot: sibling } = await f.post(9);
    const { snapshot: foreign } = await f.post(3, { storeId: f.otherStore.id });
    await prisma.productVariant.update({ where: { id: inactive.id }, data: { isActive: false } });
    const input = {
      storeId: f.store.id, targetOnHand: 0, reason: "Zero selected rows", idempotencyKey: randomUUID(),
    };
    await expect(f.admin.inventory.bulkSetOnHand({ ...input, snapshotIds: [selected.id, foreign.id] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.inventorySnapshot.findUnique({ where: { id: selected.id } })).toMatchObject({ onHand: 7 });
    const correction = { ...input, idempotencyKey: randomUUID(), snapshotIds: [empty.id, selected.id] };
    const result = await f.admin.inventory.bulkSetOnHand(correction);
    expect(result).toEqual({ requestedCount: 2, updatedCount: 1, unchangedCount: 1, targetOnHand: 0 });
    await expect(f.admin.inventory.bulkSetOnHand(correction)).resolves.toEqual(result);
    expect(await prisma.inventorySnapshot.findUnique({ where: { id: sibling.id } })).toMatchObject({ onHand: 9 });
    expect(await prisma.inventorySnapshot.findUnique({ where: { id: foreign.id } })).toMatchObject({ onHand: 3 });
    expect(await prisma.stockLot.findFirst({ where: { storeId: f.store.id, variantId: active.id } })).toMatchObject({ onHandQty: 0 });
    expect(await prisma.productVariant.findUnique({ where: { id: inactive.id } })).toMatchObject({ isActive: false });
    expect(await prisma.auditLog.count({ where: { action: "INVENTORY_BULK_SET_ON_HAND", entityId: empty.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "INVENTORY_STORE_RESET", entityId: f.store.id } })).toBe(0);
  });

  it("requires store access and a current preview even if stock returns to its original quantity", async () => {
    const f = await fixture();
    await f.post(8);
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    const foreignOrganization = await prisma.organization.create({ data: { name: "Other organization" } });
    const foreignStore = await prisma.store.create({
      data: { organizationId: foreignOrganization.id, name: "Foreign store", code: "FOREIGN" },
    });
    const preview = await f.admin.inventory.previewStoreStockReset({ storeId: f.store.id });
    const input = f.resetInput(preview.previewToken);
    await expect(manager.inventory.previewStoreStockReset({ storeId: f.store.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(manager.inventory.resetStoreStock(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.admin.inventory.previewStoreStockReset({ storeId: foreignStore.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.admin.inventory.resetStoreStock({ ...input, storeId: foreignStore.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.admin.inventory.resetStoreStock({ ...input, storeId: f.otherStore.id, idempotencyKey: randomUUID() }))
      .rejects.toMatchObject({ code: "CONFLICT", message: "inventoryStoreResetPreviewStale" });

    await f.post(-2);
    await f.post(2);
    await expect(f.admin.inventory.resetStoreStock(input))
      .rejects.toMatchObject({ code: "CONFLICT", message: "inventoryStoreResetPreviewStale" });
    expect(await prisma.inventorySnapshot.findFirst({ where: { storeId: f.store.id } })).toMatchObject({ onHand: 8 });
    expect(await prisma.auditLog.count({ where: { action: "INVENTORY_STORE_RESET" } })).toBe(0);
  });

  it("allows an empty store reset but rejects another command with the already-used preview", async () => {
    const f = await fixture();
    const preview = await f.admin.inventory.previewStoreStockReset({ storeId: f.store.id });
    expect(preview).toMatchObject({ snapshotCount: 0, nonZeroCount: 0 });
    const input = f.resetInput(preview.previewToken);
    await expect(f.admin.inventory.resetStoreStock(input)).resolves.toMatchObject({ requestedCount: 0, updatedCount: 0 });
    await expect(f.admin.inventory.resetStoreStock({ ...input, idempotencyKey: randomUUID() }))
      .rejects.toMatchObject({ code: "CONFLICT", message: "inventoryStoreResetPreviewStale" });
    expect(await prisma.auditLog.count({ where: { action: "INVENTORY_STORE_RESET", entityId: f.store.id } })).toBe(1);
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it("rejects a reviewed reset when a concurrent receipt commits before it acquires the snapshot lock", async () => {
    const f = await fixture();
    await f.post(3);
    const preview = await f.admin.inventory.previewStoreStockReset({ storeId: f.store.id });
    let markWritten!: () => void;
    let releaseReceipt!: () => void;
    const written = new Promise<void>((resolve) => { markWritten = resolve; });
    const holdReceipt = new Promise<void>((resolve) => { releaseReceipt = resolve; });
    const receipt = prisma.$transaction(async (tx) => {
      await applyStockMovement(tx, {
        storeId: f.store.id,
        productId: f.product.id,
        organizationId: f.org.id,
        qtyDelta: 4,
        type: StockMovementType.RECEIVE,
      });
      markWritten();
      await holdReceipt;
    }, { timeout: 10_000 });
    await written;
    const reset = f.admin.inventory.resetStoreStock(f.resetInput(preview.previewToken));
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const [locks] = await prisma.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND pid <> pg_backend_pid() AND query LIKE '%FOR UPDATE OF s%') AS waiting
        `;
        if (locks.waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
    } finally {
      releaseReceipt();
    }
    await receipt;
    await expect(reset).rejects.toMatchObject({ code: "CONFLICT", message: "inventoryStoreResetPreviewStale" });
    expect(await prisma.inventorySnapshot.findFirst({ where: { storeId: f.store.id } })).toMatchObject({ onHand: 7 });
    expect(await prisma.stockMovement.count({ where: { referenceType: "STORE_STOCK_RESET" } })).toBe(0);
  });

  it("resets a whole store beyond one database write batch", async () => {
    const f = await fixture();
    const variants = Array.from({ length: 1_005 }, (_, index) => ({
      id: `bulk-reset-variant-${index}`, productId: f.product.id, attributes: {}, isActive: index % 2 === 0,
    }));
    const identity = { storeId: f.store.id, productId: f.product.id };
    await prisma.$transaction(async (tx) => {
      await tx.productVariant.createMany({ data: variants });
      await tx.inventorySnapshot.createMany({ data: variants.map(({ id }) => ({
        ...identity, variantId: id, variantKey: id, onHand: 2,
      })) });
      await tx.stockMovement.createMany({ data: variants.map(({ id }) => ({
        ...identity, variantId: id, qtyDelta: 2, type: StockMovementType.RECEIVE,
      })) });
    });
    const preview = await f.admin.inventory.previewStoreStockReset({ storeId: f.store.id });
    expect(preview).toMatchObject({ snapshotCount: 1_005, nonZeroCount: 1_005, hiddenNonZeroCount: 502 });
    await expect(f.admin.inventory.resetStoreStock(f.resetInput(preview.previewToken)))
      .resolves.toMatchObject({ requestedCount: 1_005, updatedCount: 1_005 });
    expect(await prisma.inventorySnapshot.count({ where: { storeId: f.store.id, onHand: { not: 0 } } })).toBe(0);
    expect(await prisma.stockMovement.count({ where: { storeId: f.store.id, referenceType: "STORE_STOCK_RESET" } })).toBe(1_005);
    expect(await prisma.auditLog.count({ where: { action: "INVENTORY_STORE_RESET_LINE" } })).toBe(1_005);
  });
});
