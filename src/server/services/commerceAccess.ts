import type { Prisma, PrismaClient } from "@prisma/client";

import { hasPermission, type AppPermission } from "@/lib/roleAccess";
import { AppError } from "@/server/services/errors";
import {
  assertUserCanAccessStore,
  resolveAccessibleStoreIds,
  userHasAllStoreAccess,
  type StoreAccessUser,
} from "@/server/services/storeAccess";

type StoreAccessClient = Pick<PrismaClient | Prisma.TransactionClient, "store" | "userStoreAccess">;

export const assertCommercePermission = (user: StoreAccessUser, permission: AppPermission) => {
  if (!hasPermission(user, permission)) {
    throw new AppError("forbidden", "FORBIDDEN", 403);
  }
};

export const assertCommerceStoreAccess = async (
  client: StoreAccessClient,
  user: StoreAccessUser,
  storeId: string,
) => {
  await assertUserCanAccessStore(client, user, storeId);
  return storeId;
};

export const assertCommerceStoreIdsAccess = async (
  client: StoreAccessClient,
  user: StoreAccessUser,
  storeIds: string[],
) => {
  const uniqueStoreIds = Array.from(new Set(storeIds.map((id) => id.trim()).filter(Boolean)));
  await Promise.all(uniqueStoreIds.map((storeId) => assertUserCanAccessStore(client, user, storeId)));
  return uniqueStoreIds;
};

export const resolveCommerceStoreScope = async (
  client: StoreAccessClient,
  user: StoreAccessUser,
  requestedStoreId?: string | null,
) => {
  const normalizedStoreId = requestedStoreId?.trim() || null;
  if (normalizedStoreId) {
    return assertCommerceStoreAccess(client, user, normalizedStoreId);
  }
  if (userHasAllStoreAccess(user)) {
    return undefined;
  }

  const accessibleStoreIds = await resolveAccessibleStoreIds(client, user);
  if (!accessibleStoreIds.length) {
    throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  }
  if (accessibleStoreIds.length > 1) {
    throw new AppError("integrationStoreRequired", "BAD_REQUEST", 400);
  }
  return accessibleStoreIds[0];
};

export const resolveCommerceAccessibleStoreIds = async (
  client: StoreAccessClient,
  user: StoreAccessUser,
) => {
  if (userHasAllStoreAccess(user)) {
    return null;
  }
  const accessibleStoreIds = await resolveAccessibleStoreIds(client, user);
  if (!accessibleStoreIds.length) {
    throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  }
  return accessibleStoreIds;
};
