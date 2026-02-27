import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { StockCountStatus, StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { withIdempotency } from "@/server/services/idempotency";
import { applyStockMovement } from "@/server/services/inventory";
import { writeAuditLog } from "@/server/services/audit";
import { eventBus } from "@/server/events/eventBus";
import { toJson } from "@/server/services/json";
import { normalizeScanValue } from "@/lib/scanning/normalize";

const resolveVariantKey = (variantId?: string | null) => variantId ?? "BASE";

const generateCode = () => {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = randomUUID().slice(0, 6).toUpperCase();
  return `SC-${datePart}-${suffix}`;
};

const resolveScanMatch = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  rawValue: string,
) => {
  const normalized = normalizeScanValue(rawValue);
  if (!normalized) {
    throw new AppError("scanValueRequired", "BAD_REQUEST", 400);
  }

  const barcodeMatch = await tx.productBarcode.findFirst({
    where: {
      organizationId,
      value: normalized,
      product: { isDeleted: false },
    },
    select: { productId: true },
  });
  if (barcodeMatch) {
    return { productId: barcodeMatch.productId, variantId: null, barcodeValue: normalized };
  }

  const productMatch = await tx.product.findFirst({
    where: {
      organizationId,
      isDeleted: false,
      sku: { equals: normalized, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (productMatch) {
    return { productId: productMatch.id, variantId: null, barcodeValue: normalized };
  }

  const variantMatches = await tx.productVariant.findMany({
    where: {
      sku: { equals: normalized, mode: "insensitive" },
      product: { organizationId, isDeleted: false },
      isActive: true,
    },
    select: { id: true, productId: true },
  });

  if (variantMatches.length === 1) {
    return {
      productId: variantMatches[0].productId,
      variantId: variantMatches[0].id,
      barcodeValue: normalized,
    };
  }
  if (variantMatches.length > 1) {
    throw new AppError("scanAmbiguous", "BAD_REQUEST", 400);
  }

  throw new AppError("scanNotFound", "NOT_FOUND", 404);
};

export const createStockCount = async (input: {
  storeId: string;
  notes?: string | null;
  actorId: string;
  organizationId: string;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({ where: { id: input.storeId } });
    if (!store || store.organizationId !== input.organizationId) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateCode();
      try {
        return await tx.stockCount.create({
          data: {
            organizationId: input.organizationId,
            storeId: input.storeId,
            code,
            notes: input.notes ?? undefined,
            status: StockCountStatus.DRAFT,
            createdById: input.actorId,
          },
        });
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
          continue;
        }
        throw error;
      }
    }

    throw new AppError("uniqueConstraintViolation", "CONFLICT", 409);
  });
};

export const addOrUpdateLineByScan = async (input: {
  stockCountId: string;
  storeId: string;
  barcodeOrQuery: string;
  mode: "increment" | "set";
  countedQty?: number;
  countedDelta?: number;
  actorId: string;
  organizationId: string;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const count = await tx.stockCount.findUnique({ where: { id: input.stockCountId } });
    if (!count || count.organizationId !== input.organizationId) {
      throw new AppError("stockCountNotFound", "NOT_FOUND", 404);
    }
    if (count.storeId !== input.storeId) {
      throw new AppError("stockCountStoreMismatch", "BAD_REQUEST", 400);
    }
    if (count.status === StockCountStatus.APPLIED || count.status === StockCountStatus.CANCELLED) {
      throw new AppError("stockCountLocked", "CONFLICT", 409);
    }

    const match = await resolveScanMatch(tx, input.organizationId, input.barcodeOrQuery);
    const variantKey = resolveVariantKey(match.variantId);

    const existing = await tx.stockCountLine.findUnique({
      where: {
        stockCountId_productId_variantKey: {
          stockCountId: input.stockCountId,
          productId: match.productId,
          variantKey,
        },
      },
    });

    const snapshot = await tx.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: input.storeId,
          productId: match.productId,
          variantKey,
        },
      },
    });

    const expectedOnHand = existing?.expectedOnHand ?? snapshot?.onHand ?? 0;
    const baseCounted = existing?.countedQty ?? 0;
    const incrementBy = input.countedDelta ?? 1;
    const nextCounted =
      input.mode === "set" ? (input.countedQty ?? 0) : baseCounted + incrementBy;
    const deltaQty = nextCounted - expectedOnHand;

    const now = new Date();
    const line = await tx.stockCountLine.upsert({
      where: {
        stockCountId_productId_variantKey: {
          stockCountId: input.stockCountId,
          productId: match.productId,
          variantKey,
        },
      },
      update: {
        countedQty: nextCounted,
        deltaQty,
        barcodeValue: match.barcodeValue ?? undefined,
        lastScannedAt: now,
      },
      create: {
        stockCountId: input.stockCountId,
        storeId: input.storeId,
        productId: match.productId,
        variantId: match.variantId ?? undefined,
        variantKey,
        barcodeValue: match.barcodeValue ?? undefined,
        expectedOnHand,
        countedQty: nextCounted,
        deltaQty,
        lastScannedAt: now,
      },
    });

    if (count.status === StockCountStatus.DRAFT) {
      await tx.stockCount.update({
        where: { id: count.id },
        data: { status: StockCountStatus.IN_PROGRESS, startedAt: count.startedAt ?? new Date() },
      });
    }

    return line;
  });
};

export const setLineCountedQty = async (input: {
  lineId: string;
  countedQty: number;
  actorId: string;
  organizationId: string;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const line = await tx.stockCountLine.findUnique({
      where: { id: input.lineId },
      include: { stockCount: true },
    });
    if (!line || line.stockCount.organizationId !== input.organizationId) {
      throw new AppError("stockCountLineNotFound", "NOT_FOUND", 404);
    }
    if (
      line.stockCount.status === StockCountStatus.APPLIED ||
      line.stockCount.status === StockCountStatus.CANCELLED
    ) {
      throw new AppError("stockCountLocked", "CONFLICT", 409);
    }

    return tx.stockCountLine.update({
      where: { id: input.lineId },
      data: {
        countedQty: input.countedQty,
        deltaQty: input.countedQty - line.expectedOnHand,
      },
    });
  });
};

export const removeLine = async (input: {
  lineId: string;
  actorId: string;
  organizationId: string;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const line = await tx.stockCountLine.findUnique({
      where: { id: input.lineId },
      include: { stockCount: true },
    });
    if (!line || line.stockCount.organizationId !== input.organizationId) {
      throw new AppError("stockCountLineNotFound", "NOT_FOUND", 404);
    }
    if (
      line.stockCount.status === StockCountStatus.APPLIED ||
      line.stockCount.status === StockCountStatus.CANCELLED
    ) {
      throw new AppError("stockCountLocked", "CONFLICT", 409);
    }

    await tx.stockCountLine.delete({ where: { id: input.lineId } });
    return { removed: true };
  });
};

export const applyStockCount = async (input: {
  stockCountId: string;
  actorId: string;
  organizationId: string;
  requestId: string;
  idempotencyKey: string;
}) => {
  const { result, storeId, touched } = await prisma.$transaction(async (tx) => {
    const { result } = await withIdempotency(
      tx,
      { key: input.idempotencyKey, route: "stockCounts.apply", userId: input.actorId },
      async () => {
        const count = await tx.stockCount.findUnique({
          where: { id: input.stockCountId },
          include: { lines: true },
        });
        if (!count || count.organizationId !== input.organizationId) {
          throw new AppError("stockCountNotFound", "NOT_FOUND", 404);
        }
        if (count.status === StockCountStatus.APPLIED) {
          return { applied: true, adjustments: 0 };
        }
        if (count.status === StockCountStatus.CANCELLED) {
          throw new AppError("stockCountLocked", "CONFLICT", 409);
        }

        let adjustments = 0;

        for (const line of count.lines) {
          const snapshot = await tx.inventorySnapshot.findUnique({
            where: {
              storeId_productId_variantKey: {
                storeId: count.storeId,
                productId: line.productId,
                variantKey: line.variantKey,
              },
            },
          });
          const expectedOnHand = snapshot?.onHand ?? 0;
          const deltaQty = line.countedQty - expectedOnHand;

          await tx.stockCountLine.update({
            where: { id: line.id },
            data: { expectedOnHand, deltaQty },
          });

          if (deltaQty === 0) {
            continue;
          }

          const before = snapshot ?? null;
          const movement = await applyStockMovement(tx, {
            storeId: count.storeId,
            productId: line.productId,
            variantId: line.variantId ?? undefined,
            qtyDelta: deltaQty,
            type: StockMovementType.ADJUSTMENT,
            referenceType: "STOCK_COUNT",
            referenceId: count.id,
            note: `stockCount:${count.code}`,
            actorId: input.actorId,
            organizationId: input.organizationId,
          });

          await writeAuditLog(tx, {
            organizationId: input.organizationId,
            actorId: input.actorId,
            action: "STOCK_COUNT_APPLY",
            entity: "InventorySnapshot",
            entityId: movement.snapshot.id,
            before: before ? toJson(before) : null,
            after: toJson(movement.snapshot),
            requestId: input.requestId,
          });

          adjustments += 1;
        }

        await tx.stockCount.update({
          where: { id: count.id },
          data: {
            status: StockCountStatus.APPLIED,
            appliedAt: new Date(),
            appliedById: input.actorId,
          },
        });

        return { applied: true, adjustments };
      },
    );

    const count = await tx.stockCount.findUnique({ where: { id: input.stockCountId } });
    const touched: Array<{ productId: string; variantId: string | null }> =
      await tx.stockCountLine.findMany({
      where: { stockCountId: input.stockCountId },
      select: { productId: true, variantId: true },
    });

    return { result, storeId: count?.storeId ?? null, touched };
  });

  if (storeId) {
    touched.forEach((line) => {
      eventBus.publish({
        type: "inventory.updated",
        payload: {
          storeId,
          productId: line.productId,
          variantId: line.variantId ?? null,
        },
      });
    });
  }

  return result;
};

export const cancelStockCount = async (input: {
  stockCountId: string;
  actorId: string;
  organizationId: string;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const count = await tx.stockCount.findUnique({ where: { id: input.stockCountId } });
    if (!count || count.organizationId !== input.organizationId) {
      throw new AppError("stockCountNotFound", "NOT_FOUND", 404);
    }
    if (count.status === StockCountStatus.APPLIED) {
      throw new AppError("stockCountLocked", "CONFLICT", 409);
    }

    return tx.stockCount.update({
      where: { id: count.id },
      data: { status: StockCountStatus.CANCELLED },
    });
  });
};
