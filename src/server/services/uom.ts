import { Prisma } from "@prisma/client";

import { AppError } from "@/server/services/errors";

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
    // Decimal pack inputs such as 0.29 * 100 must produce 29 base units,
    // without accepting genuinely fractional base quantities by rounding.
    const baseQty = new Prisma.Decimal(input.qty).mul(pack.multiplierToBase);
    if (!baseQty.isFinite() || !baseQty.isInteger() || !Number.isSafeInteger(baseQty.toNumber())) {
      throw new AppError("invalidQuantity", "BAD_REQUEST", 400);
    }
    return baseQty.toNumber();
  }

  if (input.unitId && input.unitId !== input.baseUnitId) {
    throw new AppError("unitMismatch", "BAD_REQUEST", 400);
  }

  if (!Number.isFinite(input.qty) || !Number.isInteger(input.qty)) {
    throw new AppError("invalidQuantity", "BAD_REQUEST", 400);
  }

  return input.qty;
};
