import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "@/server/trpc/trpc";
import { buildDailySeries, forecastDemand } from "@/server/services/forecasting";
import { subDays } from "@/server/services/time";
import { assertUserCanAccessStore } from "@/server/services/storeAccess";
import { toTRPCError } from "@/server/trpc/errors";

export const forecastRouter = router({
  explain: protectedProcedure
    .input(
      z.object({
        storeId: z.string(),
        productId: z.string(),
        windowDays: z.number().int().min(7).max(90).default(30),
        horizonDays: z.number().int().min(7).max(60).default(14),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Membership in the organization does not grant access to every store.
      // Authorize before reading either the product or its sales movements.
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
      } catch (error) {
        throw toTRPCError(error);
      }
      const product = await ctx.prisma.product.findFirst({
        where: { id: input.productId, organizationId: ctx.user.organizationId },
        select: { id: true, organizationId: true },
      });
      if (!product || product.organizationId !== ctx.user.organizationId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "productAccessDenied" });
      }

      const start = subDays(new Date(), input.windowDays);
      const movements = await ctx.prisma.stockMovement.findMany({
        where: {
          storeId: input.storeId,
          productId: input.productId,
          type: "SALE",
          createdAt: { gte: start },
        },
        orderBy: { createdAt: "asc" },
      });

      const dailySales = buildDailySeries(
        movements.map((movement) => ({
          date: movement.createdAt,
          qty: Math.abs(movement.qtyDelta),
        })),
        input.windowDays,
      );

      const forecast = forecastDemand({
        dailySales,
        horizonDays: input.horizonDays,
        windowDays: input.windowDays,
      });

      return {
        ...forecast,
        dailySales,
      };
    }),
});
