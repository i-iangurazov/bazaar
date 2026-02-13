import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "@/server/trpc/trpc";
import { buildReorderSuggestion } from "@/server/services/reorderSuggestions";
import { enrichRecentActivity } from "@/server/services/activity";

export const dashboardRouter = router({
  summary: protectedProcedure
    .input(z.object({ storeId: z.string() }))
    .query(async ({ ctx, input }) => {
      const asRecord = (value: Prisma.JsonValue | null): Record<string, unknown> | null => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return null;
        }
        return value as Record<string, unknown>;
      };

      const getStoreIdFromLog = (
        log: { entity: string; entityId: string; before: Prisma.JsonValue | null; after: Prisma.JsonValue | null },
        purchaseOrderStoreMap: Map<string, string>,
      ): string | null => {
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

      const store = await ctx.prisma.store.findUnique({ where: { id: input.storeId } });
      if (!store || store.organizationId !== ctx.user.organizationId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "storeAccessDenied" });
      }

      const lowStockCandidates = await ctx.prisma.$queryRaw<
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
        WHERE s."storeId" = ${input.storeId}
          AND pr."isDeleted" = false
          AND p."minStock" > 0
          AND s."onHand" <= p."minStock"
        ORDER BY s."updatedAt" DESC
        LIMIT 5
      `;

      const lowStockSnapshotIds = lowStockCandidates.map((item) => item.snapshotId);
      const lowStockProductIds = Array.from(
        new Set(lowStockCandidates.map((item) => item.productId)),
      );

      const [
        lowStockSnapshots,
        policies,
        forecasts,
        recentMovements,
        pendingPurchaseOrders,
        recentActivityLogsRaw,
      ] =
        await Promise.all([
          lowStockSnapshotIds.length
            ? ctx.prisma.inventorySnapshot.findMany({
                where: { id: { in: lowStockSnapshotIds } },
                include: { product: true, variant: true },
              })
            : Promise.resolve([]),
          lowStockProductIds.length
            ? ctx.prisma.reorderPolicy.findMany({
                where: { storeId: input.storeId, productId: { in: lowStockProductIds } },
              })
            : Promise.resolve([]),
          lowStockProductIds.length
            ? ctx.prisma.forecastSnapshot.findMany({
                where: { storeId: input.storeId, productId: { in: lowStockProductIds } },
                orderBy: { generatedAt: "desc" },
                distinct: ["productId"],
              })
            : Promise.resolve([]),
          ctx.prisma.stockMovement.findMany({
            where: { storeId: input.storeId },
            include: {
              product: true,
              variant: true,
              createdBy: { select: { name: true, email: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 8,
          }),
          ctx.prisma.purchaseOrder.findMany({
            where: {
              organizationId: ctx.user.organizationId,
              storeId: input.storeId,
              status: { in: ["SUBMITTED", "APPROVED"] },
            },
            include: { supplier: true },
            orderBy: { createdAt: "desc" },
            take: 5,
          }),
          ctx.prisma.auditLog.findMany({
            where: { organizationId: ctx.user.organizationId },
            include: {
              actor: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
            orderBy: { createdAt: "desc" },
            take: 40,
          }),
        ]);

      const activityPurchaseOrderIds = Array.from(
        new Set(
          recentActivityLogsRaw
            .filter((log) => log.entity === "PurchaseOrder")
            .map((log) => log.entityId),
        ),
      );
      const activityPurchaseOrders = activityPurchaseOrderIds.length
        ? await ctx.prisma.purchaseOrder.findMany({
            where: { id: { in: activityPurchaseOrderIds } },
            select: { id: true, storeId: true },
          })
        : [];
      const activityPurchaseOrderStoreMap = new Map(
        activityPurchaseOrders.map((order) => [order.id, order.storeId]),
      );

      const recentActivityLogs = recentActivityLogsRaw
        .filter(
          (log) => getStoreIdFromLog(log, activityPurchaseOrderStoreMap) === input.storeId,
        )
        .slice(0, 8);

      const snapshotMap = new Map(
        lowStockSnapshots.map((snapshot) => [snapshot.id, snapshot]),
      );
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

      const recentActivity = await enrichRecentActivity(ctx.prisma, recentActivityLogs);

      return { lowStock, pendingPurchaseOrders, recentActivity, recentMovements };
    }),
});
