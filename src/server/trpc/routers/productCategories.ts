import { z } from "zod";

import {
  adminOrOrgOwnerProcedure,
  managerProcedure,
  protectedProcedure,
  router,
} from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import {
  createProductCategory,
  listProductCategories,
  listStoreProductCategories,
  removeProductCategory,
  updateStoreProductCategoryPreference,
} from "@/server/services/productCategories";
import { assertUserCanAccessStore } from "@/server/services/storeAccess";

export const productCategoriesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return listProductCategories(ctx.user.organizationId);
  }),

  listForStore: protectedProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
        includeHidden: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await listStoreProductCategories({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          includeHidden: input.includeHidden,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  create: managerProcedure
    .input(
      z.object({
        name: z.string().min(1),
        storeId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (input.storeId) {
          await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        }
        return await createProductCategory({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          name: input.name,
          storeId: input.storeId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  remove: managerProcedure
    .input(
      z.object({
        name: z.string().min(1),
        storeId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (input.storeId) {
          await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        }
        return await removeProductCategory({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          name: input.name,
          storeId: input.storeId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  setStoreVisibility: adminOrOrgOwnerProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
        name: z.string().min(1),
        isVisibleInForms: z.boolean().optional(),
        isArchived: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await updateStoreProductCategoryPreference({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          name: input.name,
          isVisibleInForms: input.isVisibleInForms,
          isArchived: input.isArchived,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
