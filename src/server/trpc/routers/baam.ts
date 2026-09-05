import { z } from "zod";
import { managerProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { getBaamSalesMetrics } from "@/server/services/baamMetrics";

export const baamRouter = router({
  overview: managerProcedure.input(z.object({
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    storeId: z.string().min(1).optional(),
  }).strict()).query(async ({ ctx, input }) => {
    try {
      return await getBaamSalesMetrics({ ...input, actorId: ctx.user.id });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
});
