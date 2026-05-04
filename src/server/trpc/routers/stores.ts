import { z } from "zod";
import { LegalEntityType, PrinterPrintMode } from "@prisma/client";

import { adminProcedure, managerProcedure, protectedProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { createStore, updateStore, updateStoreLegalDetails, updateStorePolicy } from "@/server/services/stores";
import {
  PRICE_TAG_ROLL_LIMITS,
  PRICE_TAG_TEMPLATES,
  ROLL_PRICE_TAG_TEMPLATE,
} from "@/lib/priceTags";
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
        currencyCode: true,
        currencyRateKgsPerUnit: true,
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
        cloneFromStoreId: z.string().nullable().optional(),
        copyInventory: z.boolean().optional(),
        stockQuantityDelta: z.number().int().min(-1_000_000).max(1_000_000).optional(),
        priceAdjustmentMode: z.enum(["none", "percentage", "amount"]).optional(),
        priceAdjustmentValue: z.number().min(-1_000_000).max(1_000_000).optional(),
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
          cloneFromStoreId: input.cloneFromStoreId ?? null,
          copyInventory: input.copyInventory,
          stockQuantityDelta: input.stockQuantityDelta,
          priceAdjustmentMode: input.priceAdjustmentMode,
          priceAdjustmentValue: input.priceAdjustmentValue,
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
        labelTemplate: z.enum(PRICE_TAG_TEMPLATES).default(ROLL_PRICE_TAG_TEMPLATE),
        labelPaperMode: z.enum(["A4", "ROLL", "LABEL_PRINTER", "THERMAL"]).default("ROLL"),
        labelBarcodeType: z.enum(["auto", "ean13", "code128"]).default("auto"),
        labelDefaultCopies: z.number().int().min(1).max(100).default(1),
        labelShowProductName: z.boolean().default(true),
        labelShowPrice: z.boolean().default(true),
        labelShowSku: z.boolean().default(true),
        labelShowStoreName: z.boolean().default(false),
        labelRollGapMm: z.number().min(PRICE_TAG_ROLL_LIMITS.gapMm.min).max(PRICE_TAG_ROLL_LIMITS.gapMm.max).optional(),
        labelRollXOffsetMm: z.number().min(PRICE_TAG_ROLL_LIMITS.offsetMm.min).max(PRICE_TAG_ROLL_LIMITS.offsetMm.max).optional(),
        labelRollYOffsetMm: z.number().min(PRICE_TAG_ROLL_LIMITS.offsetMm.min).max(PRICE_TAG_ROLL_LIMITS.offsetMm.max).optional(),
        labelWidthMm: z.number().min(PRICE_TAG_ROLL_LIMITS.widthMm.min).max(PRICE_TAG_ROLL_LIMITS.widthMm.max).optional(),
        labelHeightMm: z.number().min(PRICE_TAG_ROLL_LIMITS.heightMm.min).max(PRICE_TAG_ROLL_LIMITS.heightMm.max).optional(),
        labelMarginTopMm: z.number().min(0).max(20).optional(),
        labelMarginRightMm: z.number().min(0).max(20).optional(),
        labelMarginBottomMm: z.number().min(0).max(20).optional(),
        labelMarginLeftMm: z.number().min(0).max(20).optional(),
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
          labelTemplate: input.labelTemplate,
          labelPaperMode: input.labelPaperMode,
          labelBarcodeType: input.labelBarcodeType,
          labelDefaultCopies: input.labelDefaultCopies,
          labelShowProductName: input.labelShowProductName,
          labelShowPrice: input.labelShowPrice,
          labelShowSku: input.labelShowSku,
          labelShowStoreName: input.labelShowStoreName,
          labelRollGapMm: input.labelRollGapMm,
          labelRollXOffsetMm: input.labelRollXOffsetMm,
          labelRollYOffsetMm: input.labelRollYOffsetMm,
          labelWidthMm: input.labelWidthMm,
          labelHeightMm: input.labelHeightMm,
          labelMarginTopMm: input.labelMarginTopMm,
          labelMarginRightMm: input.labelMarginRightMm,
          labelMarginBottomMm: input.labelMarginBottomMm,
          labelMarginLeftMm: input.labelMarginLeftMm,
          connectorDeviceId: input.connectorDeviceId ?? null,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
