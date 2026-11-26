import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { OperationRequestPrincipalType, Prisma, StockMovementType, type InventorySnapshot } from "@prisma/client";

import { isValidQuantity, roundQuantity } from "@/lib/quantity";
import { prisma } from "@/server/db/prisma";
import { eventBus } from "@/server/events/eventBus";
import { writeAuditLog } from "@/server/services/audit";
import { classifyDatabaseOperationFailure } from "@/server/services/databaseOperationFailure";
import { AppError } from "@/server/services/errors";
import { lockStoreStockReset } from "@/server/services/inventoryLock";
import { toJson } from "@/server/services/json";
import { runOperationRequest } from "@/server/services/operationRequests";

type StoreResetScope = { organizationId: string; storeId: string; actorId: string };
type StoreResetCommand = StoreResetScope & { reason: string; requestId: string };
type ResetSnapshot = InventorySnapshot & { hidden: boolean; validVariant: boolean };
type ResetLot = { id: string; snapshotId: string | null; variantId: string | null; onHandQty: number };
type ResetRow = { snapshot: InventorySnapshot; hidden: boolean; lots: ResetLot[] };

const stalePreview = () => new AppError("inventoryStoreResetPreviewStale", "CONFLICT", 409);

const loadResetRows = async (
  tx: Prisma.TransactionClient,
  scope: StoreResetScope,
  options: { lock: boolean; snapshotIds?: string[] },
): Promise<ResetRow[]> => {
  const store = await tx.store.findFirst({
    where: { id: scope.storeId, organizationId: scope.organizationId },
    select: { id: true, catalogSourcesConfigured: true },
  });
  if (!store) throw new AppError("storeAccessDenied", "FORBIDDEN", 403);

  const snapshots = await tx.$queryRaw<ResetSnapshot[]>`
    SELECT s.*,
      (p."isDeleted" OR coalesce(sp."isHidden", false)
        OR (s."variantId" IS NOT NULL AND NOT coalesce(v."isActive", false))
        OR (NOT ${store.catalogSourcesConfigured} AND NOT coalesce(sp."isActive", false))) AS "hidden",
      (s."variantKey" = coalesce(s."variantId", 'BASE')
        AND (s."variantId" IS NULL OR v."id" IS NOT NULL)) AS "validVariant"
    FROM "InventorySnapshot" s
    JOIN "Product" p ON p."id" = s."productId" AND p."organizationId" = ${scope.organizationId}
    LEFT JOIN "ProductVariant" v ON v."id" = s."variantId" AND v."productId" = p."id"
    LEFT JOIN "StoreProduct" sp ON sp."storeId" = s."storeId" AND sp."productId" = p."id"
    WHERE s."storeId" = ${scope.storeId}
      ${options.snapshotIds ? Prisma.sql`AND NOT p."isDeleted" AND s."id" IN (${Prisma.join(options.snapshotIds)})` : Prisma.empty}
    ORDER BY s."productId", s."variantKey"
    ${options.lock ? Prisma.sql`FOR UPDATE OF s` : Prisma.empty}
  `;
  if (options.snapshotIds && snapshots.length !== options.snapshotIds.length) {
    throw new AppError("inventorySelectionInvalid", "FORBIDDEN", 403);
  }

  // Every stock movement locks its snapshot before touching a lot. Reading the lots
  // after those locks shows the latest balances, including dormant lots from when
  // expiration tracking was enabled.
  const lots = await tx.$queryRaw<ResetLot[]>`
    SELECT l."id", s."id" AS "snapshotId", l."variantId", l."onHandQty"
    FROM "StockLot" l
    JOIN "Product" p ON p."id" = l."productId" AND p."organizationId" = ${scope.organizationId}
    LEFT JOIN "InventorySnapshot" s ON s."storeId" = l."storeId"
      AND s."productId" = l."productId" AND s."variantKey" = l."variantKey"
    WHERE l."organizationId" = ${scope.organizationId} AND l."storeId" = ${scope.storeId}
      AND l."onHandQty" <> 0
      ${options.snapshotIds ? Prisma.sql`AND s."id" IN (${Prisma.join(options.snapshotIds)})` : Prisma.empty}
    ORDER BY l."productId", l."variantKey", l."id"
    ${options.lock ? Prisma.sql`FOR UPDATE OF l` : Prisma.empty}
  `;
  const rows = new Map<string, ResetRow>();
  for (const { hidden, validVariant, ...snapshot } of snapshots) {
    if (!validVariant || !isValidQuantity(snapshot.onHand)) {
      throw new AppError("inventoryReconciliationRequired", "CONFLICT", 409);
    }
    rows.set(snapshot.id, { snapshot, hidden, lots: [] });
  }
  for (const lot of lots) {
    const row = lot.snapshotId && rows.get(lot.snapshotId);
    if (!row && lot.snapshotId && options.lock && !options.snapshotIds) {
      // A receipt created a new stock row between the two reads.
      throw stalePreview();
    }
    if (!row || lot.variantId !== row.snapshot.variantId || !isValidQuantity(lot.onHandQty)) {
      throw new AppError("inventoryReconciliationRequired", "CONFLICT", 409);
    }
    row.lots.push(lot);
  }
  return [...rows.values()];
};

const changesStock = ({ snapshot, lots }: ResetRow) => snapshot.onHand !== 0 || lots.length > 0;

const summarizeResetRows = (rows: ResetRow[]) => {
  const changed = rows.filter(changesStock);
  return {
    snapshotCount: rows.length,
    nonZeroCount: changed.length,
    hiddenNonZeroCount: changed.filter((row) => row.hidden).length,
  };
};

const storeResetAuditCount = (tx: Prisma.TransactionClient, scope: StoreResetScope) =>
  tx.auditLog.count({
    where: { organizationId: scope.organizationId, entity: "Store", entityId: scope.storeId, action: "INVENTORY_STORE_RESET" },
  });

const fingerprintRows = (rows: ResetRow[], resetCount: number) => {
  const hash = createHash("sha256").update(`${resetCount}\n`);
  for (const { snapshot, hidden, lots } of rows) {
    hash.update(JSON.stringify([
      snapshot.id, snapshot.version, snapshot.onHand, hidden,
      lots.map((lot) => [lot.id, lot.onHandQty]),
    ]) + "\n");
  }
  return hash.digest("hex");
};

const signPreview = (scope: StoreResetScope, expires: string, fingerprint: string) => {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new AppError("serviceUnavailable", "INTERNAL_SERVER_ERROR", 503);
  return createHmac("sha256", secret)
    .update(JSON.stringify(["inventory.storeStockReset.v1", scope.organizationId, scope.actorId, scope.storeId, expires, fingerprint]))
    .digest();
};

const readPreviewFingerprint = (scope: StoreResetScope, token: string) => {
  if (!/^\d{1,16}\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token)) throw stalePreview();
  const [expires, fingerprint, signature] = token.split(".");
  if (Number(expires) <= Date.now() || !timingSafeEqual(Buffer.from(signature, "hex"), signPreview(scope, expires, fingerprint))) {
    throw stalePreview();
  }
  return fingerprint;
};

export const previewStoreStockReset = async (scope: StoreResetScope) => {
  const { rows, resetCount } = await prisma.$transaction(async (tx) => ({
    rows: await loadResetRows(tx, scope, { lock: false }),
    resetCount: await storeResetAuditCount(tx, scope),
  }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
  const expires = String(Date.now() + 15 * 60_000);
  const fingerprint = fingerprintRows(rows, resetCount);
  return {
    storeId: scope.storeId,
    ...summarizeResetRows(rows),
    previewToken: `${expires}.${fingerprint}.${signPreview(scope, expires, fingerprint).toString("hex")}`,
  };
};

const writeInBatches = async <T>(entries: T[], writeBatch: (batch: T[]) => Promise<unknown>) => {
  const batchSize = 1_000;
  for (let offset = 0; offset < entries.length; offset += batchSize) {
    await writeBatch(entries.slice(offset, offset + batchSize));
  }
};

const writeZeroStock = async (
  tx: Prisma.TransactionClient,
  command: StoreResetCommand,
  rows: ResetRow[],
  mode: "wholeStore" | "selectedRows",
) => {
  const resetId = randomUUID();
  const appliedAt = new Date();
  const movements: Prisma.StockMovementCreateManyInput[] = [];
  const audits: Prisma.AuditLogCreateManyInput[] = [];
  const snapshotIds: string[] = [];
  const lotIds: string[] = [];
  let updatedCount = 0;

  for (const row of rows) {
    const { snapshot, lots } = row;
    const changed = changesStock(row);
    if (changed) {
      updatedCount += 1;
      const movement = {
        storeId: command.storeId,
        productId: snapshot.productId,
        variantId: snapshot.variantId,
        type: StockMovementType.ADJUSTMENT,
        referenceType: mode === "wholeStore" ? "STORE_STOCK_RESET" : "BULK_STOCK_ZERO",
        referenceId: resetId,
        note: command.reason,
        createdById: command.actorId,
        createdAt: appliedAt,
      };
      if (snapshot.onHand !== 0) snapshotIds.push(snapshot.id);
      let lotTotal = 0;
      for (const lot of lots) {
        lotIds.push(lot.id);
        lotTotal += lot.onHandQty;
        movements.push({ ...movement, stockLotId: lot.id, qtyDelta: -lot.onHandQty });
      }
      // Loose stock is possible if expiry tracking was disabled. Keep the sum of
      // the reset ledger entries equal to the change in the physical balance.
      const unallocatedAdjustment = roundQuantity(lotTotal - snapshot.onHand);
      if (unallocatedAdjustment) movements.push({ ...movement, qtyDelta: unallocatedAdjustment });
    }
    if (changed || mode === "selectedRows") {
      const after = snapshot.onHand === 0 ? snapshot : {
        ...snapshot, onHand: 0, version: snapshot.version + 1, updatedAt: appliedAt,
      };
      audits.push({
        organizationId: command.organizationId,
        actorId: command.actorId,
        action: mode === "wholeStore" ? "INVENTORY_STORE_RESET_LINE" : "INVENTORY_BULK_SET_ON_HAND",
        entity: "InventorySnapshot",
        entityId: snapshot.id,
        before: toJson(snapshot),
        after: toJson({ ...after, resetId, resetLotCount: lots.length, reason: command.reason }),
        requestId: command.requestId,
        createdAt: appliedAt,
      });
    }
  }

  await writeInBatches(snapshotIds, (ids) => tx.inventorySnapshot.updateMany({
    where: { storeId: command.storeId, id: { in: ids } },
    data: { onHand: 0, updatedAt: appliedAt },
  }));
  await writeInBatches(lotIds, (ids) => tx.stockLot.updateMany({
    where: { organizationId: command.organizationId, storeId: command.storeId, id: { in: ids } },
    data: { onHandQty: 0, updatedAt: appliedAt },
  }));
  await writeInBatches(movements, (data) => tx.stockMovement.createMany({ data }));
  await writeInBatches(audits, (data) => tx.auditLog.createMany({ data }));
  return { resetId, updatedCount };
};

// The caller already holds the store reset lock and the enclosing operation lease.
export const zeroSelectedStock = async (tx: Prisma.TransactionClient, command: StoreResetCommand & { snapshotIds: string[] }) => {
  const rows = await loadResetRows(tx, command, { lock: true, snapshotIds: command.snapshotIds });
  return writeZeroStock(tx, command, rows, "selectedRows");
};

export const resetStoreStock = async (input: StoreResetCommand & { previewToken: string; idempotencyKey: string }) => {
  const operation = await runOperationRequest({
    organizationId: input.organizationId,
    storeId: input.storeId,
    scope: "inventory.resetStoreStock",
    principal: { type: OperationRequestPrincipalType.AUTHENTICATED_USER, id: input.actorId },
    idempotencyKey: input.idempotencyKey,
    payload: {
      version: "inventory.resetStoreStock.v1",
      value: toJson({ storeId: input.storeId, previewToken: input.previewToken, reason: input.reason }),
    },
    allowedResponsePaths: ["storeId", "requestedCount", "updatedCount"],
    transactionOptions: { maxWait: 10_000, timeout: 120_000 },
    classifyFailure: (error) => classifyDatabaseOperationFailure(error, "inventoryStoreResetFailed"),
  }, async (tx) => {
    const expectedFingerprint = readPreviewFingerprint(input, input.previewToken);
    await lockStoreStockReset(tx, input.storeId);
    const rows = await loadResetRows(tx, input, { lock: true });
    const resetCount = await storeResetAuditCount(tx, input);
    if (fingerprintRows(rows, resetCount) !== expectedFingerprint) throw stalePreview();
    const { updatedCount, resetId } = await writeZeroStock(tx, input, rows, "wholeStore");
    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "INVENTORY_STORE_RESET",
      entity: "Store",
      entityId: input.storeId,
      before: toJson(summarizeResetRows(rows)),
      after: toJson({ storeId: input.storeId, resetId, reason: input.reason, updatedCount }),
      requestId: input.requestId,
    });
    return {
      response: { storeId: input.storeId, requestedCount: rows.length, updatedCount },
      responseStatus: 200,
      resource: { type: "Store", id: input.storeId },
    };
  });

  if (!operation.replayed && operation.response.updatedCount > 0) {
    eventBus.publish({ type: "inventory.updated", payload: { storeId: input.storeId, productId: "*" } });
  }
  return operation.response;
};
