import { z } from "zod";

import { managerProcedure, protectedProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { createUnit, listUnits, removeUnit, updateUnit } from "@/server/services/units";

export const unitsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return listUnits(ctx.user.organizationId);
  }),

  create: managerProcedure
    .input(
      z.object({
        code: z.string().trim().min(1),
        labelRu: z.string().trim().min(1),
        labelKg: z.string().trim().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createUnit({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          code: input.code,
          labelRu: input.labelRu,
          labelKg: input.labelKg,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  update: managerProcedure
    .input(
      z.object({
        unitId: z.string().trim().min(1),
        labelRu: z.string().trim().min(1),
        labelKg: z.string().trim().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateUnit({
          unitId: input.unitId,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          labelRu: input.labelRu,
          labelKg: input.labelKg,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  remove: managerProcedure
    .input(z.object({ unitId: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await removeUnit({
          unitId: input.unitId,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
