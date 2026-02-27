import { z } from "zod";
import { LegalEntityType, PrinterPrintMode } from "@prisma/client";

import { adminProcedure, managerProcedure, protectedProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { createStore, updateStore, updateStoreLegalDetails, updateStorePolicy } from "@/server/services/stores";
import {
  getStorePrinterSettings,
  updateStorePrinterSettings,
} from "@/server/services/storePrinterSettings";

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

  hardware: protectedProcedure
    .input(z.object({ storeId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        return await getStorePrinterSettings({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  updateHardware: managerProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
        receiptPrintMode: z.nativeEnum(PrinterPrintMode),
        labelPrintMode: z.nativeEnum(PrinterPrintMode),
        receiptPrinterModel: z.string().max(120).nullable().optional(),
        labelPrinterModel: z.string().max(120).nullable().optional(),
        connectorDeviceId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateStorePrinterSettings({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          receiptPrintMode: input.receiptPrintMode,
          labelPrintMode: input.labelPrintMode,
          receiptPrinterModel: input.receiptPrinterModel ?? null,
          labelPrinterModel: input.labelPrinterModel ?? null,
          connectorDeviceId: input.connectorDeviceId ?? null,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
