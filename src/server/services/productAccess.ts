import type { Prisma, PrismaClient } from "@prisma/client";

import { AppError } from "@/server/services/errors";
import {
  productStoreAssignmentInWhere,
  resolveAccessibleStoreIds,
  type StoreAccessUser,
  userHasAllStoreAccess,
} from "@/server/services/storeAccess";

type ProductAccessClient = PrismaClient | Prisma.TransactionClient;

export const assertUserCanAccessProducts = async (
  client: ProductAccessClient,
  user: StoreAccessUser,
  productIds: string[],
  options?: { includeArchived?: boolean },
) => {
  const uniqueProductIds = Array.from(new Set(productIds.map((id) => id.trim()).filter(Boolean)));
  if (!uniqueProductIds.length) {
    return;
  }

  const accessibleStoreIds = userHasAllStoreAccess(user)
    ? null
    : await resolveAccessibleStoreIds(client, user);
  const count = await client.product.count({
    where: {
      id: { in: uniqueProductIds },
      organizationId: user.organizationId,
      ...(options?.includeArchived ? {} : { isDeleted: false }),
      ...(accessibleStoreIds === null
        ? {}
        : productStoreAssignmentInWhere(accessibleStoreIds)),
    },
  });

  if (count !== uniqueProductIds.length) {
    throw new AppError("productAccessDenied", "FORBIDDEN", 403);
  }
};

export const assertUserCanAccessProduct = (
  client: ProductAccessClient,
  user: StoreAccessUser,
  productId: string,
  options?: { includeArchived?: boolean },
) => assertUserCanAccessProducts(client, user, [productId], options);
