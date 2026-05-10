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

type DashboardMetricRow = {
  todaySalesKgs: Prisma.Decimal | number | string | null;
  receiptsCount: bigint | number | string | null;
  todayCostKgs: Prisma.Decimal | number | string | null;
  openShiftsCount: bigint | number | string | null;
  negativeStockCount: bigint | number | string | null;
  missingBarcodeCount: bigint | number | string | null;
  missingPriceCount: bigint | number | string | null;
  pendingPurchaseOrdersCount: bigint | number | string | null;
  failedReceiptsCount: bigint | number | string | null;
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
  skipStoreAccessCheck,
}: {
  prisma: PrismaClient | Prisma.TransactionClient;
  logger: Logger;
  user: StoreAccessUser;
  organizationId: string;
  storeId: string;
  includeRecentActivity?: boolean;
  includeRecentMovements?: boolean;
  skipStoreAccessCheck?: boolean;
}): Promise<DashboardSummaryResult> => {
  const options = resolveDashboardSummaryOptions({
    includeRecentActivity,
    includeRecentMovements,
  });
  if (!skipStoreAccessCheck) {
    await assertDashboardStoreAccess({
      prisma,
      logger,
      user,
      organizationId,
      storeId,
      scope: "dashboard.summary",
    });
  }
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(todayStart.getDate() + 1);

  const lowStockCandidatesStartedAt = Date.now();
  const lowStockCandidates = await prisma.$queryRaw<
    { snapshotId: string; productId: string; minStock: number; totalCount: bigint }[]
  >`
    SELECT
      s.id AS "snapshotId",
      s."productId" AS "productId",
      p."minStock" AS "minStock",
      COUNT(*) OVER() AS "totalCount"
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
    dashboardMetricsRows,
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
    prisma.$queryRaw<DashboardMetricRow[]>`
      SELECT
        (
          SELECT COALESCE(SUM(o."totalKgs"), 0)
          FROM "CustomerOrder" o
          WHERE o."organizationId" = ${organizationId}
            AND o."storeId" = ${storeId}
            AND o.status = 'COMPLETED'
            AND o."completedAt" >= ${todayStart}
            AND o."completedAt" < ${tomorrowStart}
        ) AS "todaySalesKgs",
        (
          SELECT COUNT(*)
          FROM "CustomerOrder" o
          WHERE o."organizationId" = ${organizationId}
            AND o."storeId" = ${storeId}
            AND o.status = 'COMPLETED'
            AND o."completedAt" >= ${todayStart}
            AND o."completedAt" < ${tomorrowStart}
        ) AS "receiptsCount",
        (
          SELECT COALESCE(SUM(l."lineCostTotalKgs"), 0)
          FROM "CustomerOrderLine" l
          INNER JOIN "CustomerOrder" o
            ON o.id = l."customerOrderId"
          WHERE o."organizationId" = ${organizationId}
            AND o."storeId" = ${storeId}
            AND o.status = 'COMPLETED'
            AND o."completedAt" >= ${todayStart}
            AND o."completedAt" < ${tomorrowStart}
        ) AS "todayCostKgs",
        (
          SELECT COUNT(*)
          FROM "RegisterShift" shift
          WHERE shift."organizationId" = ${organizationId}
            AND shift."storeId" = ${storeId}
            AND shift.status = 'OPEN'
        ) AS "openShiftsCount",
        (
          SELECT COUNT(*)
          FROM "InventorySnapshot" s
          INNER JOIN "Product" pr
            ON pr.id = s."productId"
          WHERE s."storeId" = ${storeId}
            AND s."onHand" < 0
            AND pr."organizationId" = ${organizationId}
            AND pr."isDeleted" = false
        ) AS "negativeStockCount",
        (
          SELECT COUNT(*)
          FROM "Product" pr
          WHERE pr."organizationId" = ${organizationId}
            AND pr."isDeleted" = false
            AND EXISTS (
              SELECT 1
              FROM "StoreProduct" sp
              WHERE sp."productId" = pr.id
                AND sp."storeId" = ${storeId}
                AND sp."isActive" = true
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "ProductBarcode" barcode
              WHERE barcode."productId" = pr.id
            )
        ) AS "missingBarcodeCount",
        (
          SELECT COUNT(*)
          FROM "Product" pr
          WHERE pr."organizationId" = ${organizationId}
            AND pr."isDeleted" = false
            AND pr."basePriceKgs" IS NULL
            AND EXISTS (
              SELECT 1
              FROM "StoreProduct" sp
              WHERE sp."productId" = pr.id
                AND sp."storeId" = ${storeId}
                AND sp."isActive" = true
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "StorePrice" price
              WHERE price."productId" = pr.id
                AND price."storeId" = ${storeId}
                AND price."variantKey" = 'BASE'
            )
        ) AS "missingPriceCount",
        (
          SELECT COUNT(*)
          FROM "PurchaseOrder" po
          WHERE po."organizationId" = ${organizationId}
            AND po."storeId" = ${storeId}
            AND po.status IN ('SUBMITTED', 'APPROVED')
        ) AS "pendingPurchaseOrdersCount",
        (
          SELECT COUNT(*)
          FROM "FiscalReceipt" receipt
          WHERE receipt."organizationId" = ${organizationId}
            AND receipt."storeId" = ${storeId}
            AND receipt.status = 'FAILED'
        ) AS "failedReceiptsCount"
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
      receiptsCount: Number(dashboardMetricsRows[0]?.receiptsCount ?? 0),
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
  const dashboardMetrics = dashboardMetricsRows[0];
  const todaySalesKgs = Number(dashboardMetrics?.todaySalesKgs ?? 0);
  const receiptsCount = Number(dashboardMetrics?.receiptsCount ?? 0);
  const todayCostKgs = Number(dashboardMetrics?.todayCostKgs ?? 0);
  const grossProfitKgs =
    todaySalesKgs > 0 || todayCostKgs > 0 ? todaySalesKgs - todayCostKgs : null;

  return {
    business: {
      todaySalesKgs,
      receiptsCount,
      averageReceiptKgs: receiptsCount > 0 ? todaySalesKgs / receiptsCount : 0,
      grossProfitKgs,
      grossMarginPercent:
        todaySalesKgs > 0 ? ((todaySalesKgs - todayCostKgs) / todaySalesKgs) * 100 : null,
      openShiftsCount: Number(dashboardMetrics?.openShiftsCount ?? 0),
      lowStockCount: Number(lowStockCandidates[0]?.totalCount ?? 0),
      negativeStockCount: Number(dashboardMetrics?.negativeStockCount ?? 0),
      missingBarcodeCount: Number(dashboardMetrics?.missingBarcodeCount ?? 0),
      missingPriceCount: Number(dashboardMetrics?.missingPriceCount ?? 0),
      pendingPurchaseOrdersCount: Number(dashboardMetrics?.pendingPurchaseOrdersCount ?? 0),
      failedReceiptsCount: Number(dashboardMetrics?.failedReceiptsCount ?? 0),
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
        skipStoreAccessCheck: true,
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
