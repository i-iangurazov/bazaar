import { z } from "zod";

import { managerProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import {
  listCategoryTemplates,
  listTemplateCategories,
  removeCategoryTemplate,
  setCategoryTemplate,
} from "@/server/services/categoryTemplates";

export const categoryTemplatesRouter = router({
  list: managerProcedure
    .input(z.object({ category: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return await listCategoryTemplates({
        organizationId: ctx.user.organizationId,
        category: input?.category,
      });
    }),

  categories: managerProcedure.query(async ({ ctx }) => {
    return await listTemplateCategories(ctx.user.organizationId);
  }),

  set: managerProcedure
    .input(
      z.object({
        category: z.string().min(1),
        attributeKeys: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await setCategoryTemplate({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          category: input.category,
          attributeKeys: input.attributeKeys,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  remove: managerProcedure
    .input(z.object({ category: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await removeCategoryTemplate({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          category: input.category,
        });
        return { category: input.category };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
