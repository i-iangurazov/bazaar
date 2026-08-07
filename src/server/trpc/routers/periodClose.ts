import { z } from "zod";

import { managerProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { closePeriod, listPeriodCloses } from "@/server/services/periodClose";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import {
  assertUserCanAccessStore,
  resolveAccessibleStoreIds,
  userHasAllStoreAccess,
} from "@/server/services/storeAccess";

const periodCloseProcedure = managerProcedure.use(async ({ ctx, next }) => {
  try {
    await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "periodClose" });
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

const closeSchema = z.object({
  storeId: z.string(),
  periodStart: z.date(),
  periodEnd: z.date(),
});

export const periodCloseRouter = router({
  list: periodCloseProcedure
    .input(
      z
        .object({
          storeId: z.string().optional(),
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(10).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        const page = input?.page ?? 1;
        const pageSize = input?.pageSize ?? 25;
        if (input?.storeId) {
          await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
          return await listPeriodCloses(
            ctx.user.organizationId,
            input.storeId,
            undefined,
            page,
            pageSize,
          );
        }
        const storeIds = userHasAllStoreAccess(ctx.user)
          ? undefined
          : await resolveAccessibleStoreIds(ctx.prisma, ctx.user);
        return await listPeriodCloses(ctx.user.organizationId, undefined, storeIds, page, pageSize);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  close: periodCloseProcedure.input(closeSchema).mutation(async ({ ctx, input }) => {
    try {
      await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
      return await closePeriod({
        organizationId: ctx.user.organizationId,
        storeId: input.storeId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        closedById: ctx.user.id,
        requestId: ctx.requestId,
      });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
});
