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
import { toTRPCError } from "@/server/trpc/errors";

export const dashboardRouter = router({
  bootstrap: protectedProcedure
    .input(dashboardBootstrapInputSchema)
    .query(async ({ ctx, input }) => {
      try {
        return await getDashboardBootstrap({
          prisma: ctx.prisma,
          logger: ctx.logger,
          user: ctx.user,
          organizationId: ctx.user.organizationId,
          preferredStoreId: input?.storeId,
          includeRecentActivity: input?.includeRecentActivity,
          includeRecentMovements: input?.includeRecentMovements,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  summary: protectedProcedure
    .input(dashboardSummaryInputSchema)
    .query(async ({ ctx, input }) => {
      try {
        return await getDashboardSummary({
          prisma: ctx.prisma,
          logger: ctx.logger,
          user: ctx.user,
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          includeRecentActivity: input.includeRecentActivity,
          includeRecentMovements: input.includeRecentMovements,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  activity: protectedProcedure
    .input(dashboardActivityInputSchema)
    .query(async ({ ctx, input }) => {
      try {
        return await getDashboardActivity({
          prisma: ctx.prisma,
          logger: ctx.logger,
          user: ctx.user,
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
