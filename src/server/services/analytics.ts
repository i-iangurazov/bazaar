import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { getRedisPublisher } from "@/server/redis";

type Granularity = "day" | "week";

type SeriesPoint = { date: string; value: number };

type SalesTrendResult = {
  // Recorded completed-order totals, after discounts and before returns.
  series: { date: string; salesKgs: number }[];
  // Retained for caller compatibility; monetary sales never fall back to movements.
  usesFallback: boolean;
};

type TopProductsResult = {
  // Recorded line revenue/cost, before returns or separate order-wide adjustments.
  items: { sku: string; name: string; value: number }[];
  // True only when every sold line in the requested scope has historical cost.
  canProfit: boolean;
};

type StockoutLowStockResult = {
  lowStockCountSeries: SeriesPoint[];
  stockoutEventsCount?: SeriesPoint[];
};

type InventoryValueResult = {
  valueKgs: number;
  deadStock30: number;
  deadStock60: number;
  deadStock90: number;
};

const CACHE_TTL_SECONDS = 180;

const cacheGet = async <T>(key: string): Promise<T | null> => {
  const redis = getRedisPublisher();
  if (!redis) {
    return null;
  }
  const raw = await redis.get(key);
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as T;
};

const cacheSet = async (key: string, value: unknown) => {
  const redis = getRedisPublisher();
  if (!redis) {
    return;
  }
  await redis.set(key, JSON.stringify(value), "EX", CACHE_TTL_SECONDS);
};

const resolveStoreIds = async (organizationId: string, storeId?: string) => {
  if (storeId) {
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store || store.organizationId !== organizationId) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }
    return [storeId];
  }
  const stores = await prisma.store.findMany({
    where: { organizationId },
    select: { id: true },
  });
  return stores.map((store) => store.id);
};

const resolveScopedStoreIds = async (input: {
  organizationId: string;
  storeId?: string;
  storeIds?: string[];
}) => {
  if (input.storeIds && input.storeIds.length === 0) {
    return [];
  }
  if (input.storeIds) {
    return input.storeIds;
  }
  return resolveStoreIds(input.organizationId, input.storeId);
};

const resolveScopeCacheKey = (input: { storeId?: string; storeIds?: string[] }) =>
  input.storeId ?? (input.storeIds ? `stores:${[...input.storeIds].sort().join(",")}` : "all");

const buildOrderStoreFilter = (storeIds: string[]) =>
  Prisma.sql`AND o."storeId" IN (${Prisma.join(storeIds)})`;

const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

const buildKey = (storeId: string, productId: string, variantId?: string | null) =>
  `${storeId}:${productId}:${variantId ?? "BASE"}`;

const computeEventSeries = ({
  movements,
  snapshots,
  thresholds,
}: {
  movements: { storeId: string; productId: string; variantId: string | null; qtyDelta: number; createdAt: Date }[];
  snapshots: { storeId: string; productId: string; variantId: string | null; onHand: number }[];
  thresholds: Map<string, number | null>;
}) => {
  const movementSums = new Map<string, number>();
  movements.forEach((movement) => {
    const key = buildKey(movement.storeId, movement.productId, movement.variantId ?? null);
    movementSums.set(key, (movementSums.get(key) ?? 0) + movement.qtyDelta);
  });

  const snapshotMap = new Map<string, number>();
  snapshots.forEach((snapshot) => {
    snapshotMap.set(buildKey(snapshot.storeId, snapshot.productId, snapshot.variantId ?? null), snapshot.onHand);
  });

  const stateMap = new Map<string, number>();
  const eventCounts = new Map<string, number>();

  const ensureState = (key: string) => {
    if (!stateMap.has(key)) {
      const currentOnHand = snapshotMap.get(key) ?? 0;
      const netMovement = movementSums.get(key) ?? 0;
      stateMap.set(key, currentOnHand - netMovement);
    }
  };

  movements.forEach((movement) => {
    const key = buildKey(movement.storeId, movement.productId, movement.variantId ?? null);
    const threshold = thresholds.get(key);
    if (threshold === null || threshold === undefined) {
      return;
    }
    ensureState(key);
    const currentOnHand = stateMap.get(key) ?? 0;
    const nextOnHand = currentOnHand + movement.qtyDelta;
    if (currentOnHand > threshold && nextOnHand <= threshold) {
      const bucket = toDateKey(movement.createdAt);
      eventCounts.set(bucket, (eventCounts.get(bucket) ?? 0) + 1);
    }
    stateMap.set(key, nextOnHand);
  });

  return Array.from(eventCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, value: count }));
};

export const getSalesTrend = async (input: {
  organizationId: string;
  storeId?: string;
  storeIds?: string[];
  rangeDays: number;
  granularity: Granularity;
}): Promise<SalesTrendResult> => {
  const storeIds = await resolveScopedStoreIds(input);
  if (!storeIds.length) {
    return { series: [], usesFallback: false };
  }
  const cacheKey = `analytics:sales:v2:${input.organizationId}:${resolveScopeCacheKey(input)}:${input.rangeDays}:${input.granularity}`;
  const cached = await cacheGet<SalesTrendResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const from = new Date(Date.now() - input.rangeDays * 24 * 60 * 60 * 1000);
  const to = new Date();
  const granularity = input.granularity === "week" ? "week" : "day";
  const storeFilter = buildOrderStoreFilter(storeIds);

  const rows = await prisma.$queryRaw<
    Array<{ bucket: Date; salesKgs: string | number }>
  >(Prisma.sql`
    SELECT date_trunc(${granularity}, o."completedAt") AS bucket,
           SUM(o."totalKgs") AS "salesKgs"
    FROM "CustomerOrder" o
    WHERE o."organizationId" = ${input.organizationId}
      AND o.status = 'COMPLETED'
      AND o."completedAt" >= ${from}
      AND o."completedAt" <= ${to}
      ${storeFilter}
    GROUP BY bucket
    ORDER BY bucket
  `);

  const series = rows.map((row) => ({
    date: row.bucket.toISOString(),
    salesKgs: Number(row.salesKgs),
  }));

  const result = { series, usesFallback: false };
  await cacheSet(cacheKey, result);
  return result;
};

export const getTopProducts = async (input: {
  organizationId: string;
  storeId?: string;
  storeIds?: string[];
  rangeDays: number;
  metric: "revenue" | "units" | "profit";
}): Promise<TopProductsResult> => {
  const storeIds = await resolveScopedStoreIds(input);
  if (!storeIds.length) {
    return { items: [], canProfit: false };
  }
  const cacheKey = `analytics:top:v2:${input.organizationId}:${resolveScopeCacheKey(input)}:${input.rangeDays}:${input.metric}`;
  const cached = await cacheGet<TopProductsResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const from = new Date(Date.now() - input.rangeDays * 24 * 60 * 60 * 1000);
  const to = new Date();
  const storeFilter = buildOrderStoreFilter(storeIds);
  const sortMetric = {
    revenue: Prisma.sql`revenue`,
    units: Prisma.sql`units`,
    profit: Prisma.sql`profit`,
  }[input.metric];

  const rows = await prisma.$queryRaw<
    Array<{
      productId: string;
      sku: string;
      name: string;
      units: number;
      revenue: string | number | null;
      profit: string | number | null;
      canProfit: boolean;
    }>
  >(Prisma.sql`
    WITH product_sales AS (
      SELECT l."productId" AS "productId",
             p."sku" AS sku,
             p."name" AS name,
             SUM(l.qty) AS units,
             SUM(l."lineTotalKgs") AS revenue,
             BOOL_AND(COALESCE(l."lineCostTotalKgs", l."unitCostKgs" * l.qty) IS NOT NULL) AS "hasCost",
             CASE WHEN BOOL_AND(COALESCE(l."lineCostTotalKgs", l."unitCostKgs" * l.qty) IS NOT NULL)
               THEN SUM(l."lineTotalKgs" - COALESCE(l."lineCostTotalKgs", l."unitCostKgs" * l.qty))
               ELSE NULL
             END AS profit
      FROM "CustomerOrderLine" l
      JOIN "CustomerOrder" o ON o.id = l."customerOrderId"
      JOIN "Product" p ON p.id = l."productId"
        AND p."organizationId" = o."organizationId"
      WHERE o."organizationId" = ${input.organizationId}
        AND o.status = 'COMPLETED'
        AND o."completedAt" >= ${from}
        AND o."completedAt" <= ${to}
        ${storeFilter}
      GROUP BY l."productId", p."sku", p."name"
    )
    SELECT "productId", sku, name, units, revenue, profit,
           BOOL_AND("hasCost") OVER () AS "canProfit"
    FROM product_sales
    ORDER BY ${sortMetric} DESC NULLS LAST, sku ASC, "productId" ASC
    LIMIT 10
  `);

  // Cost availability covers every product in this scope before LIMIT, not just
  // the selected ten. Missing historical costs cannot be replaced with zero.
  const canProfit = rows.length > 0 && rows.every((row) => row.canProfit);
  if (input.metric === "profit" && !canProfit) {
    const result = { items: [], canProfit: false };
    await cacheSet(cacheKey, result);
    return result;
  }

  const items = rows.map((row) => {
    const value =
      input.metric === "profit"
        ? Number(row.profit ?? 0)
        : input.metric === "revenue"
          ? Number(row.revenue ?? 0)
          : Number(row.units ?? 0);
    return { sku: row.sku, name: row.name, value };
  });

  const result = { items, canProfit };
  await cacheSet(cacheKey, result);
  return result;
};

export const getStockoutsLowStockSeries = async (input: {
  organizationId: string;
  storeId?: string;
  storeIds?: string[];
  rangeDays: number;
}): Promise<StockoutLowStockResult> => {
  const storeIds = await resolveScopedStoreIds(input);
  if (!storeIds.length) {
    return { lowStockCountSeries: [] };
  }
  const cacheKey = `analytics:stock:${input.organizationId}:${resolveScopeCacheKey(input)}:${input.rangeDays}`;
  const cached = await cacheGet<StockoutLowStockResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const from = new Date(Date.now() - input.rangeDays * 24 * 60 * 60 * 1000);
  const to = new Date();

  const movements = await prisma.stockMovement.findMany({
    where: {
      storeId: { in: storeIds },
      createdAt: { gte: from, lte: to },
    },
    select: { storeId: true, productId: true, variantId: true, qtyDelta: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const snapshots = await prisma.inventorySnapshot.findMany({
    where: { storeId: { in: storeIds } },
    select: { storeId: true, productId: true, variantId: true, onHand: true },
  });

  const reorderPolicies = await prisma.reorderPolicy.findMany({
    where: { storeId: { in: storeIds } },
    select: { storeId: true, productId: true, minStock: true },
  });

  const lowStockThresholds = new Map<string, number | null>();
  reorderPolicies.forEach((policy) => {
    if (policy.minStock > 0) {
      lowStockThresholds.set(buildKey(policy.storeId, policy.productId, null), policy.minStock);
    }
  });

  const lowStockThresholdByKey = new Map<string, number | null>();
  snapshots.forEach((snapshot) => {
    const policyKey = buildKey(snapshot.storeId, snapshot.productId, null);
    const threshold = lowStockThresholds.get(policyKey);
    lowStockThresholdByKey.set(
      buildKey(snapshot.storeId, snapshot.productId, snapshot.variantId ?? null),
      threshold ?? null,
    );
  });

  movements.forEach((movement) => {
    const key = buildKey(movement.storeId, movement.productId, movement.variantId ?? null);
    if (!lowStockThresholdByKey.has(key)) {
      const policyKey = buildKey(movement.storeId, movement.productId, null);
      lowStockThresholdByKey.set(key, lowStockThresholds.get(policyKey) ?? null);
    }
  });

  const lowStockSeries = computeEventSeries({
    movements,
    snapshots,
    thresholds: lowStockThresholdByKey,
  });

  const stockoutThresholds = new Map<string, number | null>();
  snapshots.forEach((snapshot) => {
    stockoutThresholds.set(buildKey(snapshot.storeId, snapshot.productId, snapshot.variantId ?? null), 0);
  });
  movements.forEach((movement) => {
    const key = buildKey(movement.storeId, movement.productId, movement.variantId ?? null);
    if (!stockoutThresholds.has(key)) {
      stockoutThresholds.set(key, 0);
    }
  });

  const stockoutSeries = computeEventSeries({
    movements,
    snapshots,
    thresholds: stockoutThresholds,
  });

  const result: StockoutLowStockResult = {
    lowStockCountSeries: lowStockSeries,
    stockoutEventsCount: stockoutSeries.length ? stockoutSeries : undefined,
  };
  await cacheSet(cacheKey, result);
  return result;
};

export const getInventoryValue = async (input: {
  organizationId: string;
  storeId?: string;
  storeIds?: string[];
}): Promise<InventoryValueResult> => {
  const storeIds = await resolveScopedStoreIds(input);
  if (!storeIds.length) {
    return { valueKgs: 0, deadStock30: 0, deadStock60: 0, deadStock90: 0 };
  }
  const cacheKey = `analytics:value:${input.organizationId}:${resolveScopeCacheKey(input)}`;
  const cached = await cacheGet<InventoryValueResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const storeFilter = input.storeId
    ? Prisma.sql`AND s."storeId" = ${input.storeId}`
    : Prisma.sql`AND s."storeId" IN (${Prisma.join(storeIds)})`;

  const valueRow = await prisma.$queryRaw<Array<{ total: string | number | null }>>(Prisma.sql`
    SELECT SUM(s."onHand" * COALESCE(sp."priceKgs", p."basePriceKgs", 0)) AS total
    FROM "InventorySnapshot" s
    JOIN "Store" st ON st.id = s."storeId"
    JOIN "Product" p ON p.id = s."productId"
    LEFT JOIN "StorePrice" sp ON sp."storeId" = s."storeId"
      AND sp."productId" = s."productId"
      AND sp."variantKey" = s."variantKey"
    WHERE st."organizationId" = ${input.organizationId}
      ${storeFilter}
  `);

  const snapshots = await prisma.inventorySnapshot.findMany({
    where: { storeId: { in: storeIds }, onHand: { gt: 0 } },
    select: { storeId: true, productId: true, variantId: true },
  });

  const lastMovements = await prisma.stockMovement.groupBy({
    by: ["storeId", "productId", "variantId"],
    where: { storeId: { in: storeIds } },
    _max: { createdAt: true },
  });

  const lastMovementMap = new Map<string, Date | null>();
  lastMovements.forEach((item) => {
    lastMovementMap.set(
      buildKey(item.storeId, item.productId, item.variantId ?? null),
      item._max.createdAt ?? null,
    );
  });

  const now = Date.now();
  let deadStock30 = 0;
  let deadStock60 = 0;
  let deadStock90 = 0;

  snapshots.forEach((snapshot) => {
    const lastMovement = lastMovementMap.get(
      buildKey(snapshot.storeId, snapshot.productId, snapshot.variantId ?? null),
    );
    const ageDays = lastMovement ? (now - lastMovement.getTime()) / (24 * 60 * 60 * 1000) : 999;
    if (ageDays >= 90) {
      deadStock90 += 1;
    }
    if (ageDays >= 60) {
      deadStock60 += 1;
    }
    if (ageDays >= 30) {
      deadStock30 += 1;
    }
  });

  const valueKgs = Number(valueRow?.[0]?.total ?? 0);
  const result = { valueKgs, deadStock30, deadStock60, deadStock90 };
  await cacheSet(cacheKey, result);
  return result;
};
