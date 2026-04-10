import { z } from "zod";

import {
  getBakaiStoreExportJob,
  getBakaiStoreOverview,
  getBakaiStoreSettings,
  listBakaiStoreExportJobs,
  listBakaiStoreProductIds,
  listBakaiStoreProducts,
  requestBakaiStoreExport,
  runBakaiStorePreflight,
  updateBakaiStoreMappings,
  updateBakaiStoreProductSelection,
} from "@/server/services/bakaiStore";
import { toTRPCError } from "@/server/trpc/errors";
import { managerProcedure, protectedProcedure, rateLimit, router } from "@/server/trpc/trpc";

export const bakaiStoreRouter = router({
  overview: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await getBakaiStoreOverview(ctx.user.organizationId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  settings: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await getBakaiStoreSettings(ctx.user.organizationId);
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
        return await listBakaiStoreProducts({
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
        return await listBakaiStoreProductIds({
          organizationId: ctx.user.organizationId,
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
        productIds: z.array(z.string().min(1)).min(1).max(500),
        included: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateBakaiStoreProductSelection({
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
      return await runBakaiStorePreflight(ctx.user.organizationId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  exportNow: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 2, prefix: "bakai-store-export-now" }))
    .mutation(async ({ ctx }) => {
      try {
        return await requestBakaiStoreExport({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  exportReadyNow: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 2, prefix: "bakai-store-export-ready" }))
    .mutation(async ({ ctx }) => {
      try {
        return await requestBakaiStoreExport({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          mode: "READY_ONLY",
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
        return await listBakaiStoreExportJobs(ctx.user.organizationId, input?.limit ?? 50);
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
        return await getBakaiStoreExportJob(ctx.user.organizationId, input.jobId);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
