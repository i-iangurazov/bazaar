import { Prisma, type PrismaClient } from "@prisma/client";

type PrismaDbClient = PrismaClient | Prisma.TransactionClient;
type DecimalLike = Prisma.Decimal | string | number;

export type ProductCostReconciliationEvidence = {
  physicalQuantity: number;
  ledgerQuantity: number;
  ledgerValueKgs: DecimalLike | null;
  valuedMovementCount: number;
  unvaluedMovementCount: number;
  currentCost: {
    quantity: number;
    basisValueKgs: DecimalLike;
    averageCostKgs: DecimalLike;
  } | null;
};

export type ProductCostReconciliationReviewReason =
  | "NEGATIVE_PHYSICAL_QUANTITY"
  | "NEGATIVE_CURRENT_QUANTITY"
  | "NEGATIVE_CURRENT_VALUE"
  | "NEGATIVE_LEDGER_VALUE"
  | "NONZERO_VALUE_WITH_ZERO_QUANTITY"
  | "NONZERO_LEDGER_VALUE_WITH_ZERO_QUANTITY"
  | "UNVALUED_MOVEMENT_HISTORY"
  | "LEDGER_SNAPSHOT_QUANTITY_MISMATCH"
  | "MISSING_CURRENT_COST"
  | "CURRENT_SNAPSHOT_QUANTITY_MISMATCH"
  | "CURRENT_VALUE_DIFFERS_FROM_LEDGER";

export type ProductCostDeterministicRepair =
  | {
      action: "BACKFILL_LEGACY_BASIS_VALUE";
      quantity: number;
      basisValueKgs: number;
      averageCostKgs: number;
    }
  | {
      action: "CREATE_FROM_COMPLETE_MOVEMENT_LEDGER";
      quantity: number;
      basisValueKgs: number;
      averageCostKgs: number;
    }
  | {
      action: "REFRESH_AVERAGE_PROJECTION";
      quantity: number;
      basisValueKgs: number;
      averageCostKgs: number;
    };

export type ProductCostReconciliationClassification = {
  status: "MATCH" | "NO_COST_REQUIRED" | "DETERMINISTIC_REPAIR" | "REVIEW_REQUIRED";
  safeRepair: ProductCostDeterministicRepair | null;
  reviewReasons: ProductCostReconciliationReviewReason[];
  effectiveCurrentValueKgs: number | null;
};

const BASIS_SCALE = 6;
const AVERAGE_SCALE = 2;
const VALUE_TOLERANCE = new Prisma.Decimal("0.000001");
const ROUNDING = Prisma.Decimal.ROUND_HALF_UP;

const decimal = (value: DecimalLike) => new Prisma.Decimal(value.toString());
const normalizedValue = (value: DecimalLike) =>
  decimal(value).toDecimalPlaces(BASIS_SCALE, ROUNDING);
const projectedAverage = (value: Prisma.Decimal, quantity: number) =>
  quantity > 0
    ? value.div(quantity).toDecimalPlaces(AVERAGE_SCALE, ROUNDING)
    : new Prisma.Decimal(0);
const valuesDiffer = (left: Prisma.Decimal, right: Prisma.Decimal) =>
  left.minus(right).abs().gt(VALUE_TOLERANCE);

/**
 * Classifies evidence only; it never mutates ProductCost. Safe repairs are kept
 * separate from review reasons so an operator cannot mistake ambiguous history
 * for an automatic revaluation instruction.
 */
export const classifyProductCostReconciliation = (
  evidence: ProductCostReconciliationEvidence,
): ProductCostReconciliationClassification => {
  const reviewReasons: ProductCostReconciliationReviewReason[] = [];
  const ledgerValue =
    evidence.ledgerValueKgs === null ? null : normalizedValue(evidence.ledgerValueKgs);
  const current = evidence.currentCost;

  if (evidence.physicalQuantity < 0) {
    reviewReasons.push("NEGATIVE_PHYSICAL_QUANTITY");
  }
  if (ledgerValue?.lt(0)) {
    reviewReasons.push("NEGATIVE_LEDGER_VALUE");
  }
  if (evidence.ledgerQuantity === 0 && ledgerValue !== null && !ledgerValue.equals(0)) {
    reviewReasons.push("NONZERO_LEDGER_VALUE_WITH_ZERO_QUANTITY");
  }
  if (evidence.unvaluedMovementCount > 0) {
    reviewReasons.push("UNVALUED_MOVEMENT_HISTORY");
  }
  if (evidence.ledgerQuantity !== evidence.physicalQuantity) {
    reviewReasons.push("LEDGER_SNAPSHOT_QUANTITY_MISMATCH");
  }

  let safeRepair: ProductCostDeterministicRepair | null = null;
  let effectiveCurrentValue: Prisma.Decimal | null = null;

  if (!current) {
    if (evidence.physicalQuantity > 0) {
      if (
        evidence.unvaluedMovementCount === 0 &&
        evidence.ledgerQuantity === evidence.physicalQuantity &&
        ledgerValue !== null &&
        ledgerValue.gte(0)
      ) {
        safeRepair = {
          action: "CREATE_FROM_COMPLETE_MOVEMENT_LEDGER",
          quantity: evidence.physicalQuantity,
          basisValueKgs: Number(ledgerValue),
          averageCostKgs: Number(projectedAverage(ledgerValue, evidence.physicalQuantity)),
        };
      } else {
        reviewReasons.push("MISSING_CURRENT_COST");
      }
    }
  } else {
    const currentValue = normalizedValue(current.basisValueKgs);
    const currentAverage = decimal(current.averageCostKgs).toDecimalPlaces(AVERAGE_SCALE, ROUNDING);

    if (current.quantity < 0) {
      reviewReasons.push("NEGATIVE_CURRENT_QUANTITY");
    }
    if (currentValue.lt(0)) {
      reviewReasons.push("NEGATIVE_CURRENT_VALUE");
    }
    if (current.quantity === 0 && !currentValue.equals(0)) {
      reviewReasons.push("NONZERO_VALUE_WITH_ZERO_QUANTITY");
    }
    if (current.quantity !== evidence.physicalQuantity) {
      reviewReasons.push("CURRENT_SNAPSHOT_QUANTITY_MISMATCH");
    }

    const isLegacyBasisDefault =
      current.quantity > 0 && currentValue.equals(0) && !currentAverage.equals(0);
    effectiveCurrentValue = isLegacyBasisDefault
      ? normalizedValue(currentAverage.mul(current.quantity))
      : currentValue;

    if (isLegacyBasisDefault) {
      safeRepair = {
        action: "BACKFILL_LEGACY_BASIS_VALUE",
        quantity: current.quantity,
        basisValueKgs: Number(effectiveCurrentValue),
        averageCostKgs: Number(currentAverage),
      };
    } else if (
      current.quantity > 0 &&
      currentValue.gte(0) &&
      !projectedAverage(currentValue, current.quantity).equals(currentAverage)
    ) {
      safeRepair = {
        action: "REFRESH_AVERAGE_PROJECTION",
        quantity: current.quantity,
        basisValueKgs: Number(currentValue),
        averageCostKgs: Number(projectedAverage(currentValue, current.quantity)),
      };
    }

    if (
      ledgerValue !== null &&
      evidence.unvaluedMovementCount === 0 &&
      evidence.ledgerQuantity === evidence.physicalQuantity &&
      effectiveCurrentValue !== null &&
      valuesDiffer(effectiveCurrentValue, ledgerValue)
    ) {
      // A manual revaluation can legitimately cause this difference, but the
      // movement ledger alone cannot prove that. Require a reviewed decision.
      reviewReasons.push("CURRENT_VALUE_DIFFERS_FROM_LEDGER");
    }
  }

  const uniqueReviewReasons = Array.from(new Set(reviewReasons));
  const status: ProductCostReconciliationClassification["status"] = uniqueReviewReasons.length
    ? "REVIEW_REQUIRED"
    : safeRepair
      ? "DETERMINISTIC_REPAIR"
      : !current && evidence.physicalQuantity === 0
        ? "NO_COST_REQUIRED"
        : "MATCH";

  return {
    status,
    safeRepair,
    reviewReasons: uniqueReviewReasons,
    effectiveCurrentValueKgs: effectiveCurrentValue === null ? null : Number(effectiveCurrentValue),
  };
};

type ReconciliationSqlRow = {
  productId: string;
  variantId: string | null;
  variantKey: string;
  productSku: string;
  productName: string;
  physicalQuantity: number;
  ledgerQuantity: number;
  ledgerValueKgs: Prisma.Decimal | null;
  valuedMovementCount: number;
  unvaluedMovementCount: number;
  averageCostKgs: Prisma.Decimal | null;
  currentQuantity: number | null;
  currentBasisValueKgs: Prisma.Decimal | null;
};

export type ProductCostReconciliationCursor = {
  productId: string;
  variantKey: string;
};

export const buildProductCostReconciliationReport = async (
  db: PrismaDbClient,
  input: {
    organizationId: string;
    cursor?: ProductCostReconciliationCursor | null;
    limit?: number;
  },
) => {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 100), 1), 500);
  const cursorSql = input.cursor
    ? Prisma.sql`WHERE (scope."productId", scope."variantKey") > (${input.cursor.productId}, ${input.cursor.variantKey})`
    : Prisma.empty;

  const rows = await db.$queryRaw<ReconciliationSqlRow[]>(Prisma.sql`
    WITH scope_rows AS (
      SELECT cost."productId", cost."variantId", cost."variantKey"
      FROM "ProductCost" cost
      WHERE cost."organizationId" = ${input.organizationId}

      UNION

      SELECT snapshot."productId", snapshot."variantId", snapshot."variantKey"
      FROM "InventorySnapshot" snapshot
      INNER JOIN "Store" store ON store.id = snapshot."storeId"
      WHERE store."organizationId" = ${input.organizationId}

      UNION

      SELECT movement."productId", movement."variantId", COALESCE(movement."variantId", 'BASE')
      FROM "StockMovement" movement
      INNER JOIN "Store" store ON store.id = movement."storeId"
      WHERE store."organizationId" = ${input.organizationId}
    ), scope AS (
      SELECT
        scope_row."productId",
        MAX(scope_row."variantId") AS "variantId",
        scope_row."variantKey"
      FROM scope_rows scope_row
      GROUP BY scope_row."productId", scope_row."variantKey"
    )
    SELECT
      scope."productId" AS "productId",
      scope."variantId" AS "variantId",
      scope."variantKey" AS "variantKey",
      product.sku AS "productSku",
      product.name AS "productName",
      COALESCE(snapshot_totals.quantity, 0)::int AS "physicalQuantity",
      COALESCE(movement_totals.quantity, 0)::int AS "ledgerQuantity",
      movement_totals.value AS "ledgerValueKgs",
      COALESCE(movement_totals."valuedMovementCount", 0)::int AS "valuedMovementCount",
      COALESCE(movement_totals."unvaluedMovementCount", 0)::int AS "unvaluedMovementCount",
      CASE
        WHEN cost."valuationLegacyUpdatedAt" IS NOT NULL
          AND cost."updatedAt" <= cost."valuationLegacyUpdatedAt"
          THEN cost."preciseAvgCostKgs"
        ELSE cost."avgCostKgs"
      END AS "averageCostKgs",
      CASE
        WHEN cost."valuationLegacyUpdatedAt" IS NOT NULL
          AND cost."updatedAt" <= cost."valuationLegacyUpdatedAt"
          THEN cost."preciseCostBasisQty"
        ELSE NULL
      END AS "currentQuantity",
      CASE
        WHEN cost."valuationLegacyUpdatedAt" IS NOT NULL
          AND cost."updatedAt" <= cost."valuationLegacyUpdatedAt"
          THEN cost."costBasisValueKgs"
        ELSE NULL
      END AS "currentBasisValueKgs"
    FROM scope
    INNER JOIN "Product" product ON product.id = scope."productId"
    LEFT JOIN "ProductCost" cost
      ON cost."organizationId" = ${input.organizationId}
     AND cost."productId" = scope."productId"
     AND cost."variantKey" = scope."variantKey"
    LEFT JOIN LATERAL (
      SELECT SUM(snapshot."onHand")::int AS quantity
      FROM "InventorySnapshot" snapshot
      INNER JOIN "Store" store ON store.id = snapshot."storeId"
      WHERE store."organizationId" = ${input.organizationId}
        AND snapshot."productId" = scope."productId"
        AND snapshot."variantKey" = scope."variantKey"
    ) snapshot_totals ON true
    LEFT JOIN LATERAL (
      SELECT
        SUM(movement."qtyDelta")::int AS quantity,
        CASE
          WHEN COUNT(*) FILTER (
            WHERE movement."qtyDelta" <> 0
              AND movement."inventoryValueDeltaKgs" IS NULL
          ) > 0 THEN NULL
          ELSE COALESCE(SUM(movement."inventoryValueDeltaKgs"), 0)
        END AS value,
        COUNT(*) FILTER (
          WHERE movement."inventoryValueDeltaKgs" IS NOT NULL
        )::int AS "valuedMovementCount",
        COUNT(*) FILTER (
          WHERE movement."qtyDelta" <> 0
            AND movement."inventoryValueDeltaKgs" IS NULL
        )::int AS "unvaluedMovementCount"
      FROM "StockMovement" movement
      INNER JOIN "Store" store ON store.id = movement."storeId"
      WHERE store."organizationId" = ${input.organizationId}
        AND movement."productId" = scope."productId"
        AND COALESCE(movement."variantId", 'BASE') = scope."variantKey"
    ) movement_totals ON true
    ${cursorSql}
    ORDER BY scope."productId" ASC, scope."variantKey" ASC
    LIMIT ${limit + 1}
  `);

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const items = pageRows.map((row) => {
    const evidence: ProductCostReconciliationEvidence = {
      physicalQuantity: row.physicalQuantity,
      ledgerQuantity: row.ledgerQuantity,
      ledgerValueKgs: row.ledgerValueKgs,
      valuedMovementCount: row.valuedMovementCount,
      unvaluedMovementCount: row.unvaluedMovementCount,
      currentCost:
        row.currentQuantity === null ||
        row.currentBasisValueKgs === null ||
        row.averageCostKgs === null
          ? null
          : {
              quantity: row.currentQuantity,
              basisValueKgs: row.currentBasisValueKgs,
              averageCostKgs: row.averageCostKgs,
            },
    };
    return {
      organizationId: input.organizationId,
      productId: row.productId,
      variantId: row.variantId,
      variantKey: row.variantKey,
      productSku: row.productSku,
      productName: row.productName,
      evidence: {
        ...evidence,
        ledgerValueKgs: evidence.ledgerValueKgs === null ? null : Number(evidence.ledgerValueKgs),
        currentCost: evidence.currentCost
          ? {
              quantity: evidence.currentCost.quantity,
              basisValueKgs: Number(evidence.currentCost.basisValueKgs),
              averageCostKgs: Number(evidence.currentCost.averageCostKgs),
            }
          : null,
      },
      classification: classifyProductCostReconciliation(evidence),
    };
  });
  const last = pageRows.at(-1);

  return {
    mode: "READ_ONLY" as const,
    organizationId: input.organizationId,
    page: {
      limit,
      cursor: input.cursor ?? null,
      hasMore,
      nextCursor:
        hasMore && last ? { productId: last.productId, variantKey: last.variantKey } : null,
    },
    totals: {
      scopes: items.length,
      match: items.filter((item) => item.classification.status === "MATCH").length,
      noCostRequired: items.filter((item) => item.classification.status === "NO_COST_REQUIRED")
        .length,
      deterministicRepair: items.filter(
        (item) => item.classification.status === "DETERMINISTIC_REPAIR",
      ).length,
      reviewRequired: items.filter((item) => item.classification.status === "REVIEW_REQUIRED")
        .length,
      safeRepairCandidates: items.filter((item) => item.classification.safeRepair !== null).length,
    },
    items,
  };
};
