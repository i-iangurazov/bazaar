import { BakaiStoreConnectionMode, ProductDescriptionGenerationSource } from "@prisma/client";
import { z } from "zod";

import {
  getBakaiStoreJob,
  getBakaiStoreOverview,
  getBakaiStoreSavedToken,
  getBakaiStoreSettings,
  listBakaiStoreJobs,
  listBakaiStoreProductIds,
  listBakaiStoreProducts,
  requestBakaiStoreApiSync,
  requestBakaiStoreExport,
  runBakaiStoreApiPreflight,
  runBakaiStorePreflight,
  testBakaiStoreConnection,
  updateBakaiStoreBranchMappings,
  updateBakaiStoreSettings,
  updateBakaiStoreMappings,
  updateBakaiStoreProductSelection,
} from "@/server/services/bakaiStore";
import { toTRPCError } from "@/server/trpc/errors";
import { managerProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { locales } from "@/lib/locales";
import { startProductDescriptionGenerationJob } from "@/server/services/productDescriptionGenerationJobs";
import {
  assertCommerceStoreAccess,
  assertCommerceStoreIdsAccess,
  resolveCommerceAccessibleStoreIds,
  resolveCommerceStoreScope,
} from "@/server/services/commerceAccess";

export const bakaiStoreRouter = router({
  overview: managerProcedure.query(async ({ ctx }) => {
    try {
      const accessibleStoreIds = await resolveCommerceAccessibleStoreIds(ctx.prisma, ctx.user);
      return await getBakaiStoreOverview(ctx.user.organizationId, accessibleStoreIds);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  settings: managerProcedure.query(async ({ ctx }) => {
    try {
      const accessibleStoreIds = await resolveCommerceAccessibleStoreIds(ctx.prisma, ctx.user);
      return await getBakaiStoreSettings(ctx.user.organizationId, accessibleStoreIds);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  revealToken: managerProcedure.query(async ({ ctx }) => {
    try {
      return await getBakaiStoreSavedToken(ctx.user.organizationId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  saveSettings: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 6, prefix: "bakai-store-save-settings" }))
    .input(
      z.object({
        connectionMode: z.nativeEnum(BakaiStoreConnectionMode),
        apiToken: z.string().max(4096).optional().nullable(),
        clearToken: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateBakaiStoreSettings({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          connectionMode: input.connectionMode,
          apiToken: input.apiToken,
          clearToken: input.clearToken,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  testConnection: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 6, prefix: "bakai-store-test-connection" }))
    .mutation(async ({ ctx }) => {
      try {
        return await testBakaiStoreConnection({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  saveMappings: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 6, prefix: "bakai-store-save-mappings" }))
    .input(
      z.object({
        mappings: z.array(
          z.object({
            columnKey: z.string().min(1).max(32),
            storeId: z.string().max(200),
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
        return await updateBakaiStoreMappings({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          mappings: input.mappings,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  saveBranchMappings: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 6, prefix: "bakai-store-save-branch-mappings" }))
    .input(
      z.object({
        mappings: z.array(
          z.object({
            storeId: z.string().min(1),
            branchId: z.string().max(200),
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
        return await updateBakaiStoreBranchMappings({
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
        return await listBakaiStoreProducts({
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
        return await listBakaiStoreProductIds({
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
    .use(rateLimit({ windowMs: 60_000, max: 20, prefix: "bakai-store-update-products" }))
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
        return await updateBakaiStoreProductSelection({
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

  startDescriptionGenerationJob: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 10, prefix: "bakai-store-descriptions-job-start" }))
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
          source: ProductDescriptionGenerationSource.BAKAI_STORE,
          locale: input.locale,
          productIds: input.productIds,
          overwriteExisting: input.overwriteExisting,
          logger: ctx.logger,
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
        return await runBakaiStorePreflight(ctx.user.organizationId, storeId);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  apiPreflight: managerProcedure
    .input(z.object({ storeId: z.string().min(1).optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const storeId = await resolveCommerceStoreScope(ctx.prisma, ctx.user, input?.storeId);
        return await runBakaiStoreApiPreflight(ctx.user.organizationId, storeId);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  exportNow: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 2, prefix: "bakai-store-export-now" }))
    .input(z.object({ storeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCommerceStoreAccess(ctx.prisma, ctx.user, input.storeId);
        return await requestBakaiStoreExport({
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
    .use(rateLimit({ windowMs: 60_000, max: 2, prefix: "bakai-store-export-ready" }))
    .input(z.object({ storeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCommerceStoreAccess(ctx.prisma, ctx.user, input.storeId);
        return await requestBakaiStoreExport({
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

  apiSyncNow: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 2, prefix: "bakai-store-api-sync-now" }))
    .input(z.object({ storeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCommerceStoreAccess(ctx.prisma, ctx.user, input.storeId);
        return await requestBakaiStoreApiSync({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  apiSyncReadyNow: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 2, prefix: "bakai-store-api-sync-ready-now" }))
    .input(z.object({ storeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCommerceStoreAccess(ctx.prisma, ctx.user, input.storeId);
        return await requestBakaiStoreApiSync({
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
        return await listBakaiStoreJobs(
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
        return await getBakaiStoreJob(
          ctx.user.organizationId,
          input.jobId,
          accessibleStoreIds,
        );
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
