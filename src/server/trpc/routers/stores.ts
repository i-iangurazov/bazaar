import { z } from "zod";
import { LegalEntityType, PrinterPrintMode } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import {
  adminOrOrgOwnerProcedure,
  adminProcedure,
  managerProcedure,
  protectedProcedure,
  router,
} from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import {
  createStore,
  updateStore,
  updateStoreLegalDetails,
  updateStoreProductSettings,
  updateStorePolicy,
} from "@/server/services/stores";
import {
  PRICE_TAG_ROLL_LIMITS,
  PRICE_TAG_TEMPLATES,
  ROLL_PRICE_TAG_TEMPLATE,
} from "@/lib/priceTags";
import {
  getStorePrinterSettings,
  updateStorePrinterSettings,
} from "@/server/services/storePrinterSettings";
import { assertUserCanAccessStore, userHasAllStoreAccess } from "@/server/services/storeAccess";

export const storesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const storeSelect = {
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
      enableSku: true,
      enableBarcode: true,
      enableSimilarProductCheck: true,
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
    } as const;
    if (!userHasAllStoreAccess(ctx.user)) {
      const accessRows = await ctx.prisma.userStoreAccess.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          userId: ctx.user.id,
          store: { organizationId: ctx.user.organizationId },
        },
        select: { store: { select: storeSelect } },
        orderBy: { store: { name: "asc" } },
      });
      return accessRows.map((row) => row.store);
    }

    return ctx.prisma.store.findMany({
      where: { organizationId: ctx.user.organizationId },
      select: storeSelect,
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
        enableSku: z.boolean().optional(),
        enableBarcode: z.boolean().optional(),
        enableSimilarProductCheck: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const customProductSettingsRequested =
          input.enableSku !== undefined ||
          input.enableBarcode !== undefined ||
          input.enableSimilarProductCheck !== undefined;
        if (customProductSettingsRequested && ctx.user.role !== "ADMIN" && !ctx.user.isOrgOwner) {
          throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
        }
        if ((input.copyInventory || input.stockQuantityDelta) && ctx.user.role !== "ADMIN") {
          throw new TRPCError({ code: "FORBIDDEN", message: "inventoryAdminRequired" });
        }
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
          enableSku: input.enableSku,
          enableBarcode: input.enableBarcode,
          enableSimilarProductCheck: input.enableSimilarProductCheck,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  updateProductSettings: adminOrOrgOwnerProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
        enableSku: z.boolean(),
        enableBarcode: z.boolean(),
        enableSimilarProductCheck: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateStoreProductSettings({
          storeId: input.storeId,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          enableSku: input.enableSku,
          enableBarcode: input.enableBarcode,
          enableSimilarProductCheck: input.enableSimilarProductCheck,
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
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
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
        receiptPrintProvider: z
          .enum([
            "DISABLED",
            "QZ_TRAY",
            "KIOSK_SILENT_PRINT",
            "NETWORK_ESC_POS",
            "MANUAL_BROWSER_PRINT",
          ])
          .default("DISABLED"),
        labelPrintProvider: z
          .enum([
            "DISABLED",
            "QZ_TRAY",
            "KIOSK_SILENT_PRINT",
            "NETWORK_ESC_POS",
            "MANUAL_BROWSER_PRINT",
          ])
          .default("DISABLED"),
        receiptAutoPrintEnabled: z.boolean().default(false),
        receiptFallbackMode: z.enum(["NONE", "MANUAL_BROWSER_PRINT"]).default("MANUAL_BROWSER_PRINT"),
        receiptTemplateUsage: z.enum(["PRINT", "EXPORT", "BOTH"]).default("BOTH"),
        receiptPaperSize: z.enum(["58MM", "80MM", "A4", "CUSTOM"]).default("58MM"),
        receiptCustomWidthMm: z.number().min(40).max(210).default(58),
        receiptCustomHeightMm: z.number().min(0).max(500).default(0),
        receiptMarginTopMm: z.number().min(0).max(20).default(3),
        receiptMarginRightMm: z.number().min(0).max(20).default(2),
        receiptMarginBottomMm: z.number().min(0).max(20).default(3),
        receiptMarginLeftMm: z.number().min(0).max(20).default(2),
        receiptFontSize: z.number().min(6).max(14).default(8.4),
        receiptShowStoreName: z.boolean().default(true),
        receiptShowStoreAddress: z.boolean().default(true),
        receiptShowStorePhone: z.boolean().default(true),
        receiptShowLogo: z.boolean().default(false),
        receiptShowCashierName: z.boolean().default(true),
        receiptShowSaleNumber: z.boolean().default(true),
        receiptShowDateTime: z.boolean().default(true),
        receiptShowProductName: z.boolean().default(true),
        receiptShowProductSku: z.boolean().default(true),
        receiptShowProductBarcode: z.boolean().default(false),
        receiptShowProductUnitPrice: z.boolean().default(true),
        receiptShowProductQuantity: z.boolean().default(true),
        receiptShowDiscount: z.boolean().default(true),
        receiptShowSubtotal: z.boolean().default(true),
        receiptShowPaymentMethod: z.boolean().default(true),
        receiptShowTotal: z.boolean().default(true),
        receiptShowChange: z.boolean().default(true),
        receiptFooterText: z.string().max(300).optional().default(""),
        receiptPrinterModel: z.string().max(120).nullable().optional(),
        labelPrinterModel: z.string().max(120).nullable().optional(),
        labelTemplate: z.enum(PRICE_TAG_TEMPLATES).default(ROLL_PRICE_TAG_TEMPLATE),
        labelPaperMode: z.enum(["A4", "ROLL", "LABEL_PRINTER", "THERMAL"]).default("ROLL"),
        labelBarcodeType: z.enum(["auto", "ean13", "code128"]).default("auto"),
        labelLayoutOrder: z
          .enum([
            "PRICE_NAME_BARCODE",
            "NAME_BARCODE_PRICE",
            "BARCODE_ONLY",
            "NAME_BARCODE",
            "PRICE_BARCODE",
          ])
          .default("NAME_BARCODE_PRICE"),
        labelDefaultCopies: z.number().int().min(1).max(100).default(1),
        labelShowProductName: z.boolean().default(true),
        labelShowPrice: z.boolean().default(true),
        labelShowSku: z.boolean().default(true),
        labelShowBarcodeText: z.boolean().default(true),
        labelShowCurrency: z.boolean().default(true),
        labelShowStoreName: z.boolean().default(false),
        labelBarcodeHeightMm: z.number().min(6).max(40).default(12),
        labelFontSize: z.number().min(6).max(14).default(8),
        labelRollGapMm: z
          .number()
          .min(PRICE_TAG_ROLL_LIMITS.gapMm.min)
          .max(PRICE_TAG_ROLL_LIMITS.gapMm.max)
          .optional(),
        labelRollXOffsetMm: z
          .number()
          .min(PRICE_TAG_ROLL_LIMITS.offsetMm.min)
          .max(PRICE_TAG_ROLL_LIMITS.offsetMm.max)
          .optional(),
        labelRollYOffsetMm: z
          .number()
          .min(PRICE_TAG_ROLL_LIMITS.offsetMm.min)
          .max(PRICE_TAG_ROLL_LIMITS.offsetMm.max)
          .optional(),
        labelWidthMm: z
          .number()
          .min(PRICE_TAG_ROLL_LIMITS.widthMm.min)
          .max(PRICE_TAG_ROLL_LIMITS.widthMm.max)
          .optional(),
        labelHeightMm: z
          .number()
          .min(PRICE_TAG_ROLL_LIMITS.heightMm.min)
          .max(PRICE_TAG_ROLL_LIMITS.heightMm.max)
          .optional(),
        labelMarginTopMm: z.number().min(0).max(20).optional(),
        labelMarginRightMm: z.number().min(0).max(20).optional(),
        labelMarginBottomMm: z.number().min(0).max(20).optional(),
        labelMarginLeftMm: z.number().min(0).max(20).optional(),
        connectorDeviceId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await updateStorePrinterSettings({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          receiptPrintMode: input.receiptPrintMode,
          labelPrintMode: input.labelPrintMode,
          receiptPrintProvider: input.receiptPrintProvider,
          labelPrintProvider: input.labelPrintProvider,
          receiptAutoPrintEnabled: input.receiptAutoPrintEnabled,
          receiptFallbackMode: input.receiptFallbackMode,
          receiptTemplateUsage: input.receiptTemplateUsage,
          receiptPaperSize: input.receiptPaperSize,
          receiptCustomWidthMm: input.receiptCustomWidthMm,
          receiptCustomHeightMm: input.receiptCustomHeightMm,
          receiptMarginTopMm: input.receiptMarginTopMm,
          receiptMarginRightMm: input.receiptMarginRightMm,
          receiptMarginBottomMm: input.receiptMarginBottomMm,
          receiptMarginLeftMm: input.receiptMarginLeftMm,
          receiptFontSize: input.receiptFontSize,
          receiptShowStoreName: input.receiptShowStoreName,
          receiptShowStoreAddress: input.receiptShowStoreAddress,
          receiptShowStorePhone: input.receiptShowStorePhone,
          receiptShowLogo: input.receiptShowLogo,
          receiptShowCashierName: input.receiptShowCashierName,
          receiptShowSaleNumber: input.receiptShowSaleNumber,
          receiptShowDateTime: input.receiptShowDateTime,
          receiptShowProductName: input.receiptShowProductName,
          receiptShowProductSku: input.receiptShowProductSku,
          receiptShowProductBarcode: input.receiptShowProductBarcode,
          receiptShowProductUnitPrice: input.receiptShowProductUnitPrice,
          receiptShowProductQuantity: input.receiptShowProductQuantity,
          receiptShowDiscount: input.receiptShowDiscount,
          receiptShowSubtotal: input.receiptShowSubtotal,
          receiptShowPaymentMethod: input.receiptShowPaymentMethod,
          receiptShowTotal: input.receiptShowTotal,
          receiptShowChange: input.receiptShowChange,
          receiptFooterText: input.receiptFooterText,
          receiptPrinterModel: input.receiptPrinterModel ?? null,
          labelPrinterModel: input.labelPrinterModel ?? null,
          labelTemplate: input.labelTemplate,
          labelPaperMode: input.labelPaperMode,
          labelBarcodeType: input.labelBarcodeType,
          labelLayoutOrder: input.labelLayoutOrder,
          labelDefaultCopies: input.labelDefaultCopies,
          labelShowProductName: input.labelShowProductName,
          labelShowPrice: input.labelShowPrice,
          labelShowSku: input.labelShowSku,
          labelShowBarcodeText: input.labelShowBarcodeText,
          labelShowCurrency: input.labelShowCurrency,
          labelShowStoreName: input.labelShowStoreName,
          labelBarcodeHeightMm: input.labelBarcodeHeightMm,
          labelFontSize: input.labelFontSize,
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
