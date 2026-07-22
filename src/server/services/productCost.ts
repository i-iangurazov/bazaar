import { Prisma } from "@prisma/client";

import { AppError } from "@/server/services/errors";

const resolveVariantKey = (variantId?: string | null) => variantId ?? "BASE";

type ProductCostScope = {
  organizationId: string;
  productId: string;
  variantId?: string | null;
};

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

const decimal = (value: number | Prisma.Decimal) => new Prisma.Decimal(value.toString());

const lockProductCostScope = async (
  tx: Prisma.TransactionClient,
  input: ProductCostScope,
) => {
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
      OR: [
        { type: "RECEIVE" },
        { type: "ADJUSTMENT", referenceType: "IMPORT_ROLLBACK" },
      ],
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
          avgCostKgs:
            quantity > 0
              ? totalValueKgs.div(quantity).toDecimalPlaces(2)
              : new Prisma.Decimal(0),
          costBasisQty: quantity,
        });
      }
      seenStockReceivingReferenceIds.add(movement.referenceId);
    }
    const movementValue =
      movement.lineTotalKgs ??
      (movement.unitCostKgs === null
        ? null
        : movement.unitCostKgs.mul(movement.qtyDelta));
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
      select: { avgCostKgs: true, costBasisQty: true },
    }),
  ]);
  const actualQuantity = actual?.costBasisQty ?? 0;
  const supersededReceivingAggregate = actual
    ? stream.supersededReceivingAggregates.find(
        (aggregate) =>
          aggregate.costBasisQty === actual.costBasisQty &&
          aggregate.avgCostKgs.equals(actual.avgCostKgs),
      ) ?? null
    : null;
  const isIndeterminate =
    stream.unvaluedMovementCount > 0 ||
    (actualQuantity > stream.quantity && !supersededReceivingAggregate);
  const isDeterminate = !isIndeterminate;
  const expectedAverage =
    stream.quantity > 0
      ? stream.totalValueKgs.div(stream.quantity).toDecimalPlaces(2)
      : new Prisma.Decimal(0);
  const status: ProductCostMismatchStatus = isIndeterminate
    ? "INDETERMINATE_UNVALUED_STREAM"
    : streamIsInvalid(stream)
      ? "INVALID_AUTHORITATIVE_STREAM"
      : actual &&
          actual.costBasisQty === stream.quantity &&
          actual.avgCostKgs.equals(expectedAverage)
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

export const updateProductCost = async (
  tx: Prisma.TransactionClient,
  input: ProductCostScope & {
    qtyReceived: number;
    unitCost: number;
  },
) => {
  if (input.qtyReceived <= 0) {
    return null;
  }
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0) {
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
  const previousQuantity = existing?.costBasisQty ?? 0;
  const nextQuantity = previousQuantity + input.qtyReceived;
  const previousTotal = existing
    ? existing.avgCostKgs.mul(previousQuantity)
    : new Prisma.Decimal(0);
  const nextTotal = previousTotal.plus(decimal(input.unitCost).mul(input.qtyReceived));
  const nextAverage = nextTotal.div(nextQuantity).toDecimalPlaces(2);

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
      lastReceiptAt: new Date(),
    },
    create: {
      organizationId: input.organizationId,
      productId: input.productId,
      variantId: input.variantId ?? undefined,
      variantKey,
      avgCostKgs: nextAverage,
      costBasisQty: nextQuantity,
      lastReceiptAt: new Date(),
    },
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
    const nextAverage =
      stream.quantity > 0
        ? stream.totalValueKgs.div(stream.quantity).toDecimalPlaces(2)
        : new Prisma.Decimal(0);
    return tx.productCost.create({
      data: {
        organizationId: input.organizationId,
        productId: input.productId,
        variantId: input.variantId ?? undefined,
        variantKey,
        avgCostKgs: nextAverage,
        costBasisQty: stream.quantity,
        lastReceiptAt: stream.lastReceiptAt,
      },
    });
  }

  const quantityDelta = input.nextQuantity - input.previousQuantity;
  const previousStreamQuantity = stream.quantity - quantityDelta;
  const fullyValuedBeforeEdit =
    stream.unvaluedMovementCount === 0 &&
    existing.costBasisQty === previousStreamQuantity;

  let nextQuantity: number;
  let nextTotal: Prisma.Decimal;
  if (fullyValuedBeforeEdit) {
    if (streamIsInvalid(stream)) {
      throw new AppError("productCostContributionMismatch", "CONFLICT", 409);
    }
    nextQuantity = stream.quantity;
    nextTotal = stream.totalValueKgs;
  } else {
    nextQuantity = existing.costBasisQty - input.previousQuantity + input.nextQuantity;
    nextTotal = existing.avgCostKgs
      .mul(existing.costBasisQty)
      .minus(previousLineTotalKgs)
      .plus(nextLineTotalKgs);
    if (
      nextQuantity < 0 ||
      nextTotal.lt(0) ||
      (nextQuantity === 0 && !nextTotal.equals(0))
    ) {
      throw new AppError("productCostContributionMismatch", "CONFLICT", 409);
    }
  }

  const nextAverage =
    nextQuantity > 0 ? nextTotal.div(nextQuantity).toDecimalPlaces(2) : new Prisma.Decimal(0);
  return tx.productCost.update({
    where: { id: existing.id },
    data: {
      avgCostKgs: nextAverage,
      costBasisQty: nextQuantity,
      lastReceiptAt: stream.lastReceiptAt ?? existing.lastReceiptAt,
    },
  });
};
