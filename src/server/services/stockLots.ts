import type { Prisma } from "@prisma/client";

import { AppError } from "@/server/services/errors";

const resolveVariantKey = (variantId?: string | null) => variantId ?? "BASE";

export const applyStockLotAdjustment = async (
  tx: Prisma.TransactionClient,
  input: {
    storeId: string;
    productId: string;
    variantId?: string | null;
    qtyDelta: number;
    expiryDate?: Date | null;
    stockLotId?: string | null;
    organizationId: string;
    allowNegativeStock?: boolean;
  },
) => {
  const store = await tx.store.findUnique({ where: { id: input.storeId } });
  if (!store || store.organizationId !== input.organizationId) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }
  if (!store.trackExpiryLots) {
    return null;
  }

  const variantKey = resolveVariantKey(input.variantId);
  // Callers hold the corresponding InventorySnapshot FOR UPDATE, which also
  // serializes first-lot creation (expiryDate is nullable, not a unique key).
  const existing = input.stockLotId
    ? await tx.stockLot.findUnique({ where: { id: input.stockLotId } })
    : await tx.stockLot.findFirst({
    where: {
      storeId: input.storeId,
      productId: input.productId,
      variantKey,
      expiryDate: input.expiryDate ?? null,
    },
  });
  if (existing && (existing.storeId !== input.storeId || existing.productId !== input.productId ||
      existing.variantKey !== variantKey || existing.organizationId !== input.organizationId)) {
    throw new AppError("variantNotFound", "NOT_FOUND", 404);
  }
  if (input.stockLotId && !existing) throw new AppError("lotNotFound", "NOT_FOUND", 404);

  const allowNegativeStock = store.allowNegativeStock || input.allowNegativeStock === true;
  const nextQty = (existing?.onHandQty ?? 0) + input.qtyDelta;
  if (!allowNegativeStock && input.qtyDelta < 0 && nextQty < 0) {
    throw new AppError("insufficientStock", "CONFLICT", 409);
  }
  if (!existing && input.qtyDelta < 0 && !allowNegativeStock) {
    throw new AppError("lotNotFound", "NOT_FOUND", 404);
  }

  const lot = existing
    ? await tx.stockLot.update({
        where: { id: existing.id },
        data: { onHandQty: nextQty },
      })
    : await tx.stockLot.create({
        data: {
          organizationId: store.organizationId,
          storeId: input.storeId,
          productId: input.productId,
          variantId: input.variantId ?? undefined,
          variantKey,
          expiryDate: input.expiryDate ?? null,
          onHandQty: nextQty,
        },
      });

  return lot;
};
