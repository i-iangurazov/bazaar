import {
  ProductImageStudioBackground,
  ProductImageStudioOutputFormat,
} from "@prisma/client";
import { z } from "zod";

import {
  createProductImageStudioJob,
  getProductImageStudioJob,
  getProductImageStudioOverview,
  listProductImageStudioJobs,
  retryProductImageStudioJob,
  saveGeneratedImageToProduct,
} from "@/server/services/productImageStudio";
import { toTRPCError } from "@/server/trpc/errors";
import { managerProcedure, protectedProcedure, rateLimit, router } from "@/server/trpc/trpc";

export const productImageStudioRouter = router({
  overview: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await getProductImageStudioOverview(ctx.user.organizationId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  jobs: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await listProductImageStudioJobs(ctx.user.organizationId, input?.limit ?? 50);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  job: protectedProcedure
    .input(
      z.object({
        jobId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await getProductImageStudioJob(ctx.user.organizationId, input.jobId);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  create: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 8, prefix: "product-image-studio-create" }))
    .input(
      z.object({
        sourceImageUrl: z.string().min(1).max(4000),
        productId: z.string().min(1).optional().nullable(),
        backgroundMode: z.nativeEnum(ProductImageStudioBackground),
        outputFormat: z.nativeEnum(ProductImageStudioOutputFormat),
        centered: z.boolean(),
        improveVisibility: z.boolean(),
        softShadow: z.boolean().optional(),
        tighterCrop: z.boolean().optional(),
        brighterPresentation: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createProductImageStudioJob({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          sourceImageUrl: input.sourceImageUrl,
          productId: input.productId,
          backgroundMode: input.backgroundMode,
          outputFormat: input.outputFormat,
          centered: input.centered,
          improveVisibility: input.improveVisibility,
          softShadow: input.softShadow,
          tighterCrop: input.tighterCrop,
          brighterPresentation: input.brighterPresentation,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  retry: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 8, prefix: "product-image-studio-retry" }))
    .input(
      z.object({
        jobId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await retryProductImageStudioJob({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          jobId: input.jobId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  saveToProduct: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 12, prefix: "product-image-studio-save" }))
    .input(
      z.object({
        jobId: z.string().min(1),
        productId: z.string().min(1).optional().nullable(),
        setAsPrimary: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await saveGeneratedImageToProduct({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          jobId: input.jobId,
          productId: input.productId,
          setAsPrimary: input.setAsPrimary,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
