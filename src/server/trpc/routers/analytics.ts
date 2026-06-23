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
  getSalesAnalyticsDayDetail,
  getSalesAnalyticsFilterOptions,
  getSalesAnalyticsOverview,
  getSoldProductsAnalytics,
  listSalesAnalyticsReceipts,
  type SalesAnalyticsScope,
} from "@/server/services/salesAnalytics";
import { AppError } from "@/server/services/errors";
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

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const salesAnalyticsBaseInput = z.object({
  storeId: z.string().optional(),
  registerId: z.string().optional(),
  cashierId: z.string().optional(),
  dateFrom: dateOnlySchema,
  dateTo: dateOnlySchema,
});

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

const assertAnalyticsRegisterScope = async (
  ctx: AuthedContext,
  input: { registerId?: string; storeId?: string },
) => {
  if (!input.registerId) {
    return;
  }
  const register = await ctx.prisma.posRegister.findFirst({
    where: {
      id: input.registerId,
      organizationId: ctx.user.organizationId,
    },
    select: {
      id: true,
      storeId: true,
    },
  });
  if (!register) {
    throw new AppError("posRegisterNotFound", "NOT_FOUND", 404);
  }
  await assertUserCanAccessStore(ctx.prisma, ctx.user, register.storeId);
  if (input.storeId && input.storeId !== register.storeId) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
};

const assertAnalyticsCashierScope = async (ctx: AuthedContext, cashierId?: string) => {
  if (!cashierId) {
    return;
  }
  const cashier = await ctx.prisma.user.findFirst({
    where: {
      id: cashierId,
      organizationId: ctx.user.organizationId,
      isActive: true,
    },
    select: { id: true },
  });
  if (!cashier) {
    throw new AppError("userNotFound", "NOT_FOUND", 404);
  }
};

const resolveSalesAnalyticsScope = async (
  ctx: AuthedContext,
  input: { storeId?: string; registerId?: string; cashierId?: string },
): Promise<SalesAnalyticsScope> => {
  await assertAnalyticsRegisterScope(ctx, input);
  await assertAnalyticsCashierScope(ctx, input.cashierId);
  const storeScope = await resolveAnalyticsStoreScope(ctx, input.storeId);
  return {
    organizationId: ctx.user.organizationId,
    ...storeScope,
    registerId: input.registerId,
    cashierId: input.cashierId,
  };
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
  salesOverview: protectedProcedure
    .input(salesAnalyticsBaseInput)
    .query(async ({ ctx, input }) => {
      try {
        await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "analytics" });
        const scope = await resolveSalesAnalyticsScope(ctx, input);
        return await getSalesAnalyticsOverview({
          ...scope,
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  salesFilterOptions: protectedProcedure
    .input(salesAnalyticsBaseInput)
    .query(async ({ ctx, input }) => {
      try {
        await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "analytics" });
        const scope = await resolveSalesAnalyticsScope(ctx, input);
        return await getSalesAnalyticsFilterOptions({
          ...scope,
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  soldProducts: protectedProcedure
    .input(
      salesAnalyticsBaseInput.extend({
        category: z.string().optional(),
        search: z.string().optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "analytics" });
        const scope = await resolveSalesAnalyticsScope(ctx, input);
        return await getSoldProductsAnalytics({
          ...scope,
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          category: input.category?.trim() || undefined,
          search: input.search?.trim() || undefined,
          page: input.page,
          pageSize: input.pageSize,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  salesDayDetail: protectedProcedure
    .input(
      z.object({
        storeId: z.string().optional(),
        registerId: z.string().optional(),
        cashierId: z.string().optional(),
        date: dateOnlySchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "analytics" });
        const scope = await resolveSalesAnalyticsScope(ctx, input);
        return await getSalesAnalyticsDayDetail({
          ...scope,
          date: input.date,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  productReceipts: protectedProcedure
    .input(
      salesAnalyticsBaseInput.extend({
        productId: z.string().min(1),
        variantKey: z.string().optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "analytics" });
        const scope = await resolveSalesAnalyticsScope(ctx, input);
        return await listSalesAnalyticsReceipts({
          ...scope,
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          productId: input.productId,
          variantKey: input.variantKey,
          page: input.page,
          pageSize: input.pageSize,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
