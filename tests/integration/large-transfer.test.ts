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
});
