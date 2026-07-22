import { z } from "zod";

import { managerProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { bulkUpdateStorePrices, upsertStorePrice } from "@/server/services/storePrices";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import { assertUserCanAccessStore } from "@/server/services/storeAccess";
import { assertUserCanAccessProduct } from "@/server/services/productAccess";

const storePricesProcedure = managerProcedure.use(async ({ ctx, next }) => {
  try {
    await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "storePrices" });
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

export const storePricesRouter = router({
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
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        await assertUserCanAccessProduct(ctx.prisma, ctx.user, input.productId);
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
        idempotencyKey: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await bulkUpdateStorePrices({
          storeId: input.storeId,
          filter: input.filter,
          mode: input.mode,
          value: input.value,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
