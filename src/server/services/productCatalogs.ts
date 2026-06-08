import type { Prisma, PrismaClient } from "@prisma/client";

import { AppError } from "@/server/services/errors";

type CatalogTx = Prisma.TransactionClient;
type CatalogClient = Pick<
  PrismaClient | Prisma.TransactionClient,
  "store" | "productCatalog" | "storeProduct" | "inventorySnapshot"
>;

export type ProductCatalogStore = {
  id: string;
  allowNegativeStock: boolean;
};

export const createDefaultProductCatalog = (
  tx: CatalogClient,
  input: {
    organizationId: string;
    name: string;
  },
) =>
  tx.productCatalog.create({
    data: {
      organizationId: input.organizationId,
      name: input.name,
    },
  });

export const resolveProductCatalog = async (
  tx: CatalogClient,
  input: {
    organizationId: string;
    productCatalogId?: string | null;
  },
) => {
  if (!input.productCatalogId) {
    return null;
  }
  const catalog = await tx.productCatalog.findFirst({
    where: {
      id: input.productCatalogId,
      organizationId: input.organizationId,
    },
    select: { id: true, name: true },
  });
  if (!catalog) {
    throw new AppError("productCatalogNotFound", "NOT_FOUND", 404);
  }
  return catalog;
};

export const resolveProductCatalogStoresForStore = async (
  tx: CatalogClient,
  input: {
    organizationId: string;
    storeId: string;
  },
): Promise<ProductCatalogStore[]> => {
  const selectedStore = await tx.store.findFirst({
    where: { id: input.storeId, organizationId: input.organizationId },
    select: {
      id: true,
      productCatalogId: true,
      allowNegativeStock: true,
    },
  });
  if (!selectedStore) {
    throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  }
  if (!selectedStore.productCatalogId) {
    return [
      {
        id: selectedStore.id,
        allowNegativeStock: selectedStore.allowNegativeStock,
      },
    ];
  }

  const stores = await tx.store.findMany({
    where: {
      organizationId: input.organizationId,
      productCatalogId: selectedStore.productCatalogId,
    },
    select: { id: true, allowNegativeStock: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const selectedFirst = [
    selectedStore,
    ...stores.filter((store) => store.id !== selectedStore.id),
  ];

  return selectedFirst.map((store) => ({
    id: store.id,
    allowNegativeStock: store.allowNegativeStock,
  }));
};

export const ensureBaseSnapshotsForCatalogStores = async (
  tx: CatalogTx,
  input: {
    productIds: string[];
    stores: ProductCatalogStore[];
  },
) => {
  const productIds = Array.from(new Set(input.productIds.filter(Boolean)));
  if (!productIds.length || !input.stores.length) {
    return;
  }

  await tx.inventorySnapshot.createMany({
    data: productIds.flatMap((productId) =>
      input.stores.map((store) => ({
        storeId: store.id,
        productId,
        variantKey: "BASE",
        onHand: 0,
        onOrder: 0,
        allowNegativeStock: store.allowNegativeStock,
      })),
    ),
    skipDuplicates: true,
  });
};

export const syncProductCatalogAssignments = async (
  tx: CatalogTx,
  input: {
    organizationId: string;
    productCatalogId: string;
    actorId?: string | null;
  },
) => {
  const stores = await tx.store.findMany({
    where: {
      organizationId: input.organizationId,
      productCatalogId: input.productCatalogId,
    },
    select: { id: true, allowNegativeStock: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (stores.length < 2) {
    return { storeCount: stores.length, productCount: 0, assignmentCount: 0 };
  }

  const storeIds = stores.map((store) => store.id);
  const assignments = await tx.storeProduct.findMany({
    where: {
      organizationId: input.organizationId,
      storeId: { in: storeIds },
      isActive: true,
      product: {
        organizationId: input.organizationId,
        isDeleted: false,
      },
    },
    select: { productId: true },
  });
  const productIds = Array.from(new Set(assignments.map((assignment) => assignment.productId)));
  if (!productIds.length) {
    return { storeCount: stores.length, productCount: 0, assignmentCount: 0 };
  }

  await tx.storeProduct.createMany({
    data: stores.flatMap((store) =>
      productIds.map((productId) => ({
        organizationId: input.organizationId,
        storeId: store.id,
        productId,
        assignedById: input.actorId ?? undefined,
        isActive: true,
      })),
    ),
    skipDuplicates: true,
  });

  await tx.storeProduct.updateMany({
    where: {
      organizationId: input.organizationId,
      storeId: { in: storeIds },
      productId: { in: productIds },
      isActive: false,
    },
    data: {
      isActive: true,
      assignedById: input.actorId ?? undefined,
    },
  });

  await ensureBaseSnapshotsForCatalogStores(tx, { productIds, stores });

  return {
    storeCount: stores.length,
    productCount: productIds.length,
    assignmentCount: stores.length * productIds.length,
  };
};
