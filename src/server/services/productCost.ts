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
  costBasisValueKgs: Prisma.Decimal;
};

export const productCostBasisSelect = {
  avgCostKgs: true,
  costBasisQty: true,
  costBasisValueKgs: true,
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

/**
 * Rows created by older application code can briefly carry the column default until
 * every writer has moved to the precise basis API. Preserve their monetary basis by
 * reconstructing it from the legacy projection instead of treating it as free stock.
 */
const resolveStoredBasisValue = (basis: ProductCostBasis) => {
  if (basis.costBasisQty > 0 && basis.costBasisValueKgs.equals(0) && !basis.avgCostKgs.equals(0)) {
    return normalizeBasisValue(basis.avgCostKgs.mul(basis.costBasisQty));
  }
  return normalizeBasisValue(basis.costBasisValueKgs);
};

/**
 * ProductCost.avgCostKgs is a two-decimal compatibility/display projection. Use
 * the six-decimal basis value for calculations so repeated reads do not compound
 * rounding loss. A zero-quantity row intentionally keeps its display/manual cost.
 */
export const resolveCurrentProductCostUnit = (basis: ProductCostBasis) =>
  basis.costBasisQty > 0
    ? resolveStoredBasisValue(basis).div(basis.costBasisQty)
    : basis.avgCostKgs;

export const resolveCurrentProductCostUnitNumber = (basis: ProductCostBasis) =>
  Number(resolveCurrentProductCostUnit(basis));

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
        avgCostKgs: true,
        costBasisQty: true,
        costBasisValueKgs: true,
      },
    }),
  ]);
  const actualQuantity = actual?.costBasisQty ?? 0;
  const supersededReceivingAggregate = actual
    ? (stream.supersededReceivingAggregates.find(
        (aggregate) =>
          aggregate.costBasisQty === actual.costBasisQty &&
          aggregate.avgCostKgs.equals(actual.avgCostKgs),
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
      : actual &&
          actual.costBasisQty === stream.quantity &&
          actual.avgCostKgs.equals(expectedAverage) &&
          resolveStoredBasisValue(actual).equals(expectedBasisValue)
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
    actual: actual
      ? {
          avgCostKgs: Number(actual.avgCostKgs),
          costBasisQty: actual.costBasisQty,
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

  const cost = await tx.productCost.upsert({
    where: {
      organizationId_productId_variantKey: {
        organizationId: input.organizationId,
        productId: input.productId,
        variantKey,
      },
    },
    update: {
      avgCostKgs: averageCost,
      costBasisQty: input.quantity,
      costBasisValueKgs: basisValue,
      ...lastReceiptUpdate,
    },
    create: {
      organizationId: input.organizationId,
      productId: input.productId,
      variantId: input.variantId ?? undefined,
      variantKey,
      avgCostKgs: averageCost,
      costBasisQty: input.quantity,
      costBasisValueKgs: basisValue,
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
    await tx.stockMovement.create({
      data: {
        storeId: latestReceipt.storeId,
        productId: input.productId,
        variantId: input.variantId ?? undefined,
        type: "ADJUSTMENT",
        qtyDelta: 0,
        unitCostKgs: unitCost,
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
  const previousQuantity = existing?.costBasisQty ?? 0;
  const previousBasisValue = existing ? resolveStoredBasisValue(existing) : new Prisma.Decimal(0);
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

  return tx.productCost.upsert({
    where: {
      organizationId_productId_variantKey: {
        organizationId: input.organizationId,
        productId: input.productId,
        variantKey,
      },
    },
    update: {
      avgCostKgs: nextAverage,
      costBasisQty: nextQuantity,
      costBasisValueKgs: nextBasisValue,
      ...lastReceiptUpdate,
    },
    create: {
      organizationId: input.organizationId,
      productId: input.productId,
      variantId: input.variantId ?? undefined,
      variantKey,
      avgCostKgs: nextAverage,
      costBasisQty: nextQuantity,
      costBasisValueKgs: nextBasisValue,
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
  if (!existing || existing.costBasisQty <= 0) {
    return null;
  }

  const storedBasisValue = resolveStoredBasisValue(existing);
  if (storedBasisValue.lte(0)) {
    return null;
  }
  const preciseUnitCost = storedBasisValue.div(existing.costBasisQty);
  return {
    unitCostKgs: Number(preciseUnitCost.toDecimalPlaces(AVERAGE_COST_SCALE, COST_ROUNDING)),
    totalValueKgs: Number(normalizeBasisValue(preciseUnitCost.mul(input.quantity))),
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
  if (!existing || existing.costBasisQty <= 0) {
    if (input.quantityDelta > 0) {
      throw new AppError("positiveStockUnitCostRequired", "BAD_REQUEST", 400);
    }
    return null;
  }

  const previousQuantity = existing.costBasisQty;
  const previousBasisValue = resolveStoredBasisValue(existing);
  if (input.quantityDelta > 0 && previousBasisValue.lte(0)) {
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
    where: { id: existing.id },
    data: {
      avgCostKgs: projectAverageCost(nextBasisValue, nextQuantity),
      costBasisQty: nextQuantity,
      costBasisValueKgs: nextBasisValue,
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
        avgCostKgs: nextAverage,
        costBasisQty: stream.quantity,
        costBasisValueKgs: nextBasisValue,
        lastReceiptAt: stream.lastReceiptAt,
      },
    });
  }

  const quantityDelta = input.nextQuantity - input.previousQuantity;
  const previousStreamQuantity = stream.quantity - quantityDelta;
  const fullyValuedBeforeEdit =
    stream.unvaluedMovementCount === 0 && existing.costBasisQty === previousStreamQuantity;

  let nextQuantity: number;
  let nextTotal: Prisma.Decimal;
  if (fullyValuedBeforeEdit) {
    if (streamIsInvalid(stream)) {
      throw new AppError("productCostContributionMismatch", "CONFLICT", 409);
    }
    nextQuantity = stream.quantity;
    nextTotal = normalizeBasisValue(stream.totalValueKgs);
  } else {
    nextQuantity = existing.costBasisQty - input.previousQuantity + input.nextQuantity;
    nextTotal = resolveStoredBasisValue(existing)
      .minus(previousLineTotalKgs)
      .plus(nextLineTotalKgs);
    if (nextQuantity < 0 || nextTotal.lt(0) || (nextQuantity === 0 && !nextTotal.equals(0))) {
      throw new AppError("productCostContributionMismatch", "CONFLICT", 409);
    }
  }

  nextTotal = normalizeBasisValue(nextTotal);
  const nextAverage = projectAverageCost(nextTotal, nextQuantity);
  return tx.productCost.update({
    where: { id: existing.id },
    data: {
      avgCostKgs: nextAverage,
      costBasisQty: nextQuantity,
      costBasisValueKgs: nextTotal,
      lastReceiptAt: stream.lastReceiptAt ?? existing.lastReceiptAt,
    },
  });
};
