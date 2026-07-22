import { randomUUID } from "node:crypto";
import { OperationRequestStatus, StockMovementType } from "@prisma/client";
import type { Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const callerFor = (user: {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
  isOrgOwner?: boolean;
}) => {
  if (!user.organizationId) {
    throw new Error("Agent 2 reproduction user must belong to an organization");
  }
  return createTestCaller({
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    isOrgOwner: user.isOrgOwner,
  });
};

const seedTwoStoreScope = async () => {
  const base = await seedBase({ plan: "BUSINESS" });
  const storeB = await prisma.store.create({
    data: {
      organizationId: base.org.id,
      name: "Restricted Store B",
      code: `B-${randomUUID().slice(0, 8)}`,
      trackExpiryLots: true,
    },
  });
  const productB = await prisma.product.create({
    data: {
      organizationId: base.org.id,
      sku: `B-${randomUUID().slice(0, 10)}`,
      name: "Restricted Product B",
      unit: base.baseUnit.code,
      baseUnitId: base.baseUnit.id,
      basePriceKgs: 9876,
    },
  });
  await prisma.storeProduct.create({
    data: {
      organizationId: base.org.id,
      storeId: storeB.id,
      productId: productB.id,
      isActive: true,
      assignedById: base.adminUser.id,
    },
  });
  const barcodeB = `29${Date.now().toString().slice(-10)}`;
  await prisma.productBarcode.create({
    data: {
      organizationId: base.org.id,
      productId: productB.id,
      value: barcodeB,
    },
  });
  await prisma.productCost.create({
    data: {
      organizationId: base.org.id,
      productId: productB.id,
      variantKey: "BASE",
      avgCostKgs: 5432,
    },
  });
  const snapshotB = await prisma.inventorySnapshot.create({
    data: {
      storeId: storeB.id,
      productId: productB.id,
      variantKey: "BASE",
      onHand: 5,
    },
  });

  return { ...base, storeB, productB, barcodeB, snapshotB };
};

describeDb("Agent 2 P0 runtime reproductions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("HARD-A2-001 rejects Store B count, lot, and snapshot access without side effects", async () => {
    const { org, storeB, productB, managerUser, snapshotB } = await seedTwoStoreScope();
    const countB = await prisma.stockCount.create({
      data: {
        organizationId: org.id,
        storeId: storeB.id,
        code: `SC-${randomUUID().slice(0, 8)}`,
        status: "IN_PROGRESS",
        createdById: managerUser.id,
      },
    });
    const lineB = await prisma.stockCountLine.create({
      data: {
        stockCountId: countB.id,
        storeId: storeB.id,
        productId: productB.id,
        variantKey: "BASE",
        expectedOnHand: 5,
        countedQty: 7,
        deltaQty: 2,
      },
    });
    const lotB = await prisma.stockLot.create({
      data: {
        organizationId: org.id,
        storeId: storeB.id,
        productId: productB.id,
        variantKey: "BASE",
        expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        onHandQty: 5,
      },
    });
    const caller = callerFor(managerUser);

    await expect(caller.stockCounts.list({ storeId: storeB.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "storeAccessDenied",
    });
    await expect(caller.stockCounts.get({ stockCountId: countB.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "storeAccessDenied",
    });
    await expect(
      caller.stockLots.byProduct({ storeId: storeB.id, productId: productB.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    await expect(
      caller.stockLots.expiringSoon({ storeId: storeB.id, days: 30 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    await expect(
      caller.inventory.productIdsBySnapshotIds({ snapshotIds: [snapshotB.id] }),
    ).resolves.toEqual([]);
    await expect(
      caller.stockCounts.setLineCountedQty({ lineId: lineB.id, countedQty: 8 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    await expect(caller.stockCounts.removeLine({ lineId: lineB.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "storeAccessDenied",
    });
    await expect(
      caller.stockCounts.applyCount({
        stockCountId: countB.id,
        idempotencyKey: `a2-001-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });

    const [afterLine, afterCount, afterSnapshot, movements] = await Promise.all([
      prisma.stockCountLine.findUniqueOrThrow({ where: { id: lineB.id } }),
      prisma.stockCount.findUniqueOrThrow({ where: { id: countB.id } }),
      prisma.inventorySnapshot.findUniqueOrThrow({ where: { id: snapshotB.id } }),
      prisma.stockMovement.findMany({
        where: { referenceType: "STOCK_COUNT", referenceId: countB.id },
      }),
    ]);
    expect(afterLine.countedQty).toBe(7);
    expect(afterCount.status).toBe("IN_PROGRESS");
    expect(afterSnapshot.onHand).toBe(5);
    expect(movements).toHaveLength(0);
    expect(await prisma.stockLot.findUnique({ where: { id: lotB.id } })).not.toBeNull();
  });

  it("HARD-A2-001 preserves count and lot access in an assigned store and hides cross-org IDs", async () => {
    const { org, store, product, managerUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.store.update({ where: { id: store.id }, data: { trackExpiryLots: true } });
    const snapshot = await prisma.inventorySnapshot.create({
      data: { storeId: store.id, productId: product.id, variantKey: "BASE", onHand: 4 },
    });
    const lot = await prisma.stockLot.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        variantKey: "BASE",
        expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        onHandQty: 4,
      },
    });
    const caller = callerFor(managerUser);
    const count = await caller.stockCounts.create({ storeId: store.id, notes: "allowed" });
    const line = await caller.stockCounts.addOrUpdateLineByScan({
      idempotencyKey: `a2-001-scan-${randomUUID()}`,
      stockCountId: count.id,
      storeId: store.id,
      barcodeOrQuery: product.sku,
      mode: "set",
      countedQty: 4,
    });

    await expect(caller.stockCounts.list({ storeId: store.id })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: count.id })]),
    );
    await expect(caller.stockCounts.get({ stockCountId: count.id })).resolves.toMatchObject({
      id: count.id,
    });
    await expect(
      caller.stockLots.byProduct({ storeId: store.id, productId: product.id }),
    ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: lot.id })]));
    await expect(
      caller.inventory.productIdsBySnapshotIds({ snapshotIds: [snapshot.id] }),
    ).resolves.toEqual([product.id]);
    await expect(
      caller.stockCounts.setLineCountedQty({ lineId: line.id, countedQty: 5 }),
    ).resolves.toMatchObject({ countedQty: 5 });

    const betaOrg = await prisma.organization.create({ data: { name: "Count Beta" } });
    const betaStore = await prisma.store.create({
      data: { organizationId: betaOrg.id, name: "Beta Store", code: "COUNT-BETA" },
    });
    const betaCount = await prisma.stockCount.create({
      data: { organizationId: betaOrg.id, storeId: betaStore.id, code: "SC-BETA" },
    });
    await expect(caller.stockCounts.get({ stockCountId: betaCount.id })).resolves.toBeNull();
  });

  it("HARD-A2-002 rejects inaccessible product, assignment, and price ID tampering without writes", async () => {
    const { org, store, storeB, productB, managerUser } = await seedTwoStoreScope();
    const caller = callerFor(managerUser);

    await expect(
      caller.products.inlineUpdate({
        productId: productB.id,
        patch: { name: "Unauthorized Store B rename" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "productAccessDenied" });
    await expect(
      caller.storePrices.upsert({
        storeId: storeB.id,
        productId: productB.id,
        priceKgs: 3210,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    await expect(
      caller.storePrices.upsert({
        storeId: store.id,
        productId: productB.id,
        priceKgs: 3210,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "productAccessDenied" });
    await expect(
      caller.products.assignToStore({ storeId: store.id, productIds: [productB.id] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "productAccessDenied" });
    await expect(caller.products.archive({ productId: productB.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "productAccessDenied",
    });
    await expect(
      caller.products.generateBarcode({ productId: productB.id, mode: "CODE128", force: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "productAccessDenied" });
    await expect(
      caller.products.bulkUpdateCategory({
        productIds: [productB.id],
        category: "Unauthorized category",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "productAccessDenied" });
    await expect(
      caller.products.duplicate({
        idempotencyKey: `a2-002-duplicate-${randomUUID()}`,
        productId: productB.id,
        name: "Unauthorized duplicate",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "productAccessDenied" });

    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: productB.id } }),
    ).resolves.toMatchObject({
      name: "Restricted Product B",
      isDeleted: false,
    });
    expect(
      await prisma.storePrice.count({ where: { organizationId: org.id, productId: productB.id } }),
    ).toBe(0);
    expect(
      await prisma.storeProduct.count({
        where: { storeId: store.id, productId: productB.id, isActive: true },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: org.id, actorId: managerUser.id, entityId: productB.id },
      }),
    ).toBe(0);
    expect(
      await prisma.product.count({
        where: { organizationId: org.id, name: "Unauthorized duplicate" },
      }),
    ).toBe(0);
  });

  it("HARD-A2-002 preserves assigned-product mutations and rejects cross-org product IDs", async () => {
    const { org, store, product, managerUser } = await seedBase({ plan: "BUSINESS" });
    const caller = callerFor(managerUser);
    await expect(
      caller.products.inlineUpdate({ productId: product.id, patch: { name: "Allowed rename" } }),
    ).resolves.toMatchObject({ name: "Allowed rename" });
    await expect(
      caller.storePrices.upsert({ storeId: store.id, productId: product.id, priceKgs: 444 }),
    ).resolves.toMatchObject({ updatedById: managerUser.id });

    const betaOrg = await prisma.organization.create({ data: { name: "Product Beta" } });
    const betaUnit = await prisma.unit.create({
      data: { organizationId: betaOrg.id, code: "ea", labelRu: "ea", labelKg: "ea" },
    });
    const betaProduct = await prisma.product.create({
      data: {
        organizationId: betaOrg.id,
        sku: "BETA-PRODUCT",
        name: "Beta Product",
        unit: betaUnit.code,
        baseUnitId: betaUnit.id,
      },
    });
    await expect(
      caller.products.inlineUpdate({
        productId: betaProduct.id,
        patch: { name: "Cross-org rename" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "productAccessDenied" });
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: betaProduct.id } }),
    ).resolves.toMatchObject({
      name: "Beta Product",
    });
    await expect(
      prisma.storePrice.findUniqueOrThrow({
        where: {
          organizationId_storeId_productId_variantKey: {
            organizationId: org.id,
            storeId: store.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
    ).resolves.toMatchObject({ updatedById: managerUser.id });
  });

  it("HARD-A2-003 denies Store-B-only prices and costs to a Store-A-only staff user", async () => {
    const { productB, staffUser } = await seedTwoStoreScope();
    const caller = callerFor(staffUser);

    await expect(caller.products.pricing({ productId: productB.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "productNotFound",
    });
    await expect(caller.products.storePricing({ productId: productB.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "productNotFound",
    });
  });

  it("HARD-A2-003 preserves pricing reads for a product assigned to the caller's store", async () => {
    const { org, product, staffUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 765 } });
    await prisma.productCost.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        variantKey: "BASE",
        avgCostKgs: 432,
      },
    });
    const caller = callerFor(staffUser);
    await expect(caller.products.pricing({ productId: product.id })).resolves.toMatchObject({
      basePriceKgs: 765,
      effectivePriceKgs: 765,
      avgCostKgs: 432,
    });
    await expect(caller.products.storePricing({ productId: product.id })).resolves.toMatchObject({
      basePriceKgs: 765,
      avgCostKgs: 432,
      stores: [expect.objectContaining({ storeId: expect.any(String) })],
    });
  });

  it("HARD-A2-004 rejects manager nested initial stock before product or movement creation", async () => {
    const { store, baseUnit, managerUser } = await seedBase({ plan: "BUSINESS" });
    const caller = callerFor(managerUser);
    const marker = `NESTED-${randomUUID().slice(0, 8)}`;

    await expect(
      caller.products.create({
        idempotencyKey: `a2-004-manager-${randomUUID()}`,
        name: "Nested stock authorization probe",
        storeId: store.id,
        baseUnitId: baseUnit.id,
        initialOnHand: 0,
        variants: [
          {
            name: "S",
            sku: marker,
            attributes: { size: "S" },
            initialOnHand: 10,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "inventoryAdminRequired" });
    expect(await prisma.productVariant.count({ where: { sku: marker } })).toBe(0);
    expect(await prisma.stockMovement.count({ where: { createdById: managerUser.id } })).toBe(0);
  });

  it("HARD-A2-004 preserves nested initial stock for admins", async () => {
    const { org, store, baseUnit, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = callerFor(adminUser);
    const created = await caller.products.create({
      idempotencyKey: `a2-004-admin-${randomUUID()}`,
      name: "Admin nested stock probe",
      storeId: store.id,
      baseUnitId: baseUnit.id,
      variants: [{ name: "S", attributes: { size: "S" }, initialOnHand: 10 }],
    });
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { productId: created.id },
    });
    const [snapshot, movements] = await Promise.all([
      prisma.inventorySnapshot.findUniqueOrThrow({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: created.id,
            variantKey: variant.id,
          },
        },
      }),
      prisma.stockMovement.findMany({
        where: {
          storeId: store.id,
          productId: created.id,
          variantId: variant.id,
          type: StockMovementType.ADJUSTMENT,
        },
      }),
    ]);

    expect(created.organizationId).toBe(org.id);
    expect(snapshot.onHand).toBe(10);
    expect(movements.map((movement) => movement.qtyDelta)).toEqual([10]);
    expect(movements[0]?.createdById).toBe(adminUser.id);
  });

  it("HARD-A2-005 replays create and relative/absolute price operations exactly once", async () => {
    const { org, store, baseUnit, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = callerFor(adminUser);
    const marker = `Replay ${randomUUID()}`;
    const createInput = {
      idempotencyKey: `a2-005-create-${randomUUID()}`,
      name: marker,
      storeId: store.id,
      baseUnitId: baseUnit.id,
      initialOnHand: 3,
    };

    const firstCreate = await caller.products.create(createInput);
    const secondCreate = await caller.products.create(createInput);
    const createdRows = await prisma.product.findMany({
      where: { organizationId: org.id, name: marker },
    });
    const createdMovements = await prisma.stockMovement.findMany({
      where: { productId: { in: [firstCreate.id, secondCreate.id] }, type: "ADJUSTMENT" },
    });

    expect(firstCreate.id).toBe(secondCreate.id);
    expect(createdRows).toHaveLength(1);
    expect(createdMovements.map((movement) => movement.qtyDelta)).toEqual([3]);
    await expect(
      caller.products.create({ ...createInput, name: `${marker} changed` }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "operationRequestPayloadMismatch",
    });
    expect(await prisma.product.count({ where: { organizationId: org.id, name: marker } })).toBe(1);

    await prisma.storePrice.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        variantKey: "BASE",
        priceKgs: 100,
        updatedById: adminUser.id,
      },
    });
    const priceInput = {
      idempotencyKey: `a2-005-price-${randomUUID()}`,
      storeId: store.id,
      filter: { search: product.sku },
      mode: "increasePct" as const,
      value: 10,
    };
    await caller.storePrices.bulkUpdate(priceInput);
    await caller.storePrices.bulkUpdate(priceInput);
    await expect(caller.storePrices.bulkUpdate({ ...priceInput, value: 20 })).rejects.toMatchObject(
      {
        code: "CONFLICT",
        message: "operationRequestPayloadMismatch",
      },
    );

    const afterPrice = await prisma.storePrice.findUniqueOrThrow({
      where: {
        organizationId_storeId_productId_variantKey: {
          organizationId: org.id,
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    expect(Number(afterPrice.priceKgs)).toBe(110);

    const absolutePriceInput = {
      ...priceInput,
      idempotencyKey: `a2-005-price-absolute-${randomUUID()}`,
      mode: "increaseAbs" as const,
      value: 10,
    };
    await caller.storePrices.bulkUpdate(absolutePriceInput);
    await caller.storePrices.bulkUpdate(absolutePriceInput);
    const afterAbsolutePrice = await prisma.storePrice.findUniqueOrThrow({
      where: {
        organizationId_storeId_productId_variantKey: {
          organizationId: org.id,
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    expect(Number(afterAbsolutePrice.priceKgs)).toBe(120);
    const operationRequests = await prisma.operationRequest.findMany({
      where: {
        organizationId: org.id,
        principalKey: `user:${adminUser.id}`,
        scope: { in: ["products.create", "storePrices.bulkUpdate"] },
      },
      orderBy: { scope: "asc" },
    });
    expect(operationRequests).toHaveLength(3);
    expect(
      operationRequests.every((request) => request.status === OperationRequestStatus.COMPLETED),
    ).toBe(true);
    expect(operationRequests.every((request) => request.storeId === store.id)).toBe(true);
  });

  it("HARD-A2-005 replays duplicate and import operations without duplicate stock", async () => {
    const { org, store, baseUnit, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = callerFor(adminUser);
    const duplicateInput = {
      idempotencyKey: `a2-005-duplicate-${randomUUID()}`,
      productId: product.id,
      name: `Replay duplicate ${randomUUID()}`,
      storeId: store.id,
      copyInventory: false,
    };

    const firstDuplicate = await caller.products.duplicate(duplicateInput);
    const secondDuplicate = await caller.products.duplicate(duplicateInput);
    await expect(
      caller.products.duplicate({ ...duplicateInput, name: `${duplicateInput.name} changed` }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "operationRequestPayloadMismatch",
    });
    expect(secondDuplicate.productId).toBe(firstDuplicate.productId);
    expect(
      await prisma.product.count({
        where: { id: firstDuplicate.productId, organizationId: org.id },
      }),
    ).toBe(1);

    const importedSku = `REPLAY-IMPORT-${randomUUID().slice(0, 8)}`;
    const importInput = {
      idempotencyKey: `a2-005-import-${randomUUID()}`,
      storeId: store.id,
      stockBehavior: "add" as const,
      rows: [
        {
          sku: importedSku,
          name: "Replay import product",
          unit: baseUnit.code,
          stockQty: 4,
        },
      ],
    };
    const firstImport = await caller.products.importCsv(importInput);
    const secondImport = await caller.products.importCsv(importInput);
    await expect(
      caller.products.importCsv({
        ...importInput,
        rows: [{ ...importInput.rows[0], stockQty: 6 }],
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "operationRequestPayloadMismatch",
    });
    const imported = await prisma.product.findFirstOrThrow({
      where: { organizationId: org.id, sku: importedSku },
    });
    const [snapshot, movements, batchCount] = await Promise.all([
      prisma.inventorySnapshot.findUniqueOrThrow({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: imported.id,
            variantKey: "BASE",
          },
        },
      }),
      prisma.stockMovement.findMany({
        where: {
          storeId: store.id,
          productId: imported.id,
          type: "RECEIVE",
          referenceType: "IMPORT",
        },
      }),
      prisma.importBatch.count({ where: { id: firstImport.batchId } }),
    ]);

    expect(secondImport.batchId).toBe(firstImport.batchId);
    expect(snapshot.onHand).toBe(4);
    expect(movements.map((movement) => movement.qtyDelta)).toEqual([4]);
    expect(batchCount).toBe(1);
    const operationRequests = await prisma.operationRequest.findMany({
      where: {
        organizationId: org.id,
        principalKey: `user:${adminUser.id}`,
        scope: { in: ["products.duplicate", "products.importCsv"] },
      },
    });
    expect(operationRequests).toHaveLength(2);
    expect(
      operationRequests.every((request) => request.status === OperationRequestStatus.COMPLETED),
    ).toBe(true);
    expect(operationRequests.every((request) => request.storeId === store.id)).toBe(true);
  });

  it("HARD-A2-006 replays one stock-count scan without another increment", async () => {
    const { store, product, managerUser } = await seedBase({ plan: "BUSINESS" });
    const caller = callerFor(managerUser);
    const count = await caller.stockCounts.create({ storeId: store.id, notes: "replay probe" });
    const scan = {
      idempotencyKey: `a2-006-scan-${randomUUID()}`,
      stockCountId: count.id,
      storeId: store.id,
      barcodeOrQuery: product.sku,
      mode: "increment" as const,
      countedDelta: 1,
    };

    const first = await caller.stockCounts.addOrUpdateLineByScan(scan);
    const second = await caller.stockCounts.addOrUpdateLineByScan(scan);
    await expect(
      caller.stockCounts.addOrUpdateLineByScan({ ...scan, countedDelta: 2 }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "operationRequestPayloadMismatch",
    });
    const durable = await prisma.stockCountLine.findUniqueOrThrow({
      where: {
        stockCountId_productId_variantKey: {
          stockCountId: count.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });

    expect(first.countedQty).toBe(1);
    expect(second.countedQty).toBe(1);
    expect(durable.countedQty).toBe(1);
    await expect(
      prisma.operationRequest.findFirstOrThrow({
        where: {
          organizationId: managerUser.organizationId!,
          principalKey: `user:${managerUser.id}`,
          scope: "stockCounts.addOrUpdateLineByScan",
        },
      }),
    ).resolves.toMatchObject({
      status: OperationRequestStatus.COMPLETED,
      storeId: store.id,
      idempotencyKey: scan.idempotencyKey,
    });
  });

  it("HARD-A2-007 rolls back an invalid bulk adjustment and replays a valid batch once", async () => {
    const { org, store, baseUnit, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = callerFor(adminUser);
    const snapshotIds: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const product = await prisma.product.create({
        data: {
          organizationId: org.id,
          sku: `ATOMIC-${index}-${randomUUID().slice(0, 6)}`,
          name: `Atomicity product ${index}`,
          unit: baseUnit.code,
          baseUnitId: baseUnit.id,
          storeProducts: {
            create: {
              organizationId: org.id,
              storeId: store.id,
              isActive: true,
              assignedById: adminUser.id,
            },
          },
        },
      });
      const snapshot = await prisma.inventorySnapshot.create({
        data: { storeId: store.id, productId: product.id, variantKey: "BASE", onHand: index + 1 },
      });
      snapshotIds.push(snapshot.id);
    }
    const invalidEleventhId = randomUUID();
    const reason = `atomicity-${randomUUID()}`;
    const invalidIdempotencyKey = `a2-007-${randomUUID()}`;

    await expect(
      caller.inventory.bulkSetOnHand({
        storeId: store.id,
        snapshotIds: [...snapshotIds, invalidEleventhId],
        targetOnHand: 77,
        reason,
        idempotencyKey: invalidIdempotencyKey,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "inventorySelectionInvalid" });

    const [afterSnapshots, movements, failedOperation] = await Promise.all([
      prisma.inventorySnapshot.findMany({
        where: { id: { in: snapshotIds } },
        orderBy: { id: "asc" },
      }),
      prisma.stockMovement.findMany({ where: { storeId: store.id, note: reason } }),
      prisma.operationRequest.findUnique({
        where: {
          organizationId_scope_principalKey_idempotencyKey: {
            organizationId: org.id,
            scope: "inventory.bulkSetOnHand",
            principalKey: `user:${adminUser.id}`,
            idempotencyKey: invalidIdempotencyKey,
          },
        },
      }),
    ]);
    expect(afterSnapshots).toHaveLength(10);
    expect(afterSnapshots.map((snapshot) => snapshot.onHand).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(movements).toHaveLength(0);
    expect(failedOperation).toMatchObject({
      status: OperationRequestStatus.FAILED,
      storeId: store.id,
      errorClassification: "SAFE_BEFORE_EFFECTS",
    });

    const replayReason = `atomicity-valid-${randomUUID()}`;
    const validInput = {
      storeId: store.id,
      snapshotIds,
      targetOnHand: 77,
      reason: replayReason,
      idempotencyKey: `a2-007-valid-${randomUUID()}`,
    };
    const first = await caller.inventory.bulkSetOnHand(validInput);
    const replay = await caller.inventory.bulkSetOnHand(validInput);
    await expect(
      caller.inventory.bulkSetOnHand({ ...validInput, targetOnHand: 78 }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "operationRequestPayloadMismatch",
    });
    const [validSnapshots, validMovements, validOperation] = await Promise.all([
      prisma.inventorySnapshot.findMany({ where: { id: { in: snapshotIds } } }),
      prisma.stockMovement.findMany({ where: { storeId: store.id, note: replayReason } }),
      prisma.operationRequest.findUnique({
        where: {
          organizationId_scope_principalKey_idempotencyKey: {
            organizationId: org.id,
            scope: "inventory.bulkSetOnHand",
            principalKey: `user:${adminUser.id}`,
            idempotencyKey: validInput.idempotencyKey,
          },
        },
      }),
    ]);
    expect(replay).toEqual(first);
    expect(validSnapshots.every((snapshot) => snapshot.onHand === 77)).toBe(true);
    expect(validMovements).toHaveLength(10);
    expect(validOperation).toMatchObject({
      status: OperationRequestStatus.COMPLETED,
      storeId: store.id,
      idempotencyKey: validInput.idempotencyKey,
      response: first,
    });
    expect(validOperation?.response).not.toHaveProperty("changedItems");
  });

  it("HARD-A2-007 binds a bulk operation key to one organization and store", async () => {
    const { org, store, storeB, product, snapshotB, adminUser } = await seedTwoStoreScope();
    const caller = callerFor(adminUser);
    const snapshotA = await prisma.inventorySnapshot.create({
      data: { storeId: store.id, productId: product.id, variantKey: "BASE", onHand: 2 },
    });
    const idempotencyKey = `a2-007-scope-${randomUUID()}`;
    const reason = `scope-${randomUUID()}`;

    await caller.inventory.bulkSetOnHand({
      storeId: store.id,
      snapshotIds: [snapshotA.id],
      targetOnHand: 9,
      reason,
      idempotencyKey,
    });

    await expect(
      caller.inventory.bulkSetOnHand({
        storeId: storeB.id,
        snapshotIds: [snapshotB.id],
        targetOnHand: 9,
        reason,
        idempotencyKey,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "operationRequestIdentityMismatch",
    });

    const otherOrganization = await prisma.organization.create({
      data: { name: "Agent 2 Operation Scope Other Org" },
    });
    const otherStore = await prisma.store.create({
      data: {
        organizationId: otherOrganization.id,
        name: "Other Organization Store",
        code: `OTHER-${randomUUID().slice(0, 8)}`,
      },
    });
    await expect(
      caller.inventory.bulkSetOnHand({
        storeId: otherStore.id,
        snapshotIds: [snapshotB.id],
        targetOnHand: 9,
        reason,
        idempotencyKey,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });

    const [durableA, durableB, scopedOperations, crossStoreMovements] = await Promise.all([
      prisma.inventorySnapshot.findUniqueOrThrow({ where: { id: snapshotA.id } }),
      prisma.inventorySnapshot.findUniqueOrThrow({ where: { id: snapshotB.id } }),
      prisma.operationRequest.findMany({
        where: {
          scope: "inventory.bulkSetOnHand",
          principalKey: `user:${adminUser.id}`,
          idempotencyKey,
        },
      }),
      prisma.stockMovement.findMany({
        where: { storeId: storeB.id, note: reason },
      }),
    ]);
    expect(durableA.onHand).toBe(9);
    expect(durableB.onHand).toBe(5);
    expect(crossStoreMovements).toHaveLength(0);
    expect(scopedOperations).toHaveLength(1);
    expect(scopedOperations[0]).toMatchObject({
      organizationId: org.id,
      storeId: store.id,
      status: OperationRequestStatus.COMPLETED,
    });
  });

  it("HARD-A2-008 archives only the selected store preference", async () => {
    const { org, store, storeB, managerUser } = await seedTwoStoreScope();
    const marker = `Unused ${randomUUID()}`;
    const normalized = marker.toLocaleLowerCase();
    const category = await prisma.productCategory.create({
      data: { organizationId: org.id, name: marker },
    });
    await prisma.storeCategoryPreference.createMany({
      data: [store.id, storeB.id].map((storeId) => ({
        organizationId: org.id,
        storeId,
        name: marker,
        normalizedName: normalized,
      })),
    });
    const before = await prisma.storeCategoryPreference.count({
      where: { organizationId: org.id, normalizedName: normalized },
    });

    await callerFor(managerUser).productCategories.remove({ name: marker, storeId: store.id });

    expect(before).toBe(2);
    await expect(
      prisma.storeCategoryPreference.findUniqueOrThrow({
        where: { storeId_normalizedName: { storeId: store.id, normalizedName: normalized } },
      }),
    ).resolves.toMatchObject({ isArchived: true, isVisibleInForms: false });
    await expect(
      prisma.storeCategoryPreference.findUniqueOrThrow({
        where: { storeId_normalizedName: { storeId: storeB.id, normalizedName: normalized } },
      }),
    ).resolves.toMatchObject({ isArchived: false, isVisibleInForms: true });
    await expect(
      prisma.productCategory.findUnique({ where: { id: category.id } }),
    ).resolves.toMatchObject({
      id: category.id,
    });
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId: org.id,
          actorId: managerUser.id,
          action: "STORE_CATEGORY_PREFERENCE_UPDATE",
        },
      }),
    ).toBe(1);
  });

  it("HARD-A2-008 rejects organization-wide and inaccessible-store deletion without side effects", async () => {
    const { org, storeB, managerUser } = await seedTwoStoreScope();
    const marker = `Protected ${randomUUID()}`;
    const normalized = marker.toLocaleLowerCase();
    const category = await prisma.productCategory.create({
      data: { organizationId: org.id, name: marker },
    });
    const preference = await prisma.storeCategoryPreference.create({
      data: {
        organizationId: org.id,
        storeId: storeB.id,
        name: marker,
        normalizedName: normalized,
      },
    });
    const betaOrg = await prisma.organization.create({ data: { name: "Category Beta" } });
    const betaStore = await prisma.store.create({
      data: {
        organizationId: betaOrg.id,
        name: "Category Beta Store",
        code: `CAT-B-${randomUUID().slice(0, 8)}`,
      },
    });
    const caller = callerFor(managerUser);

    await expect(caller.productCategories.remove({ name: marker })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "categoryGlobalRemoveForbidden",
    });
    await expect(
      caller.productCategories.remove({ name: marker, storeId: storeB.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    await expect(
      caller.productCategories.remove({ name: marker, storeId: betaStore.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });

    await expect(
      prisma.productCategory.findUnique({ where: { id: category.id } }),
    ).resolves.toMatchObject({
      id: category.id,
    });
    await expect(
      prisma.storeCategoryPreference.findUnique({ where: { id: preference.id } }),
    ).resolves.toMatchObject({ isArchived: false, isVisibleInForms: true });
    expect(
      await prisma.auditLog.count({
        where: { organizationId: org.id, actorId: managerUser.id },
      }),
    ).toBe(0);
  });

  it("HARD-A2-008 preserves explicit organization-wide deletion for admins", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const marker = `Global ${randomUUID()}`;
    const normalized = marker.toLocaleLowerCase();
    const category = await prisma.productCategory.create({
      data: { organizationId: org.id, name: marker },
    });
    await prisma.storeCategoryPreference.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: marker,
        normalizedName: normalized,
      },
    });

    await expect(
      callerFor(adminUser).productCategories.remove({ name: marker }),
    ).resolves.toMatchObject({
      id: category.id,
    });
    expect(await prisma.productCategory.findUnique({ where: { id: category.id } })).toBeNull();
    expect(
      await prisma.storeCategoryPreference.count({
        where: { organizationId: org.id, normalizedName: normalized },
      }),
    ).toBe(0);
  });
});
