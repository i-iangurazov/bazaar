import { beforeEach, describe, expect, it } from "vitest";
import { StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import {
  adjustStock,
  bulkSetOnHand,
  postStockReceiving,
  receiveStock,
  recomputeInventorySnapshots,
  transferStock,
} from "@/server/services/inventory";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

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

  it("rejects zero manual adjustments", async () => {
    const { org, store, product, adminUser } = await seedBase();

    await expect(
      adjustStock({
        storeId: store.id,
        productId: product.id,
        qtyDelta: 0,
        reason: "No-op",
        actorId: adminUser.id,
        organizationId: org.id,
        requestId: "req-zero-adjust",
        idempotencyKey: "idem-zero-adjust",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
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
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });

    expect(movements).toHaveLength(1);
    expect(snapshot?.onHand).toBe(4);
  });

  it("posts bulk stock receiving with one movement reference", async () => {
    const { org, store, supplier, product, adminUser, baseUnit } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: adminUser.isOrgOwner,
    });
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
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: secondProduct.id,
        isActive: true,
      },
    });

    const result = await postStockReceiving({
      storeId: store.id,
      referenceNumber: "RCV-1",
      supplierName: "Test Supplier",
      lines: [
        { productId: product.id, quantity: 3, unitCost: 5 },
        { productId: secondProduct.id, quantity: 2, unitCost: 7 },
      ],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-bulk-receive",
      idempotencyKey: "idem-bulk-receive",
    });

    expect(result.lineCount).toBe(2);
    expect(result.totalQuantity).toBe(5);
    expect(result.totalCostKgs).toBe(29);

    const movements = await prisma.stockMovement.findMany({
      where: {
        storeId: store.id,
        referenceType: "STOCK_RECEIVING",
        referenceId: result.receivingId,
        type: StockMovementType.RECEIVE,
      },
      orderBy: { linePosition: "asc" },
    });
    expect(movements).toHaveLength(2);
    expect(movements.map((movement) => movement.productId)).toEqual([product.id, secondProduct.id]);
    expect(movements.map((movement) => movement.linePosition)).toEqual([1, 2]);
    expect(movements.map((movement) => Number(movement.unitCostKgs))).toEqual([5, 7]);
    expect(movements.map((movement) => Number(movement.lineTotalKgs))).toEqual([15, 14]);

    const document = await caller.inventory.productMovementDocument({
      documentKey: `STOCK_RECEIVING:STOCK_RECEIVING:${result.receivingId}`,
    });
    expect(document?.totalAmount).toBe(29);
    expect(document?.lines.map((line) => line.productId)).toEqual([product.id, secondProduct.id]);
    expect(document?.lines.map((line) => line.unitCostKgs)).toEqual([5, 7]);

    await assertSnapshotMatchesLedger(store.id, product.id);
    await assertSnapshotMatchesLedger(store.id, secondProduct.id);
  });

  it("can restrict inventory product search to product name only", async () => {
    const { org, store, supplier, product, adminUser, baseUnit } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: adminUser.isOrgOwner,
    });

    const identifierOnlyProduct = await prisma.product.update({
      where: { id: product.id },
      data: {
        sku: "SKU-ONLY-123",
        name: "Plain Flour",
      },
    });
    await prisma.productBarcode.create({
      data: {
        organizationId: org.id,
        productId: identifierOnlyProduct.id,
        value: "BAR-ONLY-123",
      },
    });
    await prisma.productPack.create({
      data: {
        organizationId: org.id,
        productId: identifierOnlyProduct.id,
        packName: "Box",
        packBarcode: "PACK-ONLY-123",
        multiplierToBase: 6,
      },
    });

    const createSearchableProduct = async (input: {
      sku: string;
      name: string;
      requestId: string;
    }) => {
      const created = await prisma.product.create({
        data: {
          organizationId: org.id,
          supplierId: supplier.id,
          sku: input.sku,
          name: input.name,
          unit: baseUnit.code,
          baseUnitId: baseUnit.id,
        },
      });
      await prisma.storeProduct.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          productId: created.id,
          isActive: true,
        },
      });
      await adjustStock({
        storeId: store.id,
        productId: created.id,
        qtyDelta: 1,
        reason: "Search fixture",
        actorId: adminUser.id,
        organizationId: org.id,
        requestId: input.requestId,
        idempotencyKey: input.requestId,
      });
      return created;
    };

    const skuNameMatch = await createSearchableProduct({
      sku: "OTHER-SKU-ONLY",
      name: "SKU-ONLY-123 Display Name",
      requestId: "req-search-name-sku-token",
    });
    const barcodeNameMatch = await createSearchableProduct({
      sku: "OTHER-BAR-ONLY",
      name: "BAR-ONLY-123 Display Name",
      requestId: "req-search-name-barcode-token",
    });
    const packNameMatch = await createSearchableProduct({
      sku: "OTHER-PACK-ONLY",
      name: "PACK-ONLY-123 Display Name",
      requestId: "req-search-name-pack-token",
    });
    await adjustStock({
      storeId: store.id,
      productId: identifierOnlyProduct.id,
      qtyDelta: 1,
      reason: "Search fixture",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-search-identifier-product",
      idempotencyKey: "req-search-identifier-product",
    });

    const searchIds = async (search: string, searchFields?: ["name"]) =>
      (
        await caller.inventory.searchProducts({
          storeId: store.id,
          search,
          searchFields,
          limit: 20,
        })
      ).map((row) => row.product.id);

    await expect(searchIds("SKU-ONLY-123")).resolves.toEqual(
      expect.arrayContaining([identifierOnlyProduct.id, skuNameMatch.id]),
    );
    await expect(searchIds("BAR-ONLY-123")).resolves.toEqual(
      expect.arrayContaining([identifierOnlyProduct.id, barcodeNameMatch.id]),
    );
    await expect(searchIds("PACK-ONLY-123")).resolves.toEqual(
      expect.arrayContaining([identifierOnlyProduct.id, packNameMatch.id]),
    );

    await expect(searchIds("SKU-ONLY-123", ["name"])).resolves.toEqual([skuNameMatch.id]);
    await expect(searchIds("BAR-ONLY-123", ["name"])).resolves.toEqual([barcodeNameMatch.id]);
    await expect(searchIds("PACK-ONLY-123", ["name"])).resolves.toEqual([packNameMatch.id]);
  });

  it("posts stock receiving to the target store for products without existing store stock", async () => {
    const { org, supplier, product, adminUser, baseUnit } = await seedBase();
    const otherStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Other Store",
        code: "OTH",
      },
    });
    const otherStoreProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "OTH-2",
        name: "Other Store Product",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
      },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: otherStore.id,
        productId: otherStoreProduct.id,
        isActive: true,
      },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: otherStore.id,
        productId: product.id,
        isActive: true,
      },
    });

    const result = await postStockReceiving({
      storeId: otherStore.id,
      lines: [
        { productId: otherStoreProduct.id, quantity: 2, unitCost: 4 },
        { productId: product.id, quantity: 1, unitCost: 3 },
      ],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-bulk-receive-global",
      idempotencyKey: "idem-bulk-receive-global",
    });

    const movements = await prisma.stockMovement.findMany({
      where: { storeId: otherStore.id },
      orderBy: { createdAt: "asc" },
    });
    expect(result.lineCount).toBe(2);
    expect(movements).toHaveLength(2);
    expect(movements.map((movement) => movement.productId)).toEqual([
      otherStoreProduct.id,
      product.id,
    ]);

    const assigned = await prisma.storeProduct.findUnique({
      where: { storeId_productId: { storeId: otherStore.id, productId: product.id } },
    });
    expect(assigned?.isActive).toBe(true);

    const receivedSnapshot = await prisma.inventorySnapshot.findFirst({
      where: { storeId: otherStore.id, productId: product.id, variantKey: "BASE" },
    });
    expect(Number(receivedSnapshot?.onHand ?? 0)).toBe(1);
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
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: adminUser.isOrgOwner,
    });
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
    expect(movements.every((movement) => movement.referenceType === "TRANSFER")).toBe(true);
    expect(movements.every((movement) => movement.linePosition === 1)).toBe(true);

    const transferId = movements[0]?.referenceId;
    expect(transferId).toBeTruthy();
    const journal = await caller.inventory.productMovements({ type: "TRANSFER" });
    const transferRow = journal.items.find((item) => item.documentId === transferId);
    expect(transferRow?.detailUrl).toBe(
      `/inventory/movements/${encodeURIComponent(`TRANSFER:TRANSFER:${transferId}`)}`,
    );
    const document = await caller.inventory.productMovementDocument({
      documentKey: `TRANSFER:TRANSFER:${transferId}`,
    });
    expect(document?.senderName).toBe(store.name);
    expect(document?.recipientName).toBe(storeB.name);
    expect(document?.lines.map((line) => line.movementType).sort()).toEqual([
      "TRANSFER_IN",
      "TRANSFER_OUT",
    ]);
  });

  it("rejects transfer quantity above available stock when negative stock is disabled", async () => {
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
      qtyDelta: 3,
      reason: "Seed",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-transfer-over-seed",
      idempotencyKey: "idem-transfer-over-seed",
    });

    await expect(
      transferStock({
        fromStoreId: store.id,
        toStoreId: storeB.id,
        productId: product.id,
        qty: 4,
        note: "Too much",
        actorId: adminUser.id,
        organizationId: org.id,
        requestId: "req-transfer-over",
        idempotencyKey: "idem-transfer-over",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const snapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    expect(snapshot?.onHand).toBe(3);
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
