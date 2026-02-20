import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { assertFeatureEnabled } from "@/server/services/planLimits";

const stockLotsProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  try {
    await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "expiryLots" });
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

export const stockLotsRouter = router({
  byProduct: stockLotsProcedure
    .input(
      z.object({
        storeId: z.string(),
        productId: z.string(),
        variantId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const store = await ctx.prisma.store.findUnique({ where: { id: input.storeId } });
      if (!store || store.organizationId !== ctx.user.organizationId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "storeAccessDenied" });
      }
      const product = await ctx.prisma.product.findUnique({ where: { id: input.productId } });
      if (!product || product.organizationId !== ctx.user.organizationId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "productAccessDenied" });
      }

      return ctx.prisma.stockLot.findMany({
        where: {
          storeId: input.storeId,
          productId: input.productId,
          ...(input.variantId ? { variantId: input.variantId } : {}),
        },
        orderBy: [{ expiryDate: "asc" }, { updatedAt: "desc" }],
      });
    }),

  expiringSoon: stockLotsProcedure
    .input(z.object({ storeId: z.string(), days: z.number().int().min(1).max(365) }))
    .query(async ({ ctx, input }) => {
      const store = await ctx.prisma.store.findUnique({ where: { id: input.storeId } });
      if (!store || store.organizationId !== ctx.user.organizationId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "storeAccessDenied" });
      }
      if (!store.trackExpiryLots) {
        return [];
      }

      const now = new Date();
      const cutoff = new Date(now.getTime() + input.days * 24 * 60 * 60 * 1000);

      return ctx.prisma.stockLot.findMany({
        where: {
          storeId: input.storeId,
          expiryDate: { not: null, lte: cutoff, gte: now },
        },
        include: { product: true, variant: true },
        orderBy: { expiryDate: "asc" },
        take: 10,
      });
    }),
});
