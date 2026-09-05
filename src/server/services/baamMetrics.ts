import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import {
  getPlanFeatures,
  hasPlanFeature,
  resolveOrganizationAccessState,
} from "@/server/services/planLimits";
import {
  getSalesAnalyticsOverview,
  resolveSalesAnalyticsDateRange,
  type SalesAnalyticsDateInput,
} from "@/server/services/salesAnalytics";

export const BAAM_METRIC_VERSION = "completed-sales-kgs-v1";
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

// Shared by metric snapshots and post-provider authorization. This reads only
// membership, entitlements and store grants, never operational records.
export const readBaamAccessScope = async (
  tx: Prisma.TransactionClient,
  actorId: string,
  storeId?: string,
) => {
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: {
      id: true,
      organizationId: true,
      role: true,
      isActive: true,
      isOrgOwner: true,
      sessionVersion: true,
    },
  });
  if (!actor?.isActive || !actor.organizationId) {
    throw new AppError("unauthorized", "UNAUTHORIZED", 401);
  }
  if (actor.role !== "ADMIN" && actor.role !== "MANAGER") {
    throw new AppError("forbidden", "FORBIDDEN", 403);
  }
  const organization = await tx.organization.findUnique({
    where: { id: actor.organizationId },
    select: { plan: true, subscriptionStatus: true, trialEndsAt: true, currentPeriodEndsAt: true },
  });
  if (!organization || !resolveOrganizationAccessState(organization).hasAccess) {
    throw new AppError("subscriptionInactive", "FORBIDDEN", 403);
  }
  if (!hasPlanFeature(organization.plan, "analytics")) {
    throw new AppError("featureLockedAnalytics", "FORBIDDEN", 403);
  }
  const stores = await tx.store.findMany({
    where: {
      organizationId: actor.organizationId,
      ...(actor.role === "ADMIN" || actor.isOrgOwner
        ? {}
        : {
            userAccesses: { some: { userId: actor.id, organizationId: actor.organizationId } },
          }),
    },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });
  if (storeId && !stores.some((store) => store.id === storeId)) {
    throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  }
  const storeIds = storeId ? [storeId] : stores.map((store) => store.id);
  return {
    role: actor.role,
    isOrgOwner: actor.isOrgOwner,
    planFeatures: getPlanFeatures(organization.plan),
    authorizationFingerprint: createHash("sha256")
      .update(
        JSON.stringify({
          role: actor.role,
          owner: actor.isOrgOwner,
          sessionVersion: actor.sessionVersion,
          organization,
          stores: stores.map((store) => store.id),
        }),
      )
      .digest("hex"),
    actorId: actor.id,
    organizationId: actor.organizationId,
    storeIds,
    availableStores: stores,
  };
};

export const getBaamAccessScope = async (actorId: string, storeId?: string) =>
  prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return readBaamAccessScope(tx, actorId, storeId);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 },
  );

// actorId must come from the authenticated server context, never request input.
// No memoization: role, organization, subscription and store grants are read for
// every request, together with the metrics in one read-only database snapshot.
export const getBaamSalesMetrics = async (
  input: SalesAnalyticsDateInput & { actorId: string; storeId?: string },
) => {
  const range = resolveSalesAnalyticsDateRange(input);
  const queryStartedAt = new Date().toISOString();
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const access = await readBaamAccessScope(tx, input.actorId, input.storeId);
      const { storeIds, availableStores: stores } = access;
      const scope = { organizationId: access.organizationId, storeIds };
      const report = await getSalesAnalyticsOverview({ ...scope, ...range }, tx);
      const totals = report.totals;
      const paymentsKgs = money(
        Object.values(totals.paymentBreakdown).reduce((sum, value) => sum + value, 0),
      );
      const refundsKgs = money(
        Object.values(totals.refundBreakdown).reduce((sum, value) => sum + value, 0),
      );
      const salesDifferenceKgs = money(paymentsKgs - totals.grossSalesKgs);
      const refundsDifferenceKgs = money(refundsKgs - totals.returnsKgs);
      const queryHash = createHash("sha256")
        .update(
          JSON.stringify({
            version: BAAM_METRIC_VERSION,
            ...scope,
            fromUtc: range.fromUtc.toISOString(),
            toUtcExclusive: range.toUtcExclusive.toISOString(),
          }),
        )
        .digest("hex");
      return {
        version: BAAM_METRIC_VERSION,
        queryHash,
        audience: { actorId: access.actorId },
        scope: { ...scope, availableStores: stores },
        period: {
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
          timeZone: range.timeZone,
          fromUtc: range.fromUtc.toISOString(),
          toUtcExclusive: range.toUtcExclusive.toISOString(),
        },
        currency: "KGS" as const,
        totals: {
          salesBeforeReturnsKgs: totals.grossSalesKgs,
          returnsKgs: totals.returnsKgs,
          netSalesKgs: totals.netSalesKgs,
          recordedDiscountKgs: totals.discountKgs,
          receiptCount: totals.receiptCount,
          returnCount: totals.returnCount,
          averageReceiptKgs: totals.receiptCount ? totals.averageReceiptKgs : null,
          paymentBreakdown: totals.paymentBreakdown,
          refundBreakdown: totals.refundBreakdown,
        },
        days: report.series.map((day) => ({
          date: day.date,
          salesBeforeReturnsKgs: day.grossSalesKgs,
          returnsKgs: day.returnsKgs,
          netSalesKgs: day.netSalesKgs,
          receiptCount: day.receiptCount,
          returnCount: day.returnCount,
          recordedDiscountKgs: day.discountKgs,
          averageReceiptKgs: day.receiptCount ? day.averageReceiptKgs : null,
        })),
        freshness: {
          queryStartedAt,
          queriedAt: new Date().toISOString(),
          cache: "bypassed" as const,
          isolation: "repeatable_read" as const,
          sourceCompleteThrough: null,
          sourceCompleteness: "unknown" as const,
        },
        quality: {
          qualifyingRecords: totals.receiptCount + totals.returnCount,
          emptyAccessibleStoreSet: storeIds.length === 0,
          salesDifferenceKgs,
          refundsDifferenceKgs,
          paymentsReconcile: salesDifferenceKgs === 0 && refundsDifferenceKgs === 0,
          zeroMeaning: "no_qualifying_value_in_snapshot" as const,
        },
        policy: {
          sales: "completed_nonheld_pos_orders_after_recorded_discounts" as const,
          returns: "completed_returns_by_own_completion_date" as const,
          dateWindow: "business_dates_inclusive_utc_half_open" as const,
          exclusions: [
            "profit",
            "tax",
            "inventory",
            "all_channel_revenue",
            "source_completeness",
          ] as const,
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 },
  );
};
