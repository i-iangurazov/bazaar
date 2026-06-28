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
import {
  assertUserCanAccessStore,
  assignProductToStore,
  type StoreAccessUser,
} from "@/server/services/storeAccess";
import {
  buildWriteOffMovementNote,
  isStockWriteOffReason,
  type StockWriteOffReason,
} from "@/lib/inventory/writeOff";

const BULK_SET_ON_HAND_TRANSACTION_CHUNK_SIZE = 10;

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

type BulkSetOnHandChunkResult = BulkSetOnHandResult & {
  changedItems: Array<{ storeId: string; productId: string; variantId: string | null }>;
};

export type ApplyStockMovementInput = {
  storeId: string;
  productId: string;
  variantId?: string | null;
  qtyDelta: number;
  type: StockMovementType;
  referenceType?: string;
  referenceId?: string;
  linePosition?: number | null;
  unitCostKgs?: number | null;
  lineTotalKgs?: number | null;
  note?: string | null;
  actorId?: string | null;
  organizationId?: string;
  allowNegativeStock?: boolean;
  movementDate?: Date | null;
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
  await assignProductToStore(tx, {
    organizationId: input.organizationId ?? store.organizationId,
    storeId: input.storeId,
    productId: input.productId,
    actorId: input.actorId,
  });

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

  const effectiveAllowNegativeStock = store.allowNegativeStock || input.allowNegativeStock === true;
  const snapshotCreatedAt = new Date();
  await tx.$executeRaw`
    INSERT INTO "InventorySnapshot" ("id", "storeId", "productId", "variantId", "variantKey", "onHand", "onOrder", "allowNegativeStock", "updatedAt")
    VALUES (${randomUUID()}, ${input.storeId}, ${input.productId}, ${input.variantId ?? null}, ${variantKey}, 0, 0, ${effectiveAllowNegativeStock}, ${snapshotCreatedAt})
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
  if (!effectiveAllowNegativeStock && nextOnHand < 0) {
    throw new AppError("insufficientStock", "CONFLICT", 409);
  }

  const updatedSnapshot = await tx.inventorySnapshot.update({
    where: { id: snapshot.id },
    data: {
      onHand: nextOnHand,
      allowNegativeStock: effectiveAllowNegativeStock,
    },
  });

  const movement = await tx.stockMovement.create({
    data: {
      storeId: input.storeId,
      productId: input.productId,
      variantId: input.variantId ?? undefined,
      type: input.type,
      qtyDelta: input.qtyDelta,
      linePosition: input.linePosition ?? undefined,
      unitCostKgs: input.unitCostKgs ?? undefined,
      lineTotalKgs: input.lineTotalKgs ?? undefined,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      note: input.note ?? undefined,
      createdById: input.actorId ?? undefined,
      createdAt: input.movementDate ?? undefined,
    },
  });

  return { snapshot: updatedSnapshot, movementId: movement.id };
};

export const adjustStock = async (input: StockAdjustmentInput): Promise<StockAdjustmentResult> => {
  if (input.qtyDelta === 0) {
    throw new AppError("nonZeroAdjustment", "BAD_REQUEST", 400);
  }
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
          allowNegativeStock: true,
        });

        const lot = await applyStockLotAdjustment(tx, {
          storeId: input.storeId,
          productId: input.productId,
          variantId: input.variantId,
          qtyDelta,
          expiryDate: input.expiryDate ?? null,
          organizationId: input.organizationId,
          allowNegativeStock: true,
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
    payload: {
      storeId: input.storeId,
      productId: input.productId,
      variantId: input.variantId ?? null,
    },
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

export const bulkSetOnHand = async (input: BulkSetOnHandInput): Promise<BulkSetOnHandResult> => {
  const logger = getLogger(input.requestId);
  const snapshotIds = Array.from(new Set(input.snapshotIds.filter(Boolean)));
  if (!snapshotIds.length) {
    throw new AppError("inventorySelectionRequired", "BAD_REQUEST", 400);
  }

  const chunks: string[][] = [];
  for (
    let index = 0;
    index < snapshotIds.length;
    index += BULK_SET_ON_HAND_TRANSACTION_CHUNK_SIZE
  ) {
    chunks.push(snapshotIds.slice(index, index + BULK_SET_ON_HAND_TRANSACTION_CHUNK_SIZE));
  }

  const changedItems: BulkSetOnHandChunkResult["changedItems"] = [];
  let updatedCount = 0;
  let unchangedCount = 0;

  for (const [chunkIndex, chunkSnapshotIds] of chunks.entries()) {
    const chunkResult = await prisma.$transaction(
      async (tx) => {
        const { result: bulkResult } = await withIdempotency(
          tx,
          {
            key: `${input.idempotencyKey}:${chunkIndex}`,
            route: "inventory.bulkSetOnHand",
            userId: input.actorId,
          },
          async () => {
            const chunkChangedItems: BulkSetOnHandChunkResult["changedItems"] = [];
            const store = await tx.store.findUnique({
              where: { id: input.storeId },
              select: { id: true, organizationId: true },
            });
            if (!store || store.organizationId !== input.organizationId) {
              throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
            }

            const snapshots = await tx.inventorySnapshot.findMany({
              where: {
                id: { in: chunkSnapshotIds },
                storeId: input.storeId,
                store: { organizationId: input.organizationId },
                product: { organizationId: input.organizationId, isDeleted: false },
              },
              include: {
                product: { select: { id: true, organizationId: true, isDeleted: true } },
              },
            });

            if (snapshots.length !== chunkSnapshotIds.length) {
              throw new AppError("inventorySelectionInvalid", "FORBIDDEN", 403);
            }

            let chunkUpdatedCount = 0;
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
                allowNegativeStock: true,
              });

              const lot = await applyStockLotAdjustment(tx, {
                storeId: input.storeId,
                productId: snapshot.productId,
                variantId: snapshot.variantId,
                qtyDelta,
                expiryDate: null,
                organizationId: input.organizationId,
                allowNegativeStock: true,
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

              chunkUpdatedCount += 1;
              chunkChangedItems.push({
                storeId: input.storeId,
                productId: snapshot.productId,
                variantId: snapshot.variantId ?? null,
              });
            }

            return {
              requestedCount: chunkSnapshotIds.length,
              updatedCount: chunkUpdatedCount,
              unchangedCount: chunkSnapshotIds.length - chunkUpdatedCount,
              targetOnHand: input.targetOnHand,
              changedItems: chunkChangedItems,
            };
          },
        );

        return bulkResult as BulkSetOnHandChunkResult;
      },
      { timeout: 10_000 },
    );
    updatedCount += chunkResult.updatedCount;
    unchangedCount += chunkResult.unchangedCount;
    changedItems.push(...chunkResult.changedItems);
  }

  const result = {
    requestedCount: snapshotIds.length,
    updatedCount,
    unchangedCount,
    targetOnHand: input.targetOnHand,
  };

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
          allowNegativeStock: true,
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
    payload: {
      storeId: input.storeId,
      productId: input.productId,
      variantId: input.variantId ?? null,
    },
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

export type StockReceivingLineInput = {
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitCost: number;
};

export type StockReceivingInput = {
  storeId: string;
  date?: Date | null;
  supplierName?: string | null;
  note?: string | null;
  referenceNumber?: string | null;
  lines: StockReceivingLineInput[];
  actorId: string;
  organizationId: string;
  requestId: string;
  idempotencyKey: string;
};

export type StockReceivingResult = {
  receivingId: string;
  storeId: string;
  lineCount: number;
  totalQuantity: number;
  totalCostKgs: number;
  lines: Array<{
    productId: string;
    variantId: string | null;
    quantity: number;
    unitCost: number;
    snapshotId: string;
    onHand: number;
    movementId: string;
  }>;
};

export type StockWriteOffLineInput = {
  productId: string;
  variantId?: string | null;
  qty: number;
  unitId?: string | null;
  packId?: string | null;
};

export type StockWriteOffInput = {
  storeId: string;
  date?: Date | null;
  reason: StockWriteOffReason | string;
  comment?: string | null;
  lines: StockWriteOffLineInput[];
  actorId: string;
  organizationId: string;
  requestId: string;
  idempotencyKey: string;
};

export type StockWriteOffResult = {
  writeOffId: string;
  storeId: string;
  reason: StockWriteOffReason;
  comment: string | null;
  lineCount: number;
  totalQuantity: number;
  totalCostKgs: number | null;
  lines: Array<{
    productId: string;
    variantId: string | null;
    quantity: number;
    unitCost: number | null;
    snapshotId: string;
    onHand: number;
    movementId: string;
  }>;
};

const buildReceivingMovementNote = (input: {
  referenceNumber?: string | null;
  supplierName?: string | null;
  note?: string | null;
}) =>
  [
    input.referenceNumber?.trim()
      ? `Оприходование ${input.referenceNumber.trim()}`
      : "Оприходование",
    input.supplierName?.trim() ? `Поставщик: ${input.supplierName.trim()}` : null,
    input.note?.trim() ? input.note.trim() : null,
  ]
    .filter(Boolean)
    .join(" • ");

export const postStockReceiving = async (
  input: StockReceivingInput,
): Promise<StockReceivingResult> => {
  const logger = getLogger(input.requestId);
  if (!input.lines.length) {
    throw new AppError("receivingLinesRequired", "BAD_REQUEST", 400);
  }

  const receivingId = randomUUID();
  const movementNote = buildReceivingMovementNote(input);
  const changedItems: Array<{
    storeId: string;
    productId: string;
    variantId: string | null;
    onHand: number;
  }> = [];

  const result = await prisma.$transaction(async (tx) => {
    const { result: receipt } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "inventory.stockReceiving",
        userId: input.actorId,
      },
      async () => {
        const store = await tx.store.findFirst({
          where: { id: input.storeId, organizationId: input.organizationId },
          select: { id: true },
        });
        if (!store) {
          throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
        }

        const normalizedLines = input.lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId ?? null,
          variantKey: resolveVariantKey(line.variantId),
          quantity: line.quantity,
          unitCost: line.unitCost,
        }));
        const lineKeys = new Set<string>();
        for (const line of normalizedLines) {
          const key = `${line.productId}:${line.variantKey}`;
          if (lineKeys.has(key)) {
            throw new AppError("duplicateLineItem", "BAD_REQUEST", 400);
          }
          lineKeys.add(key);
          if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
            throw new AppError("invalidReceivingQuantity", "BAD_REQUEST", 400);
          }
          if (!Number.isFinite(line.unitCost) || line.unitCost < 0) {
            throw new AppError("unitCostInvalid", "BAD_REQUEST", 400);
          }
        }

        const productIds = Array.from(new Set(normalizedLines.map((line) => line.productId)));
        const products = await tx.product.findMany({
          where: {
            id: { in: productIds },
            organizationId: input.organizationId,
            isDeleted: false,
            storeProducts: {
              some: {
                storeId: input.storeId,
                isActive: true,
              },
            },
          },
          select: { id: true },
        });
        if (products.length !== productIds.length) {
          throw new AppError("invalidProducts", "FORBIDDEN", 403);
        }

        const variantIds = Array.from(
          new Set(normalizedLines.map((line) => line.variantId).filter(Boolean) as string[]),
        );
        if (variantIds.length) {
          const variants = await tx.productVariant.findMany({
            where: {
              id: { in: variantIds },
              isActive: true,
              product: { organizationId: input.organizationId, isDeleted: false },
            },
            select: { id: true, productId: true },
          });
          const variantProductMap = new Map(
            variants.map((variant) => [variant.id, variant.productId]),
          );
          for (const line of normalizedLines) {
            if (line.variantId && variantProductMap.get(line.variantId) !== line.productId) {
              throw new AppError("variantMismatch", "BAD_REQUEST", 400);
            }
          }
          if (variants.length !== variantIds.length) {
            throw new AppError("variantNotFound", "NOT_FOUND", 404);
          }
        }

        const lineResults: StockReceivingResult["lines"] = [];
        for (const [index, line] of normalizedLines.entries()) {
          const before = await tx.inventorySnapshot.findUnique({
            where: {
              storeId_productId_variantKey: {
                storeId: input.storeId,
                productId: line.productId,
                variantKey: line.variantKey,
              },
            },
          });

          const { snapshot, movementId } = await applyStockMovement(tx, {
            storeId: input.storeId,
            productId: line.productId,
            variantId: line.variantId,
            qtyDelta: line.quantity,
            type: StockMovementType.RECEIVE,
            referenceType: "STOCK_RECEIVING",
            referenceId: receivingId,
            linePosition: index + 1,
            unitCostKgs: line.unitCost,
            lineTotalKgs: line.quantity * line.unitCost,
            note: movementNote,
            actorId: input.actorId,
            organizationId: input.organizationId,
            movementDate: input.date ?? null,
            allowNegativeStock: true,
          });

          await updateProductCost(tx, {
            organizationId: input.organizationId,
            productId: line.productId,
            variantId: line.variantId,
            qtyReceived: line.quantity,
            unitCost: line.unitCost,
          });

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

          changedItems.push({
            storeId: input.storeId,
            productId: line.productId,
            variantId: line.variantId,
            onHand: snapshot.onHand,
          });
          lineResults.push({
            productId: line.productId,
            variantId: line.variantId,
            quantity: line.quantity,
            unitCost: line.unitCost,
            snapshotId: snapshot.id,
            onHand: snapshot.onHand,
            movementId,
          });
        }

        return {
          receivingId,
          storeId: input.storeId,
          lineCount: lineResults.length,
          totalQuantity: lineResults.reduce((sum, line) => sum + line.quantity, 0),
          totalCostKgs: lineResults.reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
          lines: lineResults,
        };
      },
    );

    return receipt as StockReceivingResult;
  });

  changedItems.forEach((item) => {
    eventBus.publish({
      type: "inventory.updated",
      payload: { storeId: item.storeId, productId: item.productId, variantId: item.variantId },
    });
  });

  await Promise.all(
    changedItems.map((item) =>
      maybeEmitLowStock({
        storeId: item.storeId,
        productId: item.productId,
        variantId: item.variantId,
        onHand: item.onHand,
        requestId: input.requestId,
      }),
    ),
  );

  logger.info(
    {
      storeId: input.storeId,
      receivingId: result.receivingId,
      lineCount: result.lineCount,
      totalQuantity: result.totalQuantity,
    },
    "stock receiving posted",
  );

  return result;
};

export const postStockWriteOff = async (
  input: StockWriteOffInput,
): Promise<StockWriteOffResult> => {
  const logger = getLogger(input.requestId);
  if (!input.lines.length) {
    throw new AppError("writeOffLinesRequired", "BAD_REQUEST", 400);
  }
  if (!isStockWriteOffReason(input.reason)) {
    throw new AppError("writeOffReasonRequired", "BAD_REQUEST", 400);
  }

  const writeOffId = randomUUID();
  const comment = input.comment?.trim() || null;
  const movementNote = buildWriteOffMovementNote({ reason: input.reason, comment });
  const changedItems: Array<{
    storeId: string;
    productId: string;
    variantId: string | null;
    onHand: number;
  }> = [];

  const result = await prisma.$transaction(async (tx) => {
    const { result: writeOff } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "inventory.stockWriteOff",
        userId: input.actorId,
      },
      async () => {
        const store = await tx.store.findFirst({
          where: { id: input.storeId, organizationId: input.organizationId },
          select: { id: true },
        });
        if (!store) {
          throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
        }

        const normalizedLines = input.lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId ?? null,
          variantKey: resolveVariantKey(line.variantId),
          qty: line.qty,
          unitId: line.unitId ?? null,
          packId: line.packId ?? null,
        }));
        const lineKeys = new Set<string>();
        for (const line of normalizedLines) {
          const key = `${line.productId}:${line.variantKey}`;
          if (lineKeys.has(key)) {
            throw new AppError("duplicateLineItem", "BAD_REQUEST", 400);
          }
          lineKeys.add(key);
          if (!Number.isInteger(line.qty) || line.qty <= 0) {
            throw new AppError("invalidWriteOffQty", "BAD_REQUEST", 400);
          }
        }

        const productIds = Array.from(new Set(normalizedLines.map((line) => line.productId)));
        const products = await tx.product.findMany({
          where: {
            id: { in: productIds },
            organizationId: input.organizationId,
            isDeleted: false,
            storeProducts: {
              some: {
                storeId: input.storeId,
                isActive: true,
              },
            },
          },
          select: { id: true, baseUnitId: true },
        });
        if (products.length !== productIds.length) {
          throw new AppError("invalidWriteOffProducts", "FORBIDDEN", 403);
        }
        const productMap = new Map(products.map((product) => [product.id, product]));

        const variantIds = Array.from(
          new Set(normalizedLines.map((line) => line.variantId).filter(Boolean) as string[]),
        );
        if (variantIds.length) {
          const variants = await tx.productVariant.findMany({
            where: {
              id: { in: variantIds },
              isActive: true,
              product: { organizationId: input.organizationId, isDeleted: false },
            },
            select: { id: true, productId: true },
          });
          const variantProductMap = new Map(
            variants.map((variant) => [variant.id, variant.productId]),
          );
          for (const line of normalizedLines) {
            if (line.variantId && variantProductMap.get(line.variantId) !== line.productId) {
              throw new AppError("variantMismatch", "BAD_REQUEST", 400);
            }
          }
          if (variants.length !== variantIds.length) {
            throw new AppError("variantNotFound", "NOT_FOUND", 404);
          }
        }

        const costs = await tx.productCost.findMany({
          where: {
            organizationId: input.organizationId,
            productId: { in: productIds },
          },
          select: { productId: true, variantKey: true, avgCostKgs: true },
        });
        const costMap = new Map(
          costs.map((cost) => [`${cost.productId}:${cost.variantKey}`, Number(cost.avgCostKgs)]),
        );

        const lineResults: StockWriteOffResult["lines"] = [];
        for (const [index, line] of normalizedLines.entries()) {
          const product = productMap.get(line.productId);
          if (!product) {
            throw new AppError("productNotFound", "NOT_FOUND", 404);
          }
          const qty = await resolveBaseQuantity(tx, {
            organizationId: input.organizationId,
            productId: line.productId,
            baseUnitId: product.baseUnitId,
            qty: line.qty,
            unitId: line.unitId,
            packId: line.packId,
            mode: "inventory",
          });
          if (!Number.isInteger(qty) || qty <= 0) {
            throw new AppError("invalidWriteOffQty", "BAD_REQUEST", 400);
          }

          const unitCost = costMap.get(`${line.productId}:${line.variantKey}`) ?? null;
          const lineTotal = unitCost !== null ? unitCost * qty : null;
          const before = await tx.inventorySnapshot.findUnique({
            where: {
              storeId_productId_variantKey: {
                storeId: input.storeId,
                productId: line.productId,
                variantKey: line.variantKey,
              },
            },
          });

          const { snapshot, movementId } = await applyStockMovement(tx, {
            storeId: input.storeId,
            productId: line.productId,
            variantId: line.variantId,
            qtyDelta: -Math.abs(qty),
            type: StockMovementType.WRITE_OFF,
            referenceType: "WRITE_OFF",
            referenceId: writeOffId,
            linePosition: index + 1,
            unitCostKgs: unitCost,
            lineTotalKgs: lineTotal,
            note: movementNote,
            actorId: input.actorId,
            organizationId: input.organizationId,
            movementDate: input.date ?? null,
            allowNegativeStock: true,
          });

          await writeAuditLog(tx, {
            organizationId: input.organizationId,
            actorId: input.actorId,
            action: "INVENTORY_WRITE_OFF",
            entity: "InventorySnapshot",
            entityId: snapshot.id,
            before: before ? toJson(before) : null,
            after: toJson(snapshot),
            requestId: input.requestId,
          });

          changedItems.push({
            storeId: input.storeId,
            productId: line.productId,
            variantId: line.variantId,
            onHand: snapshot.onHand,
          });
          lineResults.push({
            productId: line.productId,
            variantId: line.variantId,
            quantity: qty,
            unitCost,
            snapshotId: snapshot.id,
            onHand: snapshot.onHand,
            movementId,
          });
        }

        const lineTotals = lineResults.map((line) =>
          line.unitCost !== null ? line.unitCost * line.quantity : null,
        );
        const totalCostKgs = lineTotals.some((lineTotal) => lineTotal !== null)
          ? lineTotals.reduce<number>((sum, lineTotal) => sum + (lineTotal ?? 0), 0)
          : null;

        return {
          writeOffId,
          storeId: input.storeId,
          reason: input.reason,
          comment,
          lineCount: lineResults.length,
          totalQuantity: lineResults.reduce((sum, line) => sum + line.quantity, 0),
          totalCostKgs,
          lines: lineResults,
        };
      },
    );

    return writeOff as StockWriteOffResult;
  });

  changedItems.forEach((item) => {
    eventBus.publish({
      type: "inventory.updated",
      payload: { storeId: item.storeId, productId: item.productId, variantId: item.variantId },
    });
  });

  await Promise.all(
    changedItems.map((item) =>
      maybeEmitLowStock({
        storeId: item.storeId,
        productId: item.productId,
        variantId: item.variantId,
        onHand: item.onHand,
        requestId: input.requestId,
      }),
    ),
  );

  logger.info(
    {
      storeId: input.storeId,
      writeOffId: result.writeOffId,
      lineCount: result.lineCount,
      totalQuantity: result.totalQuantity,
      reason: result.reason,
    },
    "stock write-off posted",
  );

  return result;
};

export type TransferStockLineInput = {
  productId: string;
  variantId?: string | null;
  qty: number;
  unitId?: string | null;
  packId?: string | null;
  expiryDate?: Date | null;
};

export type TransferStockInput = {
  fromStoreId: string;
  toStoreId: string;
  lines?: TransferStockLineInput[];
  productId?: string;
  variantId?: string | null;
  qty?: number;
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
  const inputLines = input.lines?.length
    ? input.lines
    : input.productId && typeof input.qty === "number"
      ? [
          {
            productId: input.productId,
            variantId: input.variantId,
            qty: input.qty,
            unitId: input.unitId,
            packId: input.packId,
            expiryDate: input.expiryDate,
          },
        ]
      : [];
  if (!inputLines.length) {
    throw new AppError("invalidTransferQty", "BAD_REQUEST", 400);
  }
  const normalizedInputLines = inputLines.map((line) => ({
    productId: line.productId,
    variantId: line.variantId ?? null,
    variantKey: resolveVariantKey(line.variantId),
    qty: line.qty,
    unitId: line.unitId ?? null,
    packId: line.packId ?? null,
    expiryDate: line.expiryDate ?? null,
  }));
  const lineKeys = new Set<string>();
  for (const line of normalizedInputLines) {
    const key = `${line.productId}:${line.variantKey}`;
    if (lineKeys.has(key)) {
      throw new AppError("duplicateLineItem", "BAD_REQUEST", 400);
    }
    lineKeys.add(key);
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw new AppError("invalidTransferQty", "BAD_REQUEST", 400);
    }
  }
  const transferId = randomUUID();
  const changedItems: Array<{
    storeId: string;
    productId: string;
    variantId: string | null;
    onHand: number;
  }> = [];
  const result = await prisma.$transaction(async (tx) => {
    const { result: transfer } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "inventory.transfer",
        userId: input.actorId,
      },
      async () => {
        const productIds = Array.from(new Set(normalizedInputLines.map((line) => line.productId)));
        const products = await tx.product.findMany({
          where: {
            id: { in: productIds },
            organizationId: input.organizationId,
            isDeleted: false,
            storeProducts: {
              some: {
                storeId: input.fromStoreId,
                isActive: true,
              },
            },
          },
          select: { id: true, baseUnitId: true },
        });
        if (products.length !== productIds.length) {
          throw new AppError("invalidTransferProducts", "FORBIDDEN", 403);
        }
        const productMap = new Map(products.map((product) => [product.id, product]));

        const variantIds = Array.from(
          new Set(normalizedInputLines.map((line) => line.variantId).filter(Boolean) as string[]),
        );
        if (variantIds.length) {
          const variants = await tx.productVariant.findMany({
            where: {
              id: { in: variantIds },
              isActive: true,
              product: { organizationId: input.organizationId, isDeleted: false },
            },
            select: { id: true, productId: true },
          });
          const variantProductMap = new Map(
            variants.map((variant) => [variant.id, variant.productId]),
          );
          for (const line of normalizedInputLines) {
            if (line.variantId && variantProductMap.get(line.variantId) !== line.productId) {
              throw new AppError("variantMismatch", "BAD_REQUEST", 400);
            }
          }
          if (variants.length !== variantIds.length) {
            throw new AppError("variantNotFound", "NOT_FOUND", 404);
          }
        }

        const costs = await tx.productCost.findMany({
          where: {
            organizationId: input.organizationId,
            productId: { in: productIds },
          },
          select: { productId: true, variantKey: true, avgCostKgs: true },
        });
        const costMap = new Map(
          costs.map((cost) => [`${cost.productId}:${cost.variantKey}`, Number(cost.avgCostKgs)]),
        );

        const lineResults: Array<{
          productId: string;
          variantId: string | null;
          quantity: number;
          unitCost: number | null;
          outSnapshotId: string;
          inSnapshotId: string;
          outOnHand: number;
          inOnHand: number;
          outMovementId: string;
          inMovementId: string;
        }> = [];

        for (const [index, line] of normalizedInputLines.entries()) {
          const product = productMap.get(line.productId);
          if (!product) {
            throw new AppError("productNotFound", "NOT_FOUND", 404);
          }
          const qty = await resolveBaseQuantity(tx, {
            organizationId: input.organizationId,
            productId: line.productId,
            baseUnitId: product.baseUnitId,
            qty: line.qty,
            unitId: line.unitId,
            packId: line.packId,
            mode: "inventory",
          });
          if (!Number.isInteger(qty) || qty <= 0) {
            throw new AppError("invalidTransferQty", "BAD_REQUEST", 400);
          }
          const unitCost = costMap.get(`${line.productId}:${line.variantKey}`) ?? null;
          const lineTotal = unitCost !== null ? unitCost * qty : null;

          const outBefore = await tx.inventorySnapshot.findUnique({
            where: {
              storeId_productId_variantKey: {
                storeId: input.fromStoreId,
                productId: line.productId,
                variantKey: line.variantKey,
              },
            },
          });

          const inBefore = await tx.inventorySnapshot.findUnique({
            where: {
              storeId_productId_variantKey: {
                storeId: input.toStoreId,
                productId: line.productId,
                variantKey: line.variantKey,
              },
            },
          });

          const outMovement = await applyStockMovement(tx, {
            storeId: input.fromStoreId,
            productId: line.productId,
            variantId: line.variantId,
            qtyDelta: -Math.abs(qty),
            type: StockMovementType.TRANSFER_OUT,
            referenceType: "TRANSFER",
            referenceId: transferId,
            linePosition: index + 1,
            unitCostKgs: unitCost,
            lineTotalKgs: lineTotal,
            note: input.note ?? undefined,
            actorId: input.actorId,
            organizationId: input.organizationId,
            allowNegativeStock: true,
          });

          const inMovement = await applyStockMovement(tx, {
            storeId: input.toStoreId,
            productId: line.productId,
            variantId: line.variantId,
            qtyDelta: Math.abs(qty),
            type: StockMovementType.TRANSFER_IN,
            referenceType: "TRANSFER",
            referenceId: transferId,
            linePosition: index + 1,
            note: input.note ?? undefined,
            actorId: input.actorId,
            organizationId: input.organizationId,
          });

          const outLot = await applyStockLotAdjustment(tx, {
            storeId: input.fromStoreId,
            productId: line.productId,
            variantId: line.variantId,
            qtyDelta: -Math.abs(qty),
            expiryDate: line.expiryDate ?? null,
            organizationId: input.organizationId,
            allowNegativeStock: true,
          });
          if (outLot) {
            await tx.stockMovement.update({
              where: { id: outMovement.movementId },
              data: { stockLotId: outLot.id },
            });
          }
          const inLot = await applyStockLotAdjustment(tx, {
            storeId: input.toStoreId,
            productId: line.productId,
            variantId: line.variantId,
            qtyDelta: Math.abs(qty),
            expiryDate: line.expiryDate ?? null,
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

          changedItems.push(
            {
              storeId: input.fromStoreId,
              productId: line.productId,
              variantId: line.variantId,
              onHand: outMovement.snapshot.onHand,
            },
            {
              storeId: input.toStoreId,
              productId: line.productId,
              variantId: line.variantId,
              onHand: inMovement.snapshot.onHand,
            },
          );
          lineResults.push({
            productId: line.productId,
            variantId: line.variantId,
            quantity: qty,
            unitCost,
            outSnapshotId: outMovement.snapshot.id,
            inSnapshotId: inMovement.snapshot.id,
            outOnHand: outMovement.snapshot.onHand,
            inOnHand: inMovement.snapshot.onHand,
            outMovementId: outMovement.movementId,
            inMovementId: inMovement.movementId,
          });
        }

        return {
          transferId,
          fromStoreId: input.fromStoreId,
          toStoreId: input.toStoreId,
          lineCount: lineResults.length,
          totalQuantity: lineResults.reduce((sum, line) => sum + line.quantity, 0),
          lines: lineResults,
          outSnapshot: lineResults[0]?.outSnapshotId ?? null,
          inSnapshot: lineResults[0]?.inSnapshotId ?? null,
        };
      },
    );

    return transfer;
  });

  changedItems.forEach((item) => {
    eventBus.publish({
      type: "inventory.updated",
      payload: { storeId: item.storeId, productId: item.productId, variantId: item.variantId },
    });
  });
  await Promise.all(
    changedItems
      .filter((item) => item.storeId === input.fromStoreId)
      .map((item) =>
        maybeEmitLowStock({
          storeId: item.storeId,
          productId: item.productId,
          variantId: item.variantId,
          onHand: item.onHand,
          requestId: input.requestId,
        }),
      ),
  );

  logger.info(
    {
      fromStoreId: input.fromStoreId,
      toStoreId: input.toStoreId,
      lineCount: inputLines.length,
    },
    "inventory transferred",
  );

  return result;
};

export type EditableStockMovementDocumentType = "STOCK_RECEIVING" | "TRANSFER" | "WRITE_OFF";

export type EditStockMovementDocumentLineInput = {
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitCostKgs?: number | null;
};

export type EditStockMovementDocumentInput = {
  documentType: EditableStockMovementDocumentType;
  referenceType: string;
  referenceId: string;
  destinationStoreId?: string | null;
  lines: EditStockMovementDocumentLineInput[];
  reason?: string | null;
  actorId: string;
  organizationId: string;
  requestId: string;
  idempotencyKey: string;
  user?: StoreAccessUser;
};

const STOCK_DOCUMENT_ARCHIVE_REFERENCE_TYPE = "STOCK_DOCUMENT_ARCHIVE";
const STOCK_RECEIVING_ARCHIVE_REFERENCE_TYPE = "STOCK_RECEIVING_ARCHIVE";

export type ArchiveStockMovementDocumentInput = {
  documentType: "STOCK_RECEIVING" | "TRANSFER" | "WRITE_OFF";
  referenceType: string;
  referenceId: string;
  reason?: string | null;
  actorId: string;
  organizationId: string;
  requestId: string;
  idempotencyKey: string;
  user?: StoreAccessUser;
};

type StockDocumentAggregateLine = {
  productId: string;
  variantId: string | null;
  variantKey: string;
  quantity: number;
  unitCostKgs: number | null;
  lineTotalKgs: number | null;
};

const stockDocumentLineKey = (productId: string, variantKey: string) =>
  `${productId}:${variantKey}`;

const roundStockMoney = (value: number) => Math.round(value * 100) / 100;

const aggregateStockDocumentLines = (
  movements: Array<{
    productId: string;
    variantId: string | null;
    type: StockMovementType;
    qtyDelta: number;
    unitCostKgs: Prisma.Decimal | number | null;
    lineTotalKgs: Prisma.Decimal | number | null;
    createdAt: Date;
  }>,
  documentType: EditableStockMovementDocumentType,
) => {
  const aggregates = new Map<
    string,
    {
      productId: string;
      variantId: string | null;
      variantKey: string;
      qtyDelta: number;
      lineTotalKgs: number;
      hasLineTotal: boolean;
      latestUnitCostKgs: number | null;
      latestAt: Date;
    }
  >();

  for (const movement of movements) {
    if (documentType === "TRANSFER" && movement.type !== StockMovementType.TRANSFER_OUT) {
      continue;
    }
    const variantKey = resolveVariantKey(movement.variantId);
    const key = stockDocumentLineKey(movement.productId, variantKey);
    const existing = aggregates.get(key);
    const unitCostKgs = movement.unitCostKgs === null ? null : Number(movement.unitCostKgs);
    const lineTotalKgs = movement.lineTotalKgs === null ? null : Number(movement.lineTotalKgs);
    if (existing) {
      existing.qtyDelta += Number(movement.qtyDelta);
      if (lineTotalKgs !== null) {
        existing.lineTotalKgs += lineTotalKgs;
        existing.hasLineTotal = true;
      }
      if (unitCostKgs !== null && movement.createdAt >= existing.latestAt) {
        existing.latestUnitCostKgs = unitCostKgs;
        existing.latestAt = movement.createdAt;
      }
      continue;
    }
    aggregates.set(key, {
      productId: movement.productId,
      variantId: movement.variantId,
      variantKey,
      qtyDelta: Number(movement.qtyDelta),
      lineTotalKgs: lineTotalKgs ?? 0,
      hasLineTotal: lineTotalKgs !== null,
      latestUnitCostKgs: unitCostKgs,
      latestAt: movement.createdAt,
    });
  }

  const result = new Map<string, StockDocumentAggregateLine>();
  aggregates.forEach((line, key) => {
    const quantity =
      documentType === "STOCK_RECEIVING"
        ? line.qtyDelta
        : Math.abs(documentType === "TRANSFER" ? line.qtyDelta : line.qtyDelta);
    if (quantity === 0 && !line.hasLineTotal) {
      return;
    }
    const total = line.hasLineTotal ? roundStockMoney(line.lineTotalKgs) : null;
    result.set(key, {
      productId: line.productId,
      variantId: line.variantId,
      variantKey: line.variantKey,
      quantity: Math.max(0, quantity),
      unitCostKgs:
        total !== null && quantity > 0
          ? roundStockMoney(total / quantity)
          : line.latestUnitCostKgs,
      lineTotalKgs: total,
    });
  });
  return result;
};

const getNetStockMovementStoreIds = (
  movements: Array<{ storeId: string; type: StockMovementType; qtyDelta: number }>,
  movementType: StockMovementType,
  isActiveTotal: (quantity: number) => boolean,
) => {
  const totals = new Map<string, { quantity: number; firstIndex: number }>();
  movements.forEach((movement, index) => {
    if (movement.type !== movementType) {
      return;
    }
    const existing = totals.get(movement.storeId);
    if (existing) {
      existing.quantity += movement.qtyDelta;
      return;
    }
    totals.set(movement.storeId, { quantity: movement.qtyDelta, firstIndex: index });
  });

  return Array.from(totals.entries())
    .filter(([, total]) => isActiveTotal(total.quantity))
    .sort(([, left], [, right]) => left.firstIndex - right.firstIndex)
    .map(([storeId]) => storeId);
};

const normalizeStockDocumentEditLines = (
  lines: EditStockMovementDocumentLineInput[],
  unitCostMap: Map<string, number>,
) => {
  if (!lines.length) {
    throw new AppError("documentLinesRequired", "BAD_REQUEST", 400);
  }

  const normalized = new Map<string, StockDocumentAggregateLine>();
  for (const line of lines) {
    const variantKey = resolveVariantKey(line.variantId);
    const key = stockDocumentLineKey(line.productId, variantKey);
    if (normalized.has(key)) {
      throw new AppError("duplicateLineItem", "BAD_REQUEST", 400);
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new AppError("invalidDocumentQuantity", "BAD_REQUEST", 400);
    }
    const unitCostKgs =
      line.unitCostKgs !== null && line.unitCostKgs !== undefined
        ? roundStockMoney(line.unitCostKgs)
        : (unitCostMap.get(key) ?? unitCostMap.get(stockDocumentLineKey(line.productId, "BASE")) ?? 0);
    if (!Number.isFinite(unitCostKgs) || unitCostKgs < 0) {
      throw new AppError("unitCostInvalid", "BAD_REQUEST", 400);
    }
    normalized.set(key, {
      productId: line.productId,
      variantId: line.variantId ?? null,
      variantKey,
      quantity: line.quantity,
      unitCostKgs,
      lineTotalKgs: roundStockMoney(line.quantity * unitCostKgs),
    });
  }
  return normalized;
};

export const editStockMovementDocument = async (input: EditStockMovementDocumentInput) => {
  if (
    (input.documentType === "STOCK_RECEIVING" && input.referenceType !== "STOCK_RECEIVING") ||
    (input.documentType === "TRANSFER" && input.referenceType !== "TRANSFER") ||
    (input.documentType === "WRITE_OFF" && input.referenceType !== "WRITE_OFF")
  ) {
    throw new AppError("productMovementDocumentUnsupported", "BAD_REQUEST", 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    const { result: editResult, replayed } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "inventory.productMovement.editDocument",
        userId: input.actorId,
      },
      async () => {
        await tx.$queryRaw`
          SELECT m."id"
          FROM "StockMovement" m
          INNER JOIN "Store" s ON s."id" = m."storeId"
          WHERE m."referenceType" = ${input.referenceType}
            AND m."referenceId" = ${input.referenceId}
            AND s."organizationId" = ${input.organizationId}
          FOR UPDATE
        `;

        const movements = await tx.stockMovement.findMany({
          where: {
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            store: { organizationId: input.organizationId },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        if (!movements.length) {
          throw new AppError("productMovementDocumentNotFound", "NOT_FOUND", 404);
        }

        const storeIds = Array.from(new Set(movements.map((movement) => movement.storeId)));
        if (input.user) {
          await Promise.all(
            storeIds.map((storeId) => assertUserCanAccessStore(tx, input.user!, storeId)),
          );
        }

        const sourceStoreIds =
          input.documentType === "TRANSFER"
            ? getNetStockMovementStoreIds(
                movements,
                StockMovementType.TRANSFER_OUT,
                (quantity) => quantity < 0,
              )
            : storeIds;
        const destinationStoreIds =
          input.documentType === "TRANSFER"
            ? getNetStockMovementStoreIds(
                movements,
                StockMovementType.TRANSFER_IN,
                (quantity) => quantity > 0,
              )
            : [];
        if (sourceStoreIds.length !== 1) {
          throw new AppError("productMovementDocumentUnsupported", "CONFLICT", 409);
        }
        if (input.documentType === "TRANSFER" && destinationStoreIds.length !== 1) {
          throw new AppError("productMovementDocumentUnsupported", "CONFLICT", 409);
        }

        const sourceStoreId = sourceStoreIds[0]!;
        const oldDestinationStoreId = destinationStoreIds[0] ?? null;
        const destinationStoreId =
          input.documentType === "TRANSFER"
            ? (input.destinationStoreId?.trim() || oldDestinationStoreId)
            : null;
        if (input.documentType === "TRANSFER") {
          if (!destinationStoreId || !oldDestinationStoreId) {
            throw new AppError("productMovementDocumentUnsupported", "CONFLICT", 409);
          }
          if (destinationStoreId === sourceStoreId) {
            throw new AppError("transferSameStore", "BAD_REQUEST", 400);
          }
          const destinationStore = await tx.store.findFirst({
            where: { id: destinationStoreId, organizationId: input.organizationId },
            select: { id: true },
          });
          if (!destinationStore) {
            throw new AppError("storeNotFound", "NOT_FOUND", 404);
          }
          if (input.user) {
            await assertUserCanAccessStore(tx, input.user, destinationStoreId);
          }
        }
        const productIds = Array.from(new Set(input.lines.map((line) => line.productId)));
        const products = await tx.product.findMany({
          where: {
            id: { in: productIds },
            organizationId: input.organizationId,
            isDeleted: false,
            storeProducts: {
              some: {
                storeId: sourceStoreId,
                isActive: true,
              },
            },
          },
          select: { id: true },
        });
        if (products.length !== productIds.length) {
          throw new AppError("invalidProducts", "FORBIDDEN", 403);
        }

        const variantIds = Array.from(
          new Set(input.lines.map((line) => line.variantId).filter(Boolean) as string[]),
        );
        if (variantIds.length) {
          const variants = await tx.productVariant.findMany({
            where: {
              id: { in: variantIds },
              isActive: true,
              product: { organizationId: input.organizationId, isDeleted: false },
            },
            select: { id: true, productId: true },
          });
          const variantProductMap = new Map(
            variants.map((variant) => [variant.id, variant.productId]),
          );
          for (const line of input.lines) {
            if (line.variantId && variantProductMap.get(line.variantId) !== line.productId) {
              throw new AppError("variantMismatch", "BAD_REQUEST", 400);
            }
          }
          if (variants.length !== variantIds.length) {
            throw new AppError("variantNotFound", "NOT_FOUND", 404);
          }
        }

        const costProductIds = Array.from(
          new Set([...productIds, ...movements.map((movement) => movement.productId)]),
        );
        const costs = await tx.productCost.findMany({
          where: {
            organizationId: input.organizationId,
            productId: { in: costProductIds },
          },
          select: { productId: true, variantKey: true, avgCostKgs: true },
        });
        const unitCostMap = new Map(
          costs.map((cost) => [stockDocumentLineKey(cost.productId, cost.variantKey), Number(cost.avgCostKgs)]),
        );

        const beforeLines = aggregateStockDocumentLines(movements, input.documentType);
        beforeLines.forEach((line, key) => {
          if (line.unitCostKgs !== null) {
            unitCostMap.set(key, line.unitCostKgs);
          }
        });
        const desiredLines = normalizeStockDocumentEditLines(input.lines, unitCostMap);
        const reason = input.reason?.trim() || "Редактирование документа";
        const changedItems = new Map<
          string,
          { storeId: string; productId: string; variantId: string | null; onHand: number | null }
        >();

        const lineKeys = new Set([...beforeLines.keys(), ...desiredLines.keys()]);
        let linePosition = 0;
        for (const key of lineKeys) {
          linePosition += 1;
          const beforeLine = beforeLines.get(key);
          const desiredLine = desiredLines.get(key);
          const movementLine = desiredLine ?? beforeLine;
          if (!movementLine) {
            continue;
          }
          const oldQuantity = beforeLine?.quantity ?? 0;
          const newQuantity = desiredLine?.quantity ?? 0;
          const oldLineTotal = beforeLine?.lineTotalKgs ?? 0;
          const newLineTotal = desiredLine?.lineTotalKgs ?? 0;
          const lineTotalDelta = roundStockMoney(newLineTotal - oldLineTotal);
          const unitCostKgs = desiredLine?.unitCostKgs ?? beforeLine?.unitCostKgs ?? null;

          if (input.documentType === "STOCK_RECEIVING") {
            const qtyDelta = newQuantity - oldQuantity;
            if (qtyDelta !== 0 || lineTotalDelta !== 0) {
              const movement = await applyStockMovement(tx, {
                storeId: sourceStoreId,
                productId: movementLine.productId,
                variantId: movementLine.variantId,
                qtyDelta,
                type: StockMovementType.RECEIVE,
                referenceType: input.referenceType,
                referenceId: input.referenceId,
                linePosition,
                unitCostKgs,
                lineTotalKgs: lineTotalDelta,
                note: reason,
                actorId: input.actorId,
                organizationId: input.organizationId,
                allowNegativeStock: true,
              });
              if (desiredLine && qtyDelta > 0 && unitCostKgs !== null) {
                await updateProductCost(tx, {
                  organizationId: input.organizationId,
                  productId: movementLine.productId,
                  variantId: movementLine.variantId,
                  qtyReceived: qtyDelta,
                  unitCost: unitCostKgs,
                });
              }
              changedItems.set(`${sourceStoreId}:${key}`, {
                storeId: sourceStoreId,
                productId: movementLine.productId,
                variantId: movementLine.variantId,
                onHand: movement.snapshot.onHand,
              });
            }
            continue;
          }

          if (input.documentType === "WRITE_OFF") {
            const qtyDelta = oldQuantity - newQuantity;
            if (qtyDelta !== 0 || lineTotalDelta !== 0) {
              const movement = await applyStockMovement(tx, {
                storeId: sourceStoreId,
                productId: movementLine.productId,
                variantId: movementLine.variantId,
                qtyDelta,
                type: StockMovementType.WRITE_OFF,
                referenceType: input.referenceType,
                referenceId: input.referenceId,
                linePosition,
                unitCostKgs,
                lineTotalKgs: lineTotalDelta,
                note: reason,
                actorId: input.actorId,
                organizationId: input.organizationId,
                allowNegativeStock: true,
              });
              changedItems.set(`${sourceStoreId}:${key}`, {
                storeId: sourceStoreId,
                productId: movementLine.productId,
                variantId: movementLine.variantId,
                onHand: movement.snapshot.onHand,
              });
            }
            continue;
          }

          if (!destinationStoreId || !oldDestinationStoreId) {
            throw new AppError("productMovementDocumentUnsupported", "CONFLICT", 409);
          }
          const outQtyDelta = oldQuantity - newQuantity;
          if (outQtyDelta !== 0 || lineTotalDelta !== 0) {
            const outMovement = await applyStockMovement(tx, {
              storeId: sourceStoreId,
              productId: movementLine.productId,
              variantId: movementLine.variantId,
              qtyDelta: outQtyDelta,
              type: StockMovementType.TRANSFER_OUT,
              referenceType: input.referenceType,
              referenceId: input.referenceId,
              linePosition,
              unitCostKgs,
              lineTotalKgs: lineTotalDelta,
              note: reason,
              actorId: input.actorId,
              organizationId: input.organizationId,
              allowNegativeStock: true,
            });
            changedItems.set(`${sourceStoreId}:${key}`, {
              storeId: sourceStoreId,
              productId: movementLine.productId,
              variantId: movementLine.variantId,
              onHand: outMovement.snapshot.onHand,
            });
          }
          if (destinationStoreId === oldDestinationStoreId) {
            const inQtyDelta = newQuantity - oldQuantity;
            if (inQtyDelta !== 0) {
              const inMovement = await applyStockMovement(tx, {
                storeId: destinationStoreId,
                productId: movementLine.productId,
                variantId: movementLine.variantId,
                qtyDelta: inQtyDelta,
                type: StockMovementType.TRANSFER_IN,
                referenceType: input.referenceType,
                referenceId: input.referenceId,
                linePosition,
                note: reason,
                actorId: input.actorId,
                organizationId: input.organizationId,
              });
              changedItems.set(`${destinationStoreId}:${key}`, {
                storeId: destinationStoreId,
                productId: movementLine.productId,
                variantId: movementLine.variantId,
                onHand: inMovement.snapshot.onHand,
              });
            }
          } else {
            if (oldQuantity !== 0) {
              const oldDestinationMovement = await applyStockMovement(tx, {
                storeId: oldDestinationStoreId,
                productId: movementLine.productId,
                variantId: movementLine.variantId,
                qtyDelta: -oldQuantity,
                type: StockMovementType.TRANSFER_IN,
                referenceType: input.referenceType,
                referenceId: input.referenceId,
                linePosition,
                note: reason,
                actorId: input.actorId,
                organizationId: input.organizationId,
                allowNegativeStock: true,
              });
              changedItems.set(`${oldDestinationStoreId}:${key}`, {
                storeId: oldDestinationStoreId,
                productId: movementLine.productId,
                variantId: movementLine.variantId,
                onHand: oldDestinationMovement.snapshot.onHand,
              });
            }
            if (newQuantity !== 0) {
              const newDestinationMovement = await applyStockMovement(tx, {
                storeId: destinationStoreId,
                productId: movementLine.productId,
                variantId: movementLine.variantId,
                qtyDelta: newQuantity,
                type: StockMovementType.TRANSFER_IN,
                referenceType: input.referenceType,
                referenceId: input.referenceId,
                linePosition,
                note: reason,
                actorId: input.actorId,
                organizationId: input.organizationId,
              });
              changedItems.set(`${destinationStoreId}:${key}`, {
                storeId: destinationStoreId,
                productId: movementLine.productId,
                variantId: movementLine.variantId,
                onHand: newDestinationMovement.snapshot.onHand,
              });
            }
          }
        }

        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "INVENTORY_DOCUMENT_EDIT",
          entity: "StockMovementDocument",
          entityId: `${input.referenceType}:${input.referenceId}`,
          before: toJson({
            documentType: input.documentType,
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            sourceStoreId,
            destinationStoreId: oldDestinationStoreId,
            lines: Array.from(beforeLines.values()),
          }),
          after: toJson({
            documentType: input.documentType,
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            sourceStoreId,
            destinationStoreId,
            reason,
            lines: Array.from(desiredLines.values()),
          }),
          requestId: input.requestId,
        });

        return {
          documentType: input.documentType,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          lineCount: desiredLines.size,
          totalQuantity: Array.from(desiredLines.values()).reduce(
            (sum, line) => sum + line.quantity,
            0,
          ),
          totalAmountKgs: roundStockMoney(
            Array.from(desiredLines.values()).reduce(
              (sum, line) => sum + (line.lineTotalKgs ?? 0),
              0,
            ),
          ),
          changedItems: Array.from(changedItems.values()),
        };
      },
    );

    return { ...editResult, replayed };
  });

  if (!result.replayed) {
    result.changedItems.forEach((item) => {
      eventBus.publish({
        type: "inventory.updated",
        payload: { storeId: item.storeId, productId: item.productId, variantId: item.variantId },
      });
    });
    await Promise.all(
      result.changedItems.map((item) =>
        item.onHand === null
          ? Promise.resolve()
          : maybeEmitLowStock({
              storeId: item.storeId,
              productId: item.productId,
              variantId: item.variantId,
              onHand: item.onHand,
              requestId: input.requestId,
            }),
      ),
    );
  }

  return {
    ...result,
    replayed: undefined,
    changedItems: undefined,
  };
};

const stockMovementDocumentArchiveKey = (input: {
  documentType: "STOCK_RECEIVING" | "TRANSFER" | "WRITE_OFF";
  referenceType: string;
  referenceId: string;
}) => `${input.documentType}:${input.referenceType}:${input.referenceId}`;

export const archiveStockMovementDocument = async (
  input: ArchiveStockMovementDocumentInput,
) => {
  if (
    (input.documentType === "STOCK_RECEIVING" && input.referenceType !== "STOCK_RECEIVING") ||
    (input.documentType === "TRANSFER" && input.referenceType !== "TRANSFER") ||
    (input.documentType === "WRITE_OFF" && input.referenceType !== "WRITE_OFF")
  ) {
    throw new AppError("productMovementDocumentUnsupported", "BAD_REQUEST", 400);
  }
  const reason = input.reason?.trim() || null;
  const archiveReferenceId = stockMovementDocumentArchiveKey(input);

  const logger = getLogger(input.requestId);
  const result = await prisma.$transaction(async (tx) => {
    const { result: archiveResult, replayed } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "inventory.productMovement.archiveDocument",
        userId: input.actorId,
      },
      async () => {
        await tx.$queryRaw`
          SELECT m."id"
          FROM "StockMovement" m
          INNER JOIN "Store" s ON s."id" = m."storeId"
          WHERE m."referenceType" = ${input.referenceType}
            AND m."referenceId" = ${input.referenceId}
            AND s."organizationId" = ${input.organizationId}
          FOR UPDATE
        `;

        const existingArchive = await tx.stockMovement.findFirst({
          where: {
            store: { organizationId: input.organizationId },
            OR: [
              {
                referenceType: STOCK_DOCUMENT_ARCHIVE_REFERENCE_TYPE,
                referenceId: archiveReferenceId,
              },
              ...(input.documentType === "STOCK_RECEIVING"
                ? [
                    {
                      referenceType: STOCK_RECEIVING_ARCHIVE_REFERENCE_TYPE,
                      referenceId: input.referenceId,
                    },
                  ]
                : []),
            ],
          },
          select: { id: true },
        });
        if (existingArchive) {
          throw new AppError("productMovementDocumentAlreadyArchived", "CONFLICT", 409);
        }

        const movements = await tx.stockMovement.findMany({
          where: {
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            store: { organizationId: input.organizationId },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        if (!movements.length) {
          throw new AppError("productMovementDocumentNotFound", "NOT_FOUND", 404);
        }

        const storeIds = Array.from(new Set(movements.map((movement) => movement.storeId)));
        if (input.user) {
          await Promise.all(
            storeIds.map((storeId) => assertUserCanAccessStore(tx, input.user!, storeId)),
          );
        }

        const lines = Array.from(aggregateStockDocumentLines(movements, input.documentType).values());
        if (!lines.length) {
          throw new AppError("productMovementDocumentNotFound", "NOT_FOUND", 404);
        }
        const markerSource =
          movements.find(
            (movement) =>
              movement.productId === lines[0]?.productId &&
              (movement.variantId ?? null) === (lines[0]?.variantId ?? null),
          ) ?? movements[0]!;

        const marker = await tx.stockMovement.create({
          data: {
            storeId: markerSource.storeId,
            productId: markerSource.productId,
            variantId: markerSource.variantId ?? undefined,
            type: StockMovementType.ADJUSTMENT,
            qtyDelta: 0,
            linePosition: 0,
            referenceType: STOCK_DOCUMENT_ARCHIVE_REFERENCE_TYPE,
            referenceId: archiveReferenceId,
            note: reason ? `Архивировано: ${reason}` : "Архивировано",
            createdById: input.actorId,
          },
        });

        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "INVENTORY_DOCUMENT_ARCHIVE",
          entity: "StockMovementDocument",
          entityId: `${input.referenceType}:${input.referenceId}`,
          before: toJson({
            documentType: input.documentType,
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            storeIds,
            lines,
          }),
          after: toJson({
            documentType: input.documentType,
            archiveReferenceType: STOCK_DOCUMENT_ARCHIVE_REFERENCE_TYPE,
            archiveReferenceId,
            archiveMovementId: marker.id,
            storeIds,
            reason,
            archivedBy: input.actorId,
            archivedAt: new Date().toISOString(),
          }),
          requestId: input.requestId,
        });

        return {
          documentType: input.documentType,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          archived: true,
          reason,
          lineCount: lines.length,
          totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
        };
      },
    );

    return { ...archiveResult, replayed };
  });

  logger.info(
    {
      documentType: input.documentType,
      referenceId: input.referenceId,
      lineCount: result.lineCount,
      totalQuantity: result.totalQuantity,
    },
    "stock movement document archived",
  );

  return {
    ...result,
    replayed: undefined,
  };
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

      const before = snapshotMap.get(snapshotKey) ?? null;
      const resolvedVariantId = before?.variantId ?? (variantKey === "BASE" ? null : variantKey);
      const allowNegativeStock = store.allowNegativeStock || onHand < 0;
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
          allowNegativeStock,
        },
        create: {
          storeId: input.storeId,
          productId,
          variantKey,
          variantId: resolvedVariantId,
          onHand,
          onOrder,
          allowNegativeStock,
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
