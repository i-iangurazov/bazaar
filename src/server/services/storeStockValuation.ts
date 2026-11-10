import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  replayStoreStockValuation,
  storeStockValuationKey,
  type StoreStockValuationIncoming,
  type StoreStockValuationMovement,
} from "@/lib/inventory/storeStockValuation";
import { AppError } from "@/server/services/errors";

export const STORE_VALUATION_ROW_LIMIT = 50_000;
export const STORE_VALUATION_PRODUCT_ROW_LIMIT = 20_000;

/** Call in a consistent read transaction, or under the receipt's product locks. No writes. */
export async function readStoreStockValuation(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    storeId: string;
    lines: StoreStockValuationIncoming[];
    movementDate?: Date;
  },
) {
  if (!input.lines.length || input.lines.length > 500) throw new AppError("invalidProducts");
  const lineKeys = input.lines.map((line) =>
    storeStockValuationKey(line.productId, line.variantId),
  );
  if (new Set(lineKeys).size !== lineKeys.length) throw new AppError("duplicateLineItem");
  const stores = await tx.store.findMany({
    where: { organizationId: input.organizationId },
    select: { id: true },
  });
  if (!stores.some((store) => store.id === input.storeId))
    throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  const productIds = [...new Set(input.lines.map((line) => line.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: productIds }, organizationId: input.organizationId, isDeleted: false },
    select: { id: true },
  });
  if (products.length !== productIds.length)
    throw new AppError("invalidProducts", "FORBIDDEN", 403);
  const variantIds = [
    ...new Set(input.lines.flatMap((line) => (line.variantId ? [line.variantId] : []))),
  ];
  if (variantIds.length) {
    const variants = await tx.productVariant.findMany({
      where: { id: { in: variantIds }, productId: { in: productIds } },
      select: { id: true, productId: true },
    });
    if (
      input.lines.some(
        (line) =>
          line.variantId &&
          !variants.some(
            (variant) => variant.id === line.variantId && variant.productId === line.productId,
          ),
      )
    )
      throw new AppError("variantMismatch", "BAD_REQUEST", 400);
  }
  const scope = input.lines.map((line) => ({
    productId: line.productId,
    variantId: line.variantId ?? null,
  }));
  const storeIds = stores.map((store) => store.id);
  const [rows, snapshots] = await Promise.all([
    tx.stockMovement.findMany({
      where: { storeId: { in: storeIds }, OR: scope },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: STORE_VALUATION_ROW_LIMIT + 1,
      select: {
        id: true,
        storeId: true,
        productId: true,
        variantId: true,
        type: true,
        qtyDelta: true,
        unitCostKgs: true,
        lineTotalKgs: true,
        referenceType: true,
        referenceId: true,
        createdAt: true,
      },
    }),
    tx.inventorySnapshot.findMany({
      where: { storeId: { in: storeIds }, OR: scope },
      select: { storeId: true, productId: true, variantId: true, onHand: true, version: true },
    }),
  ]);
  const truncated = new Set<string>();
  if (rows.length > STORE_VALUATION_ROW_LIMIT)
    for (const line of input.lines)
      truncated.add(storeStockValuationKey(line.productId, line.variantId));
  const counts = new Map<string, number>();
  const movements: StoreStockValuationMovement[] = rows
    .slice(0, STORE_VALUATION_ROW_LIMIT)
    .map((row) => {
      const key = storeStockValuationKey(row.productId, row.variantId);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      if (count > STORE_VALUATION_PRODUCT_ROW_LIMIT) truncated.add(key);
      return {
        ...row,
        unitCostKgs: row.unitCostKgs?.toString() ?? null,
        lineTotalKgs: row.lineTotalKgs?.toString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  const returnIds = [
    ...new Set(
      movements
        .filter((row) => row.referenceType === "SaleReturn" && row.referenceId)
        .map((row) => row.referenceId!),
    ),
  ];
  const returns = returnIds.length
    ? await tx.saleReturn.findMany({
        where: { id: { in: returnIds }, organizationId: input.organizationId },
        select: { id: true, originalSaleId: true },
      })
    : [];
  const originalByReturn = new Map(returns.map((row) => [row.id, row.originalSaleId]));
  for (const row of movements)
    if (row.referenceType === "SaleReturn" && row.referenceId)
      row.originalSaleId = originalByReturn.get(row.referenceId) ?? null;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        version: "store-stock-valuation.v1",
        organizationId: input.organizationId,
        storeId: input.storeId,
        lines: input.lines,
        movementDate: input.movementDate?.toISOString() ?? null,
        movements,
        snapshots: [...snapshots].sort((a, b) =>
          JSON.stringify([a.storeId, a.productId, a.variantId]).localeCompare(
            JSON.stringify([b.storeId, b.productId, b.variantId]),
          ),
        ),
        truncated: [...truncated].sort(),
      }),
    )
    .digest("hex");
  return {
    fingerprint,
    lines: replayStoreStockValuation({
      storeId: input.storeId,
      lines: input.lines,
      movements,
      snapshots,
      truncatedKeys: truncated,
      movementDate: input.movementDate,
    }),
  };
}
