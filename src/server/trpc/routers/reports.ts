import { z } from "zod";
import {
  withReportRead,
  assertReportEntities,
  reportFilterOptions,
} from "@/server/services/reporting/access";
import { getSalesReport, reportViews } from "@/server/services/reporting/sales";
import { getOperationsReport, operationViews } from "@/server/services/reporting/operations";

import { businessDateOnlyEndUtc, businessDateOnlyToUtc } from "@/lib/timezone";
import { managerProcedure, router, type Context } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import {
  getShrinkageReport,
  getSlowMoversReport,
  getStockoutsReport,
} from "@/server/services/reports";
import {
  assertUserCanAccessStore,
  resolveAccessibleStoreIds,
  userHasAllStoreAccess,
} from "@/server/services/storeAccess";

const rangeSchema = z.object({
  storeId: z.string().optional(),
  days: z.number().min(7).max(365).optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(10).max(100).optional(),
});

const periodSchema = z.object({
  storeId: z.string().trim().min(1).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  search: z.string().trim().max(200).optional(),
  page: z.number().int().min(1).max(1_000_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
});
export const salesReportSchema = periodSchema
  .extend({
    channel: z.enum(["all", "pos", "orders"]).optional(),
    registerId: z.string().min(1).optional(),
    cashierId: z.string().min(1).optional(),
    category: z.string().trim().min(1).max(200).optional(),
    productId: z.string().min(1).optional(),
    variantKey: z.string().min(1).optional(),
    customerKey: z.string().max(300).optional(),
    documentId: z.string().min(1).optional(),
    kind: z.enum(["sale", "return"]).optional(),
    view: z.enum(reportViews).optional(),
    sort: z.enum(["revenue", "profit", "cost", "returns", "name", "date"]).optional(),
  })
  .strict();
const operationsSchema = periodSchema
  .extend({
    view: z.enum(operationViews),
    sort: z.enum(["date", "amount", "name"]).optional(),
  })
  .strict();

const parseDateOnlyBound = (value: string, endOfDay: boolean) => {
  return endOfDay ? businessDateOnlyEndUtc(value) : businessDateOnlyToUtc(value);
};

const resolveRange = (input: { days?: number; dateFrom?: string; dateTo?: string }) => {
  if (input.dateFrom && input.dateTo) {
    return {
      from: parseDateOnlyBound(input.dateFrom, false),
      to: parseDateOnlyBound(input.dateTo, true),
    };
  }
  const safeDays = input.days ?? 30;
  const to = new Date();
  const from = new Date(to.getTime() - safeDays * 24 * 60 * 60 * 1000);
  return { from, to };
};

const reportsProcedure = managerProcedure.use(async ({ ctx, next }) => {
  try {
    await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "analytics" });
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

type AuthedContext = Context & { user: NonNullable<Context["user"]> };
type StoreScope = { storeId?: string; storeIds?: string[] };

const resolveReportStoreScope = async (
  ctx: AuthedContext,
  storeId?: string,
): Promise<StoreScope> => {
  if (storeId) {
    await assertUserCanAccessStore(ctx.prisma, ctx.user, storeId);
    return { storeId };
  }
  if (userHasAllStoreAccess(ctx.user)) {
    return {};
  }
  return { storeIds: await resolveAccessibleStoreIds(ctx.prisma, ctx.user) };
};

export const reportsRouter = router({
  filterOptions: reportsProcedure
    .input(z.object({ storeId: z.string().min(1).optional() }).strict())
    .query(async ({ ctx, input }) => {
      try {
        return await withReportRead(ctx.user, input, reportFilterOptions);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  sales: reportsProcedure.input(salesReportSchema).query(async ({ ctx, input }) => {
    try {
      return await withReportRead(ctx.user, input, async (tx, access) => {
        await assertReportEntities(tx, access, input);
        return getSalesReport(tx, {
          ...input,
          organizationId: access.organizationId,
          storeIds: access.storeIds,
        });
      });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  salesExport: reportsProcedure.input(salesReportSchema).query(async ({ ctx, input }) => {
    try {
      return await withReportRead(ctx.user, { ...input, export: true }, async (tx, access) => {
        await assertReportEntities(tx, access, input);
        return getSalesReport(
          tx,
          { ...input, organizationId: access.organizationId, storeIds: access.storeIds },
          { exportAll: true },
        );
      });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  operations: reportsProcedure.input(operationsSchema).query(async ({ ctx, input }) => {
    try {
      return await withReportRead(ctx.user, input, (tx, access) =>
        getOperationsReport(tx, {
          ...input,
          organizationId: access.organizationId,
          storeIds: access.storeIds,
        }),
      );
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  operationsExport: reportsProcedure.input(operationsSchema).query(async ({ ctx, input }) => {
    try {
      return await withReportRead(ctx.user, { ...input, export: true }, (tx, access) =>
        getOperationsReport(
          tx,
          { ...input, organizationId: access.organizationId, storeIds: access.storeIds },
          { exportAll: true },
        ),
      );
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  stockouts: reportsProcedure.input(rangeSchema).query(async ({ ctx, input }) => {
    try {
      const range = resolveRange(input);
      const storeScope = await resolveReportStoreScope(ctx, input.storeId);
      return await getStockoutsReport({
        organizationId: ctx.user.organizationId,
        ...storeScope,
        ...range,
        page: input.page,
        pageSize: input.pageSize,
      });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  slowMovers: reportsProcedure.input(rangeSchema).query(async ({ ctx, input }) => {
    try {
      const range = resolveRange(input);
      const storeScope = await resolveReportStoreScope(ctx, input.storeId);
      return await getSlowMoversReport({
        organizationId: ctx.user.organizationId,
        ...storeScope,
        ...range,
        page: input.page,
        pageSize: input.pageSize,
      });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  shrinkage: reportsProcedure.input(rangeSchema).query(async ({ ctx, input }) => {
    try {
      const range = resolveRange(input);
      const storeScope = await resolveReportStoreScope(ctx, input.storeId);
      return await getShrinkageReport({
        organizationId: ctx.user.organizationId,
        ...storeScope,
        ...range,
        page: input.page,
        pageSize: input.pageSize,
      });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
});
