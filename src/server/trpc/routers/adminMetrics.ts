import { z } from "zod";

import { adminProcedure, router } from "@/server/trpc/trpc";
import { withReportRead } from "@/server/services/reporting/access";
import { toTRPCError } from "@/server/trpc/errors";
import {
  adminMetricsSortDirections,
  adminMetricsSortKeys,
  adminMetricsWarningFilters,
  getAdminMetrics,
} from "@/server/services/adminMetrics";

const adminMetricsInputSchema = z
  .object({
    storeId: z.string().trim().min(1).nullable().optional(),
    category: z.string().trim().min(1).nullable().optional(),
    search: z.string().trim().max(200).nullable().optional(),
    includeArchived: z.boolean().optional(),
    warning: z.enum(adminMetricsWarningFilters).optional(),
    sortKey: z.enum(adminMetricsSortKeys).optional(),
    sortDirection: z.enum(adminMetricsSortDirections).optional(),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(10).max(100).optional(),
  })
  .optional();

export const adminMetricsRouter = router({
  get: adminProcedure.input(adminMetricsInputSchema).query(async ({ ctx, input }) => {
    try {
      return await withReportRead(
        ctx.user,
        { adminOnly: true, requireAnalytics: false, storeId: input?.storeId ?? undefined },
        (tx) => getAdminMetrics({ ...input, organizationId: ctx.user.organizationId }, tx),
      );
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  export: adminProcedure
    .input(
      adminMetricsInputSchema
        .unwrap()
        .extend({ view: z.enum(["products", "stores", "categories"]).optional() })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await withReportRead(
          ctx.user,
          {
            adminOnly: true,
            requireAnalytics: false,
            export: true,
            storeId: input?.storeId ?? undefined,
          },
          (tx) =>
            getAdminMetrics({ ...input, organizationId: ctx.user.organizationId }, tx, {
              exportAll: true,
              exportView: input.view,
            }),
        );
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
