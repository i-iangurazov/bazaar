import { z } from "zod";
import { Role } from "@prisma/client";

import { TRPCError } from "@trpc/server";

import { protectedProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import {
  getInventoryValue,
  getSalesTrend,
  getStockoutsLowStockSeries,
  getTopProducts,
} from "@/server/services/analytics";

const storeScopeSchema = z
  .object({
    storeId: z.string().optional(),
  })
  .optional();

const ensureScope = (role: Role, storeId?: string) => {
  if (role === Role.STAFF && !storeId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
  }
};

export const analyticsRouter = router({
  salesTrend: protectedProcedure
    .input(
      z.object({
        storeId: z.string().optional(),
        rangeDays: z.number().min(7).max(365),
        granularity: z.enum(["day", "week"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      ensureScope(ctx.user.role, input.storeId);
      try {
        return await getSalesTrend({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          rangeDays: input.rangeDays,
          granularity: input.granularity,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  topProducts: protectedProcedure
    .input(
      z.object({
        storeId: z.string().optional(),
        rangeDays: z.number().min(7).max(365),
        metric: z.enum(["revenue", "units", "profit"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      ensureScope(ctx.user.role, input.storeId);
      try {
        return await getTopProducts({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          rangeDays: input.rangeDays,
          metric: input.metric,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  stockoutsLowStock: protectedProcedure
    .input(
      z.object({
        storeId: z.string().optional(),
        rangeDays: z.number().min(7).max(365),
      }),
    )
    .query(async ({ ctx, input }) => {
      ensureScope(ctx.user.role, input.storeId);
      try {
        return await getStockoutsLowStockSeries({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          rangeDays: input.rangeDays,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  inventoryValue: protectedProcedure
    .input(storeScopeSchema)
    .query(async ({ ctx, input }) => {
      const storeId = input?.storeId;
      ensureScope(ctx.user.role, storeId);
      try {
        return await getInventoryValue({
          organizationId: ctx.user.organizationId,
          storeId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
