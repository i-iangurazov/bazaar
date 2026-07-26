import { z } from "zod";

import { managerProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { bulkUpdateStorePrices, upsertStorePrice } from "@/server/services/storePrices";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import {
  applyCatalogDiscountInputSchema,
  previewCatalogDiscountInputSchema,
  removeCatalogDiscountInputSchema,
} from "@/lib/catalogDiscountContract";
import {
  applyCatalogDiscount,
  previewCatalogDiscount,
  removeCatalogDiscount,
} from "@/server/services/catalogDiscounts";
import { assertUserCanAccessStore } from "@/server/services/storeAccess";

const storePricesProcedure = managerProcedure.use(async ({ ctx, next }) => {
  try {
    await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "storePrices" });
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

export const storePricesRouter = router({
  previewDiscount: storePricesProcedure
    .input(previewCatalogDiscountInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await previewCatalogDiscount({ user: ctx.user, discount: input });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  applyDiscount: storePricesProcedure
    .input(applyCatalogDiscountInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await applyCatalogDiscount({
          user: ctx.user,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          discount: input,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  removeDiscount: storePricesProcedure
    .input(removeCatalogDiscountInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await removeCatalogDiscount({
          user: ctx.user,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          discount: input,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  discountVariants: storePricesProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
        productIds: z.array(z.string().min(1)).min(1).max(5_000),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        const productIds = Array.from(new Set(input.productIds));
        const products = await ctx.prisma.product.findMany({
          where: {
            id: { in: productIds },
            organizationId: ctx.user.organizationId,
            isDeleted: false,
            storeProducts: { some: { storeId: input.storeId, isActive: true } },
          },
          select: {
            id: true,
            name: true,
            variants: {
              where: { isActive: true },
              select: { id: true, name: true, sku: true },
              orderBy: [{ name: "asc" }, { id: "asc" }],
            },
          },
          orderBy: { name: "asc" },
        });
        if (products.length !== productIds.length) {
          throw new Error("catalogDiscountProductScopeMismatch");
        }
        return products.flatMap((product) =>
          product.variants.map((variant) => ({
            id: variant.id,
            productId: product.id,
            label: `${product.name} — ${variant.name?.trim() || variant.sku?.trim() || variant.id.slice(0, 8)}`,
          })),
        );
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  upsert: storePricesProcedure
    .input(
      z.object({
        storeId: z.string(),
        productId: z.string(),
        variantId: z.string().optional().nullable(),
        priceKgs: z.number().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await upsertStorePrice({
          storeId: input.storeId,
          productId: input.productId,
          variantId: input.variantId ?? undefined,
          priceKgs: input.priceKgs,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  bulkUpdate: storePricesProcedure
    .input(
      z.object({
        storeId: z.string(),
        filter: z
          .object({
            search: z.string().optional(),
            category: z.string().optional(),
            type: z.enum(["all", "product", "bundle"]).optional(),
            includeArchived: z.boolean().optional(),
          })
          .optional(),
        mode: z.enum(["set", "increasePct", "increaseAbs"]),
        value: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await bulkUpdateStorePrices({
          storeId: input.storeId,
          filter: input.filter,
          mode: input.mode,
          value: input.value,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
