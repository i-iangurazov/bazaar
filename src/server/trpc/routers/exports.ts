import { z } from "zod";
import { ExportType } from "@prisma/client";

import { managerProcedure, protectedProcedure, rateLimit, router, type Context } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { listExportJobs, requestExport, getExportJob, retryExportJob } from "@/server/services/exports";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import {
  assertUserCanAccessStore,
  resolveAccessibleStoreIds,
  userHasAllStoreAccess,
} from "@/server/services/storeAccess";

const exportRequestSchema = z.object({
  storeId: z.string(),
  type: z.nativeEnum(ExportType),
  format: z.enum(["csv", "xlsx"]).optional(),
  periodStart: z.date(),
  periodEnd: z.date(),
});

type AuthedContext = Context & { user: NonNullable<Context["user"]> };
type StoreScope = { storeId?: string; storeIds?: string[] };

const resolveExportStoreScope = async (ctx: AuthedContext, storeId?: string): Promise<StoreScope> => {
  if (storeId) {
    await assertUserCanAccessStore(ctx.prisma, ctx.user, storeId);
    return { storeId };
  }
  if (userHasAllStoreAccess(ctx.user)) {
    return {};
  }
  return { storeIds: await resolveAccessibleStoreIds(ctx.prisma, ctx.user) };
};

export const exportsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          storeId: z.string().optional(),
          limit: z.number().int().positive().max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "exports" });
        const storeScope = await resolveExportStoreScope(ctx, input?.storeId);
        return await listExportJobs(ctx.user.organizationId, {
          ...storeScope,
          limit: input?.limit,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  get: protectedProcedure.input(z.object({ jobId: z.string() })).query(async ({ ctx, input }) => {
    try {
      await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "exports" });
      const storeScope = await resolveExportStoreScope(ctx);
      return await getExportJob(ctx.user.organizationId, input.jobId, storeScope.storeIds);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  create: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 6, prefix: "exports-create" }))
    .input(exportRequestSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "exports" });
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await requestExport({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          type: input.type,
          format: input.format,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          requestedById: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  retry: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 4, prefix: "exports-retry" }))
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "exports" });
        const storeScope = await resolveExportStoreScope(ctx);
        return await retryExportJob({
          organizationId: ctx.user.organizationId,
          jobId: input.jobId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          storeIds: storeScope.storeIds,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
