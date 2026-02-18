import { prisma } from "@/server/db/prisma";
import type { ProductEventType } from "@/server/services/productEvents";

const FIRST_VALUE_EVENTS: ProductEventType[] = [
  "first_product_created",
  "first_import_completed",
  "first_po_created",
  "first_po_received",
  "first_price_tags_printed",
];

export const getAdminMetrics = async (input: { organizationId: string }) => {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    onboardingProgress,
    onboardingStarted,
    firstValue,
    wauUsers,
    adjustments30d,
    stockoutsCurrent,
    completedSales7d,
    completedSales30d,
    completedReturns30d,
    salesLines30d,
    poPipelineRaw,
    kkmNotSentCount,
    kkmFailedCount,
    fiscalQueueRaw,
    topStockouts,
  ] = await Promise.all([
    prisma.onboardingProgress.findUnique({
      where: { organizationId: input.organizationId },
      select: { completedAt: true },
    }),

    prisma.productEvent.findFirst({
      where: { organizationId: input.organizationId, type: "onboarding_started" },
      orderBy: { createdAt: "asc" },
    }),

    prisma.productEvent.findFirst({
      where: { organizationId: input.organizationId, type: { in: FIRST_VALUE_EVENTS } },
      orderBy: { createdAt: "asc" },
    }),

    prisma.productEvent.groupBy({
      by: ["actorId"],
      where: {
        organizationId: input.organizationId,
        actorId: { not: null },
        createdAt: { gte: sevenDaysAgo },
      },
    }),

    prisma.stockMovement.count({
      where: {
        store: { organizationId: input.organizationId },
        type: "ADJUSTMENT",
        createdAt: { gte: thirtyDaysAgo },
      },
    }),

    prisma.inventorySnapshot.count({
      where: {
        store: { organizationId: input.organizationId },
        onHand: { lte: 0 },
      },
    }),

    prisma.customerOrder.aggregate({
      where: {
        organizationId: input.organizationId,
        status: "COMPLETED",
        createdAt: { gte: sevenDaysAgo },
      },
      _count: { _all: true },
      _sum: { totalKgs: true },
    }),

    prisma.customerOrder.aggregate({
      where: {
        organizationId: input.organizationId,
        status: "COMPLETED",
        createdAt: { gte: thirtyDaysAgo },
      },
      _count: { _all: true },
      _sum: { totalKgs: true },
    }),

    prisma.saleReturn.aggregate({
      where: {
        organizationId: input.organizationId,
        status: "COMPLETED",
        createdAt: { gte: thirtyDaysAgo },
      },
      _count: { _all: true },
      _sum: { totalKgs: true },
    }),

    prisma.customerOrderLine.aggregate({
      where: {
        customerOrder: {
          organizationId: input.organizationId,
          status: "COMPLETED",
          createdAt: { gte: thirtyDaysAgo },
        },
      },
      _sum: {
        lineTotalKgs: true,
        lineCostTotalKgs: true,
      },
    }),

    prisma.purchaseOrder.groupBy({
      by: ["status"],
      where: {
        organizationId: input.organizationId,
        status: {
          in: ["SUBMITTED", "APPROVED", "PARTIALLY_RECEIVED"],
        },
      },
      _count: { _all: true },
    }),

    prisma.customerOrder.count({
      where: {
        organizationId: input.organizationId,
        isPosSale: true,
        status: "COMPLETED",
        kkmStatus: "NOT_SENT",
        store: {
          complianceProfile: {
            is: { enableKkm: true },
          },
        },
      },
    }),

    prisma.customerOrder.count({
      where: {
        organizationId: input.organizationId,
        isPosSale: true,
        status: "COMPLETED",
        kkmStatus: "FAILED",
        store: {
          complianceProfile: {
            is: { enableKkm: true },
          },
        },
      },
    }),

    prisma.fiscalReceipt.groupBy({
      by: ["status"],
      where: {
        organizationId: input.organizationId,
      },
      _count: { _all: true },
    }),

    prisma.inventorySnapshot.findMany({
      where: {
        store: { organizationId: input.organizationId },
        onHand: { lte: 0 },
      },
      orderBy: [{ onHand: "asc" }, { updatedAt: "desc" }],
      take: 5,
      select: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
        store: {
          select: {
            id: true,
            name: true,
          },
        },
        onHand: true,
      },
    }),
  ]);

  const timeToFirstValueHours =
    onboardingStarted && firstValue
      ? (firstValue.createdAt.getTime() - onboardingStarted.createdAt.getTime()) / (1000 * 60 * 60)
      : null;

  const sales30dRevenue = Number(completedSales30d._sum.totalKgs ?? 0);
  const returns30dAmount = Number(completedReturns30d._sum.totalKgs ?? 0);
  const returns30dCount = completedReturns30d._count._all;
  const sales30dCount = completedSales30d._count._all;

  const grossRevenue30d = Number(salesLines30d._sum.lineTotalKgs ?? 0);
  const grossCost30d = Number(salesLines30d._sum.lineCostTotalKgs ?? 0);
  const grossProfit30d = grossRevenue30d - grossCost30d;
  const grossMargin30dPercent =
    grossRevenue30d > 0 ? (grossProfit30d / grossRevenue30d) * 100 : null;

  const poPipeline = {
    submitted: poPipelineRaw.find((row) => row.status === "SUBMITTED")?._count._all ?? 0,
    approved: poPipelineRaw.find((row) => row.status === "APPROVED")?._count._all ?? 0,
    partiallyReceived:
      poPipelineRaw.find((row) => row.status === "PARTIALLY_RECEIVED")?._count._all ?? 0,
  };

  const fiscalQueue = {
    queued: fiscalQueueRaw.find((row) => row.status === "QUEUED")?._count._all ?? 0,
    processing: fiscalQueueRaw.find((row) => row.status === "PROCESSING")?._count._all ?? 0,
    failed: fiscalQueueRaw.find((row) => row.status === "FAILED")?._count._all ?? 0,
  };

  return {
    onboardingCompleted: Boolean(onboardingProgress?.completedAt),
    onboardingCompletedAt: onboardingProgress?.completedAt ?? null,
    onboardingStartedAt: onboardingStarted?.createdAt ?? null,
    firstValueAt: firstValue?.createdAt ?? null,
    firstValueType: firstValue?.type ?? null,
    timeToFirstValueHours,
    weeklyActiveUsers: wauUsers.length,
    adjustments30d,
    stockoutsCurrent,
    sales7d: {
      orders: completedSales7d._count._all,
      revenueKgs: Number(completedSales7d._sum.totalKgs ?? 0),
    },
    sales30d: {
      orders: sales30dCount,
      revenueKgs: sales30dRevenue,
    },
    returns30d: {
      orders: returns30dCount,
      amountKgs: returns30dAmount,
      refundRatePercent: sales30dCount > 0 ? (returns30dCount / sales30dCount) * 100 : 0,
    },
    gross30d: {
      revenueKgs: grossRevenue30d,
      costKgs: grossCost30d,
      profitKgs: grossProfit30d,
      marginPercent: grossMargin30dPercent,
    },
    poPipeline,
    kkmHealth: {
      notSentOrders: kkmNotSentCount,
      failedOrders: kkmFailedCount,
      fiscalQueued: fiscalQueue.queued,
      fiscalProcessing: fiscalQueue.processing,
      fiscalFailed: fiscalQueue.failed,
    },
    topStockouts: topStockouts.map((item) => ({
      productId: item.product.id,
      productName: item.product.name,
      productSku: item.product.sku,
      storeId: item.store.id,
      storeName: item.store.name,
      onHand: item.onHand,
    })),
  };
};
