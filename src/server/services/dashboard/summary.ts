import type {
  AuditLog,
  ForecastSnapshot,
  InventorySnapshot,
  Prisma,
  PrismaClient,
  PurchaseOrder,
  ReorderPolicy,
} from "@prisma/client";
import type { Logger } from "pino";
import { TRPCError } from "@trpc/server";

import { logProfileSection } from "@/server/profiling/perf";
import { enrichRecentActivity } from "@/server/services/activity";
import { buildReorderSuggestion } from "@/server/services/reorderSuggestions";
import {
  canAccessStore,
  listAccessibleStores,
  type StoreAccessUser,
} from "@/server/services/storeAccess";

type ProductSummary = {
  id: string;
  name: string;
  sku: string;
};

type VariantSummary = {
  id: string;
  name: string | null;
};

type LowStockSnapshot = Pick<
  InventorySnapshot,
  "id" | "storeId" | "productId" | "variantId" | "variantKey" | "onHand" | "onOrder" | "allowNegativeStock" | "updatedAt"
> & {
  product: ProductSummary;
  variant: VariantSummary | null;
};

type PendingPurchaseOrder = Pick<PurchaseOrder, "id" | "status" | "createdAt"> & {
  supplier: { name: string | null } | null;
};

type RecentMovement = {
  id: string;
  type: string;
  qtyDelta: number;
  note: string | null;
  createdAt: Date;
  product: ProductSummary;
  variant: VariantSummary | null;
  createdBy: { name: string | null; email: string } | null;
};

export type DashboardSummaryResult = {
  business: {
    todaySalesKgs: number;
    receiptsCount: number;
    averageReceiptKgs: number;
    grossProfitKgs: number | null;
    grossMarginPercent: number | null;
    openShiftsCount: number;
    lowStockCount: number;
    negativeStockCount: number;
    missingBarcodeCount: number;
    missingPriceCount: number;
    pendingPurchaseOrdersCount: number;
    failedReceiptsCount: number;
  };
  lowStock: Array<{
    snapshot: LowStockSnapshot;
    product: ProductSummary;
    variant: VariantSummary | null;
    minStock: number;
    lowStock: boolean;
    reorder: ReturnType<typeof buildReorderSuggestion>;
  }>;
  pendingPurchaseOrders: PendingPurchaseOrder[];
  recentActivity: Awaited<ReturnType<typeof enrichRecentActivity>>;
  recentMovements: RecentMovement[];
};

export type DashboardActivityResult = {
  recentActivity: Awaited<ReturnType<typeof enrichRecentActivity>>;
};

type DashboardSummaryOptions = {
  includeRecentActivity?: boolean;
  includeRecentMovements?: boolean;
};

export const emptyDashboardSummary = (): DashboardSummaryResult => ({
  business: {
    todaySalesKgs: 0,
    receiptsCount: 0,
    averageReceiptKgs: 0,
    grossProfitKgs: null,
    grossMarginPercent: null,
    openShiftsCount: 0,
    lowStockCount: 0,
    negativeStockCount: 0,
    missingBarcodeCount: 0,
    missingPriceCount: 0,
    pendingPurchaseOrdersCount: 0,
    failedReceiptsCount: 0,
  },
  lowStock: [],
  pendingPurchaseOrders: [],
  recentActivity: [],
  recentMovements: [],
});

export const emptyDashboardActivity = (): DashboardActivityResult => ({
  recentActivity: [],
});

const asRecord = (value: Prisma.JsonValue | null): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const getStoreIdFromLog = (
  log: Pick<AuditLog, "entity" | "entityId" | "before" | "after">,
  purchaseOrderStoreMap: Map<string, string>,
) => {
  if (log.entity === "PurchaseOrder") {
    return purchaseOrderStoreMap.get(log.entityId) ?? null;
  }
  const source = asRecord(log.after) ?? asRecord(log.before);
  if (!source) {
    return null;
  }
  const storeId = source.storeId;
  return typeof storeId === "string" ? storeId : null;
};

const resolveDashboardSummaryOptions = (
  options?: DashboardSummaryOptions,
): Required<DashboardSummaryOptions> => ({
  includeRecentActivity: options?.includeRecentActivity ?? true,
  includeRecentMovements: options?.includeRecentMovements ?? true,
});

const assertDashboardStoreAccess = async ({
  prisma,
  logger,
  user,
  organizationId,
  storeId,
  scope,
}: {
  prisma: PrismaClient | Prisma.TransactionClient;
  logger: Logger;
  user: StoreAccessUser;
  organizationId: string;
  storeId: string;
  scope: "dashboard.summary" | "dashboard.activity";
}) => {
  const storeLookupStartedAt = Date.now();
  const allowed = await canAccessStore(prisma, user, storeId);
  logProfileSection({
    logger,
    scope,
    section: "storeLookup",
    startedAt: storeLookupStartedAt,
    details: { storeId },
  });

  if (!allowed || user.organizationId !== organizationId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "storeAccessDenied" });
  }
};

const loadDashboardRecentActivity = async ({
  prisma,
  logger,
  organizationId,
  storeId,
  scope,
}: {
  prisma: PrismaClient | Prisma.TransactionClient;
  logger: Logger;
  organizationId: string;
  storeId: string;
  scope: "dashboard.summary" | "dashboard.activity";
}) => {
  const activityReadsStartedAt = Date.now();
  const recentActivityLogsRaw = await prisma.auditLog.findMany({
    where: { organizationId },
    select: {
      id: true,
      action: true,
      entity: true,
      entityId: true,
      before: true,
      after: true,
      createdAt: true,
      actor: {
        select: {
          name: true,
          email: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  logProfileSection({
    logger,
    scope,
    section: "activityReads",
    startedAt: activityReadsStartedAt,
    details: {
      storeId,
      recentActivityLogs: recentActivityLogsRaw.length,
    },
  });

  const activityPurchaseOrderIds = Array.from(
    new Set(
      recentActivityLogsRaw
        .filter((log) => log.entity === "PurchaseOrder")
        .map((log) => log.entityId),
    ),
  );

  const activityPurchaseOrderLookupStartedAt = Date.now();
  const activityPurchaseOrders = activityPurchaseOrderIds.length
    ? await prisma.purchaseOrder.findMany({
        where: { id: { in: activityPurchaseOrderIds } },
        select: { id: true, storeId: true },
      })
    : [];
  logProfileSection({
    logger,
    scope,
    section: "activityPurchaseOrderLookup",
    startedAt: activityPurchaseOrderLookupStartedAt,
    details: {
      storeId,
      purchaseOrders: activityPurchaseOrders.length,
    },
  });

  const activityPurchaseOrderStoreMap = new Map(
    activityPurchaseOrders.map((order) => [order.id, order.storeId]),
  );

  const recentActivityLogs = recentActivityLogsRaw
    .filter((log) => getStoreIdFromLog(log, activityPurchaseOrderStoreMap) === storeId)
    .slice(0, 8);

  const recentActivityStartedAt = Date.now();
  const recentActivity = await enrichRecentActivity(
    prisma,
    recentActivityLogs as Parameters<typeof enrichRecentActivity>[1],
  );
  logProfileSection({
    logger,
    scope,
    section: "recentActivityEnrichment",
    startedAt: recentActivityStartedAt,
    details: {
      storeId,
      activityItems: recentActivity.length,
    },
  });

  return recentActivity;
};

export const getDashboardSummary = async ({
  prisma,
  logger,
  user,
  organizationId,
  storeId,
  includeRecentActivity,
  includeRecentMovements,
}: {
  prisma: PrismaClient | Prisma.TransactionClient;
  logger: Logger;
  user: StoreAccessUser;
  organizationId: string;
  storeId: string;
  includeRecentActivity?: boolean;
  includeRecentMovements?: boolean;
}): Promise<DashboardSummaryResult> => {
  const options = resolveDashboardSummaryOptions({
    includeRecentActivity,
    includeRecentMovements,
  });
  await assertDashboardStoreAccess({
    prisma,
    logger,
    user,
    organizationId,
    storeId,
    scope: "dashboard.summary",
  });
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(todayStart.getDate() + 1);

  const lowStockCandidatesStartedAt = Date.now();
  const lowStockCandidates = await prisma.$queryRaw<
    { snapshotId: string; productId: string; minStock: number }[]
  >`
    SELECT
      s.id AS "snapshotId",
      s."productId" AS "productId",
      p."minStock" AS "minStock"
    FROM "InventorySnapshot" s
    INNER JOIN "ReorderPolicy" p
      ON p."storeId" = s."storeId"
     AND p."productId" = s."productId"
    INNER JOIN "Product" pr
      ON pr.id = s."productId"
    WHERE s."storeId" = ${storeId}
      AND pr."isDeleted" = false
      AND p."minStock" > 0
      AND s."onHand" <= p."minStock"
    ORDER BY s."updatedAt" DESC
    LIMIT 5
  `;
  logProfileSection({
    logger,
    scope: "dashboard.summary",
    section: "lowStockCandidates",
    startedAt: lowStockCandidatesStartedAt,
    details: {
      storeId,
      candidateCount: lowStockCandidates.length,
    },
  });

  const lowStockSnapshotIds = lowStockCandidates.map((item) => item.snapshotId);
  const lowStockProductIds = Array.from(new Set(lowStockCandidates.map((item) => item.productId)));

  const secondaryReadsStartedAt = Date.now();
  const [
    lowStockSnapshots,
    policies,
    forecasts,
    recentMovements,
    pendingPurchaseOrders,
    todayOrders,
    openShiftsCount,
    negativeStockCount,
    missingBarcodeCount,
    missingPriceCount,
    pendingPurchaseOrdersCount,
    failedReceiptsCount,
    lowStockCountRows,
  ] = await Promise.all([
    lowStockSnapshotIds.length
      ? prisma.inventorySnapshot.findMany({
          where: { id: { in: lowStockSnapshotIds } },
          select: {
            id: true,
            storeId: true,
            productId: true,
            variantId: true,
            variantKey: true,
            onHand: true,
            onOrder: true,
            allowNegativeStock: true,
            updatedAt: true,
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
              },
            },
            variant: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        })
      : Promise.resolve([] as LowStockSnapshot[]),
    lowStockProductIds.length
      ? prisma.reorderPolicy.findMany({
          where: { storeId, productId: { in: lowStockProductIds } },
        })
      : Promise.resolve([] as ReorderPolicy[]),
    lowStockProductIds.length
      ? prisma.forecastSnapshot.findMany({
          where: { storeId, productId: { in: lowStockProductIds } },
          orderBy: { generatedAt: "desc" },
          distinct: ["productId"],
        })
      : Promise.resolve([] as ForecastSnapshot[]),
    options.includeRecentMovements
      ? prisma.stockMovement.findMany({
          where: { storeId },
          select: {
            id: true,
            type: true,
            qtyDelta: true,
            note: true,
            createdAt: true,
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
              },
            },
            variant: {
              select: {
                id: true,
                name: true,
              },
            },
            createdBy: {
              select: {
                name: true,
                email: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 8,
        })
      : Promise.resolve([] as RecentMovement[]),
    prisma.purchaseOrder.findMany({
      where: {
        organizationId,
        storeId,
        status: { in: ["SUBMITTED", "APPROVED"] },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        supplier: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.customerOrder.findMany({
      where: {
        organizationId,
        storeId,
        status: "COMPLETED",
        completedAt: {
          gte: todayStart,
          lt: tomorrowStart,
        },
      },
      select: {
        id: true,
        totalKgs: true,
        lines: {
          select: {
            lineCostTotalKgs: true,
          },
        },
      },
    }),
    prisma.registerShift.count({
      where: {
        organizationId,
        storeId,
        status: "OPEN",
      },
    }),
    prisma.inventorySnapshot.count({
      where: {
        storeId,
        onHand: { lt: 0 },
        product: { organizationId, isDeleted: false },
      },
    }),
    prisma.product.count({
      where: {
        organizationId,
        isDeleted: false,
        storeProducts: { some: { storeId, isActive: true } },
        barcodes: { none: {} },
      },
    }),
    prisma.product.count({
      where: {
        organizationId,
        isDeleted: false,
        storeProducts: { some: { storeId, isActive: true } },
        basePriceKgs: null,
        storePrices: { none: { storeId, variantKey: "BASE" } },
      },
    }),
    prisma.purchaseOrder.count({
      where: {
        organizationId,
        storeId,
        status: { in: ["SUBMITTED", "APPROVED"] },
      },
    }),
    prisma.fiscalReceipt.count({
      where: {
        organizationId,
        storeId,
        status: "FAILED",
      },
    }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT s.id) AS "count"
      FROM "InventorySnapshot" s
      INNER JOIN "ReorderPolicy" p
        ON p."storeId" = s."storeId"
       AND p."productId" = s."productId"
      INNER JOIN "Product" pr
        ON pr.id = s."productId"
      WHERE s."storeId" = ${storeId}
        AND pr."isDeleted" = false
        AND p."minStock" > 0
        AND s."onHand" <= p."minStock"
    `,
  ]);
  logProfileSection({
    logger,
    scope: "dashboard.summary",
    section: "secondaryReads",
    startedAt: secondaryReadsStartedAt,
    details: {
      storeId,
      lowStockSnapshots: lowStockSnapshots.length,
      policies: policies.length,
      forecasts: forecasts.length,
      recentMovements: recentMovements.length,
      pendingPurchaseOrders: pendingPurchaseOrders.length,
      receiptsCount: todayOrders.length,
      includeRecentActivity: options.includeRecentActivity,
      includeRecentMovements: options.includeRecentMovements,
    },
  });

  const snapshotMap = new Map(lowStockSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const policyMap = new Map(policies.map((policy) => [policy.productId, policy]));
  const forecastMap = new Map(forecasts.map((forecast) => [forecast.productId, forecast]));

  const lowStock = lowStockCandidates.flatMap((candidate) => {
    const snapshot = snapshotMap.get(candidate.snapshotId);
    if (!snapshot) {
      return [];
    }
    const policy = policyMap.get(candidate.productId) ?? null;
    const minStock = Number(candidate.minStock);
    return [
      {
        snapshot,
        product: snapshot.product,
        variant: snapshot.variant,
        minStock,
        lowStock: minStock > 0 && snapshot.onHand <= minStock,
        reorder: buildReorderSuggestion(
          snapshot,
          policy,
          forecastMap.get(snapshot.productId) ?? null,
        ),
      },
    ];
  });
  const recentActivity = options.includeRecentActivity
    ? await loadDashboardRecentActivity({
        prisma,
        logger,
        organizationId,
        storeId,
        scope: "dashboard.summary",
      })
    : [];

  return {
    business: {
      todaySalesKgs: todayOrders.reduce((sum, order) => sum + Number(order.totalKgs), 0),
      receiptsCount: todayOrders.length,
      averageReceiptKgs:
        todayOrders.length > 0
          ? todayOrders.reduce((sum, order) => sum + Number(order.totalKgs), 0) /
            todayOrders.length
          : 0,
      grossProfitKgs: (() => {
        const revenue = todayOrders.reduce((sum, order) => sum + Number(order.totalKgs), 0);
        const cost = todayOrders.reduce(
          (sum, order) =>
            sum +
            order.lines.reduce(
              (lineSum, line) => lineSum + Number(line.lineCostTotalKgs ?? 0),
              0,
            ),
          0,
        );
        return revenue > 0 || cost > 0 ? revenue - cost : null;
      })(),
      grossMarginPercent: (() => {
        const revenue = todayOrders.reduce((sum, order) => sum + Number(order.totalKgs), 0);
        const cost = todayOrders.reduce(
          (sum, order) =>
            sum +
            order.lines.reduce(
              (lineSum, line) => lineSum + Number(line.lineCostTotalKgs ?? 0),
              0,
            ),
          0,
        );
        return revenue > 0 ? ((revenue - cost) / revenue) * 100 : null;
      })(),
      openShiftsCount,
      lowStockCount: Number(lowStockCountRows[0]?.count ?? 0),
      negativeStockCount,
      missingBarcodeCount,
      missingPriceCount,
      pendingPurchaseOrdersCount,
      failedReceiptsCount,
    },
    lowStock,
    pendingPurchaseOrders,
    recentActivity,
    recentMovements,
  };
};

export const getDashboardActivity = async ({
  prisma,
  logger,
  user,
  organizationId,
  storeId,
}: {
  prisma: PrismaClient | Prisma.TransactionClient;
  logger: Logger;
  user: StoreAccessUser;
  organizationId: string;
  storeId: string;
}): Promise<DashboardActivityResult> => {
  await assertDashboardStoreAccess({
    prisma,
    logger,
    user,
    organizationId,
    storeId,
    scope: "dashboard.activity",
  });

  return {
    recentActivity: await loadDashboardRecentActivity({
      prisma,
      logger,
      organizationId,
      storeId,
      scope: "dashboard.activity",
    }),
  };
};

export const getDashboardBootstrap = async ({
  prisma,
  logger,
  user,
  organizationId,
  preferredStoreId,
  includeRecentActivity,
  includeRecentMovements,
}: {
  prisma: PrismaClient | Prisma.TransactionClient;
  logger: Logger;
  user: StoreAccessUser;
  organizationId: string;
  preferredStoreId?: string;
  includeRecentActivity?: boolean;
  includeRecentMovements?: boolean;
}) => {
  const storesLookupStartedAt = Date.now();
  const stores = (await listAccessibleStores(prisma, user)).map((store) => ({
    id: store.id,
    name: store.name,
    currencyCode: store.currencyCode,
    currencyRateKgsPerUnit: store.currencyRateKgsPerUnit,
  }));
  logProfileSection({
    logger,
    scope: "dashboard.bootstrap",
    section: "storesLookup",
    startedAt: storesLookupStartedAt,
    details: {
      storeCount: stores.length,
      hasPreferredStoreId: Boolean(preferredStoreId),
    },
  });

  const selectedStoreId =
    (preferredStoreId && stores.some((store) => store.id === preferredStoreId)
      ? preferredStoreId
      : stores[0]?.id) ?? null;

  const summary = selectedStoreId
    ? await getDashboardSummary({
        prisma,
        logger,
        user,
        organizationId,
        storeId: selectedStoreId,
        includeRecentActivity,
        includeRecentMovements,
      })
    : emptyDashboardSummary();

  return {
    stores: stores.map((store) => ({
      ...store,
      currencyRateKgsPerUnit: Number(store.currencyRateKgsPerUnit),
    })),
    selectedStoreId,
    summary,
  };
};
