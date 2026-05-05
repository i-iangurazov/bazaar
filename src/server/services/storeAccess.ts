import type { Prisma, PrismaClient, Role } from "@prisma/client";

import { AppError } from "@/server/services/errors";

export type StoreAccessUser = {
  id: string;
  organizationId: string;
  role: Role | string;
  isOrgOwner?: boolean | null;
  isPlatformOwner?: boolean | null;
};

type StoreAccessClient = Pick<PrismaClient | Prisma.TransactionClient, "store" | "userStoreAccess">;

export const userHasAllStoreAccess = (user: StoreAccessUser) =>
  Boolean(user.isOrgOwner || user.isPlatformOwner || user.role === "ADMIN");

export const listAccessibleStores = async (client: StoreAccessClient, user: StoreAccessUser) => {
  if (userHasAllStoreAccess(user)) {
    return client.store.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { name: "asc" },
    });
  }

  const accessRows = await client.userStoreAccess.findMany({
    where: {
      organizationId: user.organizationId,
      userId: user.id,
    },
    select: {
      store: true,
    },
    orderBy: { store: { name: "asc" } },
  });

  return accessRows.map((row) => row.store);
};

export const resolveAccessibleStoreIds = async (
  client: StoreAccessClient,
  user: StoreAccessUser,
) => {
  const stores = await listAccessibleStores(client, user);
  return stores.map((store) => store.id);
};

export const canAccessStore = async (
  client: StoreAccessClient,
  user: StoreAccessUser,
  storeId: string,
) => {
  if (userHasAllStoreAccess(user)) {
    const store = await client.store.findFirst({
      where: { id: storeId, organizationId: user.organizationId },
      select: { id: true },
    });
    return Boolean(store);
  }

  const access = await client.userStoreAccess.findFirst({
    where: {
      organizationId: user.organizationId,
      userId: user.id,
      storeId,
      store: { organizationId: user.organizationId },
    },
    select: { id: true },
  });
  return Boolean(access);
};

export const assertUserCanAccessStore = async (
  client: StoreAccessClient,
  user: StoreAccessUser,
  storeId: string,
) => {
  const allowed = await canAccessStore(client, user, storeId);
  if (!allowed) {
    throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  }
};

export const resolveDefaultStoreId = async (
  client: StoreAccessClient,
  user: StoreAccessUser,
  preferredStoreId?: string | null,
) => {
  if (preferredStoreId && (await canAccessStore(client, user, preferredStoreId))) {
    return preferredStoreId;
  }

  const stores = await listAccessibleStores(client, user);
  return stores[0]?.id ?? null;
};

export const assignProductToStore = async (
  client: Pick<PrismaClient | Prisma.TransactionClient, "store" | "product" | "storeProduct">,
  input: {
    organizationId: string;
    storeId: string;
    productId: string;
    actorId?: string | null;
  },
) => {
  const [store, product] = await Promise.all([
    client.store.findFirst({
      where: { id: input.storeId, organizationId: input.organizationId },
      select: { id: true },
    }),
    client.product.findFirst({
      where: { id: input.productId, organizationId: input.organizationId, isDeleted: false },
      select: { id: true },
    }),
  ]);

  if (!store) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }
  if (!product) {
    throw new AppError("productNotFound", "NOT_FOUND", 404);
  }

  return client.storeProduct.upsert({
    where: {
      storeId_productId: {
        storeId: input.storeId,
        productId: input.productId,
      },
    },
    create: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      productId: input.productId,
      assignedById: input.actorId ?? undefined,
      isActive: true,
    },
    update: {
      isActive: true,
      assignedById: input.actorId ?? undefined,
    },
  });
};

export const productStoreAssignmentWhere = (storeId?: string | null): Prisma.ProductWhereInput =>
  storeId
    ? {
        storeProducts: {
          some: {
            storeId,
            isActive: true,
          },
        },
      }
    : {};
