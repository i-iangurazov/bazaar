import { z } from "zod";
import { ExportType } from "@prisma/client";

import { managerProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { listExportJobs, requestExport, getExportJob } from "@/server/services/exports";

const exportRequestSchema = z.object({
  storeId: z.string(),
  type: z.nativeEnum(ExportType),
  periodStart: z.date(),
  periodEnd: z.date(),
});

export const exportsRouter = router({
  list: managerProcedure
    .input(z.object({ storeId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        return await listExportJobs(ctx.user.organizationId, input?.storeId);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  get: managerProcedure.input(z.object({ jobId: z.string() })).query(async ({ ctx, input }) => {
    try {
      return await getExportJob(ctx.user.organizationId, input.jobId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  create: managerProcedure.input(exportRequestSchema).mutation(async ({ ctx, input }) => {
    try {
      return await requestExport({
        organizationId: ctx.user.organizationId,
        storeId: input.storeId,
        type: input.type,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        requestedById: ctx.user.id,
        requestId: ctx.requestId,
      });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
});
