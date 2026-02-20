import { z } from "zod";

import { adminProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { createImpersonationSession, revokeImpersonationSession } from "@/server/services/impersonation";
import { getSupportBundle } from "@/server/services/supportBundle";
import { listStoreFeatureFlags, upsertStoreFeatureFlag } from "@/server/services/storeFeatureFlags";
import { assertFeatureEnabled } from "@/server/services/planLimits";

const ensureSupportToolkit = async (organizationId: string) => {
  await assertFeatureEnabled({ organizationId, feature: "supportToolkit" });
};

export const adminSupportRouter = router({
  storeFlags: adminProcedure.query(async ({ ctx }) => {
    try {
      await ensureSupportToolkit(ctx.user.organizationId);
      return await listStoreFeatureFlags({ organizationId: ctx.user.organizationId });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  upsertStoreFlag: adminProcedure
    .input(z.object({ storeId: z.string(), key: z.string().min(1), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ensureSupportToolkit(ctx.user.organizationId);
        return await upsertStoreFeatureFlag({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          key: input.key,
          enabled: input.enabled,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  createImpersonation: adminProcedure
    .input(
      z.object({
        targetUserId: z.string(),
        ttlMinutes: z.number().min(5).max(240).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await ensureSupportToolkit(ctx.user.organizationId);
        return await createImpersonationSession({
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
          targetUserId: input.targetUserId,
          ttlMinutes: input.ttlMinutes,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  revokeImpersonation: adminProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ensureSupportToolkit(ctx.user.organizationId);
        return await revokeImpersonationSession({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          sessionId: input.sessionId,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  exportBundle: adminProcedure.mutation(async ({ ctx }) => {
    try {
      await ensureSupportToolkit(ctx.user.organizationId);
      return await getSupportBundle({
        organizationId: ctx.user.organizationId,
        actorId: ctx.user.id,
        requestId: ctx.requestId,
      });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
});
