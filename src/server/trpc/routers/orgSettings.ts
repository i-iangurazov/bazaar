import { LegalEntityType } from "@prisma/client";
import { z } from "zod";

import {
  getBusinessProfile,
  updateBusinessProfile,
} from "@/server/services/orgSettings";
import { toTRPCError } from "@/server/trpc/errors";
import { adminOrOrgOwnerProcedure, router } from "@/server/trpc/trpc";

export const orgSettingsRouter = router({
  getBusinessProfile: adminOrOrgOwnerProcedure
    .input(z.object({ storeId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        return await getBusinessProfile({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          storeId: input?.storeId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  updateBusinessProfile: adminOrOrgOwnerProcedure
    .input(
      z.object({
        organizationName: z.string().min(2),
        storeId: z.string(),
        legalEntityType: z.nativeEnum(LegalEntityType).nullable().optional(),
        legalName: z.string().max(240).nullable().optional(),
        inn: z.string().max(32).nullable().optional(),
        address: z.string().max(512).nullable().optional(),
        phone: z.string().max(40).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateBusinessProfile({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          organizationName: input.organizationName,
          storeId: input.storeId,
          legalEntityType: input.legalEntityType ?? null,
          legalName: input.legalName ?? null,
          inn: input.inn ?? null,
          address: input.address ?? null,
          phone: input.phone ?? null,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
