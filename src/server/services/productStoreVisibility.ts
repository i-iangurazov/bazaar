import { prisma } from "@/server/db/prisma";
import { lockAssortment, publishAssortmentChange } from "./assortmentPolicy";
import { writeAuditLog } from "./audit";
import { AppError } from "./errors";
import { toJson } from "./json";
import { assertUserCanAccessStore, type StoreAccessUser } from "./storeAccess";

/** Exclude a shared card locally. Membership, stock, prices and other stores stay intact. */
export async function setProductStoreVisibility(input: {
  user: StoreAccessUser;
  storeId: string;
  productIds: string[];
  hidden: boolean;
  requestId: string;
}) {
  if (!["ADMIN", "MANAGER"].includes(input.user.role))
    throw new AppError("forbidden", "FORBIDDEN", 403);
  await assertUserCanAccessStore(prisma, input.user, input.storeId);
  const productIds = [...new Set(input.productIds)].sort();
  const result = await prisma.$transaction(
    async (tx) => {
      await lockAssortment(tx, input.user.organizationId);
      const before = await tx.storeProduct.findMany({
        where: {
          organizationId: input.user.organizationId,
          storeId: input.storeId,
          productId: { in: productIds },
          product: { organizationId: input.user.organizationId, isDeleted: false },
          OR: [{ isActive: true }, { isHidden: true }],
        },
        orderBy: { productId: "asc" },
      });
      if (before.length !== productIds.length)
        throw new AppError("productAccessDenied", "FORBIDDEN", 403);
      await tx.storeProduct.updateMany({
        where: { id: { in: before.map((row) => row.id) } },
        data: { isHidden: input.hidden, isActive: !input.hidden },
      });
      const after = await tx.storeProduct.findMany({
        where: { id: { in: before.map((row) => row.id) } },
        orderBy: { productId: "asc" },
      });
      if (!input.hidden && after.some((row) => !row.isActive))
        throw new AppError("productNotAvailableInStore", "CONFLICT", 409);
      await writeAuditLog(tx, {
        organizationId: input.user.organizationId,
        actorId: input.user.id,
        requestId: input.requestId,
        action: input.hidden ? "PRODUCT_STORE_HIDE" : "PRODUCT_STORE_SHOW",
        entity: "StoreProductVisibility",
        entityId: input.storeId,
        before: toJson(before),
        after: toJson(after),
      });
      return { count: after.length };
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
  await publishAssortmentChange(input.user.organizationId);
  return result;
}
