import { protectedProcedure, router } from "@/server/trpc/trpc";
import { searchGlobal } from "@/server/services/search/global";
import { searchGlobalInputSchema } from "@/server/trpc/routers/search.schemas";

export const searchRouter = router({
  global: protectedProcedure
    .input(searchGlobalInputSchema)
    .query(async ({ ctx, input }) =>
      searchGlobal({
        prisma: ctx.prisma,
        organizationId: ctx.user.organizationId,
        rawQuery: input.q,
        logger: ctx.logger,
      }),
    ),
});
