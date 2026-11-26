import { assertProductQuantity } from "./productQuantity";
import { roundQuantity } from "@/lib/quantity";
import { randomUUID } from "node:crypto";
import { OperationRequestPrincipalType, Prisma, StockCountStatus, StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { withIdempotency } from "@/server/services/idempotency";
import { applyStockMovement } from "@/server/services/inventory";
import { writeAuditLog } from "@/server/services/audit";
import { assertBaamReviewedVersion } from "@/server/services/baamExecutionContext";
import { eventBus } from "@/server/events/eventBus";
import { toJson } from "@/server/services/json";
import { normalizeScanValue } from "@/lib/scanning/normalize";
import { classifyDatabaseOperationFailure } from "@/server/services/databaseOperationFailure";
import { runOperationRequest } from "@/server/services/operationRequests";
import { productStoreAssignmentWhere } from "@/server/services/storeAccess";
import { lockStoreStockReset } from "@/server/services/inventoryLock";

const resolveVariantKey = (variantId?: string | null) => variantId ?? "BASE";

const stockCorrectionActions = [
  "INVENTORY_SET_ON_HAND",
  "INVENTORY_BULK_SET_ON_HAND",
  "INVENTORY_IMPORT_SET_ON_HAND",
];

const captureStockBaseline = async (
  tx: Prisma.TransactionClient,
  input: { organizationId: string; storeId: string; productId: string; variantKey: string },
) => {
  await lockStoreStockReset(tx, input.storeId);
  const [snapshot, resetCount, appliedLineCount] = await Promise.all([
    tx.inventorySnapshot.findUnique({
      where: { storeId_productId_variantKey: {
        storeId: input.storeId, productId: input.productId, variantKey: input.variantKey,
      } },
      select: { id: true, onHand: true },
    }),
    tx.auditLog.count({ where: {
      organizationId: input.organizationId,
      action: "INVENTORY_STORE_RESET",
      entity: "Store",
      entityId: input.storeId,
    } }),
    tx.stockCountLine.count({ where: {
      storeId: input.storeId,
      productId: input.productId,
      variantKey: input.variantKey,
      stockCount: { organizationId: input.organizationId, status: StockCountStatus.APPLIED },
    } }),
  ]);
  const correctionCount = snapshot ? await tx.auditLog.count({ where: {
    organizationId: input.organizationId,
    action: { in: stockCorrectionActions },
    entity: "InventorySnapshot",
    entityId: snapshot.id,
  } }) : 0;
  return {
    onHand: snapshot?.onHand ?? 0,
    snapshotId: snapshot?.id ?? null,
    resetCount,
    correctionCount,
    appliedLineCount,
  };
};

const findStaleStockCountLines = async (
  tx: Prisma.TransactionClient,
  count: { id: string; organizationId: string; storeId: string },
) => {
  // Absolute writers share the store lock. Audit counts also detect a deliberate zero
  // when the balance (and its snapshot version) was already zero at the time of reset.
  const staleLines = await tx.$queryRaw<{ id: string }[]>`
    WITH store_resets AS (
      SELECT COUNT(*)::int AS total, MAX("createdAt") AS latest_at
      FROM "AuditLog"
      WHERE "organizationId" = ${count.organizationId} AND "entity" = 'Store'
        AND "entityId" = ${count.storeId} AND "action" = 'INVENTORY_STORE_RESET'
    )
    SELECT line."id"
    FROM "StockCountLine" line
    CROSS JOIN store_resets
    LEFT JOIN "InventorySnapshot" snapshot
      ON snapshot."storeId" = line."storeId" AND snapshot."productId" = line."productId"
      AND snapshot."variantKey" = line."variantKey"
    LEFT JOIN LATERAL (
      SELECT first_scan."after"->'stockBaseline' AS baseline,
        COALESCE(
          (first_scan."after"->>'lastScannedAt')::timestamptz AT TIME ZONE 'UTC',
          line."createdAt"
        ) AS captured_at
      FROM "AuditLog" first_scan
      WHERE first_scan."organizationId" = ${count.organizationId}
        AND first_scan."entity" = 'StockCountLine' AND first_scan."entityId" = line."id"
        AND first_scan."action" = 'STOCK_COUNT_LINE_SET' AND first_scan."before" IS NULL
      ORDER BY first_scan."createdAt", first_scan."id"
      LIMIT 1
    ) original ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS total, MAX(document."appliedAt") AS latest_at
      FROM "StockCountLine" applied_line
      JOIN "StockCount" document ON document."id" = applied_line."stockCountId"
      WHERE applied_line."storeId" = line."storeId" AND applied_line."productId" = line."productId"
        AND applied_line."variantKey" = line."variantKey"
        AND document."organizationId" = ${count.organizationId} AND document."status" = 'APPLIED'
    ) posted_counts ON TRUE
    WHERE line."stockCountId" = ${count.id} AND line."storeId" = ${count.storeId}
      AND CASE WHEN original.baseline IS NOT NULL THEN
        store_resets.total <> (original.baseline->>'resetCount')::int
        OR posted_counts.total <> (original.baseline->>'appliedLineCount')::int
        OR (original.baseline->>'snapshotId' IS NOT NULL
          AND snapshot."id" IS DISTINCT FROM original.baseline->>'snapshotId')
        OR (SELECT COUNT(*) FROM "AuditLog" correction
          WHERE correction."organizationId" = ${count.organizationId}
            AND correction."entity" = 'InventorySnapshot' AND correction."entityId" = snapshot."id"
            AND correction."action" IN (${Prisma.join(stockCorrectionActions)}))
          <> (original.baseline->>'correctionCount')::int
      ELSE
        store_resets.latest_at >= COALESCE(original.captured_at, line."createdAt")
        OR posted_counts.latest_at >= COALESCE(original.captured_at, line."createdAt")
        OR EXISTS (SELECT 1 FROM "AuditLog" correction
          WHERE correction."organizationId" = ${count.organizationId}
            AND correction."entity" = 'InventorySnapshot' AND correction."entityId" = snapshot."id"
            AND correction."action" IN (${Prisma.join(stockCorrectionActions)})
            AND GREATEST(correction."createdAt", (correction."after"->>'updatedAt')::timestamptz AT TIME ZONE 'UTC')
              >= COALESCE(original.captured_at, line."createdAt"))
        OR EXISTS (SELECT 1 FROM "StockMovement" movement
          WHERE movement."storeId" = line."storeId" AND movement."productId" = line."productId"
            AND movement."variantId" IS NOT DISTINCT FROM line."variantId"
            AND movement."referenceType" = 'IMPORT' AND movement."note" = 'importStockSet'
            AND movement."createdAt" >= COALESCE(original.captured_at, line."createdAt"))
      END
  `;
  return staleLines.map((line) => line.id);
};

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
        const created = await tx.stockCount.create({
          data: {
            organizationId: input.organizationId,
            storeId: input.storeId,
            code,
            notes: input.notes ?? undefined,
            status: StockCountStatus.DRAFT,
            createdById: input.actorId,
          },
        });
        await writeAuditLog(tx, { organizationId: input.organizationId, actorId: input.actorId, requestId: input.requestId, action: "STOCK_COUNT_CREATE", entity: "StockCount", entityId: created.id, after: toJson(created) });
        return created;
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
  productId?: string;
  mode: "increment" | "set";
  countedQty?: number;
  countedDelta?: number;
  actorId: string;
  organizationId: string;
  requestId: string;
  idempotencyKey?: string;
}) => {
  const operation = await runOperationRequest(
    {
      organizationId: input.organizationId,
      storeId: input.storeId,
      scope: "stockCounts.addOrUpdateLineByScan",
      principal: {
        type: OperationRequestPrincipalType.AUTHENTICATED_USER,
        id: input.actorId,
      },
      idempotencyKey: input.idempotencyKey ?? input.requestId,
      payload: {
        version: "stockCounts.addOrUpdateLineByScan.v1",
        value: toJson({
          stockCountId: input.stockCountId,
          storeId: input.storeId,
          barcodeOrQuery: normalizeScanValue(input.barcodeOrQuery),
          ...(input.productId ? { productId: input.productId } : {}),
          mode: input.mode,
          countedQty: input.mode === "set" ? (input.countedQty ?? 0) : null,
          countedDelta: input.mode === "increment" ? (input.countedDelta ?? 1) : null,
        }),
      },
      allowedResponsePaths: ["lineId"],
      classifyFailure: (error) => classifyDatabaseOperationFailure(error, "stockCountScanFailed"),
    },
    async (tx) => {
      await assertBaamReviewedVersion(tx, "StockCount", input.stockCountId);
      await tx.$queryRaw`SELECT "id" FROM "StockCount" WHERE "id" = ${input.stockCountId} FOR UPDATE`;
      const count = await tx.stockCount.findUnique({ where: { id: input.stockCountId } });
      if (!count || count.organizationId !== input.organizationId) {
        throw new AppError("stockCountNotFound", "NOT_FOUND", 404);
      }
      if (count.storeId !== input.storeId) {
        throw new AppError("stockCountStoreMismatch", "BAD_REQUEST", 400);
      }
      if (
        count.status === StockCountStatus.APPLIED ||
        count.status === StockCountStatus.CANCELLED
      ) {
        throw new AppError("stockCountLocked", "CONFLICT", 409);
      }

      const selectedProduct = input.productId
        ? await tx.product.findFirst({
            where: {
              id: input.productId,
              organizationId: input.organizationId,
              isDeleted: false,
              ...productStoreAssignmentWhere(input.storeId),
            },
            select: { id: true },
          })
        : null;
      if (input.productId && !selectedProduct) {
        throw new AppError("scanNotFound", "NOT_FOUND", 404);
      }
      const match = selectedProduct
        ? { productId: selectedProduct.id, variantId: null, barcodeValue: null }
        : await resolveScanMatch(tx, input.organizationId, input.barcodeOrQuery);
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

      const stockBaseline = existing ? undefined : await captureStockBaseline(tx, {
        organizationId: input.organizationId,
        storeId: input.storeId,
        productId: match.productId,
        variantKey,
      });

      const expectedOnHand = existing?.expectedOnHand ?? stockBaseline?.onHand ?? 0;
      const baseCounted = existing?.countedQty ?? 0;
      const incrementBy = input.countedDelta ?? 1;
      const nextCounted =
        input.mode === "set" ? (input.countedQty ?? 0) : roundQuantity(baseCounted + incrementBy);
      await assertProductQuantity(tx, input.organizationId, match.productId, nextCounted, true);
      const deltaQty = roundQuantity(nextCounted - expectedOnHand);

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

      await tx.stockCount.update({
          where: { id: count.id },
          data: {
            status: StockCountStatus.IN_PROGRESS,
            startedAt: count.startedAt ?? new Date(),
          },
        });
      await writeAuditLog(tx, { organizationId: input.organizationId, actorId: input.actorId, requestId: input.requestId, action: "STOCK_COUNT_LINE_SET", entity: "StockCountLine", entityId: line.id, before: existing ? toJson(existing) : null, after: toJson({ ...line, stockBaseline }) });

      return {
        response: { lineId: line.id },
        responseStatus: 200,
        resource: { type: "StockCountLine", id: line.id },
      };
    },
  );

  const line = await prisma.stockCountLine.findUnique({
    where: { id: operation.response.lineId },
  });
  if (!line) {
    throw new AppError("stockCountLineNotFound", "NOT_FOUND", 404);
  }
  return line;
};

export const setLineCountedQty = async (input: {
  lineId: string;
  countedQty: number;
  actorId: string;
  organizationId: string;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const identity = await tx.stockCountLine.findUnique({ where: { id: input.lineId }, select: { stockCountId: true } });
    if (identity) await tx.$queryRaw`SELECT "id" FROM "StockCount" WHERE "id" = ${identity.stockCountId} FOR UPDATE`;
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

    await assertBaamReviewedVersion(tx, "StockCount", line.stockCountId);
    await assertProductQuantity(tx, input.organizationId, line.productId, input.countedQty, true);
    const updated = await tx.stockCountLine.update({
      where: { id: input.lineId },
      data: {
        countedQty: input.countedQty,
        deltaQty: roundQuantity(input.countedQty - line.expectedOnHand),
      },
    });
    await tx.stockCount.update({ where: { id: line.stockCountId }, data: { updatedAt: new Date() } });
    await writeAuditLog(tx, { organizationId: input.organizationId, actorId: input.actorId, requestId: input.requestId, action: "STOCK_COUNT_LINE_SET", entity: "StockCountLine", entityId: line.id, before: toJson(line), after: toJson(updated) });
    return updated;
  });
};

export const removeLine = async (input: {
  lineId: string;
  actorId: string;
  organizationId: string;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const identity = await tx.stockCountLine.findUnique({ where: { id: input.lineId }, select: { stockCountId: true } });
    if (identity) await tx.$queryRaw`SELECT "id" FROM "StockCount" WHERE "id" = ${identity.stockCountId} FOR UPDATE`;
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

    await assertBaamReviewedVersion(tx, "StockCount", line.stockCountId);
    await tx.stockCountLine.delete({ where: { id: input.lineId } });
    await tx.stockCount.update({ where: { id: line.stockCountId }, data: { updatedAt: new Date() } });
    await writeAuditLog(tx, { organizationId: input.organizationId, actorId: input.actorId, requestId: input.requestId, action: "STOCK_COUNT_LINE_REMOVE", entity: "StockCountLine", entityId: line.id, before: toJson(line) });
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
        await assertBaamReviewedVersion(tx, "StockCount", input.stockCountId);
        await tx.$queryRaw`SELECT "id" FROM "StockCount" WHERE "id" = ${input.stockCountId} FOR UPDATE`;
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

        await lockStoreStockReset(tx, count.storeId);
        const staleLineIds = await findStaleStockCountLines(tx, count);
        if (staleLineIds.length > 0) {
          throw new AppError("stockCountStaleLines", "CONFLICT", 409, { staleLineIds });
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
          // Apply the discrepancy observed when this line was counted. Later sales
          // and receipts must survive; never reset the current stock to an old count.
          const deltaQty = roundQuantity(line.countedQty - line.expectedOnHand);

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
            allowNegativeStock: true,
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

        const applied = await tx.stockCount.update({
          where: { id: count.id },
          data: {
            status: StockCountStatus.APPLIED,
            appliedAt: new Date(),
            appliedById: input.actorId,
          },
        });
        await writeAuditLog(tx, { organizationId: input.organizationId, actorId: input.actorId, requestId: input.requestId, action: "STOCK_COUNT_DOCUMENT_APPLY", entity: "StockCount", entityId: count.id, before: toJson(count), after: toJson(applied) });

        return { applied: true, adjustments };
      },
    );

    await tx.$queryRaw`SELECT "id" FROM "StockCount" WHERE "id" = ${input.stockCountId} FOR UPDATE`;
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
    await assertBaamReviewedVersion(tx, "StockCount", input.stockCountId);
    await tx.$queryRaw`SELECT "id" FROM "StockCount" WHERE "id" = ${input.stockCountId} FOR UPDATE`;
    const count = await tx.stockCount.findUnique({ where: { id: input.stockCountId } });
    if (!count || count.organizationId !== input.organizationId) {
      throw new AppError("stockCountNotFound", "NOT_FOUND", 404);
    }
    if (count.status === StockCountStatus.APPLIED) {
      throw new AppError("stockCountLocked", "CONFLICT", 409);
    }

    const cancelled = await tx.stockCount.update({
      where: { id: count.id },
      data: { status: StockCountStatus.CANCELLED },
    });
    await writeAuditLog(tx, { organizationId: input.organizationId, actorId: input.actorId, requestId: input.requestId, action: "STOCK_COUNT_CANCEL", entity: "StockCount", entityId: count.id, before: toJson(count), after: toJson(cancelled) });
    return cancelled;
  });
};
