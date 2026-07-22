import { PurchaseOrderStatus, StockMovementType } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { rollbackImportBatch } from "@/server/services/imports";
import { adjustStock } from "@/server/services/inventory";
import { inspectProductCostMismatch } from "@/server/services/productCost";
import {
  approvePurchaseOrder,
  createPurchaseOrder,
  receivePurchaseOrder,
} from "@/server/services/purchaseOrders";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const costKey = (organizationId: string, productId: string, variantKey = "BASE") => ({
  organizationId_productId_variantKey: { organizationId, productId, variantKey },
});

describeDb("Agent 2 B2 receiving cost verification", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("HARD-A2-018 retries safely, reverses the effective edited line, and archives without changing cost", async () => {
    const { org, store, supplier, product, adminUser, baseUnit } = await seedBase({
      plan: "BUSINESS",
    });
    const keepProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "A2-018-KEEP",
        name: "A2-018 keep line",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        storeProducts: {
          create: { organizationId: org.id, storeId: store.id, isActive: true },
        },
      },
    });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });
    const receiving = await caller.inventory.postStockReceiving({
      storeId: store.id,
      lines: [
        { productId: product.id, quantity: 10, unitCost: 5 },
        { productId: keepProduct.id, quantity: 1, unitCost: 1 },
      ],
      idempotencyKey: "hard-a2-018-receive",
    });
    const documentKey = `STOCK_RECEIVING:STOCK_RECEIVING:${receiving.receivingId}`;
    const firstEdit = {
      documentKey,
      reason: "correct receiving quantity and cost",
      lines: [
        { productId: product.id, quantity: 7, unitCostKgs: 6 },
        { productId: keepProduct.id, quantity: 1, unitCostKgs: 1 },
      ],
      idempotencyKey: "hard-a2-018-edit",
    };

    await caller.inventory.editProductMovementDocument(firstEdit);
    await caller.inventory.editProductMovementDocument(firstEdit);
    await caller.inventory.editProductMovementDocument({
      documentKey,
      reason: "remove the effective edited line",
      lines: [{ productId: keepProduct.id, quantity: 1, unitCostKgs: 1 }],
      idempotencyKey: "hard-a2-018-remove",
    });

    const beforeArchive = await prisma.productCost.findUniqueOrThrow({
      where: costKey(org.id, product.id),
    });
    await caller.inventory.archiveProductMovementDocument({
      documentKey,
      reason: "archive after effective reversal",
      idempotencyKey: "hard-a2-018-archive",
    });
    const [afterArchive, snapshot, movements, report] = await Promise.all([
      prisma.productCost.findUniqueOrThrow({ where: costKey(org.id, product.id) }),
      prisma.inventorySnapshot.findUniqueOrThrow({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
      prisma.stockMovement.findMany({
        where: {
          productId: product.id,
          referenceType: "STOCK_RECEIVING",
          referenceId: receiving.receivingId,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      prisma.$transaction((tx) =>
        inspectProductCostMismatch(tx, {
          organizationId: org.id,
          productId: product.id,
        }),
      ),
    ]);
    const evidence = {
      cost: {
        beforeArchive: [Number(beforeArchive.avgCostKgs), beforeArchive.costBasisQty],
        afterArchive: [Number(afterArchive.avgCostKgs), afterArchive.costBasisQty],
      },
      onHand: snapshot.onHand,
      movementQty: movements.map((movement) => movement.qtyDelta),
      movementValueKgs: movements.map((movement) => Number(movement.lineTotalKgs)),
      detector: report.status,
    };
    console.info(`[B2-EVIDENCE] HARD-A2-018-reversal ${JSON.stringify(evidence)}`);

    expect(evidence).toEqual({
      cost: { beforeArchive: [0, 0], afterArchive: [0, 0] },
      onHand: 0,
      movementQty: [10, -3, -7],
      movementValueKgs: [50, -8, -42],
      detector: "MATCH",
    });
  });

  it("HARD-A2-018 uses the exact valued stream across rounding-sensitive receipts and a second edit", async () => {
    const { org, store, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    const otherStore = await prisma.store.create({
      data: { organizationId: org.id, name: "A2 Other Store", code: "A2-OTHER" },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: otherStore.id,
        productId: product.id,
        isActive: true,
      },
    });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });
    const first = await caller.inventory.postStockReceiving({
      storeId: store.id,
      lines: [{ productId: product.id, quantity: 3, unitCost: 0.01 }],
      idempotencyKey: "hard-a2-018-round-first",
    });
    await caller.inventory.postStockReceiving({
      storeId: otherStore.id,
      lines: [{ productId: product.id, quantity: 2, unitCost: 0.02 }],
      idempotencyKey: "hard-a2-018-round-second",
    });
    const documentKey = `STOCK_RECEIVING:STOCK_RECEIVING:${first.receivingId}`;
    await caller.inventory.editProductMovementDocument({
      documentKey,
      lines: [{ productId: product.id, quantity: 4, unitCostKgs: 0.01 }],
      idempotencyKey: "hard-a2-018-round-edit-1",
    });
    await caller.inventory.editProductMovementDocument({
      documentKey,
      lines: [{ productId: product.id, quantity: 2, unitCostKgs: 0.02 }],
      idempotencyKey: "hard-a2-018-round-edit-2",
    });

    const [cost, report] = await Promise.all([
      prisma.productCost.findUniqueOrThrow({ where: costKey(org.id, product.id) }),
      prisma.$transaction((tx) =>
        inspectProductCostMismatch(tx, { organizationId: org.id, productId: product.id }),
      ),
    ]);
    expect({ avg: Number(cost.avgCostKgs), basis: cost.costBasisQty }).toEqual({
      avg: 0.02,
      basis: 4,
    });
    expect(report).toMatchObject({
      status: "MATCH",
      expected: { avgCostKgs: 0.02, costBasisQty: 4, totalValueKgs: 0.08 },
      valuedMovementCount: 4,
    });
  });

  it("HARD-A2-018 keeps variant cost isolated while aggregating that variant across stores", async () => {
    const { org, store, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, name: "Blue", sku: "A2-BLUE", attributes: {} },
    });
    const otherStore = await prisma.store.create({
      data: { organizationId: org.id, name: "A2 Variant Store", code: "A2-VAR" },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: otherStore.id,
        productId: product.id,
        isActive: true,
      },
    });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });
    const first = await caller.inventory.postStockReceiving({
      storeId: store.id,
      lines: [{ productId: product.id, variantId: variant.id, quantity: 2, unitCost: 3 }],
      idempotencyKey: "hard-a2-018-variant-first",
    });
    await caller.inventory.postStockReceiving({
      storeId: otherStore.id,
      lines: [{ productId: product.id, variantId: variant.id, quantity: 3, unitCost: 5 }],
      idempotencyKey: "hard-a2-018-variant-second",
    });
    await caller.inventory.editProductMovementDocument({
      documentKey: `STOCK_RECEIVING:STOCK_RECEIVING:${first.receivingId}`,
      lines: [{ productId: product.id, variantId: variant.id, quantity: 1, unitCostKgs: 4 }],
      idempotencyKey: "hard-a2-018-variant-edit",
    });

    const [variantCost, baseCost] = await Promise.all([
      prisma.productCost.findUniqueOrThrow({
        where: costKey(org.id, product.id, variant.id),
      }),
      prisma.productCost.findUnique({ where: costKey(org.id, product.id) }),
    ]);
    expect({ avg: Number(variantCost.avgCostKgs), basis: variantCost.costBasisQty }).toEqual({
      avg: 4.75,
      basis: 4,
    });
    expect(baseCost).toBeNull();
  });

  it("HARD-A2-018 preserves an external manual/import basis and reports the stream as indeterminate", async () => {
    const { org, store, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.productCost.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        variantKey: "BASE",
        avgCostKgs: 10,
        costBasisQty: 1,
      },
    });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });
    const receiving = await caller.inventory.postStockReceiving({
      storeId: store.id,
      lines: [{ productId: product.id, quantity: 10, unitCost: 5 }],
      idempotencyKey: "hard-a2-018-external-receive",
    });
    await caller.inventory.editProductMovementDocument({
      documentKey: `STOCK_RECEIVING:STOCK_RECEIVING:${receiving.receivingId}`,
      lines: [{ productId: product.id, quantity: 7, unitCostKgs: 6 }],
      idempotencyKey: "hard-a2-018-external-edit",
    });

    const [cost, report] = await Promise.all([
      prisma.productCost.findUniqueOrThrow({ where: costKey(org.id, product.id) }),
      prisma.$transaction((tx) =>
        inspectProductCostMismatch(tx, { organizationId: org.id, productId: product.id }),
      ),
    ]);
    expect({ avg: Number(cost.avgCostKgs), basis: cost.costBasisQty }).toEqual({
      avg: 6.49,
      basis: 8,
    });
    expect(report).toMatchObject({
      status: "INDETERMINATE_UNVALUED_STREAM",
      expected: null,
      actual: { costBasisQty: 8 },
      valuedStream: { quantity: 7, totalValueKgs: 42 },
    });
    console.info(
      `[B2-EVIDENCE] HARD-A2-018-indeterminate ${JSON.stringify({
        status: report.status,
        actual: report.actual,
        valuedStream: report.valuedStream,
      })}`,
    );
  });

  it("HARD-A2-018 detector identifies the stale pre-edit aggregate as a definite document mismatch", async () => {
    const { org, store, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });
    const receiving = await caller.inventory.postStockReceiving({
      storeId: store.id,
      lines: [{ productId: product.id, quantity: 10, unitCost: 5 }],
      idempotencyKey: "hard-a2-018-detector-receive",
    });
    await caller.inventory.editProductMovementDocument({
      documentKey: `STOCK_RECEIVING:STOCK_RECEIVING:${receiving.receivingId}`,
      lines: [{ productId: product.id, quantity: 7, unitCostKgs: 6 }],
      idempotencyKey: "hard-a2-018-detector-edit",
    });
    await prisma.productCost.update({
      where: costKey(org.id, product.id),
      data: { avgCostKgs: 5, costBasisQty: 10 },
    });

    const report = await prisma.$transaction((tx) =>
      inspectProductCostMismatch(tx, { organizationId: org.id, productId: product.id }),
    );
    const evidence = {
      status: report.status,
      organizationId: report.organizationId,
      productId: report.productId,
      variantId: report.variantId,
      affectedStoreIds: report.affectedStoreIds,
      stockReceivingReferenceIds: report.stockReceivingReferenceIds,
      supersededReceivingReferenceId: report.supersededReceivingReferenceId,
      actual: report.actual,
      expected: report.expected,
    };
    console.info(`[B2-EVIDENCE] HARD-A2-018-mismatch ${JSON.stringify(evidence)}`);
    expect(evidence).toEqual({
      status: "MISMATCH",
      organizationId: org.id,
      productId: product.id,
      variantId: null,
      affectedStoreIds: [store.id],
      stockReceivingReferenceIds: [receiving.receivingId],
      supersededReceivingReferenceId: receiving.receivingId,
      actual: { avgCostKgs: 5, costBasisQty: 10 },
      expected: { avgCostKgs: 6, costBasisQty: 7, totalValueKgs: 42 },
    });
  });

  it("HARD-A2-018 rejects a forced aggregate mismatch and rolls back every edit side effect", async () => {
    const { org, store, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });
    const receiving = await caller.inventory.postStockReceiving({
      storeId: store.id,
      lines: [{ productId: product.id, quantity: 10, unitCost: 5 }],
      idempotencyKey: "hard-a2-018-mismatch-receive",
    });
    await prisma.productCost.update({
      where: costKey(org.id, product.id),
      data: { avgCostKgs: 5, costBasisQty: 2 },
    });
    const before = await Promise.all([
      prisma.inventorySnapshot.findUniqueOrThrow({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
      prisma.stockMovement.count({
        where: { referenceType: "STOCK_RECEIVING", referenceId: receiving.receivingId },
      }),
      prisma.auditLog.count({ where: { organizationId: org.id } }),
      prisma.$transaction((tx) =>
        inspectProductCostMismatch(tx, { organizationId: org.id, productId: product.id }),
      ),
    ]);
    expect(before[3].status).toBe("MISMATCH");

    await expect(
      caller.inventory.editProductMovementDocument({
        documentKey: `STOCK_RECEIVING:STOCK_RECEIVING:${receiving.receivingId}`,
        lines: [{ productId: product.id, quantity: 7, unitCostKgs: 6 }],
        idempotencyKey: "hard-a2-018-mismatch-edit",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "productCostContributionMismatch" });

    const after = await Promise.all([
      prisma.inventorySnapshot.findUniqueOrThrow({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
      prisma.stockMovement.count({
        where: { referenceType: "STOCK_RECEIVING", referenceId: receiving.receivingId },
      }),
      prisma.auditLog.count({ where: { organizationId: org.id } }),
      prisma.idempotencyKey.count({
        where: {
          userId: adminUser.id,
          route: "inventory.productMovement.editDocument",
          key: "hard-a2-018-mismatch-edit",
        },
      }),
    ]);
    expect({ onHand: after[0].onHand, movements: after[1], audits: after[2], idem: after[3] }).toEqual({
      onHand: before[0].onHand,
      movements: before[1],
      audits: before[2],
      idem: 0,
    });
  });

  it("HARD-A2-018 reverses received PO cost once and rejects a rollback retry without side effects", async () => {
    const { org, store, supplier, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    const po = await createPurchaseOrder({
      organizationId: org.id,
      storeId: store.id,
      supplierId: supplier.id,
      lines: [{ productId: product.id, qtyOrdered: 4, unitCost: 5 }],
      actorId: adminUser.id,
      requestId: "hard-a2-018-po-create",
      submit: true,
    });
    await approvePurchaseOrder({
      purchaseOrderId: po.id,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "hard-a2-018-po-approve",
    });
    await receivePurchaseOrder({
      purchaseOrderId: po.id,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "hard-a2-018-po-receive",
      idempotencyKey: "hard-a2-018-po-receive",
      lines: [{ lineId: po.lines[0]!.id, qtyReceived: 4 }],
    });
    const beforeCost = await prisma.productCost.findUniqueOrThrow({
      where: costKey(org.id, product.id),
    });
    const batch = await prisma.importBatch.create({
      data: { organizationId: org.id, type: "purchaseOrders", createdById: adminUser.id },
    });
    await prisma.importedEntity.create({
      data: { batchId: batch.id, entityType: "PurchaseOrder", entityId: po.id },
    });

    await rollbackImportBatch({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "hard-a2-018-po-rollback",
      batchId: batch.id,
    });
    const beforeRetryCount = await prisma.stockMovement.count({
      where: { referenceType: "IMPORT_ROLLBACK", referenceId: po.id },
    });
    await expect(
      rollbackImportBatch({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "hard-a2-018-po-rollback-retry",
        batchId: batch.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "importAlreadyRolledBack" });

    const [afterCost, afterRetryCount, updatedPo, compensation] = await Promise.all([
      prisma.productCost.findUniqueOrThrow({ where: costKey(org.id, product.id) }),
      prisma.stockMovement.count({
        where: { referenceType: "IMPORT_ROLLBACK", referenceId: po.id },
      }),
      prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } }),
      prisma.stockMovement.findFirstOrThrow({
        where: { referenceType: "IMPORT_ROLLBACK", referenceId: po.id },
      }),
    ]);
    const evidence = {
      before: [Number(beforeCost.avgCostKgs), beforeCost.costBasisQty],
      after: [Number(afterCost.avgCostKgs), afterCost.costBasisQty],
      compensation: {
        type: compensation.type,
        qty: compensation.qtyDelta,
        value: Number(compensation.lineTotalKgs),
      },
      rollbackMovements: [beforeRetryCount, afterRetryCount],
      status: updatedPo.status,
    };
    console.info(`[B2-EVIDENCE] HARD-A2-018-import-rollback ${JSON.stringify(evidence)}`);
    expect(evidence).toEqual({
      before: [5, 4],
      after: [0, 0],
      compensation: { type: StockMovementType.ADJUSTMENT, qty: -4, value: -20 },
      rollbackMovements: [1, 1],
      status: PurchaseOrderStatus.CANCELLED,
    });
  });

  it("HARD-A2-018 rolls back PO cancellation and ProductCost together when stock reversal fails", async () => {
    const { org, store, supplier, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    const po = await createPurchaseOrder({
      organizationId: org.id,
      storeId: store.id,
      supplierId: supplier.id,
      lines: [{ productId: product.id, qtyOrdered: 4, unitCost: 5 }],
      actorId: adminUser.id,
      requestId: "hard-a2-018-atomic-po-create",
      submit: true,
    });
    await approvePurchaseOrder({
      purchaseOrderId: po.id,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "hard-a2-018-atomic-po-approve",
    });
    await receivePurchaseOrder({
      purchaseOrderId: po.id,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "hard-a2-018-atomic-po-receive",
      idempotencyKey: "hard-a2-018-atomic-po-receive",
      lines: [{ lineId: po.lines[0]!.id, qtyReceived: 4 }],
    });
    await adjustStock({
      storeId: store.id,
      productId: product.id,
      qtyDelta: -4,
      reason: "consume received stock before rollback",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "hard-a2-018-atomic-consume",
      idempotencyKey: "hard-a2-018-atomic-consume",
    });
    const batch = await prisma.importBatch.create({
      data: { organizationId: org.id, type: "purchaseOrders", createdById: adminUser.id },
    });
    await prisma.importedEntity.create({
      data: { batchId: batch.id, entityType: "PurchaseOrder", entityId: po.id },
    });
    const beforeCost = await prisma.productCost.findUniqueOrThrow({
      where: costKey(org.id, product.id),
    });

    await expect(
      rollbackImportBatch({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "hard-a2-018-atomic-rollback",
        batchId: batch.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "insufficientStock" });

    const [afterCost, updatedPo, updatedBatch, compensationCount] = await Promise.all([
      prisma.productCost.findUniqueOrThrow({ where: costKey(org.id, product.id) }),
      prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } }),
      prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } }),
      prisma.stockMovement.count({
        where: { referenceType: "IMPORT_ROLLBACK", referenceId: po.id },
      }),
    ]);
    expect({ avg: Number(afterCost.avgCostKgs), basis: afterCost.costBasisQty }).toEqual({
      avg: Number(beforeCost.avgCostKgs),
      basis: beforeCost.costBasisQty,
    });
    expect(updatedPo.status).toBe(PurchaseOrderStatus.RECEIVED);
    expect(updatedBatch.rolledBackAt).toBeNull();
    expect(compensationCount).toBe(0);
  });
});
