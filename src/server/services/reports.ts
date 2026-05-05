import { StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";

type ReportRangeInput = {
  organizationId: string;
  storeId?: string;
  storeIds?: string[];
  from: Date;
  to: Date;
};

type StockoutRow = {
  storeId: string;
  storeName: string;
  productId: string;
  productName: string;
  productSku: string;
  variantId: string | null;
  variantName: string | null;
  count: number;
  lastAt: Date | null;
  onHand: number;
};

type SlowMoverRow = {
  storeId: string;
  storeName: string;
  productId: string;
  productName: string;
  productSku: string;
  variantId: string | null;
  variantName: string | null;
  lastMovementAt: Date | null;
  onHand: number;
};

type ShrinkageRow = {
  storeId: string;
  storeName: string;
  productId: string;
  productName: string;
  productSku: string;
  variantId: string | null;
  variantName: string | null;
  userId: string | null;
  userName: string | null;
  totalQty: number;
  movementCount: number;
};

const buildKey = (storeId: string, productId: string, variantId: string | null) =>
  `${storeId}:${productId}:${variantId ?? "BASE"}`;

const loadStores = async (organizationId: string, storeId?: string, limitedStoreIds?: string[]) => {
  if (limitedStoreIds && limitedStoreIds.length === 0) {
    return { storeIds: [], storeMap: new Map<string, string>() };
  }
  const stores = await prisma.store.findMany({
    where: {
      organizationId,
      ...(storeId ? { id: storeId } : limitedStoreIds ? { id: { in: limitedStoreIds } } : {}),
    },
    select: { id: true, name: true },
  });
  const storeIds = stores.map((store) => store.id);
  const storeMap = new Map(stores.map((store) => [store.id, store.name]));
  return { storeIds, storeMap };
};

const loadProducts = async (productIds: string[]) => {
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, sku: true },
  });
  return new Map(products.map((product) => [product.id, product]));
};

const loadVariants = async (variantIds: string[]) => {
  if (!variantIds.length) {
    return new Map<string, { id: string; name: string | null }>();
  }
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, name: true },
  });
  return new Map(variants.map((variant) => [variant.id, variant]));
};

export const getStockoutsReport = async (input: ReportRangeInput): Promise<StockoutRow[]> => {
  const { storeIds, storeMap } = await loadStores(input.organizationId, input.storeId, input.storeIds);
  if (!storeIds.length) {
    return [];
  }

  const movements = await prisma.stockMovement.findMany({
    where: {
      storeId: { in: storeIds },
      createdAt: { gte: input.from, lte: input.to },
    },
    select: { storeId: true, productId: true, variantId: true, qtyDelta: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const snapshots = await prisma.inventorySnapshot.findMany({
    where: { storeId: { in: storeIds } },
    select: { storeId: true, productId: true, variantId: true, onHand: true },
  });

  const snapshotMap = new Map<string, number>();
  snapshots.forEach((snapshot) => {
    snapshotMap.set(
      buildKey(snapshot.storeId, snapshot.productId, snapshot.variantId ?? null),
      snapshot.onHand,
    );
  });

  const movementSums = new Map<string, number>();
  movements.forEach((movement) => {
    const key = buildKey(movement.storeId, movement.productId, movement.variantId ?? null);
    movementSums.set(key, (movementSums.get(key) ?? 0) + movement.qtyDelta);
  });

  const states = new Map<string, { onHand: number; count: number; lastAt: Date | null }>();
  movements.forEach((movement) => {
    const key = buildKey(movement.storeId, movement.productId, movement.variantId ?? null);
    if (!states.has(key)) {
      const currentOnHand = snapshotMap.get(key) ?? 0;
      const netMovement = movementSums.get(key) ?? 0;
      states.set(key, { onHand: currentOnHand - netMovement, count: 0, lastAt: null });
    }
    const state = states.get(key);
    if (!state) {
      return;
    }
    const prevOnHand = state.onHand;
    state.onHand += movement.qtyDelta;
    if (prevOnHand > 0 && state.onHand <= 0) {
      state.count += 1;
      state.lastAt = movement.createdAt;
    }
  });

  const rows = Array.from(states.entries())
    .filter(([, state]) => state.count > 0)
    .map(([key, state]) => {
      const [storeId, productId, variantKey] = key.split(":");
      return {
        storeId,
        productId,
        variantId: variantKey === "BASE" ? null : variantKey,
        count: state.count,
        lastAt: state.lastAt,
        onHand: snapshotMap.get(key) ?? 0,
      };
    });

  const productIds = rows.map((row) => row.productId);
  const variantIds = rows
    .map((row) => row.variantId)
    .filter((value): value is string => Boolean(value));
  const productMap = await loadProducts(productIds);
  const variantMap = await loadVariants(variantIds);

  return rows.map((row) => {
    const product = productMap.get(row.productId);
    const variant = row.variantId ? variantMap.get(row.variantId) : undefined;
    return {
      storeId: row.storeId,
      storeName: storeMap.get(row.storeId) ?? "",
      productId: row.productId,
      productName: product?.name ?? "",
      productSku: product?.sku ?? "",
      variantId: row.variantId,
      variantName: variant?.name ?? null,
      count: row.count,
      lastAt: row.lastAt,
      onHand: row.onHand,
    };
  });
};

export const getSlowMoversReport = async (input: ReportRangeInput): Promise<SlowMoverRow[]> => {
  const { storeIds, storeMap } = await loadStores(input.organizationId, input.storeId, input.storeIds);
  if (!storeIds.length) {
    return [];
  }

  const snapshots = await prisma.inventorySnapshot.findMany({
    where: { storeId: { in: storeIds } },
    select: { storeId: true, productId: true, variantId: true, onHand: true },
  });

  const lastMovements = await prisma.stockMovement.groupBy({
    by: ["storeId", "productId", "variantId"],
    where: { storeId: { in: storeIds }, createdAt: { lte: input.to } },
    _max: { createdAt: true },
  });

  const lastMovementMap = new Map(
    lastMovements.map((item) => [
      buildKey(item.storeId, item.productId, item.variantId ?? null),
      item._max.createdAt ?? null,
    ]),
  );

  const rows = snapshots
    .map((snapshot) => {
      const key = buildKey(snapshot.storeId, snapshot.productId, snapshot.variantId ?? null);
      const lastMovementAt = lastMovementMap.get(key) ?? null;
      return {
        storeId: snapshot.storeId,
        productId: snapshot.productId,
        variantId: snapshot.variantId ?? null,
        onHand: snapshot.onHand,
        lastMovementAt,
      };
    })
    .filter((row) => !row.lastMovementAt || row.lastMovementAt < input.from);

  const productIds = rows.map((row) => row.productId);
  const variantIds = rows
    .map((row) => row.variantId)
    .filter((value): value is string => Boolean(value));
  const productMap = await loadProducts(productIds);
  const variantMap = await loadVariants(variantIds);

  return rows.map((row) => {
    const product = productMap.get(row.productId);
    const variant = row.variantId ? variantMap.get(row.variantId) : undefined;
    return {
      storeId: row.storeId,
      storeName: storeMap.get(row.storeId) ?? "",
      productId: row.productId,
      productName: product?.name ?? "",
      productSku: product?.sku ?? "",
      variantId: row.variantId,
      variantName: variant?.name ?? null,
      lastMovementAt: row.lastMovementAt,
      onHand: row.onHand,
    };
  });
};

export const getShrinkageReport = async (input: ReportRangeInput): Promise<ShrinkageRow[]> => {
  const { storeIds, storeMap } = await loadStores(input.organizationId, input.storeId, input.storeIds);
  if (!storeIds.length) {
    return [];
  }

  const groups = await prisma.stockMovement.groupBy({
    by: ["storeId", "productId", "variantId", "createdById"],
    where: {
      storeId: { in: storeIds },
      type: StockMovementType.ADJUSTMENT,
      qtyDelta: { lt: 0 },
      createdAt: { gte: input.from, lte: input.to },
    },
    _sum: { qtyDelta: true },
    _count: { _all: true },
  });

  const productIds = groups.map((group) => group.productId);
  const variantIds = groups
    .map((group) => group.variantId)
    .filter((value): value is string => Boolean(value));
  const userIds = groups
    .map((group) => group.createdById)
    .filter((value): value is string => Boolean(value));

  const productMap = await loadProducts(productIds);
  const variantMap = await loadVariants(variantIds);
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    : [];
  const userMap = new Map(users.map((user) => [user.id, user.name ?? user.email ?? ""]));

  return groups.map((group) => {
    const product = productMap.get(group.productId);
    const variant = group.variantId ? variantMap.get(group.variantId) : undefined;
    return {
      storeId: group.storeId,
      storeName: storeMap.get(group.storeId) ?? "",
      productId: group.productId,
      productName: product?.name ?? "",
      productSku: product?.sku ?? "",
      variantId: group.variantId ?? null,
      variantName: variant?.name ?? null,
      userId: group.createdById ?? null,
      userName: group.createdById ? userMap.get(group.createdById) ?? null : null,
      totalQty: Math.abs(group._sum.qtyDelta ?? 0),
      movementCount: group._count._all,
    };
  });
};
