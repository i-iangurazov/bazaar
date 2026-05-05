import { z } from "zod";

import { managerProcedure, router, type Context } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import {
  getShrinkageReport,
  getSlowMoversReport,
  getStockoutsReport,
} from "@/server/services/reports";
import {
  assertUserCanAccessStore,
  resolveAccessibleStoreIds,
  userHasAllStoreAccess,
} from "@/server/services/storeAccess";

const rangeSchema = z.object({
  storeId: z.string().optional(),
  days: z.number().min(7).max(365).optional(),
});

const resolveRange = (days?: number) => {
  const safeDays = days ?? 30;
  const to = new Date();
  const from = new Date(to.getTime() - safeDays * 24 * 60 * 60 * 1000);
  return { from, to };
};

const reportsProcedure = managerProcedure.use(async ({ ctx, next }) => {
  try {
    await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "analytics" });
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

type AuthedContext = Context & { user: NonNullable<Context["user"]> };
type StoreScope = { storeId?: string; storeIds?: string[] };

const resolveReportStoreScope = async (ctx: AuthedContext, storeId?: string): Promise<StoreScope> => {
  if (storeId) {
    await assertUserCanAccessStore(ctx.prisma, ctx.user, storeId);
    return { storeId };
  }
  if (userHasAllStoreAccess(ctx.user)) {
    return {};
  }
  return { storeIds: await resolveAccessibleStoreIds(ctx.prisma, ctx.user) };
};

export const reportsRouter = router({
  stockouts: reportsProcedure.input(rangeSchema).query(async ({ ctx, input }) => {
    try {
      const range = resolveRange(input.days);
      const storeScope = await resolveReportStoreScope(ctx, input.storeId);
      return await getStockoutsReport({
        organizationId: ctx.user.organizationId,
        ...storeScope,
        ...range,
      });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  slowMovers: reportsProcedure.input(rangeSchema).query(async ({ ctx, input }) => {
    try {
      const range = resolveRange(input.days);
      const storeScope = await resolveReportStoreScope(ctx, input.storeId);
      return await getSlowMoversReport({
        organizationId: ctx.user.organizationId,
        ...storeScope,
        ...range,
      });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  shrinkage: reportsProcedure.input(rangeSchema).query(async ({ ctx, input }) => {
    try {
      const range = resolveRange(input.days);
      const storeScope = await resolveReportStoreScope(ctx, input.storeId);
      return await getShrinkageReport({
        organizationId: ctx.user.organizationId,
        ...storeScope,
        ...range,
      });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
});
