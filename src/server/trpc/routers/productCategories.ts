import { z } from "zod";

import { adminProcedure, protectedProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import {
  createProductCategory,
  listProductCategories,
  removeProductCategory,
} from "@/server/services/productCategories";

export const productCategoriesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return listProductCategories(ctx.user.organizationId);
  }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createProductCategory({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          name: input.name,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  remove: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await removeProductCategory({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          name: input.name,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
