import { MMarketEnvironment, ProductDescriptionGenerationSource } from "@prisma/client";
import { z } from "zod";

import { locales } from "@/lib/locales";
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
import { managerProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { startProductDescriptionGenerationJob } from "@/server/services/productDescriptionGenerationJobs";
import {
  assertCommerceStoreAccess,
  assertCommerceStoreIdsAccess,
  resolveCommerceAccessibleStoreIds,
  resolveCommerceStoreScope,
} from "@/server/services/commerceAccess";

export const mMarketRouter = router({
  overview: managerProcedure.query(async ({ ctx }) => {
    try {
      const accessibleStoreIds = await resolveCommerceAccessibleStoreIds(ctx.prisma, ctx.user);
      return await getMMarketOverview(ctx.user.organizationId, accessibleStoreIds);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  settings: managerProcedure.query(async ({ ctx }) => {
    try {
      const accessibleStoreIds = await resolveCommerceAccessibleStoreIds(ctx.prisma, ctx.user);
      return await getMMarketSettings(ctx.user.organizationId, accessibleStoreIds);
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
        await assertCommerceStoreIdsAccess(
          ctx.prisma,
          ctx.user,
          input.mappings.map((mapping) => mapping.storeId),
        );
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

  products: managerProcedure
    .input(
      z
        .object({
          storeId: z.string().min(1).optional(),
          search: z.string().max(200).optional(),
          selection: z.enum(["all", "included", "excluded"]).optional(),
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(1).max(10).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        const storeId = await resolveCommerceStoreScope(ctx.prisma, ctx.user, input?.storeId);
        return await listMMarketProducts({
          organizationId: ctx.user.organizationId,
          storeId,
          search: input?.search,
          selection: input?.selection,
          page: input?.page,
          pageSize: input?.pageSize,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  listIds: managerProcedure
    .input(
      z
        .object({
          storeId: z.string().min(1).optional(),
          search: z.string().max(200).optional(),
          selection: z.enum(["all", "included", "excluded"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        const storeId = await resolveCommerceStoreScope(ctx.prisma, ctx.user, input?.storeId);
        return await listMMarketProductIds({
          organizationId: ctx.user.organizationId,
          storeId,
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
        storeId: z.string().min(1),
        productIds: z.array(z.string().min(1)).min(1).max(500),
        included: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCommerceStoreAccess(ctx.prisma, ctx.user, input.storeId);
        return await updateMMarketProductSelection({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          productIds: input.productIds,
          included: input.included,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  preflight: managerProcedure
    .input(z.object({ storeId: z.string().min(1).optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const storeId = await resolveCommerceStoreScope(ctx.prisma, ctx.user, input?.storeId);
        return await runMMarketPreflight(ctx.user.organizationId, storeId);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  bulkGenerateDescriptions: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 30, prefix: "mmarket-descriptions-bulk" }))
    .input(
      z.object({
        storeId: z.string().min(1),
        locale: z.enum(locales).optional(),
        productIds: z.array(z.string().min(1)).min(1).max(25).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCommerceStoreAccess(ctx.prisma, ctx.user, input.storeId);
        return await bulkGenerateMMarketShortDescriptions({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          locale: input.locale,
          productIds: input.productIds,
          logger: ctx.logger,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  startDescriptionGenerationJob: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 10, prefix: "mmarket-descriptions-job-start" }))
    .input(
      z.object({
        storeId: z.string().min(1),
        locale: z.enum(locales).optional(),
        productIds: z.array(z.string().min(1)).min(1).max(5000),
        overwriteExisting: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCommerceStoreAccess(ctx.prisma, ctx.user, input.storeId);
        return await startProductDescriptionGenerationJob({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          source: ProductDescriptionGenerationSource.M_MARKET,
          locale: input.locale,
          productIds: input.productIds,
          overwriteExisting: input.overwriteExisting,
          logger: ctx.logger,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  bulkAutofillSpecs: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 30, prefix: "mmarket-specs-bulk" }))
    .input(
      z.object({
        storeId: z.string().min(1),
        productIds: z.array(z.string().min(1)).min(1).max(25).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCommerceStoreAccess(ctx.prisma, ctx.user, input.storeId);
        return await bulkAutofillMMarketSpecs({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          productIds: input.productIds,
          logger: ctx.logger,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  bulkCreateBaseTemplates: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 1, prefix: "mmarket-templates-bulk" }))
    .input(z.object({ storeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCommerceStoreAccess(ctx.prisma, ctx.user, input.storeId);
        return await bulkCreateMMarketBaseTemplates({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          logger: ctx.logger,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  assignMissingCategory: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 2, prefix: "mmarket-category-bulk" }))
    .input(z.object({ storeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCommerceStoreAccess(ctx.prisma, ctx.user, input.storeId);
        return await assignDefaultCategoryToMMarketProducts({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
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
    .input(z.object({ storeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCommerceStoreAccess(ctx.prisma, ctx.user, input.storeId);
        return await requestMMarketExport({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  exportReadyNow: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 2, prefix: "mmarket-export-ready" }))
    .input(z.object({ storeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCommerceStoreAccess(ctx.prisma, ctx.user, input.storeId);
        return await requestMMarketExport({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          mode: "READY_ONLY",
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  jobs: managerProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        const accessibleStoreIds = await resolveCommerceAccessibleStoreIds(ctx.prisma, ctx.user);
        return await listMMarketExportJobs(
          ctx.user.organizationId,
          input?.limit ?? 50,
          accessibleStoreIds,
        );
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  getJob: managerProcedure
    .input(
      z.object({
        jobId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const accessibleStoreIds = await resolveCommerceAccessibleStoreIds(ctx.prisma, ctx.user);
        return await getMMarketExportJob(
          ctx.user.organizationId,
          input.jobId,
          accessibleStoreIds,
        );
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
