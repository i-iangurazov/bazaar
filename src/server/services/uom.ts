import { Prisma } from "@prisma/client";

import { AppError } from "@/server/services/errors";
import { isValidQuantity } from "@/lib/quantity";

export type QuantityMode = "purchasing" | "receiving" | "inventory";

export type ResolveBaseQuantityInput = {
  organizationId: string;
  productId: string;
  baseUnitId: string;
  qty: number;
  unitId?: string | null;
  packId?: string | null;
  mode: QuantityMode;
};

export const resolveBaseQuantity = async (
  tx: Prisma.TransactionClient,
  input: ResolveBaseQuantityInput,
) => {
  if (input.packId) {
    const pack = await tx.productPack.findUnique({ where: { id: input.packId } });
    if (!pack || pack.organizationId !== input.organizationId) {
      throw new AppError("packNotFound", "NOT_FOUND", 404);
    }
    if (pack.productId !== input.productId) {
      throw new AppError("packMismatch", "BAD_REQUEST", 400);
    }
    const allowed =
      input.mode === "purchasing"
        ? pack.allowInPurchasing
        : pack.allowInReceiving;
    if (!allowed) {
      throw new AppError("packNotAllowed", "FORBIDDEN", 403);
    }
    if (!Number.isFinite(input.qty)) {
      throw new AppError("invalidQuantity", "BAD_REQUEST", 400);
    }
    const baseQty = new Prisma.Decimal(input.qty).mul(pack.multiplierToBase);
    const unit = await tx.unit.findUnique({ where: { id: input.baseUnitId } });
    if (!unit || unit.organizationId !== input.organizationId ||
        !baseQty.isFinite() || !isValidQuantity(baseQty.toNumber(), unit.quantityPrecision)) {
      throw new AppError("invalidQuantity", "BAD_REQUEST", 400);
    }
    return baseQty.toNumber();
  }

  if (input.unitId && input.unitId !== input.baseUnitId) {
    throw new AppError("unitMismatch", "BAD_REQUEST", 400);
  }

  const unit = await tx.unit.findUnique({ where: { id: input.baseUnitId } });
  if (!unit || unit.organizationId !== input.organizationId || !isValidQuantity(input.qty, unit.quantityPrecision)) {
    throw new AppError("invalidQuantity", "BAD_REQUEST", 400);
  }

  return input.qty;
};
