import { z } from "zod";
import { ExportType } from "@prisma/client";

import { managerProcedure, protectedProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { listExportJobs, requestExport, getExportJob, retryExportJob } from "@/server/services/exports";
import { assertFeatureEnabled } from "@/server/services/planLimits";

const exportRequestSchema = z.object({
  storeId: z.string(),
  type: z.nativeEnum(ExportType),
  format: z.enum(["csv", "xlsx"]).optional(),
  periodStart: z.date(),
  periodEnd: z.date(),
});

export const exportsRouter = router({
  list: protectedProcedure
    .input(z.object({ storeId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "exports" });
        return await listExportJobs(ctx.user.organizationId, input?.storeId);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  get: protectedProcedure.input(z.object({ jobId: z.string() })).query(async ({ ctx, input }) => {
    try {
      await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "exports" });
      return await getExportJob(ctx.user.organizationId, input.jobId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  create: managerProcedure.input(exportRequestSchema).mutation(async ({ ctx, input }) => {
    try {
      await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "exports" });
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
  retry: managerProcedure.input(z.object({ jobId: z.string() })).mutation(async ({ ctx, input }) => {
    try {
      await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "exports" });
      return await retryExportJob({
        organizationId: ctx.user.organizationId,
        jobId: input.jobId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
      });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
});
