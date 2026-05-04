import { randomUUID } from "node:crypto";
import type { InventorySnapshot, Prisma } from "@prisma/client";
import { PurchaseOrderStatus, StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { withIdempotency } from "@/server/services/idempotency";
import { eventBus } from "@/server/events/eventBus";
import { getLogger } from "@/server/logging";
import { toJson } from "@/server/services/json";
import { updateProductCost } from "@/server/services/productCost";
import { applyStockLotAdjustment } from "@/server/services/stockLots";
import { resolveBaseQuantity } from "@/server/services/uom";

export type StockAdjustmentInput = {
  storeId: string;
  productId: string;
  variantId?: string | null;
  qtyDelta: number;
  unitId?: string | null;
  packId?: string | null;
  reason: string;
  expiryDate?: Date | null;
  actorId: string;
  organizationId: string;
  requestId: string;
  idempotencyKey: string;
};

export type StockAdjustmentResult = {
  snapshotId: string;
  onHand: number;
  onOrder: number;
  movementId: string;
};

export type BulkSetOnHandInput = {
  storeId: string;
  snapshotIds: string[];
  targetOnHand: number;
  reason: string;
  actorId: string;
  organizationId: string;
  requestId: string;
  idempotencyKey: string;
};

export type BulkSetOnHandResult = {
  requestedCount: number;
  updatedCount: number;
  unchangedCount: number;
  targetOnHand: number;
};

export type ApplyStockMovementInput = {
  storeId: string;
  productId: string;
  variantId?: string | null;
  qtyDelta: number;
  type: StockMovementType;
  referenceType?: string;
  referenceId?: string;
  note?: string | null;
  actorId?: string | null;
  organizationId?: string;
};

const resolveVariantKey = (variantId?: string | null) => variantId ?? "BASE";

export const applyStockMovement = async (
  tx: Prisma.TransactionClient,
  input: ApplyStockMovementInput,
): Promise<{ snapshot: InventorySnapshot; movementId: string }> => {
  const store = await tx.store.findUnique({ where: { id: input.storeId } });
  if (!store) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }
  if (input.organizationId && store.organizationId !== input.organizationId) {
    throw new AppError("storeOrgMismatch", "FORBIDDEN", 403);
  }

  const product = await tx.product.findUnique({ where: { id: input.productId } });
  if (!product || product.isDeleted) {
    throw new AppError("productNotFound", "NOT_FOUND", 404);
  }
  if (input.organizationId && product.organizationId !== input.organizationId) {
    throw new AppError("productOrgMismatch", "FORBIDDEN", 403);
  }

  if (input.variantId) {
    const variant = await tx.productVariant.findUnique({
      where: { id: input.variantId },
      select: { productId: true, isActive: true },
    });
    if (!variant || variant.productId !== input.productId || !variant.isActive) {
      throw new AppError("variantNotFound", "NOT_FOUND", 404);
    }
  }

  const variantKey = resolveVariantKey(input.variantId);

  const snapshotCreatedAt = new Date();
  await tx.$executeRaw`
    INSERT INTO "InventorySnapshot" ("id", "storeId", "productId", "variantId", "variantKey", "onHand", "onOrder", "allowNegativeStock", "updatedAt")
    VALUES (${randomUUID()}, ${input.storeId}, ${input.productId}, ${input.variantId ?? null}, ${variantKey}, 0, 0, ${store.allowNegativeStock}, ${snapshotCreatedAt})
    ON CONFLICT ("storeId", "productId", "variantKey") DO NOTHING;
  `;

  const rows = await tx.$queryRaw<InventorySnapshot[]>`
    SELECT * FROM "InventorySnapshot"
    WHERE "storeId" = ${input.storeId} AND "productId" = ${input.productId} AND "variantKey" = ${variantKey}
    FOR UPDATE
  `;

  const snapshot = rows[0];
  if (!snapshot) {
    throw new AppError("snapshotMissing", "NOT_FOUND", 404);
  }

  const nextOnHand = snapshot.onHand + input.qtyDelta;
  if (!store.allowNegativeStock && nextOnHand < 0) {
    throw new AppError("insufficientStock", "CONFLICT", 409);
  }

  const updatedSnapshot = await tx.inventorySnapshot.update({
    where: { id: snapshot.id },
    data: {
      onHand: nextOnHand,
      allowNegativeStock: store.allowNegativeStock,
    },
  });

  const movement = await tx.stockMovement.create({
    data: {
      storeId: input.storeId,
      productId: input.productId,
      variantId: input.variantId ?? undefined,
      type: input.type,
      qtyDelta: input.qtyDelta,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      note: input.note ?? undefined,
      createdById: input.actorId ?? undefined,
    },
  });

  return { snapshot: updatedSnapshot, movementId: movement.id };
};

export const adjustStock = async (input: StockAdjustmentInput): Promise<StockAdjustmentResult> => {
  const logger = getLogger(input.requestId);
  const result = await prisma.$transaction(async (tx) => {
    const { result: adjustment } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "inventory.adjust",
        userId: input.actorId,
      },
      async () => {
        const product = await tx.product.findUnique({
          where: { id: input.productId },
          select: { organizationId: true, isDeleted: true, baseUnitId: true },
        });
        if (!product || product.isDeleted) {
          throw new AppError("productNotFound", "NOT_FOUND", 404);
        }
        if (product.organizationId !== input.organizationId) {
          throw new AppError("productOrgMismatch", "FORBIDDEN", 403);
        }

        const qtyDelta = await resolveBaseQuantity(tx, {
          organizationId: input.organizationId,
          productId: input.productId,
          baseUnitId: product.baseUnitId,
          qty: input.qtyDelta,
          unitId: input.unitId,
          packId: input.packId,
          mode: "inventory",
        });

        const before = await tx.inventorySnapshot.findUnique({
          where: {
            storeId_productId_variantKey: {
              storeId: input.storeId,
              productId: input.productId,
              variantKey: resolveVariantKey(input.variantId),
            },
          },
        });

        const { snapshot, movementId } = await applyStockMovement(tx, {
          storeId: input.storeId,
          productId: input.productId,
          variantId: input.variantId,
          qtyDelta,
          type: StockMovementType.ADJUSTMENT,
          note: input.reason,
          actorId: input.actorId,
          organizationId: input.organizationId,
        });

        const lot = await applyStockLotAdjustment(tx, {
          storeId: input.storeId,
          productId: input.productId,
          variantId: input.variantId,
          qtyDelta,
          expiryDate: input.expiryDate ?? null,
          organizationId: input.organizationId,
        });
        if (lot) {
          await tx.stockMovement.update({
            where: { id: movementId },
            data: { stockLotId: lot.id },
          });
        }

        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "INVENTORY_ADJUST",
          entity: "InventorySnapshot",
          entityId: snapshot.id,
          before: before ? toJson(before) : null,
          after: toJson(snapshot),
          requestId: input.requestId,
        });

        return {
          snapshotId: snapshot.id,
          onHand: snapshot.onHand,
          onOrder: snapshot.onOrder,
          movementId,
        };
      },
    );

    return adjustment;
  });

  eventBus.publish({
    type: "inventory.updated",
    payload: { storeId: input.storeId, productId: input.productId, variantId: input.variantId ?? null },
  });

  logger.info(
    { storeId: input.storeId, productId: input.productId, qtyDelta: input.qtyDelta },
    "inventory adjusted",
  );

  await maybeEmitLowStock({
    storeId: input.storeId,
    productId: input.productId,
    variantId: input.variantId ?? null,
    onHand: result.onHand,
    requestId: input.requestId,
  });

  return result;
};

export const bulkSetOnHand = async (
  input: BulkSetOnHandInput,
): Promise<BulkSetOnHandResult> => {
  const logger = getLogger(input.requestId);
  const snapshotIds = Array.from(new Set(input.snapshotIds.filter(Boolean)));
  if (!snapshotIds.length) {
    throw new AppError("inventorySelectionRequired", "BAD_REQUEST", 400);
  }
  if (input.targetOnHand < 0) {
    throw new AppError("inventoryOnHandNonNegative", "BAD_REQUEST", 400);
  }

  const changedItems: Array<{ storeId: string; productId: string; variantId: string | null }> = [];

  const result = await prisma.$transaction(async (tx) => {
    const { result: bulkResult } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "inventory.bulkSetOnHand",
        userId: input.actorId,
      },
      async () => {
        const store = await tx.store.findUnique({
          where: { id: input.storeId },
          select: { id: true, organizationId: true },
        });
        if (!store || store.organizationId !== input.organizationId) {
          throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
        }

        const snapshots = await tx.inventorySnapshot.findMany({
          where: {
            id: { in: snapshotIds },
            storeId: input.storeId,
            store: { organizationId: input.organizationId },
            product: { organizationId: input.organizationId, isDeleted: false },
          },
          include: {
            product: { select: { id: true, organizationId: true, isDeleted: true } },
          },
        });

        if (snapshots.length !== snapshotIds.length) {
          throw new AppError("inventorySelectionInvalid", "FORBIDDEN", 403);
        }

        let updatedCount = 0;
        for (const snapshot of snapshots) {
          const qtyDelta = input.targetOnHand - snapshot.onHand;
          if (qtyDelta === 0) {
            continue;
          }

          const { snapshot: updatedSnapshot, movementId } = await applyStockMovement(tx, {
            storeId: input.storeId,
            productId: snapshot.productId,
            variantId: snapshot.variantId,
            qtyDelta,
            type: StockMovementType.ADJUSTMENT,
            note: input.reason,
            actorId: input.actorId,
            organizationId: input.organizationId,
          });

          const lot = await applyStockLotAdjustment(tx, {
            storeId: input.storeId,
            productId: snapshot.productId,
            variantId: snapshot.variantId,
            qtyDelta,
            expiryDate: null,
            organizationId: input.organizationId,
          });
          if (lot) {
            await tx.stockMovement.update({
              where: { id: movementId },
              data: { stockLotId: lot.id },
            });
          }

          await writeAuditLog(tx, {
            organizationId: input.organizationId,
            actorId: input.actorId,
            action: "INVENTORY_BULK_SET_ON_HAND",
            entity: "InventorySnapshot",
            entityId: updatedSnapshot.id,
            before: toJson(snapshot),
            after: toJson(updatedSnapshot),
            requestId: input.requestId,
          });

          updatedCount += 1;
          changedItems.push({
            storeId: input.storeId,
            productId: snapshot.productId,
            variantId: snapshot.variantId ?? null,
          });
        }

        return {
          requestedCount: snapshotIds.length,
          updatedCount,
          unchangedCount: snapshotIds.length - updatedCount,
          targetOnHand: input.targetOnHand,
        };
      },
    );

    return bulkResult as BulkSetOnHandResult;
  });

  changedItems.forEach((item) => {
    eventBus.publish({
      type: "inventory.updated",
      payload: item,
    });
  });

  logger.info(
    {
      storeId: input.storeId,
      requestedCount: result.requestedCount,
      updatedCount: result.updatedCount,
      targetOnHand: input.targetOnHand,
    },
    "inventory bulk on hand adjusted",
  );

  return result;
};

export type ReceiveStockInput = {
  storeId: string;
  productId: string;
  variantId?: string | null;
  qtyReceived: number;
  unitId?: string | null;
  packId?: string | null;
  unitCost?: number | null;
  expiryDate?: Date | null;
  note?: string | null;
  actorId: string;
  organizationId: string;
  requestId: string;
  idempotencyKey: string;
};

export const receiveStock = async (input: ReceiveStockInput): Promise<StockAdjustmentResult> => {
  const logger = getLogger(input.requestId);
  const result = await prisma.$transaction(async (tx) => {
    const { result: receipt } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "inventory.receive",
        userId: input.actorId,
      },
      async () => {
        const product = await tx.product.findUnique({
          where: { id: input.productId },
          select: { organizationId: true, isDeleted: true, baseUnitId: true },
        });
        if (!product || product.isDeleted) {
          throw new AppError("productNotFound", "NOT_FOUND", 404);
        }
        if (product.organizationId !== input.organizationId) {
          throw new AppError("productOrgMismatch", "FORBIDDEN", 403);
        }

        const qtyReceived = await resolveBaseQuantity(tx, {
          organizationId: input.organizationId,
          productId: input.productId,
          baseUnitId: product.baseUnitId,
          qty: input.qtyReceived,
          unitId: input.unitId,
          packId: input.packId,
          mode: "receiving",
        });

        const before = await tx.inventorySnapshot.findUnique({
          where: {
            storeId_productId_variantKey: {
              storeId: input.storeId,
              productId: input.productId,
              variantKey: resolveVariantKey(input.variantId),
            },
          },
        });

        const { snapshot, movementId } = await applyStockMovement(tx, {
          storeId: input.storeId,
          productId: input.productId,
          variantId: input.variantId,
          qtyDelta: qtyReceived,
          type: StockMovementType.RECEIVE,
          note: input.note ?? undefined,
          actorId: input.actorId,
          organizationId: input.organizationId,
        });

        const lot = await applyStockLotAdjustment(tx, {
          storeId: input.storeId,
          productId: input.productId,
          variantId: input.variantId,
          qtyDelta: qtyReceived,
          expiryDate: input.expiryDate ?? null,
          organizationId: input.organizationId,
        });
        if (lot) {
          await tx.stockMovement.update({
            where: { id: movementId },
            data: { stockLotId: lot.id },
          });
        }

        if (input.unitCost !== null && input.unitCost !== undefined) {
          await updateProductCost(tx, {
            organizationId: input.organizationId,
            productId: input.productId,
            variantId: input.variantId,
            qtyReceived,
            unitCost: input.unitCost,
          });
        }

        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "INVENTORY_RECEIVE",
          entity: "InventorySnapshot",
          entityId: snapshot.id,
          before: before ? toJson(before) : null,
          after: toJson(snapshot),
          requestId: input.requestId,
        });

        return {
          snapshotId: snapshot.id,
          onHand: snapshot.onHand,
          onOrder: snapshot.onOrder,
          movementId,
        };
      },
    );

    return receipt;
  });

  eventBus.publish({
    type: "inventory.updated",
    payload: { storeId: input.storeId, productId: input.productId, variantId: input.variantId ?? null },
  });

  logger.info(
    { storeId: input.storeId, productId: input.productId, qty: input.qtyReceived },
    "inventory received",
  );

  await maybeEmitLowStock({
    storeId: input.storeId,
    productId: input.productId,
    variantId: input.variantId ?? null,
    onHand: result.onHand,
    requestId: input.requestId,
  });

  return result;
};

export type TransferStockInput = {
  fromStoreId: string;
  toStoreId: string;
  productId: string;
  variantId?: string | null;
  qty: number;
  unitId?: string | null;
  packId?: string | null;
  note?: string | null;
  expiryDate?: Date | null;
  actorId: string;
  organizationId: string;
  requestId: string;
  idempotencyKey: string;
};

export const transferStock = async (input: TransferStockInput) => {
  const logger = getLogger(input.requestId);
  if (input.fromStoreId === input.toStoreId) {
    throw new AppError("transferSameStore", "BAD_REQUEST", 400);
  }
  if (input.qty <= 0) {
    throw new AppError("invalidTransferQty", "BAD_REQUEST", 400);
  }
  const transferId = randomUUID();
  const result = await prisma.$transaction(async (tx) => {
    const { result: transfer } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "inventory.transfer",
        userId: input.actorId,
      },
      async () => {
        const product = await tx.product.findUnique({
          where: { id: input.productId },
          select: { organizationId: true, isDeleted: true, baseUnitId: true },
        });
        if (!product || product.isDeleted) {
          throw new AppError("productNotFound", "NOT_FOUND", 404);
        }
        if (product.organizationId !== input.organizationId) {
          throw new AppError("productOrgMismatch", "FORBIDDEN", 403);
        }

        const qty = await resolveBaseQuantity(tx, {
          organizationId: input.organizationId,
          productId: input.productId,
          baseUnitId: product.baseUnitId,
          qty: input.qty,
          unitId: input.unitId,
          packId: input.packId,
          mode: "inventory",
        });

        const outBefore = await tx.inventorySnapshot.findUnique({
          where: {
            storeId_productId_variantKey: {
              storeId: input.fromStoreId,
              productId: input.productId,
              variantKey: resolveVariantKey(input.variantId),
            },
          },
        });

        const inBefore = await tx.inventorySnapshot.findUnique({
          where: {
            storeId_productId_variantKey: {
              storeId: input.toStoreId,
              productId: input.productId,
              variantKey: resolveVariantKey(input.variantId),
            },
          },
        });

        const outMovement = await applyStockMovement(tx, {
          storeId: input.fromStoreId,
          productId: input.productId,
          variantId: input.variantId,
          qtyDelta: -Math.abs(qty),
          type: StockMovementType.TRANSFER_OUT,
          referenceType: "TRANSFER",
          referenceId: transferId,
          note: input.note ?? undefined,
          actorId: input.actorId,
          organizationId: input.organizationId,
        });

        const inMovement = await applyStockMovement(tx, {
          storeId: input.toStoreId,
          productId: input.productId,
          variantId: input.variantId,
          qtyDelta: Math.abs(qty),
          type: StockMovementType.TRANSFER_IN,
          referenceType: "TRANSFER",
          referenceId: transferId,
          note: input.note ?? undefined,
          actorId: input.actorId,
          organizationId: input.organizationId,
        });

        const outLot = await applyStockLotAdjustment(tx, {
          storeId: input.fromStoreId,
          productId: input.productId,
          variantId: input.variantId,
          qtyDelta: -Math.abs(qty),
          expiryDate: input.expiryDate ?? null,
          organizationId: input.organizationId,
        });
        if (outLot) {
          await tx.stockMovement.update({
            where: { id: outMovement.movementId },
            data: { stockLotId: outLot.id },
          });
        }
        const inLot = await applyStockLotAdjustment(tx, {
          storeId: input.toStoreId,
          productId: input.productId,
          variantId: input.variantId,
          qtyDelta: Math.abs(qty),
          expiryDate: input.expiryDate ?? null,
          organizationId: input.organizationId,
        });
        if (inLot) {
          await tx.stockMovement.update({
            where: { id: inMovement.movementId },
            data: { stockLotId: inLot.id },
          });
        }

        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "INVENTORY_TRANSFER_OUT",
          entity: "InventorySnapshot",
          entityId: outMovement.snapshot.id,
          before: outBefore ? toJson(outBefore) : null,
          after: toJson(outMovement.snapshot),
          requestId: input.requestId,
        });

        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "INVENTORY_TRANSFER_IN",
          entity: "InventorySnapshot",
          entityId: inMovement.snapshot.id,
          before: inBefore ? toJson(inBefore) : null,
          after: toJson(inMovement.snapshot),
          requestId: input.requestId,
        });

        return {
          outSnapshot: outMovement.snapshot,
          inSnapshot: inMovement.snapshot,
        };
      },
    );

    return transfer;
  });

  eventBus.publish({
    type: "inventory.updated",
    payload: { storeId: input.fromStoreId, productId: input.productId, variantId: input.variantId ?? null },
  });
  eventBus.publish({
    type: "inventory.updated",
    payload: { storeId: input.toStoreId, productId: input.productId, variantId: input.variantId ?? null },
  });

  logger.info(
    {
      fromStoreId: input.fromStoreId,
      toStoreId: input.toStoreId,
      productId: input.productId,
      qty: input.qty,
    },
    "inventory transferred",
  );

  await maybeEmitLowStock({
    storeId: input.fromStoreId,
    productId: input.productId,
    variantId: input.variantId ?? null,
    onHand: result.outSnapshot.onHand,
    requestId: input.requestId,
  });

  return result;
};

const maybeEmitLowStock = async (input: {
  storeId: string;
  productId: string;
  variantId?: string | null;
  onHand: number;
  requestId: string;
}) => {
  const policy = await prisma.reorderPolicy.findUnique({
    where: { storeId_productId: { storeId: input.storeId, productId: input.productId } },
  });
  const minStock = policy?.minStock ?? 0;
  if (minStock > 0 && input.onHand <= minStock) {
    eventBus.publish({
      type: "lowStock.triggered",
      payload: {
        storeId: input.storeId,
        productId: input.productId,
        variantId: input.variantId ?? null,
        onHand: input.onHand,
        minStock,
      },
    });
    getLogger(input.requestId).info(
      { storeId: input.storeId, productId: input.productId, onHand: input.onHand, minStock },
      "low stock threshold reached",
    );
  }
};
export type RecomputeInventoryInput = {
  storeId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
};

export const recomputeInventorySnapshots = async (input: RecomputeInventoryInput) => {
  const logger = getLogger(input.requestId);

  const result = await prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({ where: { id: input.storeId } });
    if (!store) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }
    if (store.organizationId !== input.organizationId) {
      throw new AppError("storeOrgMismatch", "FORBIDDEN", 403);
    }

    const movementAggregates = await tx.stockMovement.groupBy({
      by: ["productId", "variantId"],
      where: { storeId: input.storeId },
      _sum: { qtyDelta: true },
    });

    const onHandMap = new Map<string, number>();
    for (const row of movementAggregates) {
      const variantKey = resolveVariantKey(row.variantId);
      onHandMap.set(`${row.productId}:${variantKey}`, row._sum?.qtyDelta ?? 0);
    }

    const openLines = await tx.purchaseOrderLine.findMany({
      where: {
        purchaseOrder: {
          storeId: input.storeId,
          status: { in: [PurchaseOrderStatus.SUBMITTED, PurchaseOrderStatus.APPROVED] },
        },
      },
      select: { productId: true, variantId: true, qtyOrdered: true, qtyReceived: true },
    });

    const onOrderMap = new Map<string, number>();
    for (const line of openLines) {
      const remaining = line.qtyOrdered - line.qtyReceived;
      if (remaining <= 0) {
        continue;
      }
      const variantKey = resolveVariantKey(line.variantId);
      const mapKey = `${line.productId}:${variantKey}`;
      onOrderMap.set(mapKey, (onOrderMap.get(mapKey) ?? 0) + remaining);
    }

    const existingSnapshots = await tx.inventorySnapshot.findMany({
      where: { storeId: input.storeId },
    });
    const snapshotMap = new Map(
      existingSnapshots.map((snapshot) => [
        `${snapshot.productId}:${snapshot.variantKey}`,
        snapshot,
      ]),
    );

    const snapshotKeys = new Set<string>([
      ...onHandMap.keys(),
      ...onOrderMap.keys(),
      ...snapshotMap.keys(),
    ]);

    const updatedSnapshots: InventorySnapshot[] = [];
    for (const snapshotKey of snapshotKeys) {
      const [productId, variantKey] = snapshotKey.split(":");
      const onHand = onHandMap.get(snapshotKey) ?? 0;
      const onOrder = onOrderMap.get(snapshotKey) ?? 0;

      if (!store.allowNegativeStock && onHand < 0) {
        throw new AppError("negativeStockNotAllowed", "CONFLICT", 409);
      }

      const before = snapshotMap.get(snapshotKey) ?? null;
      const resolvedVariantId =
        before?.variantId ?? (variantKey === "BASE" ? null : variantKey);
      const updated = await tx.inventorySnapshot.upsert({
        where: {
          storeId_productId_variantKey: {
            storeId: input.storeId,
            productId,
            variantKey,
          },
        },
        update: {
          onHand,
          onOrder,
          allowNegativeStock: store.allowNegativeStock,
        },
        create: {
          storeId: input.storeId,
          productId,
          variantKey,
          variantId: resolvedVariantId,
          onHand,
          onOrder,
          allowNegativeStock: store.allowNegativeStock,
        },
      });

      await writeAuditLog(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "INVENTORY_RECOMPUTE",
        entity: "InventorySnapshot",
        entityId: updated.id,
        before: before ? toJson(before) : null,
        after: toJson(updated),
        requestId: input.requestId,
      });

      updatedSnapshots.push(updated);
    }

    return { updatedCount: updatedSnapshots.length };
  });

  logger.info(
    { storeId: input.storeId, updatedCount: result.updatedCount },
    "inventory snapshots recomputed",
  );

  return result;
};
