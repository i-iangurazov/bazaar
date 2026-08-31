import { randomUUID } from "node:crypto";

import { Prisma, type InventoryValuationBackfillRun, type PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;
type DecimalLike = Prisma.Decimal | string | number;

export const INVENTORY_VALUATION_ALGORITHM_VERSION = "2026-08-31.v2";
const VALUE_SCALE = 6;
const AVERAGE_SCALE = 2;
const ROUNDING = Prisma.Decimal.ROUND_HALF_UP;
const ZERO_COST_MARKER = "[ZERO_COST_REASON]";
const MAX_VALUE = new Prisma.Decimal("999999999999.999999");
const MAX_AVERAGE = new Prisma.Decimal("9999999999.99");
const MAX_STORED_QUANTITY = BigInt(2_147_483_647);
const MIN_STORED_QUANTITY = BigInt(-2_147_483_648);
const DEFAULT_MAX_BATCHES = 1;
const MAX_BATCHES = 10_000;

const decimal = (value: DecimalLike) => new Prisma.Decimal(value.toString());
const normalized = (value: DecimalLike) => decimal(value).toDecimalPlaces(VALUE_SCALE, ROUNDING);
const canonicalValue = (value: DecimalLike) => normalized(value).toFixed(VALUE_SCALE);
const projectedAverage = (value: Prisma.Decimal, quantity: number) =>
  quantity > 0
    ? value.div(quantity).toDecimalPlaces(AVERAGE_SCALE, ROUNDING)
    : new Prisma.Decimal(0);

export type InventoryMovementEvidence = {
  type: string;
  qtyDelta: number;
  unitCostKgs: DecimalLike | null;
  lineTotalKgs: DecimalLike | null;
  note: string | null;
  referenceType: string | null;
  existingInventoryValueKgs?: DecimalLike | null;
  linkedFrozenCostKgs?: DecimalLike | null;
  pairedTransferValueKgs?: DecimalLike | null;
};

export type InventoryMovementClassification =
  | {
      outcome: "VALUE";
      valueKgs: string;
      status: "LEGACY_EVIDENCE" | "EXPLICIT_ZERO";
      reason: string;
    }
  | {
      outcome: "NOT_APPLICABLE";
      valueKgs: string;
      status: "NOT_APPLICABLE";
      reason: string;
    }
  | {
      outcome: "REVIEW";
      valueKgs: null;
      status: "REVIEW_REQUIRED";
      reason: string;
    };

const review = (reason: string): InventoryMovementClassification => ({
  outcome: "REVIEW",
  valueKgs: null,
  status: "REVIEW_REQUIRED",
  reason,
});

const signedCost = (input: InventoryMovementEvidence) => {
  const evidence =
    input.lineTotalKgs === null
      ? input.unitCostKgs === null
        ? null
        : decimal(input.unitCostKgs).mul(input.qtyDelta)
      : decimal(input.lineTotalKgs);
  if (evidence === null) return null;
  return normalized(
    input.qtyDelta < 0 ? evidence.abs().negated() : input.qtyDelta > 0 ? evidence.abs() : evidence,
  );
};

export const classifyInventoryMovementEvidence = (
  input: InventoryMovementEvidence,
): InventoryMovementClassification => {
  let value: Prisma.Decimal | null = null;
  let reason = "UNSUPPORTED_MOVEMENT_EVIDENCE";

  if (input.type === "TRANSFER_OUT" || input.type === "TRANSFER_IN") {
    if (input.pairedTransferValueKgs !== undefined && input.pairedTransferValueKgs !== null) {
      value = normalized(
        input.qtyDelta < 0
          ? decimal(input.pairedTransferValueKgs).abs().negated()
          : decimal(input.pairedTransferValueKgs).abs(),
      );
    }
    reason = "PAIRED_TRANSFER_COST_EVIDENCE";
  } else if (
    input.existingInventoryValueKgs !== undefined &&
    input.existingInventoryValueKgs !== null
  ) {
    value = normalized(input.existingInventoryValueKgs);
    reason = "EXISTING_LEDGER_VALUE_EVIDENCE";
  } else if (input.qtyDelta === 0) {
    if (
      input.lineTotalKgs !== null &&
      (input.type === "RECEIVE" || input.referenceType === "STOCK_RECEIVING")
    ) {
      value = normalized(input.lineTotalKgs);
      reason = "RECEIPT_VALUE_ONLY_CORRECTION";
    } else {
      return {
        outcome: "NOT_APPLICABLE",
        valueKgs: canonicalValue(0),
        status: "NOT_APPLICABLE",
        reason: "NO_QUANTITY_OR_VALUE_EFFECT",
      };
    }
  } else if (input.type === "RECEIVE") {
    value = signedCost(input);
    reason = "RECEIPT_COST_EVIDENCE";
  } else if (input.type === "WRITE_OFF") {
    value = signedCost(input);
    reason = "WRITE_OFF_COST_EVIDENCE";
  } else if (input.type === "SALE" || input.type === "RETURN") {
    value =
      input.linkedFrozenCostKgs === null || input.linkedFrozenCostKgs === undefined
        ? null
        : normalized(
            input.type === "SALE"
              ? decimal(input.linkedFrozenCostKgs).abs().negated()
              : decimal(input.linkedFrozenCostKgs).abs(),
          );
    reason = "FROZEN_DOCUMENT_COST_EVIDENCE";
  } else if (
    input.type === "ADJUSTMENT" &&
    (input.referenceType === "IMPORT_ROLLBACK" ||
      input.referenceType === "Product" ||
      input.referenceType === "ProductVariant")
  ) {
    value = signedCost(input);
    reason = "BOUNDED_ADJUSTMENT_COST_EVIDENCE";
  } else if (input.unitCostKgs !== null) {
    value = normalized(decimal(input.unitCostKgs).mul(input.qtyDelta));
    reason = "EXPLICIT_UNIT_COST_EVIDENCE";
  }

  if (value === null) return review(reason);
  if (value.abs().gt(MAX_VALUE)) return review("VALUE_STORAGE_OVERFLOW");
  if ((input.qtyDelta > 0 && value.lt(0)) || (input.qtyDelta < 0 && value.gt(0))) {
    return review("VALUE_SIGN_MISMATCH");
  }
  if (input.qtyDelta > 0 && value.equals(0)) {
    const markerIndex = input.note?.indexOf(ZERO_COST_MARKER) ?? -1;
    const zeroReason =
      markerIndex >= 0 ? input.note?.slice(markerIndex + ZERO_COST_MARKER.length).trim() : "";
    if (!zeroReason) return review("POSITIVE_ZERO_WITHOUT_AUDIT_REASON");
    return {
      outcome: "VALUE",
      valueKgs: canonicalValue(0),
      status: "EXPLICIT_ZERO",
      reason: "LEGACY_EXPLICIT_ZERO_REASON",
    };
  }
  return {
    outcome: "VALUE",
    valueKgs: canonicalValue(value),
    status: "LEGACY_EVIDENCE",
    reason,
  };
};

type MovementRow = {
  id: string;
  organizationId: string;
  storeId: string;
  productId: string;
  variantId: string | null;
  variantKey: string;
  type: string;
  qtyDelta: number;
  linePosition: number | null;
  unitCostKgs: Prisma.Decimal | null;
  lineTotalKgs: Prisma.Decimal | null;
  inventoryValueDeltaKgs: Prisma.Decimal | null;
  inventoryValueStatus: string | null;
  note: string | null;
  referenceType: string | null;
  referenceId: string | null;
  ledgerRecordedAt: Date | null;
};

const resolveLinkedFrozenCost = async (tx: Prisma.TransactionClient, movement: MovementRow) => {
  if (!movement.referenceId) return null;
  if (movement.type === "SALE" && movement.referenceType === "CustomerOrder") {
    const result = await tx.customerOrderLine.aggregate({
      where: {
        customerOrderId: movement.referenceId,
        productId: movement.productId,
        variantKey: movement.variantKey,
      },
      _sum: { qty: true, lineCostTotalKgs: true },
    });
    return result._sum.qty === Math.abs(movement.qtyDelta) ? result._sum.lineCostTotalKgs : null;
  }
  if (movement.type === "RETURN" && movement.referenceType === "SaleReturn") {
    const result = await tx.saleReturnLine.aggregate({
      where: {
        saleReturnId: movement.referenceId,
        productId: movement.productId,
        variantKey: movement.variantKey,
      },
      _sum: { qty: true, lineCostTotalKgs: true },
    });
    return result._sum.qty === Math.abs(movement.qtyDelta) ? result._sum.lineCostTotalKgs : null;
  }
  return null;
};

const resolvePairedTransferValue = async (tx: Prisma.TransactionClient, movement: MovementRow) => {
  if (movement.type !== "TRANSFER_IN" && movement.type !== "TRANSFER_OUT") {
    return undefined;
  }
  if (movement.referenceType !== "TRANSFER" || !movement.referenceId) return null;

  const counterpartType = movement.type === "TRANSFER_IN" ? "TRANSFER_OUT" : "TRANSFER_IN";
  const counterparts = await tx.stockMovement.findMany({
    where: {
      id: { not: movement.id },
      type: counterpartType,
      referenceType: "TRANSFER",
      referenceId: movement.referenceId,
      productId: movement.productId,
      variantId: movement.variantId,
      linePosition: movement.linePosition,
      qtyDelta: -movement.qtyDelta,
      storeId: { not: movement.storeId },
      store: { organizationId: movement.organizationId },
    },
    select: {
      inventoryValueDeltaKgs: true,
      inventoryValueStatus: true,
      lineTotalKgs: true,
      unitCostKgs: true,
      qtyDelta: true,
    },
    take: 2,
  });
  if (counterparts.length !== 1 || counterparts[0]!.inventoryValueStatus === "REVIEW_REQUIRED") {
    return null;
  }
  const counterpart = counterparts[0]!;
  const counterpartEvidence =
    counterpart.inventoryValueDeltaKgs ??
    counterpart.lineTotalKgs ??
    (counterpart.unitCostKgs === null ? null : counterpart.unitCostKgs.mul(counterpart.qtyDelta));
  const ownEvidence =
    movement.inventoryValueDeltaKgs ??
    signedCost({
      type: movement.type,
      qtyDelta: movement.qtyDelta,
      unitCostKgs: movement.unitCostKgs,
      lineTotalKgs: movement.lineTotalKgs,
      note: movement.note,
      referenceType: movement.referenceType,
    });
  if (counterpartEvidence === null) return ownEvidence;
  const signedCounterpart = normalized(
    movement.qtyDelta < 0
      ? decimal(counterpartEvidence).abs().negated()
      : decimal(counterpartEvidence).abs(),
  );
  if (ownEvidence !== null && !normalized(ownEvidence).equals(signedCounterpart)) return null;
  return signedCounterpart;
};

const classifyMovementRow = async (tx: Prisma.TransactionClient, movement: MovementRow) =>
  classifyInventoryMovementEvidence({
    type: movement.type,
    qtyDelta: movement.qtyDelta,
    unitCostKgs: movement.unitCostKgs,
    lineTotalKgs: movement.lineTotalKgs,
    existingInventoryValueKgs: movement.inventoryValueDeltaKgs,
    note: movement.note,
    referenceType: movement.referenceType,
    linkedFrozenCostKgs: await resolveLinkedFrozenCost(tx, movement),
    pairedTransferValueKgs: await resolvePairedTransferValue(tx, movement),
  });

export type InventoryValuationSnapshot = {
  unclassifiedMovements: number;
  reviewMovements: number;
  unreconciledCostScopes: number;
  reviewCostScopes: number;
};

export const readInventoryValuationSnapshot = async (
  db: DbClient,
  organizationId?: string | null,
): Promise<InventoryValuationSnapshot> => {
  const organizationMovementWhere = organizationId
    ? Prisma.sql`AND store."organizationId" = ${organizationId}`
    : Prisma.empty;
  const organizationCostWhere = organizationId
    ? Prisma.sql`WHERE cost."organizationId" = ${organizationId}`
    : Prisma.empty;
  const [movement] = await db.$queryRaw<Array<{ unclassified: number; review: number }>>(
    Prisma.sql`
      SELECT
        COUNT(*) FILTER (
          WHERE movement."inventoryValueStatus" IS NULL
             OR (
               movement."inventoryValueDeltaKgs" IS NULL
               AND movement."inventoryValueStatus" IS DISTINCT FROM 'REVIEW_REQUIRED'
             )
             OR (
               movement."inventoryValueDeltaKgs" IS NOT NULL
               AND movement."inventoryValueStatus" = 'REVIEW_REQUIRED'
             )
        )::int AS unclassified,
        COUNT(*) FILTER (
          WHERE movement."inventoryValueStatus" = 'REVIEW_REQUIRED'
        )::int AS review
      FROM "StockMovement" movement
      INNER JOIN "Store" store ON store.id = movement."storeId"
      WHERE TRUE ${organizationMovementWhere}
    `,
  );
  const [cost] = await db.$queryRaw<Array<{ unreconciled: number; review: number }>>(
    Prisma.sql`
      SELECT
        COUNT(*) FILTER (
          WHERE cost."valuationStatus" IS DISTINCT FROM 'PRECISE'
             OR cost."preciseAvgCostKgs" IS NULL
             OR cost."preciseCostBasisQty" IS NULL
             OR cost."costBasisValueKgs" IS NULL
             OR cost."valuationUpdatedAt" IS NULL
             OR cost."valuationLegacyUpdatedAt" IS DISTINCT FROM cost."updatedAt"
             OR cost."preciseCostBasisQty" < 0
             OR cost."costBasisValueKgs" < 0
             OR (
               cost."preciseCostBasisQty" = 0
               AND cost."costBasisValueKgs" <> 0
             )
        )::int AS unreconciled,
        COUNT(*) FILTER (WHERE cost."valuationStatus" = 'REVIEW_REQUIRED')::int AS review
      FROM "ProductCost" cost
      ${organizationCostWhere}
    `,
  );
  return {
    unclassifiedMovements: movement?.unclassified ?? 0,
    reviewMovements: movement?.review ?? 0,
    unreconciledCostScopes: cost?.unreconciled ?? 0,
    reviewCostScopes: cost?.review ?? 0,
  };
};

export type RunInventoryValuationBackfillInput = {
  runId: string;
  organizationId?: string | null;
  batchSize: number;
  dryRun: boolean;
  maxBatches?: number;
  writerDrainConfirmed?: boolean;
  writerDrainEvidence?: string;
};

const validateRunInput = (input: RunInventoryValuationBackfillInput) => {
  if (!input.runId.trim() || !/^[A-Za-z0-9._:-]{1,120}$/.test(input.runId)) {
    throw new Error("BACKFILL_RUN_ID_INVALID");
  }
  if (!Number.isInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 500) {
    throw new Error("BACKFILL_BATCH_SIZE_INVALID");
  }
  if (
    input.maxBatches !== undefined &&
    (!Number.isInteger(input.maxBatches) || input.maxBatches < 1 || input.maxBatches > MAX_BATCHES)
  ) {
    throw new Error("BACKFILL_MAX_BATCHES_INVALID");
  }
  if (input.dryRun && (input.writerDrainConfirmed || input.writerDrainEvidence)) {
    throw new Error("BACKFILL_DRY_RUN_WRITE_CONFIRMATION_FORBIDDEN");
  }
  if (!input.dryRun && !input.writerDrainConfirmed) {
    throw new Error("BACKFILL_WRITER_DRAIN_CONFIRMATION_REQUIRED");
  }
  if (
    !input.dryRun &&
    (!input.writerDrainEvidence ||
      input.writerDrainEvidence.trim().length < 10 ||
      input.writerDrainEvidence.length > 500)
  ) {
    throw new Error("BACKFILL_WRITER_DRAIN_EVIDENCE_REQUIRED");
  }
};

type MovementWindow = {
  organizationId?: string | null;
  highWaterRecordedAt: Date;
  highWaterMovementId: string | null;
  cursorRecordedAt?: Date | null;
  cursorMovementId?: string | null;
};

const movementWhere = (input: MovementWindow): Prisma.StockMovementWhereInput => {
  const withinHighWater: Prisma.StockMovementWhereInput = {
    OR: [
      ...(input.highWaterMovementId
        ? [{ ledgerRecordedAt: null, id: { lte: input.highWaterMovementId } }]
        : []),
      { ledgerRecordedAt: { not: null, lte: input.highWaterRecordedAt } },
    ],
  };
  let afterCursor: Prisma.StockMovementWhereInput = {};
  if (input.cursorMovementId && input.cursorRecordedAt === null) {
    afterCursor = {
      OR: [
        { ledgerRecordedAt: null, id: { gt: input.cursorMovementId } },
        { ledgerRecordedAt: { not: null } },
      ],
    };
  } else if (input.cursorMovementId && input.cursorRecordedAt) {
    afterCursor = {
      OR: [
        { ledgerRecordedAt: { gt: input.cursorRecordedAt } },
        { ledgerRecordedAt: input.cursorRecordedAt, id: { gt: input.cursorMovementId } },
      ],
    };
  }
  return {
    AND: [
      withinHighWater,
      afterCursor,
      {
        OR: [
          { inventoryValueStatus: null },
          {
            inventoryValueDeltaKgs: null,
            inventoryValueStatus: { not: "REVIEW_REQUIRED" },
          },
        ],
      },
    ],
    ...(input.organizationId ? { store: { organizationId: input.organizationId } } : {}),
  };
};

const movementSelect = {
  id: true,
  storeId: true,
  productId: true,
  variantId: true,
  type: true,
  qtyDelta: true,
  linePosition: true,
  unitCostKgs: true,
  lineTotalKgs: true,
  inventoryValueDeltaKgs: true,
  inventoryValueStatus: true,
  note: true,
  referenceType: true,
  referenceId: true,
  ledgerRecordedAt: true,
  store: { select: { organizationId: true } },
} as const;

type SelectedMovement = Prisma.StockMovementGetPayload<{ select: typeof movementSelect }>;

const movementRow = (row: SelectedMovement): MovementRow => ({
  id: row.id,
  organizationId: row.store.organizationId,
  storeId: row.storeId,
  productId: row.productId,
  variantId: row.variantId,
  variantKey: row.variantId ?? "BASE",
  type: row.type,
  qtyDelta: row.qtyDelta,
  linePosition: row.linePosition,
  unitCostKgs: row.unitCostKgs,
  lineTotalKgs: row.lineTotalKgs,
  inventoryValueDeltaKgs: row.inventoryValueDeltaKgs,
  inventoryValueStatus: row.inventoryValueStatus,
  note: row.note,
  referenceType: row.referenceType,
  referenceId: row.referenceId,
  ledgerRecordedAt: row.ledgerRecordedAt,
});

const upsertIssue = async (
  tx: Prisma.TransactionClient,
  input: {
    runId: string;
    entityType: string;
    entityId: string;
    reason: string;
    evidence: Prisma.InputJsonObject;
  },
) => {
  await tx.inventoryValuationBackfillIssue.upsert({
    where: {
      runId_entityType_entityId: {
        runId: input.runId,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    },
    update: { reason: input.reason, evidenceJson: input.evidence },
    create: {
      id: randomUUID(),
      runId: input.runId,
      entityType: input.entityType,
      entityId: input.entityId,
      reason: input.reason,
      evidenceJson: input.evidence,
    },
  });
};

const processMovementBatch = async (
  prisma: PrismaClient,
  input: RunInventoryValuationBackfillInput,
) =>
  prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '2s'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
      await tx.$queryRaw`
        SELECT "id" FROM "InventoryValuationBackfillRun"
        WHERE "id" = ${input.runId} FOR UPDATE
      `;
      const run = await tx.inventoryValuationBackfillRun.findUniqueOrThrow({
        where: { id: input.runId },
      });
      if (run.phase !== "MOVEMENTS" || !run.highWaterRecordedAt) {
        return { scanned: 0, updated: 0, review: 0, transitioned: run.phase !== "MOVEMENTS" };
      }
      const rows = await tx.stockMovement.findMany({
        where: movementWhere({
          organizationId: input.organizationId,
          highWaterRecordedAt: run.highWaterRecordedAt,
          highWaterMovementId: run.highWaterMovementId,
          cursorRecordedAt: run.cursorRecordedAt,
          cursorMovementId: run.cursorMovementId,
        }),
        select: movementSelect,
        orderBy: [{ ledgerRecordedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
        take: input.batchSize,
      });
      if (!rows.length) {
        await tx.inventoryValuationBackfillRun.update({
          where: { id: input.runId },
          data: { phase: "PRODUCT_COSTS", cursorProductId: null, cursorVariantKey: null },
        });
        return { scanned: 0, updated: 0, review: 0, transitioned: true };
      }

      let updated = 0;
      let reviewCount = 0;
      for (const row of rows) {
        const classification = await classifyMovementRow(tx, movementRow(row));
        const result = await tx.stockMovement.updateMany({
          where: {
            id: row.id,
            inventoryValueStatus: row.inventoryValueStatus,
            inventoryValueDeltaKgs: row.inventoryValueDeltaKgs,
          },
          data: {
            inventoryValueDeltaKgs:
              classification.outcome === "REVIEW"
                ? row.inventoryValueDeltaKgs
                : classification.valueKgs,
            inventoryValueStatus: classification.status,
            inventoryValueReason: classification.reason,
            inventoryValueUpdatedAt: new Date(),
          },
        });
        if (result.count !== 1) {
          reviewCount += 1;
          await upsertIssue(tx, {
            runId: input.runId,
            entityType: "StockMovement",
            entityId: row.id,
            reason: "CONCURRENT_MOVEMENT_CHANGE",
            evidence: {
              type: row.type,
              qtyDelta: row.qtyDelta,
              cursorRecordedAt: row.ledgerRecordedAt?.toISOString() ?? null,
            },
          });
          continue;
        }
        if (classification.outcome === "REVIEW") {
          reviewCount += 1;
          await upsertIssue(tx, {
            runId: input.runId,
            entityType: "StockMovement",
            entityId: row.id,
            reason: classification.reason,
            evidence: {
              type: row.type,
              qtyDelta: row.qtyDelta,
              hasUnitCost: row.unitCostKgs !== null,
              hasLineTotal: row.lineTotalKgs !== null,
              hadPartialValue: row.inventoryValueDeltaKgs !== null,
            },
          });
        } else {
          updated += 1;
        }
      }
      const last = rows.at(-1)!;
      await tx.inventoryValuationBackfillRun.update({
        where: { id: input.runId },
        data: {
          cursorRecordedAt: last.ledgerRecordedAt,
          cursorMovementId: last.id,
          batchCount: { increment: 1 },
          scannedRows: { increment: rows.length },
          updatedRows: { increment: updated },
          reviewRows: { increment: reviewCount },
          movementScannedRows: { increment: rows.length },
          movementUpdatedRows: { increment: updated },
          movementReviewRows: { increment: reviewCount },
        },
      });
      return { scanned: rows.length, updated, review: reviewCount, transitioned: false };
    },
    { maxWait: 5_000, timeout: 120_000 },
  );

type CostRow = {
  id: string;
  organizationId: string;
  productId: string;
  variantKey: string;
  updatedAt: Date;
  preciseAvgCostKgs: Prisma.Decimal | null;
  preciseCostBasisQty: number | null;
  costBasisValueKgs: Prisma.Decimal | null;
  valuationStatus: string | null;
  valuationUpdatedAt: Date | null;
  valuationLegacyUpdatedAt: Date | null;
};

const classifyCostScope = async (
  tx: Prisma.TransactionClient,
  cost: CostRow,
  highWater: { recordedAt: Date; legacyMovementId: string | null },
) => {
  const productLock = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "Product"
    WHERE "id" = ${cost.productId} AND "organizationId" = ${cost.organizationId}
    FOR UPDATE
  `);
  if (!productLock.length) return { outcome: "REVIEW" as const, reason: "PRODUCT_SCOPE_MISSING" };

  const snapshotVariant =
    cost.variantKey === "BASE"
      ? Prisma.sql`snapshot."variantId" IS NULL`
      : Prisma.sql`snapshot."variantId" = ${cost.variantKey}`;
  const [snapshot] = await tx.$queryRaw<Array<{ quantity: string; negative: number }>>(Prisma.sql`
    SELECT COALESCE(SUM(snapshot."onHand"), 0)::text AS quantity,
      COUNT(*) FILTER (WHERE snapshot."onHand" < 0)::int AS negative
    FROM "InventorySnapshot" snapshot
    INNER JOIN "Store" store ON store.id = snapshot."storeId"
    WHERE store."organizationId" = ${cost.organizationId}
      AND snapshot."productId" = ${cost.productId}
      AND ${snapshotVariant}
  `);
  if ((snapshot?.negative ?? 0) > 0) {
    return { outcome: "REVIEW" as const, reason: "NEGATIVE_STORE_SNAPSHOT" };
  }

  const movementVariant =
    cost.variantKey === "BASE"
      ? Prisma.sql`movement."variantId" IS NULL`
      : Prisma.sql`movement."variantId" = ${cost.variantKey}`;
  const legacyWindow = highWater.legacyMovementId
    ? Prisma.sql`(movement."ledgerRecordedAt" IS NULL AND movement.id <= ${highWater.legacyMovementId})`
    : Prisma.sql`FALSE`;
  const [ledger] = await tx.$queryRaw<
    Array<{ quantity: string; value: string; unvalued: number; explicitZero: number }>
  >(Prisma.sql`
    SELECT COALESCE(SUM(movement."qtyDelta"), 0)::text AS quantity,
      COALESCE(SUM(movement."inventoryValueDeltaKgs"), 0)::text AS value,
      COUNT(*) FILTER (
        WHERE movement."qtyDelta" <> 0 AND movement."inventoryValueDeltaKgs" IS NULL
      )::int AS unvalued,
      COUNT(*) FILTER (
        WHERE movement."inventoryValueStatus" = 'EXPLICIT_ZERO'
      )::int AS "explicitZero"
    FROM "StockMovement" movement
    INNER JOIN "Store" store ON store.id = movement."storeId"
    WHERE store."organizationId" = ${cost.organizationId}
      AND movement."productId" = ${cost.productId}
      AND ${movementVariant}
      AND (
        ${legacyWindow}
        OR (
          movement."ledgerRecordedAt" IS NOT NULL
          AND movement."ledgerRecordedAt" <= ${highWater.recordedAt}
        )
      )
  `);
  if ((ledger?.unvalued ?? 0) > 0) {
    return { outcome: "REVIEW" as const, reason: "UNVALUED_MOVEMENT_HISTORY" };
  }

  const physicalQuantity = BigInt(snapshot?.quantity ?? "0");
  const ledgerQuantity = BigInt(ledger?.quantity ?? "0");
  if (ledgerQuantity !== physicalQuantity) {
    return { outcome: "REVIEW" as const, reason: "LEDGER_SNAPSHOT_QUANTITY_MISMATCH" };
  }
  if (physicalQuantity > MAX_STORED_QUANTITY || physicalQuantity < MIN_STORED_QUANTITY) {
    return { outcome: "REVIEW" as const, reason: "QUANTITY_STORAGE_OVERFLOW" };
  }

  const ledgerValue = normalized(ledger?.value ?? "0");
  if (ledgerValue.abs().gt(MAX_VALUE)) {
    return { outcome: "REVIEW" as const, reason: "VALUE_STORAGE_OVERFLOW" };
  }
  if (ledgerValue.lt(0) || (physicalQuantity === BigInt(0) && !ledgerValue.equals(0))) {
    return { outcome: "REVIEW" as const, reason: "INVALID_LEDGER_BASIS" };
  }
  if (physicalQuantity > BigInt(0) && ledgerValue.equals(0) && (ledger?.explicitZero ?? 0) === 0) {
    return { outcome: "REVIEW" as const, reason: "POSITIVE_ZERO_WITHOUT_AUDIT_REASON" };
  }
  const quantity = Number(physicalQuantity);
  const averageCostKgs = projectedAverage(ledgerValue, quantity);
  if (averageCostKgs.abs().gt(MAX_AVERAGE)) {
    return { outcome: "REVIEW" as const, reason: "AVERAGE_STORAGE_OVERFLOW" };
  }
  return {
    outcome: "VALUE" as const,
    quantity,
    valueKgs: ledgerValue,
    averageCostKgs,
  };
};

const processCostBatch = async (prisma: PrismaClient, input: RunInventoryValuationBackfillInput) =>
  prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '2s'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
      await tx.$queryRaw`
        SELECT "id" FROM "InventoryValuationBackfillRun"
        WHERE "id" = ${input.runId} FOR UPDATE
      `;
      const run = await tx.inventoryValuationBackfillRun.findUniqueOrThrow({
        where: { id: input.runId },
      });
      if (run.phase !== "PRODUCT_COSTS") {
        return { scanned: 0, updated: 0, review: 0, completed: run.phase === "COMPLETE" };
      }
      if (!run.highWaterRecordedAt || !run.highWaterProductCostId) {
        await tx.inventoryValuationBackfillRun.update({
          where: { id: input.runId },
          data: { phase: "COMPLETE" },
        });
        return { scanned: 0, updated: 0, review: 0, completed: true };
      }
      const costs = await tx.productCost.findMany({
        where: {
          ...(input.organizationId ? { organizationId: input.organizationId } : {}),
          id: { gt: run.cursorProductId ?? undefined, lte: run.highWaterProductCostId },
        },
        select: {
          id: true,
          organizationId: true,
          productId: true,
          variantKey: true,
          updatedAt: true,
          preciseAvgCostKgs: true,
          preciseCostBasisQty: true,
          costBasisValueKgs: true,
          valuationStatus: true,
          valuationUpdatedAt: true,
          valuationLegacyUpdatedAt: true,
        },
        orderBy: { id: "asc" },
        take: input.batchSize,
      });
      if (!costs.length) {
        await tx.inventoryValuationBackfillRun.update({
          where: { id: input.runId },
          data: { phase: "COMPLETE" },
        });
        return { scanned: 0, updated: 0, review: 0, completed: true };
      }

      let updated = 0;
      let reviewCount = 0;
      for (const cost of costs) {
        const classification = await classifyCostScope(tx, cost, {
          recordedAt: run.highWaterRecordedAt,
          legacyMovementId: run.highWaterMovementId,
        });
        if (classification.outcome === "REVIEW") {
          reviewCount += 1;
          let changed = true;
          if (cost.valuationStatus !== "REVIEW_REQUIRED") {
            const result = await tx.productCost.updateMany({
              where: { id: cost.id, updatedAt: cost.updatedAt },
              data: { valuationStatus: "REVIEW_REQUIRED", valuationUpdatedAt: new Date() },
            });
            changed = result.count === 1;
          }
          await upsertIssue(tx, {
            runId: input.runId,
            entityType: "ProductCost",
            entityId: cost.id,
            reason: changed ? classification.reason : "CONCURRENT_SCOPE_CHANGE",
            evidence: { productId: cost.productId, variantKey: cost.variantKey },
          });
          continue;
        }
        const alreadyMatches =
          cost.valuationStatus === "PRECISE" &&
          cost.preciseCostBasisQty === classification.quantity &&
          cost.preciseAvgCostKgs?.equals(classification.averageCostKgs) === true &&
          cost.costBasisValueKgs?.equals(classification.valueKgs) === true &&
          cost.valuationUpdatedAt !== null &&
          cost.valuationLegacyUpdatedAt?.getTime() === cost.updatedAt.getTime();
        if (alreadyMatches) continue;

        const timestamp = new Date();
        const result = await tx.productCost.updateMany({
          where: { id: cost.id, updatedAt: cost.updatedAt },
          data: {
            preciseAvgCostKgs: classification.averageCostKgs,
            preciseCostBasisQty: classification.quantity,
            costBasisValueKgs: classification.valueKgs,
            valuationStatus: "PRECISE",
            valuationUpdatedAt: timestamp,
            valuationLegacyUpdatedAt: timestamp,
            updatedAt: timestamp,
          },
        });
        if (result.count === 1) {
          updated += 1;
        } else {
          reviewCount += 1;
          await upsertIssue(tx, {
            runId: input.runId,
            entityType: "ProductCost",
            entityId: cost.id,
            reason: "CONCURRENT_SCOPE_CHANGE",
            evidence: { productId: cost.productId, variantKey: cost.variantKey },
          });
        }
      }
      await tx.inventoryValuationBackfillRun.update({
        where: { id: input.runId },
        data: {
          cursorProductId: costs.at(-1)!.id,
          batchCount: { increment: 1 },
          scannedRows: { increment: costs.length },
          updatedRows: { increment: updated },
          reviewRows: { increment: reviewCount },
          scopeScannedRows: { increment: costs.length },
          scopeUpdatedRows: { increment: updated },
          scopeReviewRows: { increment: reviewCount },
        },
      });
      return { scanned: costs.length, updated, review: reviewCount, completed: false };
    },
    { maxWait: 5_000, timeout: 120_000 },
  );

type CapturedHighWater = {
  recordedAt: Date;
  legacyMovementId: string | null;
  productCostId: string | null;
  hasMovements: boolean;
};

const captureHighWater = async (
  db: DbClient,
  organizationId?: string | null,
): Promise<CapturedHighWater> => {
  const [clock] = await db.$queryRaw<Array<{ recordedAt: Date }>>`
    SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS "recordedAt"
  `;
  if (!clock) throw new Error("BACKFILL_DATABASE_CLOCK_UNAVAILABLE");
  const legacy = await db.stockMovement.findFirst({
    where: {
      ledgerRecordedAt: null,
      OR: [
        { inventoryValueStatus: null },
        {
          inventoryValueDeltaKgs: null,
          inventoryValueStatus: { not: "REVIEW_REQUIRED" },
        },
      ],
      ...(organizationId ? { store: { organizationId } } : {}),
    },
    select: { id: true },
    orderBy: { id: "desc" },
  });
  const productCost = await db.productCost.findFirst({
    where: organizationId ? { organizationId } : undefined,
    select: { id: true },
    orderBy: { id: "desc" },
  });
  const window: MovementWindow = {
    organizationId,
    highWaterRecordedAt: clock.recordedAt,
    highWaterMovementId: legacy?.id ?? null,
  };
  const hasMovements =
    (await db.stockMovement.findFirst({ where: movementWhere(window), select: { id: true } })) !==
    null;
  return {
    recordedAt: clock.recordedAt,
    legacyMovementId: legacy?.id ?? null,
    productCostId: productCost?.id ?? null,
    hasMovements,
  };
};

const snapshotFromJson = (value: Prisma.JsonValue | null): InventoryValuationSnapshot => {
  const candidate = (value ?? {}) as Record<string, unknown>;
  const number = (key: keyof InventoryValuationSnapshot) => {
    const result = candidate[key];
    if (typeof result !== "number" || !Number.isInteger(result) || result < 0) {
      throw new Error("BACKFILL_SNAPSHOT_INVALID");
    }
    return result;
  };
  return {
    unclassifiedMovements: number("unclassifiedMovements"),
    reviewMovements: number("reviewMovements"),
    unreconciledCostScopes: number("unreconciledCostScopes"),
    reviewCostScopes: number("reviewCostScopes"),
  };
};

const resultForRun = (
  run: InventoryValuationBackfillRun,
  before: InventoryValuationSnapshot,
  after: InventoryValuationSnapshot,
) => ({
  mode: "APPLY" as const,
  runId: run.id,
  algorithmVersion: INVENTORY_VALUATION_ALGORITHM_VERSION,
  before,
  after,
  status: run.status,
  phase: run.phase,
  batchCount: run.batchCount,
  movement: {
    scanned: run.movementScannedRows,
    updated: run.movementUpdatedRows,
    review: run.movementReviewRows,
  },
  scopes: {
    scanned: run.scopeScannedRows,
    updated: run.scopeUpdatedRows,
    review: run.scopeReviewRows,
  },
  highWater: {
    recordedAt: run.highWaterRecordedAt,
    legacyMovementId: run.highWaterMovementId,
    productCostId: run.highWaterProductCostId,
  },
  cursor: {
    recordedAt: run.cursorRecordedAt,
    movementId: run.cursorMovementId,
    productCostId: run.cursorProductId,
  },
});

const runDryRun = async (prisma: PrismaClient, input: RunInventoryValuationBackfillInput) =>
  prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '120s'");
      const before = await readInventoryValuationSnapshot(tx, input.organizationId);
      const highWater = await captureHighWater(tx, input.organizationId);
      const maxBatches = input.maxBatches ?? DEFAULT_MAX_BATCHES;
      let cursorRecordedAt: Date | null | undefined;
      let cursorMovementId: string | null | undefined;
      let scannedRows = 0;
      let wouldUpdateRows = 0;
      let wouldReviewRows = 0;
      let batches = 0;
      while (batches < maxBatches) {
        const rows = await tx.stockMovement.findMany({
          where: movementWhere({
            organizationId: input.organizationId,
            highWaterRecordedAt: highWater.recordedAt,
            highWaterMovementId: highWater.legacyMovementId,
            cursorRecordedAt,
            cursorMovementId,
          }),
          select: movementSelect,
          orderBy: [{ ledgerRecordedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
          take: input.batchSize,
        });
        if (!rows.length) break;
        for (const row of rows) {
          const classification = await classifyMovementRow(tx, movementRow(row));
          if (classification.outcome === "REVIEW") wouldReviewRows += 1;
          else wouldUpdateRows += 1;
        }
        const last = rows.at(-1)!;
        cursorRecordedAt = last.ledgerRecordedAt;
        cursorMovementId = last.id;
        scannedRows += rows.length;
        batches += 1;
      }
      return {
        mode: "DRY_RUN" as const,
        runId: input.runId,
        algorithmVersion: INVENTORY_VALUATION_ALGORITHM_VERSION,
        before,
        scannedRows,
        wouldUpdateRows,
        wouldReviewRows,
        projectedRemainingUnclassified: Math.max(0, before.unclassifiedMovements - scannedRows),
        nextCursor: {
          recordedAt: cursorRecordedAt ?? null,
          movementId: cursorMovementId ?? null,
        },
        highWater: {
          recordedAt: highWater.recordedAt,
          legacyMovementId: highWater.legacyMovementId,
          productCostId: highWater.productCostId,
        },
        changedRows: 0,
      };
    },
    { maxWait: 5_000, timeout: 180_000 },
  );

export const runInventoryValuationBackfill = async (
  prisma: PrismaClient,
  input: RunInventoryValuationBackfillInput,
) => {
  validateRunInput(input);
  if (input.dryRun) return runDryRun(prisma, input);

  let run = await prisma.inventoryValuationBackfillRun.findUnique({ where: { id: input.runId } });
  if (!run) {
    run = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '2s'");
        const before = await readInventoryValuationSnapshot(tx, input.organizationId);
        const highWater = await captureHighWater(tx, input.organizationId);
        const confirmedAt = new Date();
        return tx.inventoryValuationBackfillRun.create({
          data: {
            id: input.runId,
            organizationId: input.organizationId,
            mode: "APPLY",
            status: "RUNNING",
            phase: highWater.hasMovements ? "MOVEMENTS" : "PRODUCT_COSTS",
            algorithmVersion: INVENTORY_VALUATION_ALGORITHM_VERSION,
            batchSize: input.batchSize,
            highWaterRecordedAt: highWater.recordedAt,
            highWaterMovementId: highWater.legacyMovementId,
            highWaterProductCostId: highWater.productCostId,
            writerDrainConfirmedAt: confirmedAt,
            writerDrainEvidenceJson: {
              statement: input.writerDrainEvidence!,
              confirmedAt: confirmedAt.toISOString(),
            },
            beforeJson: before,
          },
        });
      },
      { maxWait: 5_000, timeout: 120_000 },
    );
  }
  if (
    run.mode !== "APPLY" ||
    run.algorithmVersion !== INVENTORY_VALUATION_ALGORITHM_VERSION ||
    run.batchSize !== input.batchSize ||
    run.organizationId !== (input.organizationId ?? null) ||
    run.writerDrainConfirmedAt === null ||
    run.writerDrainEvidenceJson === null
  ) {
    throw new Error("BACKFILL_RUN_CONFIGURATION_MISMATCH");
  }
  const persistedDrainEvidence = run.writerDrainEvidenceJson as Record<string, unknown>;
  if (persistedDrainEvidence.statement !== input.writerDrainEvidence) {
    throw new Error("BACKFILL_RUN_CONFIGURATION_MISMATCH");
  }

  const before = snapshotFromJson(run.beforeJson);
  if (run.phase === "COMPLETE" && run.afterJson !== null) {
    return resultForRun(run, before, snapshotFromJson(run.afterJson));
  }
  if (run.status === "FAILED") {
    run = await prisma.inventoryValuationBackfillRun.update({
      where: { id: input.runId },
      data: { status: "RUNNING", errorMessage: null },
    });
  }

  const maxBatches = input.maxBatches ?? DEFAULT_MAX_BATCHES;
  let batches = 0;
  try {
    while (batches < maxBatches) {
      run = await prisma.inventoryValuationBackfillRun.findUniqueOrThrow({
        where: { id: input.runId },
      });
      if (run.phase === "COMPLETE") break;
      if (run.phase === "MOVEMENTS") await processMovementBatch(prisma, input);
      else await processCostBatch(prisma, input);
      batches += 1;
    }
  } catch (error) {
    await prisma.inventoryValuationBackfillRun.updateMany({
      where: { id: input.runId, phase: { not: "COMPLETE" } },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : "UNKNOWN_FAILURE",
      },
    });
    throw error;
  }

  const current = await readInventoryValuationSnapshot(prisma, input.organizationId);
  run = await prisma.inventoryValuationBackfillRun.findUniqueOrThrow({
    where: { id: input.runId },
  });
  if (run.phase === "COMPLETE" && run.afterJson === null) {
    const hasReview =
      current.unclassifiedMovements > 0 ||
      current.reviewMovements > 0 ||
      current.unreconciledCostScopes > 0 ||
      current.reviewCostScopes > 0;
    run = await prisma.inventoryValuationBackfillRun.update({
      where: { id: input.runId },
      data: {
        status: hasReview ? "COMPLETED_WITH_REVIEW" : "COMPLETED",
        afterJson: current,
        completedAt: new Date(),
      },
    });
  }
  const after = run.afterJson === null ? current : snapshotFromJson(run.afterJson);
  return resultForRun(run, before, after);
};
