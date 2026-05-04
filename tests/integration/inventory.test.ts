import { beforeEach, describe, expect, it } from "vitest";
import { StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import {
  adjustStock,
  bulkSetOnHand,
  receiveStock,
  recomputeInventorySnapshots,
  transferStock,
} from "@/server/services/inventory";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const assertSnapshotMatchesLedger = async (storeId: string, productId: string) => {
  const total = await prisma.stockMovement.aggregate({
    where: { storeId, productId },
    _sum: { qtyDelta: true },
  });
  const snapshot = await prisma.inventorySnapshot.findUnique({
    where: {
      storeId_productId_variantKey: { storeId, productId, variantKey: "BASE" },
    },
  });
  expect(snapshot?.onHand).toBe(total._sum.qtyDelta ?? 0);
};

describeDb("inventory service", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("maintains inventory ledger correctness", async () => {
    const { org, store, product, adminUser } = await seedBase();

    await adjustStock({
      storeId: store.id,
      productId: product.id,
      qtyDelta: 10,
      reason: "Initial",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-ledger-1",
      idempotencyKey: "idem-ledger-1",
    });

    await adjustStock({
      storeId: store.id,
      productId: product.id,
      qtyDelta: -3,
      reason: "Damage",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-ledger-2",
      idempotencyKey: "idem-ledger-2",
    });

    await assertSnapshotMatchesLedger(store.id, product.id);
  });

  it("blocks negative stock when not allowed", async () => {
    const { org, store, product, adminUser } = await seedBase();

    await expect(
      adjustStock({
        storeId: store.id,
        productId: product.id,
        qtyDelta: -5,
        reason: "Shrink",
        actorId: adminUser.id,
        organizationId: org.id,
        requestId: "req-negative",
        idempotencyKey: "idem-negative",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("records receive movements and updates snapshots", async () => {
    const { org, store, product, adminUser } = await seedBase();

    const result = await receiveStock({
      storeId: store.id,
      productId: product.id,
      qtyReceived: 7,
      note: "PO intake",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-receive",
      idempotencyKey: "idem-receive",
    });

    expect(result.onHand).toBe(7);

    const movement = await prisma.stockMovement.findFirst({
      where: {
        storeId: store.id,
        productId: product.id,
        type: StockMovementType.RECEIVE,
      },
    });

    expect(movement).not.toBeNull();
  });

  it("treats receive idempotency keys as replay safe", async () => {
    const { org, store, product, adminUser } = await seedBase();

    const idempotencyKey = "idem-receive-repeat";

    await receiveStock({
      storeId: store.id,
      productId: product.id,
      qtyReceived: 4,
      note: "First receive",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-receive-1",
      idempotencyKey,
    });

    await receiveStock({
      storeId: store.id,
      productId: product.id,
      qtyReceived: 4,
      note: "Second receive",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-receive-2",
      idempotencyKey,
    });

    const movements = await prisma.stockMovement.findMany({
      where: {
        storeId: store.id,
        productId: product.id,
        type: StockMovementType.RECEIVE,
      },
    });

    const snapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: { storeId: store.id, productId: product.id, variantKey: "BASE" },
      },
    });

    expect(movements).toHaveLength(1);
    expect(snapshot?.onHand).toBe(4);
  });

  it("allows negative stock when store policy permits it", async () => {
    const { org, store, product, adminUser } = await seedBase({ allowNegativeStock: true });

    const result = await adjustStock({
      storeId: store.id,
      productId: product.id,
      qtyDelta: -5,
      reason: "Backorder",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-negative-ok",
      idempotencyKey: "idem-negative-ok",
    });

    expect(result.onHand).toBe(-5);
  });

  it("bulk sets selected inventory rows to the same on-hand quantity", async () => {
    const { org, store, supplier, product, adminUser, baseUnit } = await seedBase();
    const secondProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "TEST-2",
        name: "Second Product",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
      },
    });

    await adjustStock({
      storeId: store.id,
      productId: product.id,
      qtyDelta: 3,
      reason: "Seed first",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-bulk-on-hand-seed-1",
      idempotencyKey: "idem-bulk-on-hand-seed-1",
    });
    await adjustStock({
      storeId: store.id,
      productId: secondProduct.id,
      qtyDelta: 8,
      reason: "Seed second",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-bulk-on-hand-seed-2",
      idempotencyKey: "idem-bulk-on-hand-seed-2",
    });

    const snapshots = await prisma.inventorySnapshot.findMany({
      where: { storeId: store.id, productId: { in: [product.id, secondProduct.id] } },
      orderBy: { productId: "asc" },
    });

    const result = await bulkSetOnHand({
      storeId: store.id,
      snapshotIds: snapshots.map((snapshot) => snapshot.id),
      targetOnHand: 5,
      reason: "Full recount",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-bulk-on-hand",
      idempotencyKey: "idem-bulk-on-hand",
    });

    expect(result.updatedCount).toBe(2);
    expect(result.unchangedCount).toBe(0);

    const updated = await prisma.inventorySnapshot.findMany({
      where: { id: { in: snapshots.map((snapshot) => snapshot.id) } },
    });
    expect(updated.map((snapshot) => snapshot.onHand).sort()).toEqual([5, 5]);

    const movements = await prisma.stockMovement.findMany({
      where: {
        storeId: store.id,
        productId: { in: [product.id, secondProduct.id] },
        type: StockMovementType.ADJUSTMENT,
        note: "Full recount",
      },
      orderBy: { qtyDelta: "asc" },
    });
    expect(movements.map((movement) => movement.qtyDelta)).toEqual([-3, 2]);
  });

  it("creates paired transfer movements and updates both snapshots", async () => {
    const { org, store, product, adminUser } = await seedBase();
    const storeB = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Backup Store",
        code: "BCK",
        allowNegativeStock: false,
      },
    });

    await adjustStock({
      storeId: store.id,
      productId: product.id,
      qtyDelta: 12,
      reason: "Seed",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-transfer-seed",
      idempotencyKey: "idem-transfer-seed",
    });

    await transferStock({
      fromStoreId: store.id,
      toStoreId: storeB.id,
      productId: product.id,
      qty: 5,
      note: "Move stock",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-transfer",
      idempotencyKey: "idem-transfer",
    });

    const [snapshotA, snapshotB] = await Promise.all([
      prisma.inventorySnapshot.findUnique({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
      prisma.inventorySnapshot.findUnique({
        where: {
          storeId_productId_variantKey: {
            storeId: storeB.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
    ]);

    expect(snapshotA?.onHand).toBe(7);
    expect(snapshotB?.onHand).toBe(5);

    const movements = await prisma.stockMovement.findMany({
      where: {
        productId: product.id,
        storeId: { in: [store.id, storeB.id] },
        type: { in: [StockMovementType.TRANSFER_OUT, StockMovementType.TRANSFER_IN] },
      },
    });

    expect(movements).toHaveLength(2);
  });

  it("treats transfer idempotency keys as replay safe", async () => {
    const { org, store, product, adminUser } = await seedBase();
    const storeB = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Backup Store",
        code: "BCK",
        allowNegativeStock: false,
      },
    });

    await adjustStock({
      storeId: store.id,
      productId: product.id,
      qtyDelta: 10,
      reason: "Seed",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-transfer-seed-2",
      idempotencyKey: "idem-transfer-seed-2",
    });

    const idempotencyKey = "idem-transfer-repeat";

    await transferStock({
      fromStoreId: store.id,
      toStoreId: storeB.id,
      productId: product.id,
      qty: 4,
      note: "Move once",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-transfer-1",
      idempotencyKey,
    });

    await transferStock({
      fromStoreId: store.id,
      toStoreId: storeB.id,
      productId: product.id,
      qty: 4,
      note: "Move twice",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-transfer-2",
      idempotencyKey,
    });

    const movements = await prisma.stockMovement.findMany({
      where: {
        productId: product.id,
        storeId: { in: [store.id, storeB.id] },
        type: { in: [StockMovementType.TRANSFER_OUT, StockMovementType.TRANSFER_IN] },
      },
    });

    const [snapshotA, snapshotB] = await Promise.all([
      prisma.inventorySnapshot.findUnique({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
      prisma.inventorySnapshot.findUnique({
        where: {
          storeId_productId_variantKey: {
            storeId: storeB.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
    ]);

    expect(movements).toHaveLength(2);
    expect(snapshotA?.onHand).toBe(6);
    expect(snapshotB?.onHand).toBe(4);
  });

  it("updates average cost on receive", async () => {
    const { org, store, product, adminUser } = await seedBase();

    await receiveStock({
      storeId: store.id,
      productId: product.id,
      qtyReceived: 10,
      unitCost: 5,
      note: "First receipt",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-cost-1",
      idempotencyKey: "idem-cost-1",
    });

    let cost = await prisma.productCost.findUnique({
      where: {
        organizationId_productId_variantKey: {
          organizationId: org.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    expect(cost?.avgCostKgs ? Number(cost.avgCostKgs) : null).toBe(5);

    await receiveStock({
      storeId: store.id,
      productId: product.id,
      qtyReceived: 10,
      unitCost: 7,
      note: "Second receipt",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-cost-2",
      idempotencyKey: "idem-cost-2",
    });

    cost = await prisma.productCost.findUnique({
      where: {
        organizationId_productId_variantKey: {
          organizationId: org.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    expect(cost?.avgCostKgs ? Number(cost.avgCostKgs) : null).toBeCloseTo(6, 5);
  });

  it("tracks expiry lots when enabled", async () => {
    const { org, store, product, adminUser } = await seedBase();
    await prisma.store.update({
      where: { id: store.id },
      data: { trackExpiryLots: true },
    });

    const expiryDate = new Date("2025-01-01T00:00:00.000Z");

    await receiveStock({
      storeId: store.id,
      productId: product.id,
      qtyReceived: 4,
      unitCost: 3,
      expiryDate,
      note: "Expiry receipt",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-expiry-1",
      idempotencyKey: "idem-expiry-1",
    });

    const lot = await prisma.stockLot.findFirst({
      where: {
        storeId: store.id,
        productId: product.id,
        variantKey: "BASE",
        expiryDate,
      },
    });
    expect(lot?.onHandQty).toBe(4);
  });

  it("recomputes snapshots from the ledger without drifting", async () => {
    const { org, store, product, adminUser } = await seedBase();

    await adjustStock({
      storeId: store.id,
      productId: product.id,
      qtyDelta: 8,
      reason: "Seed",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-recompute-1",
      idempotencyKey: "idem-recompute-1",
    });

    await adjustStock({
      storeId: store.id,
      productId: product.id,
      qtyDelta: -2,
      reason: "Shrink",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-recompute-2",
      idempotencyKey: "idem-recompute-2",
    });

    await recomputeInventorySnapshots({
      storeId: store.id,
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-recompute-3",
    });

    await assertSnapshotMatchesLedger(store.id, product.id);
  });
});
