import { MMarketEnvironment } from "@prisma/client";
import { z } from "zod";

import {
  assignDefaultCategoryToMMarketProducts,
  bulkAutofillMMarketSpecs,
  bulkCreateMMarketBaseTemplates,
  bulkGenerateMMarketShortDescriptions,
  getMMarketOverview,
  getMMarketSavedToken,
  getMMarketSettings,
  getMMarketExportJob,
  listMMarketProductIds,
  listMMarketProducts,
  listMMarketExportJobs,
  requestMMarketExport,
  runMMarketPreflight,
  updateMMarketProductSelection,
  updateMMarketBranchMappings,
  updateMMarketConnection,
  validateMMarketLocally,
} from "@/server/services/mMarket";
import { toTRPCError } from "@/server/trpc/errors";
import {
  adminProcedure,
  managerProcedure,
  protectedProcedure,
  rateLimit,
  router,
} from "@/server/trpc/trpc";

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

  products: protectedProcedure
    .input(
      z
        .object({
          search: z.string().max(200).optional(),
          selection: z.enum(["all", "included", "excluded"]).optional(),
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(1).max(10).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await listMMarketProducts({
          organizationId: ctx.user.organizationId,
          search: input?.search,
          selection: input?.selection,
          page: input?.page,
          pageSize: input?.pageSize,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  listIds: protectedProcedure
    .input(
      z
        .object({
          search: z.string().max(200).optional(),
          selection: z.enum(["all", "included", "excluded"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await listMMarketProductIds({
          organizationId: ctx.user.organizationId,
          search: input?.search,
          selection: input?.selection,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  updateProducts: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 20, prefix: "mmarket-update-products" }))
    .input(
      z.object({
        productIds: z.array(z.string().min(1)).min(1).max(500),
        included: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateMMarketProductSelection({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          productIds: input.productIds,
          included: input.included,
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

  bulkGenerateDescriptions: adminProcedure
    .use(rateLimit({ windowMs: 60_000, max: 30, prefix: "mmarket-descriptions-bulk" }))
    .input(
      z
        .object({
          locale: z.enum(["ru", "kg"]).optional(),
          productIds: z.array(z.string().min(1)).min(1).max(25).optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await bulkGenerateMMarketShortDescriptions({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          locale: input?.locale,
          productIds: input?.productIds,
          logger: ctx.logger,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  bulkAutofillSpecs: adminProcedure
    .use(rateLimit({ windowMs: 60_000, max: 30, prefix: "mmarket-specs-bulk" }))
    .input(
      z
        .object({
          productIds: z.array(z.string().min(1)).min(1).max(25).optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await bulkAutofillMMarketSpecs({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          productIds: input?.productIds,
          logger: ctx.logger,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  bulkCreateBaseTemplates: adminProcedure
    .use(rateLimit({ windowMs: 60_000, max: 1, prefix: "mmarket-templates-bulk" }))
    .mutation(async ({ ctx }) => {
      try {
        return await bulkCreateMMarketBaseTemplates({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          logger: ctx.logger,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  assignMissingCategory: adminProcedure
    .use(rateLimit({ windowMs: 60_000, max: 2, prefix: "mmarket-category-bulk" }))
    .mutation(async ({ ctx }) => {
      try {
        return await assignDefaultCategoryToMMarketProducts({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          logger: ctx.logger,
        });
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
