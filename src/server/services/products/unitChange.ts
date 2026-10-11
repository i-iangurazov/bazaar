import type { Prisma } from "@prisma/client";
import { quantityPrecision } from "@/lib/quantity";
import { AppError } from "@/server/services/errors";

/** Correct the unit label without converting quantities or rewriting documents. */
export async function assertProductUnitPrecision(
  tx: Prisma.TransactionClient,
  productId: string,
  precision: number,
) {
  if (precision >= quantityPrecision) return;
  // Include every store and variant, open documents and history needed for returns.
  // The product is locked by the caller; inventory writers share that lock.
  const [result] = await tx.$queryRaw<Array<{ incompatible: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM (
        SELECT "onHand" AS quantity FROM "InventorySnapshot" WHERE "productId" = ${productId}
        UNION ALL SELECT "onOrder" FROM "InventorySnapshot" WHERE "productId" = ${productId}
        UNION ALL SELECT "qtyDelta" FROM "StockMovement" WHERE "productId" = ${productId}
        UNION ALL SELECT "qty" FROM "CustomerOrderLine" WHERE "productId" = ${productId}
        UNION ALL SELECT "qty" FROM "SaleReturnLine" WHERE "productId" = ${productId}
        UNION ALL SELECT "qtyOrdered" FROM "PurchaseOrderLine" WHERE "productId" = ${productId}
        UNION ALL SELECT "qtyReceived" FROM "PurchaseOrderLine" WHERE "productId" = ${productId}
        UNION ALL SELECT "expectedOnHand" FROM "StockCountLine" WHERE "productId" = ${productId}
        UNION ALL SELECT "countedQty" FROM "StockCountLine" WHERE "productId" = ${productId}
        UNION ALL SELECT "deltaQty" FROM "StockCountLine" WHERE "productId" = ${productId}
        UNION ALL SELECT "onHandQty" FROM "StockLot" WHERE "productId" = ${productId}
        UNION ALL SELECT "costBasisQty" FROM "ProductCost" WHERE "productId" = ${productId}
        UNION ALL SELECT "minStock" FROM "ReorderPolicy" WHERE "productId" = ${productId}
        UNION ALL SELECT "minOrderQty" FROM "ReorderPolicy" WHERE "productId" = ${productId}
        UNION ALL SELECT "qty" FROM "ProductBundleComponent" WHERE "componentProductId" = ${productId}
      ) quantities
      WHERE quantity <> ROUND(quantity::numeric, ${precision}::integer)::double precision
    ) AS incompatible
  `;
  if (result?.incompatible) throw new AppError("unitChangeNotAllowed", "CONFLICT", 409);
}
