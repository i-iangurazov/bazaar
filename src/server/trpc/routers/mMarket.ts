import { MMarketEnvironment } from "@prisma/client";
import { z } from "zod";

import {
  getMMarketOverview,
  getMMarketSavedToken,
  getMMarketSettings,
  getMMarketExportJob,
  listMMarketExportJobs,
  requestMMarketExport,
  runMMarketPreflight,
  updateMMarketBranchMappings,
  updateMMarketConnection,
  validateMMarketLocally,
} from "@/server/services/mMarket";
import { toTRPCError } from "@/server/trpc/errors";
import { managerProcedure, protectedProcedure, rateLimit, router } from "@/server/trpc/trpc";

export const mMarketRouter = router({
  overview: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await getMMarketOverview(ctx.user.organizationId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  settings: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await getMMarketSettings(ctx.user.organizationId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  revealToken: managerProcedure.query(async ({ ctx }) => {
    try {
      return await getMMarketSavedToken(ctx.user.organizationId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  validateLocal: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 10, prefix: "mmarket-validate-local" }))
    .mutation(async ({ ctx }) => {
      try {
        return await validateMMarketLocally(ctx.user.organizationId);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  saveConnection: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 6, prefix: "mmarket-save-connection" }))
    .input(
      z.object({
        environment: z.nativeEnum(MMarketEnvironment),
        apiToken: z.string().max(4096).optional().nullable(),
        clearToken: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateMMarketConnection({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          environment: input.environment,
          apiToken: input.apiToken,
          clearToken: input.clearToken,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  saveBranchMappings: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 6, prefix: "mmarket-save-mappings" }))
    .input(
      z.object({
        mappings: z.array(
          z.object({
            storeId: z.string().min(1),
            mmarketBranchId: z.string().max(200),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateMMarketBranchMappings({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          mappings: input.mappings,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  preflight: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await runMMarketPreflight(ctx.user.organizationId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  exportNow: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 2, prefix: "mmarket-export-now" }))
    .mutation(async ({ ctx }) => {
      try {
        return await requestMMarketExport({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  jobs: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await listMMarketExportJobs(ctx.user.organizationId, input?.limit ?? 50);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  getJob: protectedProcedure
    .input(
      z.object({
        jobId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await getMMarketExportJob(ctx.user.organizationId, input.jobId);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
