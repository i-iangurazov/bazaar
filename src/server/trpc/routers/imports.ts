import { z } from "zod";

import { adminProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { getImportBatch, listImportBatches, rollbackImportBatch } from "@/server/services/imports";
import { assertProductImportAccess } from "@/server/billing/coreAccess";
import { getSubscriptionUsage } from "@/server/billing/subscriptionUsage";
import {
  getInitialProductImportStatus,
  startInitialProductImport,
} from "@/server/billing/initialProductImport";

export const importsRouter = router({
  availability: adminProcedure.query(async ({ ctx }) => {
    try {
      const { initialOnly } = await assertProductImportAccess(ctx.user.organizationId, true);
      const remaining = initialOnly
        ? ((await getSubscriptionUsage(ctx.user.organizationId)).find(
            (row) => row.resource === "initialImport",
          )?.remaining ?? 0)
        : null;
      return {
        initialOnly,
        remaining,
        session: initialOnly ? await getInitialProductImportStatus(ctx.user.organizationId) : null,
      };
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  startInitial: adminProcedure
    .input(z.object({ rowCounts: z.array(z.number().int().min(1).max(1000)).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await startInitialProductImport({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          rowCounts: input.rowCounts,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  list: adminProcedure
    .input(
      z
        .object({
          type: z.string().trim().min(1).max(64).optional(),
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(100).default(25),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await listImportBatches({
          organizationId: ctx.user.organizationId,
          type: input?.type,
          page: input?.page,
          pageSize: input?.pageSize,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  get: adminProcedure.input(z.object({ batchId: z.string() })).query(async ({ ctx, input }) => {
    try {
      return await getImportBatch({
        organizationId: ctx.user.organizationId,
        batchId: input.batchId,
      });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  rollback: adminProcedure
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await rollbackImportBatch({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          batchId: input.batchId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
