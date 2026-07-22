import { z } from "zod";

import { protectedProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { AppError } from "@/server/services/errors";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import { assertUserCanAccessStore } from "@/server/services/storeAccess";

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
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
      } catch (error) {
        throw toTRPCError(error);
      }
      const assignment = await ctx.prisma.storeProduct.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          productId: input.productId,
          isActive: true,
          product: { isDeleted: false },
        },
        select: { id: true },
      });
      if (!assignment) {
        throw toTRPCError(new AppError("productAccessDenied", "FORBIDDEN", 403));
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
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
      } catch (error) {
        throw toTRPCError(error);
      }
      const store = await ctx.prisma.store.findUnique({ where: { id: input.storeId } });
      if (!store) {
        return [];
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
