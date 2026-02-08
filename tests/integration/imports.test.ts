import { beforeEach, describe, expect, it } from "vitest";
import { PurchaseOrderStatus, StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { runProductImport, rollbackImportBatch } from "@/server/services/imports";
import {
  approvePurchaseOrder,
  createPurchaseOrder,
  receivePurchaseOrder,
} from "@/server/services/purchaseOrders";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("import batches", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("records import batches and mappings for product imports", async () => {
    const { org, adminUser, baseUnit } = await seedBase({ plan: "BUSINESS" });

    const result = await runProductImport({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-import-batch-1",
      source: "cloudshop",
      rows: [
        {
          sku: "IMP-1",
          name: "Imported Product",
          unit: baseUnit.code,
          barcodes: ["IMP-BC-1"],
        },
      ],
    });

    expect(result.summary).toMatchObject({ rows: 1, created: 1, updated: 0 });

    const batch = await prisma.importBatch.findUnique({
      where: { id: result.batch.id },
      include: { entities: true },
    });
    expect(batch).not.toBeNull();

    const entityTypes = new Set((batch?.entities ?? []).map((entity) => entity.entityType));
    expect(entityTypes.has("Product")).toBe(true);
    expect(entityTypes.has("ProductBarcode")).toBe(true);

    const product = await prisma.product.findUnique({
      where: { organizationId_sku: { organizationId: org.id, sku: "IMP-1" } },
    });
    expect(product?.isDeleted).toBe(false);
  });

  it("imports pricing fields and keeps imported local product image url", async () => {
    const { org, adminUser, baseUnit } = await seedBase({ plan: "BUSINESS" });

    await runProductImport({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-import-pricing-1",
      source: "cloudshop",
      rows: [
        {
          sku: "IMP-PRICE-1",
          name: "Imported With Pricing",
          unit: baseUnit.code,
          photoUrl: "/uploads/imported-products/test-org/hash.jpg",
          basePriceKgs: 150,
          purchasePriceKgs: 120,
          avgCostKgs: 118,
        },
      ],
    });

    const product = await prisma.product.findUnique({
      where: { organizationId_sku: { organizationId: org.id, sku: "IMP-PRICE-1" } },
      include: { images: true },
    });
    expect(product).not.toBeNull();
    expect(product?.basePriceKgs ? Number(product.basePriceKgs) : null).toBe(150);
    expect(product?.photoUrl).toBe("/uploads/imported-products/test-org/hash.jpg");
    expect(product?.images[0]?.url).toBe("/uploads/imported-products/test-org/hash.jpg");

    const baseCost = await prisma.productCost.findUnique({
      where: {
        organizationId_productId_variantKey: {
          organizationId: org.id,
          productId: product!.id,
          variantKey: "BASE",
        },
      },
    });
    expect(baseCost?.avgCostKgs ? Number(baseCost.avgCostKgs) : null).toBe(118);
  });

  it("rolls back imported products by archiving and removing barcodes", async () => {
    const { org, adminUser, baseUnit } = await seedBase({ plan: "BUSINESS" });

    const result = await runProductImport({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-import-batch-2",
      rows: [
        {
          sku: "IMP-2",
          name: "Rollback Product",
          unit: baseUnit.code,
          barcodes: ["IMP-BC-2"],
        },
      ],
    });

    const rollback = await rollbackImportBatch({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-import-rollback-1",
      batchId: result.batch.id,
    });

    expect(rollback.summary.archivedProducts).toBe(1);

    const product = await prisma.product.findUnique({
      where: { organizationId_sku: { organizationId: org.id, sku: "IMP-2" } },
    });
    expect(product?.isDeleted).toBe(true);

    const barcode = await prisma.productBarcode.findUnique({
      where: { organizationId_value: { organizationId: org.id, value: "IMP-BC-2" } },
    });
    expect(barcode).toBeNull();

    const batch = await prisma.importBatch.findUnique({ where: { id: result.batch.id } });
    expect(batch?.rolledBackAt).not.toBeNull();

    const report = await prisma.importRollbackReport.findUnique({
      where: { batchId: result.batch.id },
    });
    expect(report?.summary).toBeTruthy();
  });

  it("restores archived products when the same SKU is imported again", async () => {
    const { org, adminUser, baseUnit } = await seedBase({ plan: "BUSINESS" });

    const firstImport = await runProductImport({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-import-batch-restore-1",
      rows: [
        {
          sku: "IMP-RESTORE-1",
          name: "Archived Product",
          unit: baseUnit.code,
          barcodes: ["IMP-RESTORE-BC-1"],
        },
      ],
    });

    await rollbackImportBatch({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-import-batch-restore-rollback",
      batchId: firstImport.batch.id,
    });

    const archivedProduct = await prisma.product.findUnique({
      where: { organizationId_sku: { organizationId: org.id, sku: "IMP-RESTORE-1" } },
    });
    expect(archivedProduct?.isDeleted).toBe(true);

    await runProductImport({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-import-batch-restore-2",
      rows: [
        {
          sku: "IMP-RESTORE-1",
          name: "Restored Product",
          unit: baseUnit.code,
          barcodes: ["IMP-RESTORE-BC-1"],
        },
      ],
    });

    const restoredProduct = await prisma.product.findUnique({
      where: { organizationId_sku: { organizationId: org.id, sku: "IMP-RESTORE-1" } },
    });
    expect(restoredProduct?.isDeleted).toBe(false);
    expect(restoredProduct?.name).toBe("Restored Product");

    const restoredBarcode = await prisma.productBarcode.findUnique({
      where: { organizationId_value: { organizationId: org.id, value: "IMP-RESTORE-BC-1" } },
    });
    expect(restoredBarcode).not.toBeNull();
  });

  it("creates compensating movements when rolling back received purchase orders", async () => {
    const { org, store, supplier, product, adminUser } = await seedBase({ plan: "BUSINESS" });

    const po = await createPurchaseOrder({
      organizationId: org.id,
      storeId: store.id,
      supplierId: supplier.id,
      lines: [{ productId: product.id, qtyOrdered: 4 }],
      actorId: adminUser.id,
      requestId: "req-import-po-create",
      submit: true,
    });

    await approvePurchaseOrder({
      purchaseOrderId: po.id,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-import-po-approve",
    });

    await receivePurchaseOrder({
      purchaseOrderId: po.id,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-import-po-receive",
      idempotencyKey: "import-po-receive-1",
      lines: [{ lineId: po.lines[0].id, qtyReceived: 4 }],
    });

    const batch = await prisma.importBatch.create({
      data: {
        organizationId: org.id,
        type: "purchaseOrders",
        createdById: adminUser.id,
      },
    });
    await prisma.importedEntity.create({
      data: {
        batchId: batch.id,
        entityType: "PurchaseOrder",
        entityId: po.id,
      },
    });

    await rollbackImportBatch({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-import-po-rollback",
      batchId: batch.id,
    });

    const adjustments = await prisma.stockMovement.findMany({
      where: {
        referenceType: "IMPORT_ROLLBACK",
        referenceId: po.id,
        type: StockMovementType.ADJUSTMENT,
      },
    });
    const adjustmentTotal = adjustments.reduce((sum, movement) => sum + movement.qtyDelta, 0);
    expect(adjustmentTotal).toBe(-4);

    const snapshot = await prisma.inventorySnapshot.findFirst({
      where: { storeId: store.id, productId: product.id, variantKey: "BASE" },
    });
    expect(snapshot?.onHand).toBe(0);

    const updatedPo = await prisma.purchaseOrder.findUnique({ where: { id: po.id } });
    expect(updatedPo?.status).toBe(PurchaseOrderStatus.CANCELLED);
  });

  it("enforces admin-only rollback via tRPC", async () => {
    const { org, adminUser, managerUser, baseUnit } = await seedBase({ plan: "BUSINESS" });

    const result = await runProductImport({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-import-batch-3",
      rows: [
        {
          sku: "IMP-3",
          name: "RBAC Product",
          unit: baseUnit.code,
        },
      ],
    });

    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: managerUser.organizationId!,
    });

    await expect(caller.imports.rollback({ batchId: result.batch.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
