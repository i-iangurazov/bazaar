import { z } from "zod";

import { managerProcedure, protectedProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import {
  addBundleComponent,
  assembleBundle,
  listBundleComponents,
  removeBundleComponent,
} from "@/server/services/bundles";

const bundlesProtectedProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  try {
    await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "bundles" });
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

const bundlesManagerProcedure = managerProcedure.use(async ({ ctx, next }) => {
  try {
    await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "bundles" });
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

export const bundlesRouter = router({
  listComponents: bundlesProtectedProcedure
    .input(z.object({ bundleProductId: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        return await listBundleComponents({
          bundleProductId: input.bundleProductId,
          organizationId: ctx.user.organizationId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  addComponent: bundlesManagerProcedure
    .input(
      z.object({
        bundleProductId: z.string(),
        componentProductId: z.string(),
        componentVariantId: z.string().optional().nullable(),
        qty: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await addBundleComponent({
          bundleProductId: input.bundleProductId,
          componentProductId: input.componentProductId,
          componentVariantId: input.componentVariantId ?? undefined,
          qty: input.qty,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  removeComponent: bundlesManagerProcedure
    .input(z.object({ componentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await removeBundleComponent({
          componentId: input.componentId,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  assemble: bundlesManagerProcedure
    .use(rateLimit({ windowMs: 10_000, max: 10, prefix: "bundles-assemble" }))
    .input(
      z.object({
        storeId: z.string(),
        bundleProductId: z.string(),
        qty: z.number().int().positive(),
        idempotencyKey: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await assembleBundle({
          storeId: input.storeId,
          bundleProductId: input.bundleProductId,
          qty: input.qty,
          idempotencyKey: input.idempotencyKey,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
