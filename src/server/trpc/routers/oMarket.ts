import { OMarketJobType } from "@prisma/client";
import { z } from "zod";

import {
  getOMarketJob,
  getOMarketOverview,
  getOMarketSavedToken,
  getOMarketSettings,
  listOMarketJobs,
  listOMarketProductIds,
  listOMarketProducts,
  requestOMarketExport,
  runOMarketPreflight,
  testOMarketConnection,
  updateOMarketCategoryMappings,
  updateOMarketProductSelection,
  updateOMarketSettings,
  updateOMarketStoreMappings,
} from "@/server/services/oMarket";
import { toTRPCError } from "@/server/trpc/errors";
import { managerProcedure, protectedProcedure, rateLimit, router } from "@/server/trpc/trpc";

export const oMarketRouter = router({
  overview: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await getOMarketOverview(ctx.user.organizationId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  settings: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await getOMarketSettings(ctx.user.organizationId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  revealToken: managerProcedure.query(async ({ ctx }) => {
    try {
      return await getOMarketSavedToken(ctx.user.organizationId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  saveSettings: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 6, prefix: "o-market-save-settings" }))
    .input(
      z.object({
        baseUrl: z.string().max(500).optional().nullable(),
        apiToken: z.string().max(4096).optional().nullable(),
        clearToken: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateOMarketSettings({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          baseUrl: input.baseUrl,
          apiToken: input.apiToken,
          clearToken: input.clearToken,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  testConnection: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 6, prefix: "o-market-test-connection" }))
    .mutation(async ({ ctx }) => {
      try {
        return await testOMarketConnection({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  saveStoreMappings: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 6, prefix: "o-market-save-store-mappings" }))
    .input(
      z.object({
        mappings: z.array(
          z.object({
            storeId: z.string().min(1),
            locationId: z.string().max(200),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateOMarketStoreMappings({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          mappings: input.mappings,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  saveCategoryMappings: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 6, prefix: "o-market-save-category-mappings" }))
    .input(
      z.object({
        mappings: z.array(
          z.object({
            bazaarCategory: z.string().min(1).max(300),
            oMarketCategoryId: z.string().max(50),
            oMarketCategoryName: z.string().max(300).optional().nullable(),
            attributesJson: z.string().max(4000).optional().nullable(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateOMarketCategoryMappings({
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
        return await listOMarketProducts({
          organizationId: ctx.user.organizationId,
          storeId: input?.storeId,
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
          storeId: z.string().min(1).optional(),
          search: z.string().max(200).optional(),
          selection: z.enum(["all", "included", "excluded"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await listOMarketProductIds({
          organizationId: ctx.user.organizationId,
          storeId: input?.storeId,
          search: input?.search,
          selection: input?.selection,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  updateProducts: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 20, prefix: "o-market-update-products" }))
    .input(
      z.object({
        storeId: z.string().min(1),
        productIds: z.array(z.string().min(1)).min(1).max(500),
        included: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateOMarketProductSelection({
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

  preflight: protectedProcedure
    .input(
      z
        .object({
          storeId: z.string().min(1).optional(),
          jobType: z.nativeEnum(OMarketJobType).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await runOMarketPreflight(
          ctx.user.organizationId,
          input?.storeId,
          input?.jobType,
        );
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  exportNow: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 2, prefix: "o-market-export-now" }))
    .input(z.object({ storeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await requestOMarketExport({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          jobType: OMarketJobType.PRODUCT_EXPORT,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  exportReadyNow: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 2, prefix: "o-market-export-ready" }))
    .input(z.object({ storeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await requestOMarketExport({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          jobType: OMarketJobType.PRODUCT_EXPORT,
          mode: "READY_ONLY",
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  syncStockPriceNow: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 2, prefix: "o-market-stock-price-sync-now" }))
    .input(z.object({ storeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await requestOMarketExport({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          jobType: OMarketJobType.STOCK_PRICE_SYNC,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  fullSyncNow: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 1, prefix: "o-market-full-sync-now" }))
    .input(z.object({ storeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await requestOMarketExport({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          jobType: OMarketJobType.FULL_SYNC,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  jobs: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        return await listOMarketJobs(ctx.user.organizationId, input?.limit ?? 50);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  getJob: protectedProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        return await getOMarketJob(ctx.user.organizationId, input.jobId);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
