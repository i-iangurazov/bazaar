import { randomUUID } from "node:crypto";
import { PurchaseOrderStatus, StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";
import { applyStockMovement } from "@/server/services/inventory";
import {
  importProductsTx,
  resolveImportRowsPhotoUrlsForOrganization,
  type ImportProductsInput,
} from "@/server/services/products";
import { recordFirstEvent } from "@/server/services/productEvents";
import { assertCapacity, assertFeatureEnabled } from "@/server/services/planLimits";

export type RunProductImportInput = Omit<ImportProductsInput, "batchId"> & {
  source?: string;
};

const resolveImportTransactionTimeout = () => {
  const parsed = Number(process.env.IMPORT_TRANSACTION_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed >= 5_000) {
    return parsed;
  }
  return 120_000;
};

const importTransactionOptions = {
  maxWait: 10_000,
  timeout: resolveImportTransactionTimeout(),
} as const;

export const runProductImport = async (input: RunProductImportInput) => {
  await assertFeatureEnabled({ organizationId: input.organizationId, feature: "imports" });
  const importMode = input.mode ?? "full";
  const hasMinStockImport =
    input.rows.some((row) => row.minStock !== undefined) &&
    (importMode === "full" || input.updateMask?.includes("minStock"));
  if (hasMinStockImport && !input.storeId) {
    throw new AppError("storeRequired", "BAD_REQUEST", 400);
  }
  const targetStore = input.storeId
    ? await prisma.store.findFirst({
        where: {
          id: input.storeId,
          organizationId: input.organizationId,
        },
        select: { id: true, name: true },
      })
    : null;
  if (input.storeId && !targetStore) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }
  const photoResolution = await resolveImportRowsPhotoUrlsForOrganization(
    input.rows,
    input.organizationId,
  );
  const rows = photoResolution.rows;
  const uniqueSkus = Array.from(
    new Set(
      rows
        .map((row) => row.sku.trim())
        .filter((sku) => sku.length > 0),
    ),
  );
  const existingCount = uniqueSkus.length
    ? await prisma.product.count({
        where: {
          organizationId: input.organizationId,
          sku: { in: uniqueSkus },
        },
      })
    : 0;
  const netNewProducts = Math.max(0, uniqueSkus.length - existingCount);

  if (importMode === "full" && netNewProducts > 0) {
    await assertCapacity({
      organizationId: input.organizationId,
      kind: "products",
      add: netNewProducts,
    });
  }
  const result = await prisma.$transaction(
    async (tx) => {
      const batch = await tx.importBatch.create({
        data: {
          organizationId: input.organizationId,
          type: "products",
          createdById: input.actorId,
          summary: {
            source: input.source ?? "csv",
            mode: importMode,
            updateMask: input.updateMask ?? null,
            targetStoreId: targetStore?.id ?? null,
            targetStoreName: targetStore?.name ?? null,
            rows: rows.length,
          },
        },
      });

      const results = await importProductsTx(tx, {
        ...input,
        rows,
        batchId: batch.id,
      });

      const created = results.filter((row) => row.action === "created").length;
      const updated = results.filter((row) => row.action === "updated").length;
      const skipped = results.filter((row) => row.action === "skipped").length;

      const summary = {
        source: input.source ?? "csv",
        mode: importMode,
        updateMask: input.updateMask ?? null,
        targetStoreId: targetStore?.id ?? null,
        targetStoreName: targetStore?.name ?? null,
        rows: rows.length,
        created,
        updated,
        skipped,
        images: {
          downloaded: photoResolution.summary.downloaded,
          fallback: photoResolution.summary.fallback,
          missing: photoResolution.summary.missing,
        },
      };

      const updatedBatch = await tx.importBatch.update({
        where: { id: batch.id },
        data: { summary },
      });

      return { batch: updatedBatch, results, summary };
    },
    importTransactionOptions,
  );

  await recordFirstEvent({
    organizationId: input.organizationId,
    actorId: input.actorId,
    type: "first_import_completed",
    metadata: { batchId: result.batch.id },
  });

  return result;
};

export const listImportBatches = async (input: { organizationId: string }) => {
  await assertFeatureEnabled({ organizationId: input.organizationId, feature: "imports" });
  return prisma.importBatch.findMany({
    where: { organizationId: input.organizationId },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      rollbackReport: { select: { id: true, createdAt: true } },
      _count: { select: { entities: true } },
    },
    orderBy: { createdAt: "desc" },
  });
};

export const getImportBatch = async (input: { organizationId: string; batchId: string }) => {
  await assertFeatureEnabled({ organizationId: input.organizationId, feature: "imports" });
  const batch = await prisma.importBatch.findUnique({
    where: { id: input.batchId },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      rollbackReport: true,
    },
  });
  if (!batch || batch.organizationId !== input.organizationId) {
    throw new AppError("importBatchNotFound", "NOT_FOUND", 404);
  }

  const counts = await prisma.importedEntity.groupBy({
    by: ["entityType"],
    where: { batchId: input.batchId },
    _count: { _all: true },
  });

  return {
    batch,
    counts: counts.map((row) => ({
      entityType: row.entityType,
      count: row._count._all,
    })),
  };
};

const lockInventorySnapshot = async (
  tx: Parameters<typeof applyStockMovement>[0],
  input: {
    storeId: string;
    productId: string;
    variantId: string | null;
    allowNegativeStock: boolean;
  },
) => {
  const variantKey = input.variantId ?? "BASE";
  const snapshotCreatedAt = new Date();
  await tx.$executeRaw`
    INSERT INTO "InventorySnapshot" ("id", "storeId", "productId", "variantId", "variantKey", "onHand", "onOrder", "allowNegativeStock", "updatedAt")
    VALUES (${randomUUID()}, ${input.storeId}, ${input.productId}, ${input.variantId}, ${variantKey}, 0, 0, ${input.allowNegativeStock}, ${snapshotCreatedAt})
    ON CONFLICT ("storeId", "productId", "variantKey") DO NOTHING;
  `;

  const rows = await tx.$queryRaw<{ id: string; onOrder: number }[]>`
    SELECT "id", "onOrder" FROM "InventorySnapshot"
    WHERE "storeId" = ${input.storeId} AND "productId" = ${input.productId} AND "variantKey" = ${variantKey}
    FOR UPDATE
  `;

  const snapshot = rows[0];
  if (!snapshot) {
    throw new AppError("snapshotMissing", "NOT_FOUND", 404);
  }

  return snapshot;
};

const adjustOnOrder = async (
  tx: Parameters<typeof applyStockMovement>[0],
  input: {
    storeId: string;
    productId: string;
    variantId: string | null;
    delta: number;
    allowNegativeStock: boolean;
  },
) => {
  const snapshot = await lockInventorySnapshot(tx, input);
  const nextOnOrder = snapshot.onOrder + input.delta;
  if (nextOnOrder < 0) {
    throw new AppError("onOrderNegative", "CONFLICT", 409);
  }

  return tx.inventorySnapshot.update({
    where: { id: snapshot.id },
    data: {
      onOrder: nextOnOrder,
      allowNegativeStock: input.allowNegativeStock,
    },
  });
};

export const rollbackImportBatch = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  batchId: string;
}) => {
  await assertFeatureEnabled({ organizationId: input.organizationId, feature: "imports" });
  return prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.findUnique({
      where: { id: input.batchId },
      include: { entities: true },
    });

    if (!batch || batch.organizationId !== input.organizationId) {
      throw new AppError("importBatchNotFound", "NOT_FOUND", 404);
    }
    if (batch.rolledBackAt) {
      throw new AppError("importAlreadyRolledBack", "CONFLICT", 409);
    }

    const byType = new Map<string, string[]>();
    for (const entity of batch.entities) {
      const list = byType.get(entity.entityType) ?? [];
      list.push(entity.entityId);
      byType.set(entity.entityType, list);
    }

    let adjustments = 0;
    let cancelledPurchaseOrders = 0;

    const purchaseOrderIds = byType.get("PurchaseOrder") ?? [];
    if (purchaseOrderIds.length) {
      const purchaseOrders = await tx.purchaseOrder.findMany({
        where: { id: { in: purchaseOrderIds }, organizationId: input.organizationId },
        include: { lines: true, store: true },
      });

      for (const po of purchaseOrders) {
        const needsReceiveRollback =
          po.status === PurchaseOrderStatus.RECEIVED ||
          po.status === PurchaseOrderStatus.PARTIALLY_RECEIVED;

        if (needsReceiveRollback) {
          const movements = await tx.stockMovement.findMany({
            where: {
              referenceType: "PURCHASE_ORDER",
              referenceId: po.id,
              type: StockMovementType.RECEIVE,
            },
          });

          for (const movement of movements) {
            const adjustment = await applyStockMovement(tx, {
              storeId: movement.storeId,
              productId: movement.productId,
              variantId: movement.variantId ?? undefined,
              qtyDelta: -movement.qtyDelta,
              type: StockMovementType.ADJUSTMENT,
              referenceType: "IMPORT_ROLLBACK",
              referenceId: po.id,
              note: "importRollback",
              actorId: input.actorId,
              organizationId: input.organizationId,
            });

            if (movement.stockLotId) {
              const lot = await tx.stockLot.findUnique({ where: { id: movement.stockLotId } });
              if (lot) {
                const nextQty = lot.onHandQty - movement.qtyDelta;
                if (!po.store.allowNegativeStock && nextQty < 0) {
                  throw new AppError("insufficientStock", "CONFLICT", 409);
                }
                await tx.stockLot.update({
                  where: { id: lot.id },
                  data: { onHandQty: nextQty },
                });
                await tx.stockMovement.update({
                  where: { id: adjustment.movementId },
                  data: { stockLotId: lot.id },
                });
              }
            }

            adjustments += 1;
          }
        }

        const shouldAdjustOnOrder =
          po.status === PurchaseOrderStatus.SUBMITTED ||
          po.status === PurchaseOrderStatus.APPROVED ||
          po.status === PurchaseOrderStatus.PARTIALLY_RECEIVED;
        if (shouldAdjustOnOrder) {
          const remaining = po.lines.filter((line) => line.qtyOrdered > line.qtyReceived);
          for (const line of remaining) {
            const delta = -(line.qtyOrdered - line.qtyReceived);
            if (delta === 0) {
              continue;
            }
            await adjustOnOrder(tx, {
              storeId: po.storeId,
              productId: line.productId,
              variantId: line.variantId ?? null,
              delta,
              allowNegativeStock: po.store.allowNegativeStock,
            });
          }
        }

        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            status: PurchaseOrderStatus.CANCELLED,
            updatedById: input.actorId,
          },
        });

        cancelledPurchaseOrders += 1;
      }
    }

    const productIds = byType.get("Product") ?? [];
    const barcodeIds = byType.get("ProductBarcode") ?? [];
    const attributeIds = byType.get("AttributeDefinition") ?? [];
    const reorderPolicyIds = byType.get("ReorderPolicy") ?? [];

    const archivedProducts = productIds.length
      ? await tx.product.updateMany({
          where: { id: { in: productIds }, organizationId: input.organizationId, isDeleted: false },
          data: { isDeleted: true },
        })
      : { count: 0 };

    const removedBarcodes = barcodeIds.length
      ? await tx.productBarcode.deleteMany({
          where: { id: { in: barcodeIds }, organizationId: input.organizationId },
        })
      : { count: 0 };

    const attributeKeys = attributeIds.length
      ? (
          await tx.attributeDefinition.findMany({
            where: { id: { in: attributeIds }, organizationId: input.organizationId },
            select: { key: true },
          })
        ).map((item) => item.key)
      : [];

    const removedTemplates = attributeKeys.length
      ? await tx.categoryAttributeTemplate.deleteMany({
          where: {
            organizationId: input.organizationId,
            attributeKey: { in: attributeKeys },
          },
        })
      : { count: 0 };

    const deactivatedAttributes = attributeIds.length
      ? await tx.attributeDefinition.updateMany({
          where: { id: { in: attributeIds }, organizationId: input.organizationId, isActive: true },
          data: { isActive: false },
        })
      : { count: 0 };

    const removedReorderPolicies = reorderPolicyIds.length
      ? await tx.reorderPolicy.deleteMany({
          where: { id: { in: reorderPolicyIds } },
        })
      : { count: 0 };

    const summary = {
      archivedProducts: archivedProducts.count,
      removedBarcodes: removedBarcodes.count,
      removedTemplates: removedTemplates.count,
      deactivatedAttributes: deactivatedAttributes.count,
      removedReorderPolicies: removedReorderPolicies.count,
      cancelledPurchaseOrders,
      adjustments,
    };

    const report = await tx.importRollbackReport.create({
      data: {
        batchId: batch.id,
        createdById: input.actorId,
        summary,
      },
    });

    await tx.importBatch.update({
      where: { id: batch.id },
      data: {
        rolledBackAt: new Date(),
        rolledBackById: input.actorId,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "IMPORT_ROLLBACK",
      entity: "ImportBatch",
      entityId: batch.id,
      before: toJson({ rolledBackAt: batch.rolledBackAt }),
      after: toJson(summary),
      requestId: input.requestId,
    });

    return { batchId: batch.id, reportId: report.id, summary };
  });
};
