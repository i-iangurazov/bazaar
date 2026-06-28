import { beforeEach, describe, expect, it } from "vitest";
import { StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import {
  adjustStock,
  bulkSetOnHand,
  postStockReceiving,
  postStockWriteOff,
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

const assignProductToStoreForTest = async ({
  organizationId,
  storeId,
  productId,
  assignedById,
}: {
  organizationId: string;
  storeId: string;
  productId: string;
  assignedById?: string;
}) => {
  await prisma.storeProduct.upsert({
    where: { storeId_productId: { storeId, productId } },
    create: {
      organizationId,
      storeId,
      productId,
      assignedById,
      isActive: true,
    },
    update: { isActive: true, assignedById },
  });
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
    expect(document?.organizationName).toBe(org.name);
    expect(document?.totalAmount).toBe(29);
    expect(document?.lines.map((line) => line.productId)).toEqual([product.id, secondProduct.id]);
    expect(document?.lines.map((line) => line.storeId)).toEqual([store.id, store.id]);
    expect(document?.lines.map((line) => line.productDetailUrl)).toEqual([
      `/products/${product.id}?storeId=${encodeURIComponent(store.id)}`,
      `/products/${secondProduct.id}?storeId=${encodeURIComponent(store.id)}`,
    ]);
    expect(document?.lines.map((line) => line.unitCostKgs)).toEqual([5, 7]);

    await assertSnapshotMatchesLedger(store.id, product.id);
    await assertSnapshotMatchesLedger(store.id, secondProduct.id);
  });

  it("posts receiving when stock remains negative after a positive receipt", async () => {
    const { org, store, product, adminUser } = await seedBase();

    await prisma.store.update({
      where: { id: store.id },
      data: { allowNegativeStock: true },
    });
    await adjustStock({
      storeId: store.id,
      productId: product.id,
      qtyDelta: -50,
      reason: "negative stock setup",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-receiving-negative-setup",
      idempotencyKey: "receiving-negative-setup-1",
    });
    await prisma.store.update({
      where: { id: store.id },
      data: { allowNegativeStock: false },
    });

    const result = await postStockReceiving({
      storeId: store.id,
      referenceNumber: "RCV-NEGATIVE-1",
      lines: [{ productId: product.id, quantity: 25, unitCost: 10 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-receiving-negative-post",
      idempotencyKey: "receiving-negative-post-1",
    });

    expect(result.lines[0]?.onHand).toBe(-25);
    const snapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    expect(snapshot?.onHand).toBe(-25);
    await assertSnapshotMatchesLedger(store.id, product.id);
  });

  it("archives a receiving document without changing stock and hides it from active Product Movement", async () => {
    const { org, store, product, adminUser } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: adminUser.isOrgOwner,
    });

    const receiving = await caller.inventory.postStockReceiving({
      storeId: store.id,
      referenceNumber: "RCV-ARCHIVE-1",
      lines: [{ productId: product.id, quantity: 5, unitCost: 12 }],
      idempotencyKey: "receiving-archive-post-1",
    });
    const documentKey = `STOCK_RECEIVING:STOCK_RECEIVING:${receiving.receivingId}`;

    const archived = await caller.inventory.archiveProductMovementDocument({
      documentKey,
      reason: "created by mistake",
      idempotencyKey: "receiving-archive-save-1",
    });

    expect(archived.archived).toBe(true);
    expect(archived.totalQuantity).toBe(5);

    const marker = await prisma.stockMovement.findMany({
      where: {
        referenceType: "STOCK_DOCUMENT_ARCHIVE",
        referenceId: documentKey,
      },
    });
    expect(marker).toHaveLength(1);
    expect(marker[0]?.type).toBe(StockMovementType.ADJUSTMENT);
    expect(marker[0]?.qtyDelta).toBe(0);
    expect(Number(marker[0]?.lineTotalKgs ?? 0)).toBe(0);

    const snapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    expect(snapshot?.onHand).toBe(5);

    const journal = await caller.inventory.productMovements({
      type: "STOCK_RECEIVING",
      search: receiving.receivingId,
      page: 1,
      pageSize: 25,
    });
    expect(journal.items).toHaveLength(0);
    const archivedJournal = await caller.inventory.productMovements({
      type: "STOCK_RECEIVING",
      search: receiving.receivingId,
      archiveMode: "ARCHIVED",
      page: 1,
      pageSize: 25,
    });
    expect(archivedJournal.items).toHaveLength(1);
    await expect(caller.inventory.productMovementDocument({ documentKey })).resolves.toMatchObject({
      id: documentKey,
      totalQuantity: 5,
    });
    await assertSnapshotMatchesLedger(store.id, product.id);
  });

  it("edits a receiving movement document through Product Movement with net stock and amount deltas", async () => {
    const { org, store, supplier, product, adminUser, baseUnit } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: adminUser.isOrgOwner,
    });
    const [addedProduct, removedProduct] = await Promise.all(
      [
        { sku: "RECEIVING-EDIT-ADDED", name: "Receiving Edit Added" },
        { sku: "RECEIVING-EDIT-REMOVED", name: "Receiving Edit Removed" },
      ].map((item) =>
        prisma.product.create({
          data: {
            organizationId: org.id,
            supplierId: supplier.id,
            sku: item.sku,
            name: item.name,
            unit: baseUnit.code,
            baseUnitId: baseUnit.id,
          },
        }),
      ),
    );
    await Promise.all(
      [addedProduct, removedProduct].map((editProduct) =>
        assignProductToStoreForTest({
          organizationId: org.id,
          storeId: store.id,
          productId: editProduct.id,
          assignedById: adminUser.id,
        }),
      ),
    );

    const receiving = await caller.inventory.postStockReceiving({
      storeId: store.id,
      lines: [
        { productId: product.id, quantity: 10, unitCost: 5 },
        { productId: removedProduct.id, quantity: 2, unitCost: 4 },
      ],
      idempotencyKey: "receiving-edit-post-1",
    });
    const documentKey = `STOCK_RECEIVING:STOCK_RECEIVING:${receiving.receivingId}`;

    await caller.inventory.editProductMovementDocument({
      documentKey,
      reason: "test receiving edit",
      lines: [
        { productId: product.id, quantity: 7, unitCostKgs: 6 },
        { productId: addedProduct.id, quantity: 3, unitCostKgs: 7 },
      ],
      idempotencyKey: "receiving-edit-save-1",
    });

    const snapshots = await prisma.inventorySnapshot.findMany({
      where: {
        storeId: store.id,
        productId: { in: [product.id, addedProduct.id, removedProduct.id] },
      },
    });
    const onHand = (productId: string) =>
      snapshots.find((snapshot) => snapshot.productId === productId)?.onHand ?? 0;
    expect(onHand(product.id)).toBe(7);
    expect(onHand(addedProduct.id)).toBe(3);
    expect(onHand(removedProduct.id)).toBe(0);

    const movements = await prisma.stockMovement.findMany({
      where: { referenceType: "STOCK_RECEIVING", referenceId: receiving.receivingId },
      orderBy: { createdAt: "asc" },
    });
    expect(movements.map((movement) => movement.qtyDelta).sort((a, b) => a - b)).toEqual([
      -3,
      -2,
      2,
      3,
      10,
    ]);

    const journal = await caller.inventory.productMovements({
      type: "STOCK_RECEIVING",
      search: receiving.receivingId,
      page: 1,
      pageSize: 25,
    });
    expect(journal.items[0]?.totalQuantity).toBe(10);
    expect(journal.items[0]?.positionsCount).toBe(2);
    expect(journal.items[0]?.totalAmount).toBe(63);

    const document = await caller.inventory.productMovementDocument({ documentKey });
    expect(document?.positionsCount).toBe(2);
    expect(document?.totalQuantity).toBe(10);
    expect(document?.totalAmount).toBe(63);
    expect(document?.lines.map((line) => line.productId)).toEqual([
      product.id,
      addedProduct.id,
    ]);
    expect(document?.lines).toHaveLength(2);
    expect(document?.lines.some((line) => line.productId === removedProduct.id)).toBe(false);
  });

  it("shows effective receiving document lines after editing five lines down to three", async () => {
    const { org, store, supplier, product, adminUser, baseUnit } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: adminUser.isOrgOwner,
    });
    const extraProducts = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        prisma.product.create({
          data: {
            organizationId: org.id,
            supplierId: supplier.id,
            sku: `RECEIVING-5-TO-3-${index + 2}`,
            name: `Receiving 5 to 3 Product ${index + 2}`,
            unit: baseUnit.code,
            baseUnitId: baseUnit.id,
          },
        }),
      ),
    );
    await Promise.all(
      extraProducts.map((editProduct) =>
        assignProductToStoreForTest({
          organizationId: org.id,
          storeId: store.id,
          productId: editProduct.id,
          assignedById: adminUser.id,
        }),
      ),
    );

    const originalProducts = [product, ...extraProducts];
    const receiving = await caller.inventory.postStockReceiving({
      storeId: store.id,
      lines: originalProducts.map((lineProduct, index) => ({
        productId: lineProduct.id,
        quantity: index + 1,
        unitCost: 2,
      })),
      idempotencyKey: "receiving-five-to-three-post-1",
    });
    const documentKey = `STOCK_RECEIVING:STOCK_RECEIVING:${receiving.receivingId}`;

    const initialDocument = await caller.inventory.productMovementDocument({ documentKey });
    expect(initialDocument?.lines).toHaveLength(5);

    await caller.inventory.editProductMovementDocument({
      documentKey,
      reason: "remove two receiving lines",
      lines: originalProducts.slice(0, 3).map((lineProduct, index) => ({
        productId: lineProduct.id,
        quantity: index + 1,
        unitCostKgs: 2,
      })),
      idempotencyKey: "receiving-five-to-three-save-1",
    });

    const editableDocument = await caller.inventory.editableProductMovementDocument({ documentKey });
    expect(editableDocument.lines.map((line) => line.productId)).toEqual(
      originalProducts.slice(0, 3).map((lineProduct) => lineProduct.id),
    );

    const detailDocument = await caller.inventory.productMovementDocument({ documentKey });
    expect(detailDocument?.positionsCount).toBe(3);
    expect(detailDocument?.totalQuantity).toBe(6);
    expect(detailDocument?.totalAmount).toBe(12);
    expect(detailDocument?.lines.map((line) => line.productId)).toEqual(
      originalProducts.slice(0, 3).map((lineProduct) => lineProduct.id),
    );
    expect(detailDocument?.lines).toHaveLength(3);
    expect(
      detailDocument?.lines.some((line) =>
        originalProducts.slice(3).some((removedProduct) => removedProduct.id === line.productId),
      ),
    ).toBe(false);

    const journal = await caller.inventory.productMovements({
      type: "STOCK_RECEIVING",
      search: receiving.receivingId,
      page: 1,
      pageSize: 25,
    });
    expect(journal.items[0]?.positionsCount).toBe(3);
    expect(journal.items[0]?.totalQuantity).toBe(6);
    expect(journal.items[0]?.totalAmount).toBe(12);
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
    await assignProductToStoreForTest({
      organizationId: org.id,
      storeId: storeB.id,
      productId: product.id,
      assignedById: adminUser.id,
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
    expect(document?.organizationName).toBe(org.name);
    expect(document?.senderName).toBe(store.name);
    expect(document?.recipientName).toBe(storeB.name);
    expect(document?.sourceStoreId).toBe(store.id);
    expect(document?.destinationStoreId).toBe(storeB.id);
    expect(document?.lines.map((line) => line.movementType)).toEqual(["TRANSFER_OUT"]);
    expect(document?.lines.map((line) => line.productDetailUrl)).toEqual([
      `/products/${product.id}?storeId=${encodeURIComponent(store.id)}`,
    ]);
  });

  it("edits a transfer movement document with product replacement and store-safe stock deltas", async () => {
    const { org, store, product, supplier, adminUser, baseUnit } = await seedBase();
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
    const storeC = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Recipient Store",
        code: "RCP",
        allowNegativeStock: false,
      },
    });
    const [addedProduct, removedProduct] = await Promise.all(
      [
        { sku: "TRANSFER-EDIT-ADDED", name: "Transfer Edit Added" },
        { sku: "TRANSFER-EDIT-REMOVED", name: "Transfer Edit Removed" },
      ].map((item) =>
        prisma.product.create({
          data: {
            organizationId: org.id,
            supplierId: supplier.id,
            sku: item.sku,
            name: item.name,
            unit: baseUnit.code,
            baseUnitId: baseUnit.id,
          },
        }),
      ),
    );
    await Promise.all(
      [store.id, storeB.id, storeC.id].flatMap((storeId) => [
        assignProductToStoreForTest({
          organizationId: org.id,
          storeId,
          productId: product.id,
          assignedById: adminUser.id,
        }),
        assignProductToStoreForTest({
          organizationId: org.id,
          storeId,
          productId: addedProduct.id,
          assignedById: adminUser.id,
        }),
        assignProductToStoreForTest({
          organizationId: org.id,
          storeId,
          productId: removedProduct.id,
          assignedById: adminUser.id,
        }),
      ]),
    );

    await adjustStock({
      storeId: store.id,
      productId: product.id,
      qtyDelta: 12,
      reason: "Transfer edit seed original",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-transfer-edit-seed-original",
      idempotencyKey: "idem-transfer-edit-seed-original",
    });
    await adjustStock({
      storeId: store.id,
      productId: addedProduct.id,
      qtyDelta: 10,
      reason: "Transfer edit seed added",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-transfer-edit-seed-added",
      idempotencyKey: "idem-transfer-edit-seed-added",
    });
    await adjustStock({
      storeId: store.id,
      productId: removedProduct.id,
      qtyDelta: 6,
      reason: "Transfer edit seed removed",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-transfer-edit-seed-removed",
      idempotencyKey: "idem-transfer-edit-seed-removed",
    });

    const transfer = await transferStock({
      fromStoreId: store.id,
      toStoreId: storeB.id,
      lines: [
        { productId: product.id, qty: 5 },
        { productId: removedProduct.id, qty: 2 },
      ],
      note: "Move stock",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-transfer-edit",
      idempotencyKey: "idem-transfer-edit",
    });
    const documentKey = `TRANSFER:TRANSFER:${transfer.transferId}`;

    await caller.inventory.editProductMovementDocument({
      documentKey,
      reason: "test transfer edit",
      destinationStoreId: storeC.id,
      lines: [
        { productId: product.id, quantity: 4, unitCostKgs: 0 },
        { productId: addedProduct.id, quantity: 3, unitCostKgs: 0 },
      ],
      idempotencyKey: "transfer-edit-save-1",
    });

    const snapshots = await prisma.inventorySnapshot.findMany({
      where: {
        storeId: { in: [store.id, storeB.id, storeC.id] },
        productId: { in: [product.id, addedProduct.id, removedProduct.id] },
      },
    });
    const onHand = (storeId: string, productId: string) =>
      snapshots.find((snapshot) => snapshot.storeId === storeId && snapshot.productId === productId)
        ?.onHand ?? 0;

    expect(onHand(store.id, product.id)).toBe(8);
    expect(onHand(storeB.id, product.id)).toBe(0);
    expect(onHand(storeC.id, product.id)).toBe(4);
    expect(onHand(store.id, addedProduct.id)).toBe(7);
    expect(onHand(storeB.id, addedProduct.id)).toBe(0);
    expect(onHand(storeC.id, addedProduct.id)).toBe(3);
    expect(onHand(store.id, removedProduct.id)).toBe(6);
    expect(onHand(storeB.id, removedProduct.id)).toBe(0);
    expect(onHand(storeC.id, removedProduct.id)).toBe(0);

    const journal = await caller.inventory.productMovements({
      type: "TRANSFER",
      search: transfer.transferId,
      page: 1,
      pageSize: 25,
    });
    expect(journal.items[0]?.totalQuantity).toBe(7);
    expect(journal.items[0]?.positionsCount).toBe(2);
    expect(journal.items[0]?.recipientName).toBe(storeC.name);

    const document = await caller.inventory.productMovementDocument({ documentKey });
    expect(document?.positionsCount).toBe(2);
    expect(document?.totalQuantity).toBe(7);
    expect(document?.sourceStoreId).toBe(store.id);
    expect(document?.destinationStoreId).toBe(storeC.id);
    expect(document?.lines.map((line) => line.productId)).toEqual([
      product.id,
      addedProduct.id,
    ]);
    expect(document?.lines.map((line) => line.movementType)).toEqual([
      "TRANSFER_OUT",
      "TRANSFER_OUT",
    ]);
    expect(document?.lines.some((line) => line.productId === removedProduct.id)).toBe(false);
    await expect(
      caller.inventory.editProductMovementDocument({
        documentKey,
        reason: "repeat transfer edit after destination correction",
        destinationStoreId: storeC.id,
        lines: [
          { productId: product.id, quantity: 4, unitCostKgs: 0 },
          { productId: addedProduct.id, quantity: 3, unitCostKgs: 0 },
        ],
        idempotencyKey: "transfer-edit-save-2",
      }),
    ).resolves.toMatchObject({ lineCount: 2, totalQuantity: 7 });

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "INVENTORY_DOCUMENT_EDIT",
        entity: "StockMovementDocument",
        entityId: `TRANSFER:${transfer.transferId}`,
      },
    });
    expect(audit).not.toBeNull();
  });

  it("posts write-off movements as an ordered document for one store", async () => {
    const { org, store, product, supplier, baseUnit, adminUser } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: adminUser.isOrgOwner,
    });
    const otherStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Other Store",
        code: "OTH",
        allowNegativeStock: false,
      },
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
    await Promise.all([
      assignProductToStoreForTest({
        organizationId: org.id,
        storeId: store.id,
        productId: secondProduct.id,
        assignedById: adminUser.id,
      }),
      assignProductToStoreForTest({
        organizationId: org.id,
        storeId: otherStore.id,
        productId: product.id,
        assignedById: adminUser.id,
      }),
    ]);

    await adjustStock({
      storeId: store.id,
      productId: product.id,
      qtyDelta: 10,
      reason: "Seed first",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-write-off-seed-1",
      idempotencyKey: "idem-write-off-seed-1",
    });
    await adjustStock({
      storeId: store.id,
      productId: secondProduct.id,
      qtyDelta: 8,
      reason: "Seed second",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-write-off-seed-2",
      idempotencyKey: "idem-write-off-seed-2",
    });
    await adjustStock({
      storeId: otherStore.id,
      productId: product.id,
      qtyDelta: 4,
      reason: "Other store seed",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-write-off-other-seed",
      idempotencyKey: "idem-write-off-other-seed",
    });

    const result = await postStockWriteOff({
      storeId: store.id,
      date: new Date("2026-06-10T10:00:00.000Z"),
      reason: "Порча",
      comment: "Broken packaging",
      lines: [
        { productId: secondProduct.id, qty: 3 },
        { productId: product.id, qty: 4 },
      ],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-write-off",
      idempotencyKey: "idem-write-off",
    });

    expect(result.lineCount).toBe(2);
    expect(result.totalQuantity).toBe(7);
    expect(result.reason).toBe("Порча");
    expect(result.comment).toBe("Broken packaging");

    const [snapshotA, snapshotB, otherSnapshot] = await Promise.all([
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
            storeId: store.id,
            productId: secondProduct.id,
            variantKey: "BASE",
          },
        },
      }),
      prisma.inventorySnapshot.findUnique({
        where: {
          storeId_productId_variantKey: {
            storeId: otherStore.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
    ]);
    expect(snapshotA?.onHand).toBe(6);
    expect(snapshotB?.onHand).toBe(5);
    expect(otherSnapshot?.onHand).toBe(4);

    const movements = await prisma.stockMovement.findMany({
      where: { referenceType: "WRITE_OFF", referenceId: result.writeOffId },
      orderBy: { linePosition: "asc" },
    });
    expect(movements.map((movement) => movement.type)).toEqual([
      StockMovementType.WRITE_OFF,
      StockMovementType.WRITE_OFF,
    ]);
    expect(movements.map((movement) => movement.productId)).toEqual([secondProduct.id, product.id]);
    expect(movements.map((movement) => movement.qtyDelta)).toEqual([-3, -4]);
    expect(movements.every((movement) => movement.note?.startsWith("writeOff:"))).toBe(true);

    const journal = await caller.inventory.productMovements({ type: "WRITE_OFF" });
    const writeOffRow = journal.items.find((item) => item.documentId === result.writeOffId);
    expect(writeOffRow?.reason).toBe("Порча");
    expect(writeOffRow?.comment).toBe("Broken packaging");
    expect(writeOffRow?.detailUrl).toBe(
      `/inventory/movements/${encodeURIComponent(`WRITE_OFF:WRITE_OFF:${result.writeOffId}`)}`,
    );

    const document = await caller.inventory.productMovementDocument({
      documentKey: `WRITE_OFF:WRITE_OFF:${result.writeOffId}`,
    });
    expect(document?.reason).toBe("Порча");
    expect(document?.comment).toBe("Broken packaging");
    expect(document?.storeName).toBe(store.name);
    expect(document?.authorName).toBe(adminUser.name);
    expect(document?.totalQuantity).toBe(7);
    expect(document?.lines.map((line) => line.productId)).toEqual([secondProduct.id, product.id]);
  });

  it("edits a write-off movement document with line removal and quantity deltas", async () => {
    const { org, store, product, supplier, baseUnit, adminUser } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: adminUser.isOrgOwner,
    });
    const [secondProduct, addedProduct] = await Promise.all(
      [
        { sku: "WRITE-OFF-EDIT-2", name: "Write-off Edit Product 2" },
        { sku: "WRITE-OFF-EDIT-ADDED", name: "Write-off Edit Added" },
      ].map((item) =>
        prisma.product.create({
          data: {
            organizationId: org.id,
            supplierId: supplier.id,
            sku: item.sku,
            name: item.name,
            unit: baseUnit.code,
            baseUnitId: baseUnit.id,
          },
        }),
      ),
    );
    await Promise.all(
      [secondProduct, addedProduct].map((editProduct) =>
        assignProductToStoreForTest({
          organizationId: org.id,
          storeId: store.id,
          productId: editProduct.id,
          assignedById: adminUser.id,
        }),
      ),
    );

    await adjustStock({
      storeId: store.id,
      productId: product.id,
      qtyDelta: 10,
      reason: "Write-off edit seed first",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-write-off-edit-seed-1",
      idempotencyKey: "idem-write-off-edit-seed-1",
    });
    await adjustStock({
      storeId: store.id,
      productId: secondProduct.id,
      qtyDelta: 8,
      reason: "Write-off edit seed second",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-write-off-edit-seed-2",
      idempotencyKey: "idem-write-off-edit-seed-2",
    });
    await adjustStock({
      storeId: store.id,
      productId: addedProduct.id,
      qtyDelta: 5,
      reason: "Write-off edit seed added",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-write-off-edit-seed-added",
      idempotencyKey: "idem-write-off-edit-seed-added",
    });

    const writeOff = await postStockWriteOff({
      storeId: store.id,
      reason: "Порча",
      comment: "Initial write-off",
      lines: [
        { productId: product.id, qty: 4 },
        { productId: secondProduct.id, qty: 3 },
      ],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-write-off-edit",
      idempotencyKey: "idem-write-off-edit",
    });
    const documentKey = `WRITE_OFF:WRITE_OFF:${writeOff.writeOffId}`;

    await caller.inventory.editProductMovementDocument({
      documentKey,
      reason: "test write-off edit",
      lines: [
        { productId: secondProduct.id, quantity: 2, unitCostKgs: 0 },
        { productId: addedProduct.id, quantity: 1, unitCostKgs: 0 },
      ],
      idempotencyKey: "write-off-edit-save-1",
    });

    const [firstSnapshot, secondSnapshot, addedSnapshot] = await Promise.all([
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
            storeId: store.id,
            productId: secondProduct.id,
            variantKey: "BASE",
          },
        },
      }),
      prisma.inventorySnapshot.findUnique({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: addedProduct.id,
            variantKey: "BASE",
          },
        },
      }),
    ]);
    expect(firstSnapshot?.onHand).toBe(10);
    expect(secondSnapshot?.onHand).toBe(6);
    expect(addedSnapshot?.onHand).toBe(4);

    const journal = await caller.inventory.productMovements({
      type: "WRITE_OFF",
      search: writeOff.writeOffId,
      page: 1,
      pageSize: 25,
    });
    expect(journal.items[0]?.totalQuantity).toBe(3);
    expect(journal.items[0]?.positionsCount).toBe(2);

    const document = await caller.inventory.productMovementDocument({ documentKey });
    expect(document?.positionsCount).toBe(2);
    expect(document?.totalQuantity).toBe(3);
    expect(document?.lines.map((line) => line.productId)).toEqual([
      secondProduct.id,
      addedProduct.id,
    ]);
    expect(document?.lines).toHaveLength(2);
    expect(document?.lines.some((line) => line.productId === product.id)).toBe(false);
  });

  it("rejects write-off quantity above stock when negative stock is disabled", async () => {
    const { org, store, product, adminUser } = await seedBase();

    await adjustStock({
      storeId: store.id,
      productId: product.id,
      qtyDelta: 2,
      reason: "Seed",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-write-off-over-seed",
      idempotencyKey: "idem-write-off-over-seed",
    });

    await expect(
      postStockWriteOff({
        storeId: store.id,
        reason: "Потеря",
        lines: [{ productId: product.id, qty: 3 }],
        actorId: adminUser.id,
        organizationId: org.id,
        requestId: "req-write-off-over",
        idempotencyKey: "idem-write-off-over",
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
    expect(snapshot?.onHand).toBe(2);
  });

  it("assigns the product to the destination store when transferring stock", async () => {
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
      requestId: "req-transfer-unassigned-seed",
      idempotencyKey: "idem-transfer-unassigned-seed",
    });

    const result = await transferStock({
      fromStoreId: store.id,
      toStoreId: storeB.id,
      productId: product.id,
      qty: 5,
      note: "Move stock",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-transfer-unassigned",
      idempotencyKey: "idem-transfer-unassigned",
    });

    expect(result.lines[0]?.inOnHand).toBe(5);
    expect(result.lines[0]?.outOnHand).toBe(7);

    const destinationAssignment = await prisma.storeProduct.findUnique({
      where: {
        storeId_productId: {
          storeId: storeB.id,
          productId: product.id,
        },
      },
    });
    expect(destinationAssignment?.isActive).toBe(true);
    expect(destinationAssignment?.assignedById).toBe(adminUser.id);
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
    await assignProductToStoreForTest({
      organizationId: org.id,
      storeId: storeB.id,
      productId: product.id,
      assignedById: adminUser.id,
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
    await assignProductToStoreForTest({
      organizationId: org.id,
      storeId: storeB.id,
      productId: product.id,
      assignedById: adminUser.id,
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
