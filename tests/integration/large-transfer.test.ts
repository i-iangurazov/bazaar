import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { transferStock } from "@/server/services/inventory";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

(shouldRunDbTests ? describe : describe.skip)("large transfer recovery", () => {
  beforeEach(resetDatabase);

  it("commits a document taking longer than five seconds once, then replays the same receipt", async () => {
    const f = await seedBase({ plan: "ENTERPRISE" });
    const destination = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Warehouse", code: "WH" },
    });
    const ids = Array.from({ length: 24 }, () => randomUUID());
    await prisma.product.createMany({
      data: ids.map((id, index) => ({
        id,
        organizationId: f.org.id,
        name: `Transfer ${index}`,
        sku: `TRANSFER-${index}`,
        unit: f.baseUnit.code,
        baseUnitId: f.baseUnit.id,
      })),
    });
    await prisma.storeProduct.createMany({
      data: ids.map((productId) => ({
        organizationId: f.org.id,
        storeId: f.store.id,
        productId,
        isDirect: true,
      })),
    });
    await prisma.inventorySnapshot.createMany({
      data: ids.map((productId) => ({
        storeId: f.store.id,
        productId,
        onHand: 100,
      })),
    });
    await prisma.stockMovement.createMany({
      data: ids.map((productId) => ({
        storeId: f.store.id,
        productId,
        type: "RECEIVE",
        qtyDelta: 100,
      })),
    });
    // Real PostgreSQL latency reproduces the production failure without mocking transactions.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION test_slow_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."type" = 'TRANSFER_OUT' AND NEW."productId" = '${ids[0]}' THEN
        PERFORM pg_sleep(5.2); END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER test_slow_transfer BEFORE INSERT ON "StockMovement"
      FOR EACH ROW EXECUTE FUNCTION test_slow_transfer()`);
    try {
      const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
      const input = {
        fromStoreId: f.store.id,
        toStoreId: destination.id,
        lines: ids.map((productId, index) => ({ productId, qty: index + 1 })),
        idempotencyKey: randomUUID(),
      };
      const started = Date.now();
      const result = await caller.inventory.transfer(input);
      expect(Date.now() - started).toBeGreaterThan(5_000);
      expect(result.lineCount).toBe(24);
      expect(result.totalQuantity).toBe(300);
      expect(await caller.inventory.transfer(input)).toEqual(result);
      expect(await prisma.stockMovement.count({ where: { referenceId: result.transferId } })).toBe(
        48,
      );
      const snapshots = await prisma.inventorySnapshot.findMany({
        where: { productId: { in: ids } },
      });
      for (const [index, id] of ids.entries()) {
        expect(snapshots.find((s) => s.storeId === f.store.id && s.productId === id)?.onHand).toBe(
          99 - index,
        );
        expect(
          snapshots.find((s) => s.storeId === destination.id && s.productId === id)?.onHand,
        ).toBe(index + 1);
      }
      const document = await caller.inventory.productMovementDocument({
        documentKey: `TRANSFER:TRANSFER:${result.transferId}`,
      });
      expect(document?.positionsCount).toBe(24);
      expect(document?.totalQuantity).toBe(300);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS test_slow_transfer ON "StockMovement"',
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_slow_transfer()");
    }
  }, 30_000);

  it("rolls back all lines when a later line fails, and a retry can safely succeed", async () => {
    const f = await seedBase({ plan: "ENTERPRISE" });
    const destination = await prisma.store.create({
      data: { organizationId: f.org.id, name: "B", code: "B" },
    });
    const other = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        name: "Other",
        sku: "OTHER",
        unit: f.baseUnit.code,
        baseUnitId: f.baseUnit.id,
      },
    });
    await prisma.storeProduct.create({
      data: { organizationId: f.org.id, storeId: f.store.id, productId: other.id },
    });
    const input = {
      fromStoreId: f.store.id,
      toStoreId: destination.id,
      lines: [
        { productId: f.product.id, qty: 2 },
        { productId: other.id, qty: 1 },
      ],
      actorId: f.adminUser.id,
      organizationId: f.org.id,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
    };
    const before = await prisma.inventorySnapshot.findMany({ orderBy: { id: "asc" } });
    // Force a failure after the first product's two stock movements have run.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION test_fail_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."type" = 'TRANSFER_OUT' AND NEW."productId" = '${other.id}' THEN
        RAISE EXCEPTION 'test transfer failure'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER test_fail_transfer BEFORE INSERT ON "StockMovement"
      FOR EACH ROW EXECUTE FUNCTION test_fail_transfer()`);
    try {
      await expect(transferStock(input)).rejects.toThrow();
      expect(await prisma.inventorySnapshot.findMany({ orderBy: { id: "asc" } })).toEqual(before);
      expect(await prisma.stockMovement.count()).toBe(0);
      expect(await prisma.idempotencyKey.count({ where: { key: input.idempotencyKey } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS test_fail_transfer ON "StockMovement"',
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_fail_transfer()");
    }
    const result = await transferStock(input);
    expect(result.lineCount).toBe(2);
    expect(await prisma.stockMovement.count({ where: { referenceId: result.transferId } })).toBe(4);
  });

  it("edits a transfer taking longer than five seconds without losing the transaction", async () => {
    const f = await seedBase({ plan: "ENTERPRISE" });
    const destination = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Edit destination", code: "EDIT-DST" },
    });
    await prisma.inventorySnapshot.create({
      data: { storeId: f.store.id, productId: f.product.id, onHand: 100 },
    });
    await prisma.stockMovement.create({
      data: { storeId: f.store.id, productId: f.product.id, type: "RECEIVE", qtyDelta: 100 },
    });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const transfer = await caller.inventory.transfer({
      fromStoreId: f.store.id,
      toStoreId: destination.id,
      lines: [{ productId: f.product.id, qty: 5 }],
      idempotencyKey: "slow-edit-create",
    });
    // Real PostgreSQL latency reproduces the production five-second edit timeout.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION test_slow_transfer_edit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."type" = 'TRANSFER_OUT' AND NEW."productId" = '${f.product.id}' THEN
        PERFORM pg_sleep(5.2); END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER test_slow_transfer_edit BEFORE INSERT ON "StockMovement"
      FOR EACH ROW EXECUTE FUNCTION test_slow_transfer_edit()`);
    try {
      const documentKey = `TRANSFER:TRANSFER:${transfer.transferId}`;
      const editInput = {
        documentKey,
        reason: "slow edit regression",
        lines: [{ productId: f.product.id, quantity: 7 }],
        idempotencyKey: "slow-edit-save",
      };
      const started = Date.now();
      const edit = await caller.inventory.editProductMovementDocument(editInput);
      expect(Date.now() - started).toBeGreaterThan(5_000);
      expect(edit).toMatchObject({ totalQuantity: 7 });
      const onHand = async (storeId: string) =>
        (await prisma.inventorySnapshot.findUnique({
          where: {
            storeId_productId_variantKey: {
              storeId,
              productId: f.product.id,
              variantKey: "BASE",
            },
          },
          select: { onHand: true },
        }))?.onHand;
      expect(await onHand(f.store.id)).toBe(93);
      expect(await onHand(destination.id)).toBe(7);
      const document = await caller.inventory.productMovementDocument({ documentKey });
      expect(document?.positionsCount).toBe(1);
      expect(document?.totalQuantity).toBe(7);
      const movementCount = await prisma.stockMovement.count({
        where: { referenceId: transfer.transferId },
      });

      // The same idempotency key replays the terminal receipt without new movements.
      const replay = await caller.inventory.editProductMovementDocument(editInput);
      expect(replay).toMatchObject({ totalQuantity: 7 });
      expect(await onHand(f.store.id)).toBe(93);
      expect(await onHand(destination.id)).toBe(7);

      // Even a different key with the same desired document is a stock no-op.
      const newKey = await caller.inventory.editProductMovementDocument({
        ...editInput,
        idempotencyKey: "slow-edit-save-new-key",
      });
      expect(newKey).toMatchObject({ totalQuantity: 7 });
      expect(await onHand(f.store.id)).toBe(93);
      expect(await onHand(destination.id)).toBe(7);
      expect(await prisma.stockMovement.count({
        where: { referenceId: transfer.transferId },
      })).toBe(movementCount);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS test_slow_transfer_edit ON "StockMovement"',
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_slow_transfer_edit()");
    }
  }, 30_000);
});
