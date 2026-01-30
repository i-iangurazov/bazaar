import { z } from "zod";
import { LegalEntityType } from "@prisma/client";

import { adminProcedure, managerProcedure, protectedProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { createStore, updateStore, updateStoreLegalDetails, updateStorePolicy } from "@/server/services/stores";

export const storesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.store.findMany({
      where: { organizationId: ctx.user.organizationId },
      select: {
        id: true,
        name: true,
        code: true,
        allowNegativeStock: true,
        trackExpiryLots: true,
        legalEntityType: true,
        legalName: true,
        inn: true,
        address: true,
        phone: true,
        complianceProfile: {
          select: {
            enableKkm: true,
            kkmMode: true,
            kkmProviderKey: true,
            enableEsf: true,
            enableEttn: true,
            enableMarking: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });
  }),

  updatePolicy: managerProcedure
    .input(
      z.object({
        storeId: z.string(),
        allowNegativeStock: z.boolean(),
        trackExpiryLots: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateStorePolicy({
          storeId: input.storeId,
          allowNegativeStock: input.allowNegativeStock,
          trackExpiryLots: input.trackExpiryLots,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  create: managerProcedure
    .input(
      z.object({
        name: z.string().min(1),
        code: z.string().min(1),
        allowNegativeStock: z.boolean(),
        trackExpiryLots: z.boolean(),
        legalEntityType: z.nativeEnum(LegalEntityType).nullable().optional(),
        legalName: z.string().nullable().optional(),
        inn: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createStore({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          name: input.name,
          code: input.code,
          allowNegativeStock: input.allowNegativeStock,
          trackExpiryLots: input.trackExpiryLots,
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

  update: managerProcedure
    .input(z.object({ storeId: z.string(), name: z.string().min(1), code: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateStore({
          storeId: input.storeId,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          name: input.name,
          code: input.code,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  updateLegalDetails: adminProcedure
    .input(
      z.object({
        storeId: z.string(),
        legalEntityType: z.nativeEnum(LegalEntityType).nullable().optional(),
        legalName: z.string().nullable().optional(),
        inn: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateStoreLegalDetails({
          storeId: input.storeId,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
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
