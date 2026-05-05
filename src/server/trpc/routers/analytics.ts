import { z } from "zod";
import { protectedProcedure, router, type Context } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import {
  getInventoryValue,
  getSalesTrend,
  getStockoutsLowStockSeries,
  getTopProducts,
} from "@/server/services/analytics";
import {
  assertUserCanAccessStore,
  resolveAccessibleStoreIds,
  userHasAllStoreAccess,
} from "@/server/services/storeAccess";

const storeScopeSchema = z
  .object({
    storeId: z.string().optional(),
  })
  .optional();

type AuthedContext = Context & { user: NonNullable<Context["user"]> };
type StoreScope = { storeId?: string; storeIds?: string[] };

const resolveAnalyticsStoreScope = async (
  ctx: AuthedContext,
  storeId?: string,
): Promise<StoreScope> => {
  if (storeId) {
    await assertUserCanAccessStore(ctx.prisma, ctx.user, storeId);
    return { storeId };
  }
  if (userHasAllStoreAccess(ctx.user)) {
    return {};
  }
  return { storeIds: await resolveAccessibleStoreIds(ctx.prisma, ctx.user) };
};

export const analyticsRouter = router({
  salesTrend: protectedProcedure
    .input(
      z.object({
        storeId: z.string().optional(),
        rangeDays: z.number().min(7).max(365),
        granularity: z.enum(["day", "week"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "analytics" });
        const storeScope = await resolveAnalyticsStoreScope(ctx, input.storeId);
        return await getSalesTrend({
          organizationId: ctx.user.organizationId,
          ...storeScope,
          rangeDays: input.rangeDays,
          granularity: input.granularity,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  topProducts: protectedProcedure
    .input(
      z.object({
        storeId: z.string().optional(),
        rangeDays: z.number().min(7).max(365),
        metric: z.enum(["revenue", "units", "profit"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "analytics" });
        const storeScope = await resolveAnalyticsStoreScope(ctx, input.storeId);
        return await getTopProducts({
          organizationId: ctx.user.organizationId,
          ...storeScope,
          rangeDays: input.rangeDays,
          metric: input.metric,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  stockoutsLowStock: protectedProcedure
    .input(
      z.object({
        storeId: z.string().optional(),
        rangeDays: z.number().min(7).max(365),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "analytics" });
        const storeScope = await resolveAnalyticsStoreScope(ctx, input.storeId);
        return await getStockoutsLowStockSeries({
          organizationId: ctx.user.organizationId,
          ...storeScope,
          rangeDays: input.rangeDays,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  inventoryValue: protectedProcedure
    .input(storeScopeSchema)
    .query(async ({ ctx, input }) => {
      const storeId = input?.storeId;
      try {
        await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "analytics" });
        const storeScope = await resolveAnalyticsStoreScope(ctx, storeId);
        return await getInventoryValue({
          organizationId: ctx.user.organizationId,
          ...storeScope,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
