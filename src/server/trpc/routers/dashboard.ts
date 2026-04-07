import { protectedProcedure, router } from "@/server/trpc/trpc";
import {
  getDashboardActivity,
  getDashboardBootstrap,
  getDashboardSummary,
} from "@/server/services/dashboard/summary";
import {
  dashboardActivityInputSchema,
  dashboardBootstrapInputSchema,
  dashboardSummaryInputSchema,
} from "@/server/trpc/routers/dashboard.schemas";

export const dashboardRouter = router({
  bootstrap: protectedProcedure
    .input(dashboardBootstrapInputSchema)
    .query(async ({ ctx, input }) =>
      getDashboardBootstrap({
        prisma: ctx.prisma,
        logger: ctx.logger,
        organizationId: ctx.user.organizationId,
        preferredStoreId: input?.storeId,
        includeRecentActivity: input?.includeRecentActivity,
        includeRecentMovements: input?.includeRecentMovements,
      }),
    ),

  summary: protectedProcedure
    .input(dashboardSummaryInputSchema)
    .query(async ({ ctx, input }) =>
      getDashboardSummary({
        prisma: ctx.prisma,
        logger: ctx.logger,
        organizationId: ctx.user.organizationId,
        storeId: input.storeId,
        includeRecentActivity: input.includeRecentActivity,
        includeRecentMovements: input.includeRecentMovements,
      }),
    ),

  activity: protectedProcedure
    .input(dashboardActivityInputSchema)
    .query(async ({ ctx, input }) =>
      getDashboardActivity({
        prisma: ctx.prisma,
        logger: ctx.logger,
        organizationId: ctx.user.organizationId,
        storeId: input.storeId,
      }),
    ),
});
