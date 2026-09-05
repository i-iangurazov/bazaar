import { z } from "zod";
import { managerProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { getBaamSalesMetrics } from "@/server/services/baamMetrics";
import { askBaam, baamAskSchema, getBaamCapabilities } from "@/server/services/baamAssistant";

export const baamRouter = router({
  capabilities: managerProcedure.query(async ({ ctx }) => {
    try {
      return await getBaamCapabilities(ctx.user.id);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  ask: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 5, prefix: "baam-ask" }))
    .input(baamAskSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await askBaam({ ...input, actorId: ctx.user.id });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  overview: managerProcedure
    .input(
      z
        .object({
          dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          storeId: z.string().min(1).optional(),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await getBaamSalesMetrics({ ...input, actorId: ctx.user.id });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
