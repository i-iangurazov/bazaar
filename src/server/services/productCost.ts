import { Prisma } from "@prisma/client";

import { AppError } from "@/server/services/errors";

const resolveVariantKey = (variantId?: string | null) => variantId ?? "BASE";

type ProductCostScope = {
  organizationId: string;
  productId: string;
  variantId?: string | null;
};

export type ZeroCostAuthorization = {
  zeroCostConfirmed?: boolean;
  zeroCostReason?: string | null;
};

export type ProductCostBasis = {
  avgCostKgs: Prisma.Decimal;
  costBasisQty: number;
  preciseAvgCostKgs: Prisma.Decimal | null;
  preciseCostBasisQty: number | null;
  costBasisValueKgs: Prisma.Decimal | null;
  valuationStatus: string | null;
  valuationUpdatedAt: Date | null;
  valuationLegacyUpdatedAt: Date | null;
  updatedAt: Date;
};

export const productCostBasisSelect = {
  avgCostKgs: true,
  costBasisQty: true,
  preciseAvgCostKgs: true,
  preciseCostBasisQty: true,
  costBasisValueKgs: true,
  valuationStatus: true,
  valuationUpdatedAt: true,
  valuationLegacyUpdatedAt: true,
  updatedAt: true,
} as const;

type ValuedReceiptStream = {
  quantity: number;
  totalValueKgs: Prisma.Decimal;
  valuedMovementCount: number;
  unvaluedMovementCount: number;
  lastReceiptAt: Date | null;
  affectedStoreIds: string[];
  stockReceivingReferenceIds: string[];
  supersededReceivingAggregates: Array<{
    referenceId: string;
    avgCostKgs: Prisma.Decimal;
    costBasisQty: number;
  }>;
};

export type ProductCostMismatchStatus =
  | "MATCH"
  | "MISMATCH"
  | "INVALID_AUTHORITATIVE_STREAM"
  | "INDETERMINATE_UNVALUED_STREAM";

export type ProductCostMismatchReport = {
  status: ProductCostMismatchStatus;
  organizationId: string;
  productId: string;
  variantId: string | null;
  affectedStoreIds: string[];
  stockReceivingReferenceIds: string[];
  supersededReceivingReferenceId: string | null;
  actual: { avgCostKgs: number; costBasisQty: number } | null;
  expected: { avgCostKgs: number; costBasisQty: number; totalValueKgs: number } | null;
  valuedStream: { quantity: number; totalValueKgs: number };
  valuedMovementCount: number;
  unvaluedMovementCount: number;
};

const BASIS_VALUE_SCALE = 6;
const AVERAGE_COST_SCALE = 2;
const COST_ROUNDING = Prisma.Decimal.ROUND_HALF_UP;

const decimal = (value: number | Prisma.Decimal) => new Prisma.Decimal(value.toString());

const normalizeBasisValue = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(BASIS_VALUE_SCALE, COST_ROUNDING);

const assertDeliberateZeroCost = (input: ZeroCostAuthorization) => {
  if (!input.zeroCostConfirmed || !input.zeroCostReason?.trim()) {
    throw new AppError("zeroCostConfirmationRequired", "BAD_REQUEST", 400);
  }
};

const projectAverageCost = (basisValue: Prisma.Decimal, quantity: number) =>
  quantity > 0
    ? basisValue.div(quantity).toDecimalPlaces(AVERAGE_COST_SCALE, COST_ROUNDING)
    : new Prisma.Decimal(0);

const valuationTimestampData = (timestamp = new Date()) => ({
  valuationUpdatedAt: timestamp,
  valuationLegacyUpdatedAt: timestamp,
  updatedAt: timestamp,
});

/**
 * Rows created by older application code can briefly carry the column default until
 * every writer has moved to the precise basis API. Preserve their monetary basis by
 * reconstructing it from the legacy projection instead of treating it as free stock.
 */
const hasCompletePreciseBasis = (
  basis: ProductCostBasis,
): basis is ProductCostBasis & {
  preciseAvgCostKgs: Prisma.Decimal;
  preciseCostBasisQty: number;
  costBasisValueKgs: Prisma.Decimal;
} =>
  basis.preciseAvgCostKgs !== null &&
  basis.preciseCostBasisQty !== null &&
  basis.costBasisValueKgs !== null;

/**
 * ProductCost.avgCostKgs is a two-decimal compatibility/display projection. Use
 * the six-decimal basis value for calculations so repeated reads do not compound
 * rounding loss. A zero-quantity row intentionally keeps its display/manual cost.
 */
export const resolveCurrentProductCostUnit = (basis: ProductCostBasis) => {
  const legacyProjectionChangedAfterSync =
    !basis.valuationLegacyUpdatedAt || basis.updatedAt > basis.valuationLegacyUpdatedAt;
  return hasCompletePreciseBasis(basis) &&
    basis.preciseCostBasisQty > 0 &&
    !legacyProjectionChangedAfterSync
    ? normalizeBasisValue(basis.costBasisValueKgs).div(basis.preciseCostBasisQty)
    : basis.avgCostKgs;
};

export const resolveCurrentProductCostUnitNumber = (basis: ProductCostBasis) =>
  Number(resolveCurrentProductCostUnit(basis));

/**
 * Product screens and exports expose KGS unit costs at the established two-decimal
 * money boundary. Accounting mutations continue to use the unrounded resolver
 * above so the six-decimal basis is never reconstructed from this projection.
 */
export const resolveProductCostDisplayUnit = (basis: ProductCostBasis) =>
  resolveCurrentProductCostUnit(basis).toDecimalPlaces(AVERAGE_COST_SCALE, COST_ROUNDING);

export const resolveProductCostDisplayUnitNumber = (basis: ProductCostBasis) =>
  Number(resolveProductCostDisplayUnit(basis));

const lockProductCostScope = async (tx: Prisma.TransactionClient, input: ProductCostScope) => {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Product"
    WHERE "id" = ${input.productId}
      AND "organizationId" = ${input.organizationId}
    FOR UPDATE
  `;
  if (!rows.length) {
    throw new AppError("productNotFound", "NOT_FOUND", 404);
  }
};

type CompletePreciseBasis = {
  quantity: number;
  basisValueKgs: Prisma.Decimal;
  averageCostKgs: Prisma.Decimal;
  status: "PRECISE" | "LEGACY_PROJECTED" | "LEGACY_EMPTY";
};

const readPhysicalQuantity = async (tx: Prisma.TransactionClient, input: ProductCostScope) => {
  const rows = await tx.$queryRaw<Array<{ quantity: number }>>`
    SELECT COALESCE(SUM(snapshot."onHand"), 0)::integer AS quantity
    FROM "InventorySnapshot" snapshot
    INNER JOIN "Store" store ON store."id" = snapshot."storeId"
    WHERE store."organizationId" = ${input.organizationId}
      AND snapshot."productId" = ${input.productId}
      AND snapshot."variantKey" = ${resolveVariantKey(input.variantId)}
  `;
  return rows[0]?.quantity ?? 0;
};

type RollingMovement = {
  id: string;
  type: string;
  qtyDelta: number;
  unitCostKgs: Prisma.Decimal | null;
  lineTotalKgs: Prisma.Decimal | null;
  referenceType: string | null;
  referenceId: string | null;
};

const resolveLinkedFrozenMovementValue = async (
  tx: Prisma.TransactionClient,
  input: ProductCostScope,
  movement: RollingMovement,
) => {
  if (!movement.referenceId) {
    return null;
  }
  const variantKey = resolveVariantKey(input.variantId);
  if (movement.type === "SALE" && movement.referenceType === "CustomerOrder") {
    const aggregate = await tx.customerOrderLine.aggregate({
      where: {
        customerOrderId: movement.referenceId,
        productId: input.productId,
        variantKey,
      },
      _sum: { qty: true, lineCostTotalKgs: true },
    });
    if (
      aggregate._sum.qty === Math.abs(movement.qtyDelta) &&
      aggregate._sum.lineCostTotalKgs !== null
    ) {
      return normalizeBasisValue(aggregate._sum.lineCostTotalKgs.negated());
    }
  }
  if (movement.type === "RETURN" && movement.referenceType === "SaleReturn") {
    const aggregate = await tx.saleReturnLine.aggregate({
      where: {
        saleReturnId: movement.referenceId,
        productId: input.productId,
        variantKey,
      },
      _sum: { qty: true, lineCostTotalKgs: true },
    });
    if (
      aggregate._sum.qty === Math.abs(movement.qtyDelta) &&
      aggregate._sum.lineCostTotalKgs !== null
    ) {
      return normalizeBasisValue(aggregate._sum.lineCostTotalKgs);
    }
  }
  return null;
};

const reconcilePostExpandOldWrites = async (
  tx: Prisma.TransactionClient,
  input: ProductCostScope,
  existing: ProductCostBasis & {
    preciseAvgCostKgs: Prisma.Decimal;
    preciseCostBasisQty: number;
    costBasisValueKgs: Prisma.Decimal;
  },
  physicalQuantity: number,
): Promise<CompletePreciseBasis | null> => {
  if (!existing.valuationUpdatedAt) {
    return null;
  }
  const candidates = await tx.stockMovement.findMany({
    where: {
      productId: input.productId,
      variantId: input.variantId ?? null,
      inventoryValueDeltaKgs: null,
      ledgerRecordedAt: { not: null, gte: existing.valuationUpdatedAt },
      store: { organizationId: input.organizationId },
    },
    select: {
      id: true,
      type: true,
      qtyDelta: true,
      unitCostKgs: true,
      lineTotalKgs: true,
      referenceType: true,
      referenceId: true,
      ledgerRecordedAt: true,
    },
    orderBy: [{ ledgerRecordedAt: "asc" }, { id: "asc" }],
    take: 501,
  });
  if (!candidates.length || candidates.length > 500) {
    return null;
  }

  let quantity = existing.preciseCostBasisQty;
  let value = normalizeBasisValue(existing.costBasisValueKgs);
  const status: CompletePreciseBasis["status"] =
    existing.valuationStatus === "LEGACY_PROJECTED" ? "LEGACY_PROJECTED" : "PRECISE";

  for (const movement of candidates) {
    let movementValue: Prisma.Decimal | null = null;
    let reason = "ROLLING_WAC";
    if (movement.qtyDelta === 0) {
      if (
        movement.lineTotalKgs !== null &&
        (movement.type === "RECEIVE" || movement.referenceType === "STOCK_RECEIVING")
      ) {
        movementValue = normalizeBasisValue(movement.lineTotalKgs);
        reason = "ROLLING_RECEIPT_EDIT";
      } else {
        movementValue = new Prisma.Decimal(0);
        reason = "ROLLING_NO_QUANTITY_EFFECT";
      }
    } else if (movement.type === "RECEIVE") {
      const explicitValue =
        movement.lineTotalKgs ??
        (movement.unitCostKgs === null ? null : movement.unitCostKgs.mul(movement.qtyDelta));
      movementValue = explicitValue === null ? null : normalizeBasisValue(explicitValue);
      reason = "ROLLING_RECEIPT_EVIDENCE";
    } else {
      movementValue = await resolveLinkedFrozenMovementValue(tx, input, movement);
      if (movementValue !== null) {
        reason = "ROLLING_FROZEN_DOCUMENT_COST";
      }
    }

    if (movementValue === null) {
      if (quantity <= 0 || value.lte(0) || (movement.qtyDelta > 0 && status !== "PRECISE")) {
        return null;
      }
      const nextQuantity = quantity + movement.qtyDelta;
      if (nextQuantity < 0) {
        return null;
      }
      movementValue =
        nextQuantity === 0
          ? value.negated()
          : normalizeBasisValue(value.div(quantity).mul(movement.qtyDelta));
    }

    if (
      (movement.qtyDelta > 0 && movementValue.lt(0)) ||
      (movement.qtyDelta < 0 && movementValue.gt(0))
    ) {
      return null;
    }
    const nextQuantity = quantity + movement.qtyDelta;
    const nextValue = normalizeBasisValue(value.plus(movementValue));
    if (nextQuantity < 0 || nextValue.lt(0) || (nextQuantity === 0 && !nextValue.equals(0))) {
      return null;
    }
    const updated = await tx.stockMovement.updateMany({
      where: { id: movement.id, inventoryValueDeltaKgs: null },
      data: {
        inventoryValueDeltaKgs: movementValue,
        inventoryValueStatus: "LEGACY_EVIDENCE",
        inventoryValueReason: reason,
        inventoryValueUpdatedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      return null;
    }
    quantity = nextQuantity;
    value = nextValue;
  }

  if (quantity !== physicalQuantity) {
    return null;
  }
  const averageCostKgs = projectAverageCost(value, quantity);
  const timestamp = new Date();
  await tx.productCost.update({
    where: {
      organizationId_productId_variantKey: {
        organizationId: input.organizationId,
        productId: input.productId,
        variantKey: resolveVariantKey(input.variantId),
      },
    },
    data: {
      preciseAvgCostKgs: averageCostKgs,
      preciseCostBasisQty: quantity,
      costBasisValueKgs: value,
      valuationStatus: status,
      ...valuationTimestampData(timestamp),
    },
  });
  return { quantity, basisValueKgs: value, averageCostKgs, status };
};

/**
 * Initializes one mixed-version scope on demand. The legacy two-decimal average is
 * authoritative enough to keep current inventory operable, but it cannot recover
 * lost historical precision, so the row remains explicitly LEGACY_PROJECTED until
 * the bounded reconciliation process proves a stronger basis.
 */
const resolvePreciseBasisForWrite = async (
  tx: Prisma.TransactionClient,
  input: ProductCostScope,
  existing: ProductCostBasis | null,
  options?: { alreadyAppliedPhysicalQuantityDelta?: number },
): Promise<CompletePreciseBasis | null> => {
  const physicalQuantityAfterCurrentOperation = await readPhysicalQuantity(tx, input);
  const physicalQuantity =
    physicalQuantityAfterCurrentOperation - (options?.alreadyAppliedPhysicalQuantityDelta ?? 0);
  if (physicalQuantity < 0) {
    throw new AppError("valuedNegativeStockRecoveryBlocked", "CONFLICT", 409);
  }

  if (existing && hasCompletePreciseBasis(existing)) {
    const legacyChangedAfterSync =
      !existing.valuationLegacyUpdatedAt || existing.updatedAt > existing.valuationLegacyUpdatedAt;
    if (existing.preciseCostBasisQty !== physicalQuantity || legacyChangedAfterSync) {
      return reconcilePostExpandOldWrites(tx, input, existing, physicalQuantity);
    }
    return {
      quantity: existing.preciseCostBasisQty,
      basisValueKgs: normalizeBasisValue(existing.costBasisValueKgs),
      averageCostKgs: existing.preciseAvgCostKgs,
      status: existing.valuationStatus === "LEGACY_PROJECTED" ? "LEGACY_PROJECTED" : "PRECISE",
    };
  }

  if (!existing) {
    return physicalQuantity === 0
      ? {
          quantity: 0,
          basisValueKgs: new Prisma.Decimal(0),
          averageCostKgs: new Prisma.Decimal(0),
          status: "LEGACY_EMPTY",
        }
      : null;
  }
  if (physicalQuantity > 0 && existing.avgCostKgs.lte(0)) {
    await tx.productCost.update({
      where: {
        organizationId_productId_variantKey: {
          organizationId: input.organizationId,
          productId: input.productId,
          variantKey: resolveVariantKey(input.variantId),
        },
      },
      data: { valuationStatus: "REVIEW_REQUIRED", ...valuationTimestampData() },
    });
    return null;
  }

  const basisValueKgs =
    physicalQuantity === 0
      ? new Prisma.Decimal(0)
      : normalizeBasisValue(existing.avgCostKgs.mul(physicalQuantity));
  const averageCostKgs =
    physicalQuantity === 0
      ? existing.avgCostKgs
      : projectAverageCost(basisValueKgs, physicalQuantity);
  const status = physicalQuantity === 0 ? "LEGACY_EMPTY" : "LEGACY_PROJECTED";
  await tx.productCost.update({
    where: {
      organizationId_productId_variantKey: {
        organizationId: input.organizationId,
        productId: input.productId,
        variantKey: resolveVariantKey(input.variantId),
      },
    },
    data: {
      preciseAvgCostKgs: averageCostKgs,
      preciseCostBasisQty: physicalQuantity,
      costBasisValueKgs: basisValueKgs,
      valuationStatus: status,
      ...valuationTimestampData(),
    },
  });
  return { quantity: physicalQuantity, basisValueKgs, averageCostKgs, status };
};

const readValuedReceiptStream = async (
  tx: Prisma.TransactionClient,
  input: ProductCostScope,
): Promise<ValuedReceiptStream> => {
  const movements = await tx.stockMovement.findMany({
    where: {
      productId: input.productId,
      variantId: input.variantId ?? null,
      OR: [{ type: "RECEIVE" }, { type: "ADJUSTMENT", referenceType: "IMPORT_ROLLBACK" }],
      store: { organizationId: input.organizationId },
    },
    select: {
      storeId: true,
      qtyDelta: true,
      unitCostKgs: true,
      lineTotalKgs: true,
      inventoryValueDeltaKgs: true,
      referenceType: true,
      referenceId: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  let quantity = 0;
  let totalValueKgs = new Prisma.Decimal(0);
  let valuedMovementCount = 0;
  let unvaluedMovementCount = 0;
  let lastReceiptAt: Date | null = null;
  const affectedStoreIds = new Set<string>();
  const stockReceivingReferenceIds = new Set<string>();
  const seenStockReceivingReferenceIds = new Set<string>();
  const supersededReceivingAggregates: ValuedReceiptStream["supersededReceivingAggregates"] = [];

  for (const movement of movements) {
    affectedStoreIds.add(movement.storeId);
    if (movement.referenceType === "STOCK_RECEIVING" && movement.referenceId) {
      stockReceivingReferenceIds.add(movement.referenceId);
      if (seenStockReceivingReferenceIds.has(movement.referenceId)) {
        supersededReceivingAggregates.push({
          referenceId: movement.referenceId,
          avgCostKgs: projectAverageCost(totalValueKgs, quantity),
          costBasisQty: quantity,
        });
      }
      seenStockReceivingReferenceIds.add(movement.referenceId);
    }
    const movementValue =
      movement.inventoryValueDeltaKgs ??
      movement.lineTotalKgs ??
      (movement.unitCostKgs === null ? null : movement.unitCostKgs.mul(movement.qtyDelta));
    if (movementValue === null) {
      unvaluedMovementCount += 1;
      continue;
    }
    quantity += movement.qtyDelta;
    totalValueKgs = totalValueKgs.plus(movementValue);
    valuedMovementCount += 1;
    lastReceiptAt = movement.createdAt;
  }

  return {
    quantity,
    totalValueKgs,
    valuedMovementCount,
    unvaluedMovementCount,
    lastReceiptAt,
    affectedStoreIds: Array.from(affectedStoreIds).sort(),
    stockReceivingReferenceIds: Array.from(stockReceivingReferenceIds).sort(),
    supersededReceivingAggregates,
  };
};

const streamIsInvalid = (stream: ValuedReceiptStream) =>
  stream.quantity < 0 ||
  stream.totalValueKgs.lt(0) ||
  (stream.quantity === 0 && !stream.totalValueKgs.equals(0));

export const inspectProductCostMismatch = async (
  tx: Prisma.TransactionClient,
  input: ProductCostScope,
): Promise<ProductCostMismatchReport> => {
  const variantKey = resolveVariantKey(input.variantId);
  const [stream, actual] = await Promise.all([
    readValuedReceiptStream(tx, input),
    tx.productCost.findUnique({
      where: {
        organizationId_productId_variantKey: {
          organizationId: input.organizationId,
          productId: input.productId,
          variantKey,
        },
      },
      select: {
        ...productCostBasisSelect,
      },
    }),
  ]);
  const completeActual = actual && hasCompletePreciseBasis(actual) ? actual : null;
  const actualQuantity = completeActual?.preciseCostBasisQty ?? 0;
  const supersededReceivingAggregate = actual
    ? (stream.supersededReceivingAggregates.find(
        (aggregate) =>
          aggregate.costBasisQty === completeActual?.preciseCostBasisQty &&
          completeActual !== null &&
          aggregate.avgCostKgs.equals(completeActual.preciseAvgCostKgs),
      ) ?? null)
    : null;
  const isIndeterminate =
    stream.unvaluedMovementCount > 0 ||
    (actualQuantity > stream.quantity && !supersededReceivingAggregate);
  const isDeterminate = !isIndeterminate;
  const expectedBasisValue = normalizeBasisValue(stream.totalValueKgs);
  const expectedAverage = projectAverageCost(expectedBasisValue, stream.quantity);
  const status: ProductCostMismatchStatus = isIndeterminate
    ? "INDETERMINATE_UNVALUED_STREAM"
    : streamIsInvalid(stream)
      ? "INVALID_AUTHORITATIVE_STREAM"
      : completeActual &&
          completeActual.preciseCostBasisQty === stream.quantity &&
          completeActual.preciseAvgCostKgs.equals(expectedAverage) &&
          normalizeBasisValue(completeActual.costBasisValueKgs).equals(expectedBasisValue)
        ? "MATCH"
        : !actual && stream.quantity === 0
          ? "MATCH"
          : "MISMATCH";

  return {
    status,
    organizationId: input.organizationId,
    productId: input.productId,
    variantId: input.variantId ?? null,
    affectedStoreIds: stream.affectedStoreIds,
    stockReceivingReferenceIds: stream.stockReceivingReferenceIds,
    supersededReceivingReferenceId: supersededReceivingAggregate?.referenceId ?? null,
    actual: completeActual
      ? {
          avgCostKgs: Number(completeActual.preciseAvgCostKgs),
          costBasisQty: completeActual.preciseCostBasisQty,
        }
      : null,
    expected: isDeterminate
      ? {
          avgCostKgs: Number(expectedAverage),
          costBasisQty: stream.quantity,
          totalValueKgs: Number(stream.totalValueKgs),
        }
      : null,
    valuedStream: {
      quantity: stream.quantity,
      totalValueKgs: Number(stream.totalValueKgs),
    },
    valuedMovementCount: stream.valuedMovementCount,
    unvaluedMovementCount: stream.unvaluedMovementCount,
  };
};

export const setProductCostBasis = async (
  tx: Prisma.TransactionClient,
  input: ProductCostScope & {
    quantity: number;
    unitCost: number | Prisma.Decimal;
    lastReceiptAt?: Date | null;
  } & ZeroCostAuthorization,
) => {
  if (!Number.isInteger(input.quantity) || input.quantity < 0) {
    throw new AppError("invalidDocumentQuantity", "BAD_REQUEST", 400);
  }
  const unitCost = decimal(input.unitCost);
  if (!unitCost.isFinite() || unitCost.lt(0)) {
    throw new AppError("unitCostInvalid", "BAD_REQUEST", 400);
  }
  if (input.quantity > 0 && unitCost.equals(0)) {
    assertDeliberateZeroCost(input);
  }

  await lockProductCostScope(tx, input);
  const variantKey = resolveVariantKey(input.variantId);
  const existing = await tx.productCost.findUnique({
    where: {
      organizationId_productId_variantKey: {
        organizationId: input.organizationId,
        productId: input.productId,
        variantKey,
      },
    },
    select: {
      avgCostKgs: true,
      costBasisQty: true,
      preciseCostBasisQty: true,
      costBasisValueKgs: true,
    },
  });
  const negativeSnapshot = await tx.inventorySnapshot.findFirst({
    where: {
      productId: input.productId,
      ...(input.variantId ? { variantId: input.variantId } : {}),
      onHand: { lt: 0 },
      store: { organizationId: input.organizationId },
    },
    select: { id: true },
  });
  if (negativeSnapshot) {
    throw new AppError("valuedNegativeStockRecoveryBlocked", "CONFLICT", 409);
  }
  const basisValue =
    input.quantity > 0 ? normalizeBasisValue(unitCost.mul(input.quantity)) : new Prisma.Decimal(0);
  const averageCost =
    input.quantity > 0
      ? projectAverageCost(basisValue, input.quantity)
      : unitCost.toDecimalPlaces(AVERAGE_COST_SCALE, COST_ROUNDING);
  const lastReceiptUpdate =
    input.lastReceiptAt === undefined ? {} : { lastReceiptAt: input.lastReceiptAt };
  const legacyQuantity = Math.max(existing?.costBasisQty ?? 0, input.quantity > 0 ? 1 : 0);

  const cost = await tx.productCost.upsert({
    where: {
      organizationId_productId_variantKey: {
        organizationId: input.organizationId,
        productId: input.productId,
        variantKey,
      },
    },
    update: {
      preciseAvgCostKgs: averageCost,
      preciseCostBasisQty: input.quantity,
      costBasisValueKgs: basisValue,
      avgCostKgs: averageCost,
      costBasisQty: legacyQuantity,
      valuationStatus: "PRECISE",
      ...valuationTimestampData(),
      ...lastReceiptUpdate,
    },
    create: {
      organizationId: input.organizationId,
      productId: input.productId,
      variantId: input.variantId ?? undefined,
      variantKey,
      preciseAvgCostKgs: averageCost,
      preciseCostBasisQty: input.quantity,
      costBasisValueKgs: basisValue,
      avgCostKgs: averageCost,
      costBasisQty: legacyQuantity,
      valuationStatus: "PRECISE",
      ...valuationTimestampData(),
      lastReceiptAt: input.lastReceiptAt,
    },
  });

  // A manual/imported basis change after receiving is a valuation event even
  // though it has no quantity effect. Keep it in the stock journal so a later
  // attempt to rewrite that historical receipt fails closed instead of erasing
  // the revaluation ordering.
  const latestReceipt = await tx.stockMovement.findFirst({
    where: {
      productId: input.productId,
      variantId: input.variantId ?? null,
      referenceType: "STOCK_RECEIVING",
      store: { organizationId: input.organizationId },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { storeId: true },
  });
  if (latestReceipt) {
    const previousBasisValue =
      existing?.costBasisValueKgs ??
      (input.quantity > 0
        ? normalizeBasisValue((existing?.avgCostKgs ?? new Prisma.Decimal(0)).mul(input.quantity))
        : new Prisma.Decimal(0));
    const revaluationDelta = normalizeBasisValue(basisValue.minus(previousBasisValue));
    await tx.stockMovement.create({
      data: {
        storeId: latestReceipt.storeId,
        productId: input.productId,
        variantId: input.variantId ?? undefined,
        type: "ADJUSTMENT",
        qtyDelta: 0,
        unitCostKgs: unitCost,
        inventoryValueDeltaKgs: revaluationDelta,
        inventoryValueStatus: existing?.costBasisValueKgs === null ? "LEGACY_EVIDENCE" : "PRECISE",
        inventoryValueReason: "PRODUCT_COST_REVALUATION",
        inventoryValueUpdatedAt: new Date(),
        referenceType: "PRODUCT_COST_REVALUATION",
        referenceId: cost.id,
        note: "Product cost basis revalued",
        createdAt: new Date(),
      },
    });
  }

  return cost;
};

/**
 * Applies an inventory quantity/value pair atomically to the organization-wide WAC
 * basis. Positive quantities require positive values; outbound quantities require
 * negative values. Callers remain responsible for writing the corresponding stock
 * movement in the same transaction.
 */
export const applyValuedProductCostDelta = async (
  tx: Prisma.TransactionClient,
  input: ProductCostScope & {
    quantityDelta: number;
    valueDeltaKgs: number | Prisma.Decimal;
    lastReceiptAt?: Date | null;
    legacyReceiptUnitCost?: number | Prisma.Decimal;
    alreadyAppliedPhysicalQuantityDelta?: number;
  } & ZeroCostAuthorization,
) => {
  if (!Number.isInteger(input.quantityDelta)) {
    throw new AppError("invalidDocumentQuantity", "BAD_REQUEST", 400);
  }
  const valueDelta = decimal(input.valueDeltaKgs);
  if (!valueDelta.isFinite()) {
    throw new AppError("unitCostInvalid", "BAD_REQUEST", 400);
  }
  if (
    (input.quantityDelta > 0 && valueDelta.lt(0)) ||
    (input.quantityDelta < 0 && valueDelta.gt(0))
  ) {
    throw new AppError("productCostContributionMismatch", "CONFLICT", 409);
  }
  if (input.quantityDelta > 0 && valueDelta.equals(0)) {
    assertDeliberateZeroCost(input);
  }
  if (input.quantityDelta === 0 && valueDelta.equals(0)) {
    return null;
  }

  await lockProductCostScope(tx, input);
  const variantKey = resolveVariantKey(input.variantId);
  const existing = await tx.productCost.findUnique({
    where: {
      organizationId_productId_variantKey: {
        organizationId: input.organizationId,
        productId: input.productId,
        variantKey,
      },
    },
  });
  const preciseBasis = await resolvePreciseBasisForWrite(tx, input, existing, {
    alreadyAppliedPhysicalQuantityDelta: input.alreadyAppliedPhysicalQuantityDelta,
  });
  if (!preciseBasis) {
    throw new AppError("positiveStockUnitCostRequired", "BAD_REQUEST", 400);
  }
  const previousQuantity = preciseBasis.quantity;
  const previousBasisValue = preciseBasis.basisValueKgs;
  const nextQuantity = previousQuantity + input.quantityDelta;
  const nextBasisValue = normalizeBasisValue(previousBasisValue.plus(valueDelta));
  if (input.quantityDelta < 0 && nextQuantity < 0) {
    throw new AppError("valuedNegativeStockDepletionBlocked", "CONFLICT", 409);
  }
  if (
    nextQuantity < 0 ||
    nextBasisValue.lt(0) ||
    (nextQuantity === 0 && !nextBasisValue.equals(0))
  ) {
    throw new AppError("productCostContributionMismatch", "CONFLICT", 409);
  }
  const nextAverage = projectAverageCost(nextBasisValue, nextQuantity);
  const lastReceiptUpdate =
    input.lastReceiptAt === undefined ? {} : { lastReceiptAt: input.lastReceiptAt };
  const legacyReceiptUnitCost =
    input.legacyReceiptUnitCost === undefined ? null : decimal(input.legacyReceiptUnitCost);
  const previousLegacyQuantity = existing?.costBasisQty ?? 0;
  const previousLegacyValue = existing
    ? existing.avgCostKgs.mul(previousLegacyQuantity)
    : new Prisma.Decimal(0);
  const nextLegacyQuantity =
    legacyReceiptUnitCost === null
      ? previousLegacyQuantity
      : previousLegacyQuantity + input.quantityDelta;
  const nextLegacyAverage =
    legacyReceiptUnitCost === null
      ? (existing?.avgCostKgs ?? projectAverageCost(nextBasisValue, nextQuantity))
      : nextLegacyQuantity > 0
        ? previousLegacyValue
            .plus(legacyReceiptUnitCost.mul(input.quantityDelta))
            .div(nextLegacyQuantity)
            .toDecimalPlaces(AVERAGE_COST_SCALE, COST_ROUNDING)
        : new Prisma.Decimal(0);
  const compatibilityCreateQuantity =
    nextLegacyQuantity > 0 ? nextLegacyQuantity : Math.max(nextQuantity, 1);
  const compatibilityCreateAverage =
    nextLegacyQuantity > 0 ? nextLegacyAverage : projectAverageCost(nextBasisValue, nextQuantity);
  const valuationStatus =
    preciseBasis.status === "LEGACY_PROJECTED" ? "LEGACY_PROJECTED" : "PRECISE";

  return tx.productCost.upsert({
    where: {
      organizationId_productId_variantKey: {
        organizationId: input.organizationId,
        productId: input.productId,
        variantKey,
      },
    },
    update: {
      preciseAvgCostKgs: nextAverage,
      preciseCostBasisQty: nextQuantity,
      costBasisValueKgs: nextBasisValue,
      ...(legacyReceiptUnitCost === null
        ? {}
        : {
            avgCostKgs: nextLegacyAverage,
            costBasisQty: nextLegacyQuantity,
          }),
      valuationStatus,
      ...valuationTimestampData(),
      ...lastReceiptUpdate,
    },
    create: {
      organizationId: input.organizationId,
      productId: input.productId,
      variantId: input.variantId ?? undefined,
      variantKey,
      preciseAvgCostKgs: nextAverage,
      preciseCostBasisQty: nextQuantity,
      costBasisValueKgs: nextBasisValue,
      avgCostKgs: compatibilityCreateAverage,
      costBasisQty: compatibilityCreateQuantity,
      valuationStatus,
      ...valuationTimestampData(),
      lastReceiptAt: input.lastReceiptAt,
    },
  });
};

export type AppliedCurrentProductCostDelta = {
  unitCostKgs: number;
  inventoryValueDeltaKgs: number;
};

export const resolveCurrentProductCostValuation = async (
  tx: Prisma.TransactionClient,
  input: ProductCostScope & { quantity: number },
): Promise<{ unitCostKgs: number; totalValueKgs: number } | null> => {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new AppError("invalidDocumentQuantity", "BAD_REQUEST", 400);
  }

  await lockProductCostScope(tx, input);
  const existing = await tx.productCost.findUnique({
    where: {
      organizationId_productId_variantKey: {
        organizationId: input.organizationId,
        productId: input.productId,
        variantKey: resolveVariantKey(input.variantId),
      },
    },
  });
  if (!existing) {
    return null;
  }
  const currentUnitCost = resolveCurrentProductCostUnit(existing);
  if (currentUnitCost.lte(0)) {
    return null;
  }
  return {
    unitCostKgs: Number(currentUnitCost.toDecimalPlaces(AVERAGE_COST_SCALE, COST_ROUNDING)),
    totalValueKgs: Number(normalizeBasisValue(currentUnitCost.mul(input.quantity))),
  };
};

/**
 * Applies an inventory quantity change at the current precise weighted-average cost.
 * This is intended for write-offs and count/adjustment corrections where there is no
 * new purchase price. The returned signed value belongs on the StockMovement cost ledger.
 */
export const applyCurrentProductCostQuantityDelta = async (
  tx: Prisma.TransactionClient,
  input: ProductCostScope & { quantityDelta: number },
): Promise<AppliedCurrentProductCostDelta | null> => {
  if (!Number.isInteger(input.quantityDelta) || input.quantityDelta === 0) {
    throw new AppError("invalidDocumentQuantity", "BAD_REQUEST", 400);
  }

  await lockProductCostScope(tx, input);
  const variantKey = resolveVariantKey(input.variantId);
  const existing = await tx.productCost.findUnique({
    where: {
      organizationId_productId_variantKey: {
        organizationId: input.organizationId,
        productId: input.productId,
        variantKey,
      },
    },
  });
  const preciseBasis = await resolvePreciseBasisForWrite(tx, input, existing);
  if (!preciseBasis || preciseBasis.quantity <= 0) {
    if (input.quantityDelta > 0) {
      throw new AppError("positiveStockUnitCostRequired", "BAD_REQUEST", 400);
    }
    return null;
  }

  const previousQuantity = preciseBasis.quantity;
  const previousBasisValue = preciseBasis.basisValueKgs;
  if (input.quantityDelta > 0 && (previousBasisValue.lte(0) || preciseBasis.status !== "PRECISE")) {
    throw new AppError("positiveStockUnitCostRequired", "BAD_REQUEST", 400);
  }
  const nextQuantity = previousQuantity + input.quantityDelta;
  if (nextQuantity < 0) {
    throw new AppError("valuedNegativeStockDepletionBlocked", "CONFLICT", 409);
  }

  const preciseUnitCost = previousBasisValue.div(previousQuantity);
  const valueDelta =
    nextQuantity === 0
      ? previousBasisValue.negated()
      : normalizeBasisValue(preciseUnitCost.mul(input.quantityDelta));
  const nextBasisValue = normalizeBasisValue(previousBasisValue.plus(valueDelta));
  if (nextBasisValue.lt(0) || (nextQuantity === 0 && !nextBasisValue.equals(0))) {
    throw new AppError("productCostContributionMismatch", "CONFLICT", 409);
  }

  await tx.productCost.update({
    where: {
      organizationId_productId_variantKey: {
        organizationId: input.organizationId,
        productId: input.productId,
        variantKey,
      },
    },
    data: {
      preciseAvgCostKgs: projectAverageCost(nextBasisValue, nextQuantity),
      preciseCostBasisQty: nextQuantity,
      costBasisValueKgs: nextBasisValue,
      valuationStatus: preciseBasis.status === "LEGACY_PROJECTED" ? "LEGACY_PROJECTED" : "PRECISE",
      ...valuationTimestampData(),
    },
  });

  return {
    unitCostKgs: Number(preciseUnitCost.toDecimalPlaces(AVERAGE_COST_SCALE, COST_ROUNDING)),
    inventoryValueDeltaKgs: Number(valueDelta),
  };
};

export const updateProductCost = async (
  tx: Prisma.TransactionClient,
  input: ProductCostScope & {
    qtyReceived: number;
    unitCost: number;
  } & ZeroCostAuthorization,
) => {
  if (input.qtyReceived <= 0) {
    return null;
  }
  if (!Number.isInteger(input.qtyReceived)) {
    throw new AppError("invalidDocumentQuantity", "BAD_REQUEST", 400);
  }
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0) {
    throw new AppError("unitCostInvalid", "BAD_REQUEST", 400);
  }

  return applyValuedProductCostDelta(tx, {
    organizationId: input.organizationId,
    productId: input.productId,
    variantId: input.variantId,
    quantityDelta: input.qtyReceived,
    valueDeltaKgs: normalizeBasisValue(decimal(input.unitCost).mul(input.qtyReceived)),
    lastReceiptAt: new Date(),
    legacyReceiptUnitCost: input.unitCost,
    zeroCostConfirmed: input.zeroCostConfirmed,
    zeroCostReason: input.zeroCostReason,
  });
};

export const replaceProductCostContribution = async (
  tx: Prisma.TransactionClient,
  input: ProductCostScope & {
    previousQuantity: number;
    previousLineTotalKgs: number | Prisma.Decimal;
    nextQuantity: number;
    nextLineTotalKgs: number | Prisma.Decimal;
  },
) => {
  if (
    !Number.isInteger(input.previousQuantity) ||
    input.previousQuantity < 0 ||
    !Number.isInteger(input.nextQuantity) ||
    input.nextQuantity < 0
  ) {
    throw new AppError("invalidDocumentQuantity", "BAD_REQUEST", 400);
  }
  const previousLineTotalKgs = decimal(input.previousLineTotalKgs);
  const nextLineTotalKgs = decimal(input.nextLineTotalKgs);
  if (
    !previousLineTotalKgs.isFinite() ||
    previousLineTotalKgs.lt(0) ||
    !nextLineTotalKgs.isFinite() ||
    nextLineTotalKgs.lt(0)
  ) {
    throw new AppError("unitCostInvalid", "BAD_REQUEST", 400);
  }

  await lockProductCostScope(tx, input);
  const variantKey = resolveVariantKey(input.variantId);
  const existing = await tx.productCost.findUnique({
    where: {
      organizationId_productId_variantKey: {
        organizationId: input.organizationId,
        productId: input.productId,
        variantKey,
      },
    },
  });
  const stream = await readValuedReceiptStream(tx, input);
  if (!existing) {
    if (
      input.previousQuantity > 0 ||
      stream.unvaluedMovementCount > 0 ||
      stream.quantity !== input.nextQuantity ||
      streamIsInvalid(stream)
    ) {
      throw new AppError("productCostContributionMismatch", "CONFLICT", 409);
    }
    const nextBasisValue = normalizeBasisValue(stream.totalValueKgs);
    const nextAverage = projectAverageCost(nextBasisValue, stream.quantity);
    return tx.productCost.create({
      data: {
        organizationId: input.organizationId,
        productId: input.productId,
        variantId: input.variantId ?? undefined,
        variantKey,
        preciseAvgCostKgs: nextAverage,
        preciseCostBasisQty: stream.quantity,
        costBasisValueKgs: nextBasisValue,
        avgCostKgs: nextAverage,
        costBasisQty: stream.quantity,
        valuationStatus: "PRECISE",
        ...valuationTimestampData(),
        lastReceiptAt: stream.lastReceiptAt,
      },
    });
  }

  const quantityDelta = input.nextQuantity - input.previousQuantity;
  const preciseBasis = await resolvePreciseBasisForWrite(tx, input, existing, {
    alreadyAppliedPhysicalQuantityDelta: quantityDelta,
  });
  if (!preciseBasis) {
    throw new AppError("productCostContributionMismatch", "CONFLICT", 409);
  }
  const previousStreamQuantity = stream.quantity - quantityDelta;
  const fullyValuedBeforeEdit =
    stream.unvaluedMovementCount === 0 && preciseBasis.quantity === previousStreamQuantity;

  let nextQuantity: number;
  let nextTotal: Prisma.Decimal;
  if (fullyValuedBeforeEdit) {
    if (streamIsInvalid(stream)) {
      throw new AppError("productCostContributionMismatch", "CONFLICT", 409);
    }
    nextQuantity = stream.quantity;
    nextTotal = normalizeBasisValue(stream.totalValueKgs);
  } else {
    nextQuantity = preciseBasis.quantity - input.previousQuantity + input.nextQuantity;
    nextTotal = preciseBasis.basisValueKgs.minus(previousLineTotalKgs).plus(nextLineTotalKgs);
    if (nextQuantity < 0 || nextTotal.lt(0) || (nextQuantity === 0 && !nextTotal.equals(0))) {
      throw new AppError("productCostContributionMismatch", "CONFLICT", 409);
    }
  }

  nextTotal = normalizeBasisValue(nextTotal);
  const nextAverage = projectAverageCost(nextTotal, nextQuantity);
  const legacyQuantity = existing.costBasisQty - input.previousQuantity + input.nextQuantity;
  const legacyValue = existing.avgCostKgs
    .mul(existing.costBasisQty)
    .minus(previousLineTotalKgs)
    .plus(nextLineTotalKgs);
  if (legacyQuantity < 0 || legacyValue.lt(0) || (legacyQuantity === 0 && !legacyValue.equals(0))) {
    throw new AppError("productCostContributionMismatch", "CONFLICT", 409);
  }
  const legacyAverage = projectAverageCost(legacyValue, legacyQuantity);
  return tx.productCost.update({
    where: { id: existing.id },
    data: {
      preciseAvgCostKgs: nextAverage,
      preciseCostBasisQty: nextQuantity,
      costBasisValueKgs: nextTotal,
      avgCostKgs: legacyAverage,
      costBasisQty: legacyQuantity,
      valuationStatus: preciseBasis.status === "LEGACY_PROJECTED" ? "LEGACY_PROJECTED" : "PRECISE",
      ...valuationTimestampData(),
      lastReceiptAt: stream.lastReceiptAt ?? existing.lastReceiptAt,
    },
  });
};
