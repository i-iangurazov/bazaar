import { z } from "zod";
import { KkmMode, MarkingMode } from "@prisma/client";

import { adminProcedure, managerProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { getStoreComplianceProfile, upsertStoreComplianceProfile } from "@/server/services/compliance";
import { assertFeatureEnabled } from "@/server/services/planLimits";

const complianceSchema = z.object({
  storeId: z.string(),
  defaultLocale: z.string().nullable().optional(),
  taxRegime: z.string().nullable().optional(),
  enableKkm: z.boolean(),
  kkmMode: z.nativeEnum(KkmMode),
  enableEsf: z.boolean(),
  enableEttn: z.boolean(),
  enableMarking: z.boolean(),
  markingMode: z.nativeEnum(MarkingMode),
  kkmProviderKey: z.string().nullable().optional(),
  kkmSettings: z.record(z.unknown()).nullable().optional(),
});

export const complianceRouter = router({
  getStore: managerProcedure.input(z.object({ storeId: z.string() })).query(async ({ ctx, input }) => {
    try {
      await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "compliance" });
      return await getStoreComplianceProfile(ctx.user.organizationId, input.storeId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  updateStore: adminProcedure.input(complianceSchema).mutation(async ({ ctx, input }) => {
    try {
      await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "compliance" });
      return await upsertStoreComplianceProfile({
        organizationId: ctx.user.organizationId,
        storeId: input.storeId,
        updatedById: ctx.user.id,
        requestId: ctx.requestId,
        defaultLocale: input.defaultLocale ?? null,
        taxRegime: input.taxRegime ?? null,
        enableKkm: input.enableKkm,
        kkmMode: input.kkmMode,
        enableEsf: input.enableEsf,
        enableEttn: input.enableEttn,
        enableMarking: input.enableMarking,
        markingMode: input.markingMode,
        kkmProviderKey: input.kkmProviderKey ?? null,
        kkmSettings: (input.kkmSettings as Record<string, unknown> | null | undefined) ?? null,
      });
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
});
