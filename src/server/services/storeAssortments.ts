import type { Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";
import {
  createDefaultProductCatalog,
  syncProductCatalogAssignments,
} from "@/server/services/productCatalogs";

type AssortmentTx = Prisma.TransactionClient;

type StoreProductAssignment = {
  storeId: string;
  productId: string;
};

const normalizeOptional = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const storeSelect = {
  id: true,
  name: true,
  code: true,
  productCatalogId: true,
  productCatalog: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.StoreSelect;

const buildAssignmentSets = (assignments: StoreProductAssignment[]) => {
  const byStore = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    const set = byStore.get(assignment.storeId) ?? new Set<string>();
    set.add(assignment.productId);
    byStore.set(assignment.storeId, set);
  }
  return byStore;
};

const getActiveAssignmentsForStores = (
  tx: AssortmentTx,
  input: {
    organizationId: string;
    storeIds: string[];
  },
) =>
  tx.storeProduct.findMany({
    where: {
      organizationId: input.organizationId,
      storeId: { in: input.storeIds },
      isActive: true,
      product: {
        organizationId: input.organizationId,
        isDeleted: false,
      },
    },
    select: {
      storeId: true,
      productId: true,
    },
  });

export const listStoreAssortmentOverview = async (input: { organizationId: string }) =>
  prisma.$transaction(async (tx) => {
    const stores = await tx.store.findMany({
      where: { organizationId: input.organizationId },
      select: storeSelect,
      orderBy: [{ name: "asc" }, { code: "asc" }],
    });
    const storeIds = stores.map((store) => store.id);
    const assignments = storeIds.length
      ? await getActiveAssignmentsForStores(tx, {
          organizationId: input.organizationId,
          storeIds,
        })
      : [];
    const assignmentSetsByStore = buildAssignmentSets(assignments);
    const snapshotCounts = storeIds.length
      ? await tx.inventorySnapshot.groupBy({
          by: ["storeId"],
          where: {
            storeId: { in: storeIds },
            product: {
              organizationId: input.organizationId,
              isDeleted: false,
            },
          },
          _count: { productId: true },
        })
      : [];
    const snapshotCountByStore = new Map(
      snapshotCounts.map((row) => [row.storeId, row._count.productId]),
    );
    const grouped = new Map<
      string,
      {
        id: string;
        name: string;
        isShared: boolean;
        stores: Array<{
          id: string;
          name: string;
          code: string;
          visibleProductCount: number;
          stockSnapshotCount: number;
          stockOwnerLabel: string;
        }>;
        productIds: Set<string>;
      }
    >();

    for (const store of stores) {
      const groupId = store.productCatalogId ?? `store:${store.id}`;
      const group =
        grouped.get(groupId) ??
        {
          id: groupId,
          name: store.productCatalog?.name ?? store.name,
          isShared: false,
          stores: [],
          productIds: new Set<string>(),
        };
      const productIds = assignmentSetsByStore.get(store.id) ?? new Set<string>();
      for (const productId of productIds) {
        group.productIds.add(productId);
      }
      group.stores.push({
        id: store.id,
        name: store.name,
        code: store.code,
        visibleProductCount: productIds.size,
        stockSnapshotCount: snapshotCountByStore.get(store.id) ?? 0,
        stockOwnerLabel: store.name,
      });
      grouped.set(groupId, group);
    }

    const groups = Array.from(grouped.values())
      .map((group) => ({
        id: group.id,
        name: group.name,
        isShared: group.stores.length > 1,
        customerSharingMode: "ORGANIZATION_WIDE" as const,
        productCount: group.productIds.size,
        storeCount: group.stores.length,
        stores: group.stores.sort((left, right) => left.name.localeCompare(right.name)),
      }))
      .sort((left, right) => {
        if (left.isShared !== right.isShared) {
          return left.isShared ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });

    return {
      customerSharingMode: "ORGANIZATION_WIDE" as const,
      stores,
      groups,
    };
  });

const buildStoreAssortmentPreview = async (
  tx: AssortmentTx,
  input: {
    organizationId: string;
    sourceStoreId: string;
    targetStoreIds: string[];
    groupName?: string | null;
  },
) => {
  const sourceStoreId = normalizeOptional(input.sourceStoreId);
  const targetStoreIds = unique(input.targetStoreIds.map((storeId) => storeId.trim())).filter(
    (storeId) => storeId !== sourceStoreId,
  );
  if (!sourceStoreId) {
    throw new AppError("sourceStoreRequired", "BAD_REQUEST", 400);
  }
  if (!targetStoreIds.length) {
    throw new AppError("targetStoresRequired", "BAD_REQUEST", 400);
  }

  const sourceStore = await tx.store.findFirst({
    where: { id: sourceStoreId, organizationId: input.organizationId },
    select: storeSelect,
  });
  if (!sourceStore) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }

  const existingGroupStores = sourceStore.productCatalogId
    ? await tx.store.findMany({
        where: {
          organizationId: input.organizationId,
          productCatalogId: sourceStore.productCatalogId,
        },
        select: storeSelect,
        orderBy: [{ name: "asc" }, { code: "asc" }],
      })
    : [sourceStore];
  const selectedStoreIds = unique([
    ...existingGroupStores.map((store) => store.id),
    sourceStore.id,
    ...targetStoreIds,
  ]);
  const selectedStores = await tx.store.findMany({
    where: {
      organizationId: input.organizationId,
      id: { in: selectedStoreIds },
    },
    select: storeSelect,
    orderBy: [{ name: "asc" }, { code: "asc" }],
  });
  if (selectedStores.length !== selectedStoreIds.length) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }

  const selectedStoreById = new Map(selectedStores.map((store) => [store.id, store]));
  const targetStores = targetStoreIds.map((storeId) => {
    const store = selectedStoreById.get(storeId);
    if (!store) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }
    return store;
  });

  const assignments = await getActiveAssignmentsForStores(tx, {
    organizationId: input.organizationId,
    storeIds: selectedStoreIds,
  });
  const assignmentSetsByStore = buildAssignmentSets(assignments);
  const sourceCatalogStoreIds = new Set(existingGroupStores.map((store) => store.id));
  const sourceCatalogProductIds = new Set<string>();
  const groupProductIds = new Set<string>();
  for (const assignment of assignments) {
    groupProductIds.add(assignment.productId);
    if (sourceCatalogStoreIds.has(assignment.storeId)) {
      sourceCatalogProductIds.add(assignment.productId);
    }
  }
  const productIds = Array.from(groupProductIds);
  const snapshotRows = productIds.length
    ? await tx.inventorySnapshot.findMany({
        where: {
          storeId: { in: selectedStoreIds },
          productId: { in: productIds },
          variantKey: "BASE",
        },
        select: {
          storeId: true,
          productId: true,
          onHand: true,
        },
      })
    : [];
  const snapshotKeys = new Set(
    snapshotRows.map((snapshot) => `${snapshot.storeId}:${snapshot.productId}`),
  );
  const positiveStockByStore = new Map<string, number>();
  for (const snapshot of snapshotRows) {
    if (snapshot.onHand > 0) {
      positiveStockByStore.set(
        snapshot.storeId,
        (positiveStockByStore.get(snapshot.storeId) ?? 0) + 1,
      );
    }
  }

  const countMissingAssignments = (storeId: string, ids: string[]) => {
    const assigned = assignmentSetsByStore.get(storeId) ?? new Set<string>();
    return ids.filter((productId) => !assigned.has(productId)).length;
  };
  const countMissingSnapshots = (storeId: string, ids: string[]) =>
    ids.filter((productId) => !snapshotKeys.has(`${storeId}:${productId}`)).length;

  const targetImpacts = targetStores.map((store) => {
    const currentGroupId = store.productCatalogId ?? `store:${store.id}`;
    return {
      storeId: store.id,
      storeName: store.name,
      storeCode: store.code,
      currentCatalogId: store.productCatalogId,
      currentCatalogName: store.productCatalog?.name ?? store.name,
      willLeaveCurrentGroup:
        Boolean(store.productCatalogId) && store.productCatalogId !== sourceStore.productCatalogId,
      productsToAdd: countMissingAssignments(store.id, productIds),
      sourceProductsToAdd: countMissingAssignments(store.id, Array.from(sourceCatalogProductIds)),
      zeroStockSnapshotsToCreate: countMissingSnapshots(store.id, productIds),
      existingPositiveStockRows: positiveStockByStore.get(store.id) ?? 0,
      currentGroupId,
    };
  });
  const groupStoreImpacts = selectedStores.map((store) => ({
    storeId: store.id,
    storeName: store.name,
    productsToAdd: countMissingAssignments(store.id, productIds),
    zeroStockSnapshotsToCreate: countMissingSnapshots(store.id, productIds),
  }));

  const targetProductIds = new Set<string>();
  for (const targetStore of targetStores) {
    for (const productId of assignmentSetsByStore.get(targetStore.id) ?? []) {
      targetProductIds.add(productId);
    }
  }
  const targetProductsSharedBackToSource = Array.from(targetProductIds).filter(
    (productId) => !sourceCatalogProductIds.has(productId),
  ).length;
  const groupName = normalizeOptional(input.groupName) ?? sourceStore.productCatalog?.name ?? sourceStore.name;

  return {
    sourceStore: {
      id: sourceStore.id,
      name: sourceStore.name,
      code: sourceStore.code,
      currentCatalogId: sourceStore.productCatalogId,
      currentCatalogName: sourceStore.productCatalog?.name ?? sourceStore.name,
    },
    groupName,
    existingGroupStores: existingGroupStores.map((store) => ({
      id: store.id,
      name: store.name,
      code: store.code,
    })),
    targetStores: targetStores.map((store) => ({
      id: store.id,
      name: store.name,
      code: store.code,
    })),
    selectedStoreCount: selectedStores.length,
    sourceProductCount: sourceCatalogProductIds.size,
    totalSharedProductCount: productIds.length,
    targetProductsSharedBackToSource,
    totalProductsToAssign: groupStoreImpacts.reduce((sum, impact) => sum + impact.productsToAdd, 0),
    totalZeroStockSnapshotsToCreate: groupStoreImpacts.reduce(
      (sum, impact) => sum + impact.zeroStockSnapshotsToCreate,
      0,
    ),
    targetImpacts,
    groupStoreImpacts,
    stockWillBeCopied: false,
    existingStockWillRemain: true,
    destructiveActions: [] as string[],
    customerSharingMode: "ORGANIZATION_WIDE" as const,
  };
};

export const previewStoreAssortmentShare = async (input: {
  organizationId: string;
  sourceStoreId: string;
  targetStoreIds: string[];
  groupName?: string | null;
}) => prisma.$transaction((tx) => buildStoreAssortmentPreview(tx, input));

export const applyStoreAssortmentShare = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  sourceStoreId: string;
  targetStoreIds: string[];
  groupName?: string | null;
}) =>
  prisma.$transaction(async (tx) => {
    const preview = await buildStoreAssortmentPreview(tx, input);
    const sourceStore = await tx.store.findFirst({
      where: { id: input.sourceStoreId, organizationId: input.organizationId },
      select: storeSelect,
    });
    if (!sourceStore) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }

    const catalog = sourceStore.productCatalogId
      ? await tx.productCatalog.update({
          where: { id: sourceStore.productCatalogId },
          data: { name: preview.groupName },
          select: { id: true, name: true },
        })
      : await createDefaultProductCatalog(tx, {
          organizationId: input.organizationId,
          name: preview.groupName,
        });

    const storeIdsToMove = unique([sourceStore.id, ...preview.targetStores.map((store) => store.id)]);
    await tx.store.updateMany({
      where: {
        organizationId: input.organizationId,
        id: { in: storeIdsToMove },
      },
      data: {
        productCatalogId: catalog.id,
      },
    });

    const syncSummary = await syncProductCatalogAssignments(tx, {
      organizationId: input.organizationId,
      productCatalogId: catalog.id,
      actorId: input.actorId,
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "STORE_ASSORTMENT_SHARE",
      entity: "ProductCatalog",
      entityId: catalog.id,
      before: toJson(preview),
      after: toJson({
        catalog,
        storeIdsToMove,
        syncSummary,
        stockWillBeCopied: false,
        existingStockWillRemain: true,
        customerSharingMode: "ORGANIZATION_WIDE",
      }),
      requestId: input.requestId,
    });

    return {
      ...preview,
      catalogId: catalog.id,
      catalogName: catalog.name,
      syncSummary,
    };
  });
