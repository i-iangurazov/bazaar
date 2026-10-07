import type { Prisma } from "@prisma/client";
import { isValidQuantity } from "@/lib/quantity";
import { AppError } from "./errors";

export async function assertProductQuantity(
  tx: Prisma.TransactionClient,
  organizationId: string,
  productId: string,
  quantity: number,
  allowZero = false,
) {
  const product = await tx.product.findFirst({
    where: { id: productId, organizationId, isDeleted: false },
    select: { baseUnit: { select: { quantityPrecision: true } } },
  });
  if (!product) throw new AppError("productNotFound", "NOT_FOUND", 404);
  if (
    (allowZero ? quantity < 0 : quantity <= 0) ||
    !isValidQuantity(quantity, product.baseUnit.quantityPrecision)
  )
    throw new AppError(
      product.baseUnit.quantityPrecision === 0 ? "wholeQuantityRequired" : "invalidQuantity",
      "BAD_REQUEST",
      400,
    );
}
