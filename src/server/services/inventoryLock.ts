import { randomUUID } from "node:crypto";
import type { InventorySnapshot, Prisma } from "@prisma/client";
import { AppError } from "@/server/services/errors";
import { assignProductToStore } from "@/server/services/storeAccess";

/** Lock before deriving an absolute correction. Also handles the first stock write. */
export const lockStockSnapshot = async (
  tx: Prisma.TransactionClient,
  input: { storeId: string; productId: string; variantId?: string | null; organizationId: string },
): Promise<InventorySnapshot> => {
  const store = await tx.store.findUnique({ where: { id: input.storeId } });
  const product = await tx.product.findUnique({ where: { id: input.productId } });
  if (!store || store.organizationId !== input.organizationId) {
    throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  }
  if (!product || product.isDeleted || product.organizationId !== input.organizationId) {
    throw new AppError("productAccessDenied", "FORBIDDEN", 403);
  }
  if (input.variantId) {
    const variant = await tx.productVariant.findUnique({ where: { id: input.variantId } });
    if (!variant || !variant.isActive || variant.productId !== product.id) {
      throw new AppError("variantNotFound", "NOT_FOUND", 404);
    }
  }
  const variantKey = input.variantId ?? "BASE";
  await assignProductToStore(tx, input);
  await tx.$executeRaw`
    INSERT INTO "InventorySnapshot" ("id", "storeId", "productId", "variantId", "variantKey", "onHand", "onOrder", "allowNegativeStock", "updatedAt")
    VALUES (${randomUUID()}, ${input.storeId}, ${input.productId}, ${input.variantId ?? null}, ${variantKey}, 0, 0, ${store.allowNegativeStock}, ${new Date()})
    ON CONFLICT ("storeId", "productId", "variantKey") DO NOTHING
  `;
  const [snapshot] = await tx.$queryRaw<InventorySnapshot[]>`
    SELECT * FROM "InventorySnapshot"
    WHERE "storeId" = ${input.storeId} AND "productId" = ${input.productId} AND "variantKey" = ${variantKey}
    FOR UPDATE
  `;
  if (!snapshot) throw new AppError("snapshotMissing", "NOT_FOUND", 404);
  return snapshot;
};
