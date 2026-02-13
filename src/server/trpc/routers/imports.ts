import { z } from "zod";

import { adminProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { getImportBatch, listImportBatches, rollbackImportBatch } from "@/server/services/imports";

export const importsRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    try {
      return await listImportBatches({ organizationId: ctx.user.organizationId });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  get: adminProcedure
    .input(z.object({ batchId: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        return await getImportBatch({
          organizationId: ctx.user.organizationId,
          batchId: input.batchId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  rollback: adminProcedure
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await rollbackImportBatch({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          batchId: input.batchId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
