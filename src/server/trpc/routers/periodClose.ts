import { z } from "zod";

import { managerProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { closePeriod, listPeriodCloses } from "@/server/services/periodClose";
import { assertFeatureEnabled } from "@/server/services/planLimits";

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
    .input(z.object({ storeId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        return await listPeriodCloses(ctx.user.organizationId, input?.storeId);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  close: periodCloseProcedure.input(closeSchema).mutation(async ({ ctx, input }) => {
    try {
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
