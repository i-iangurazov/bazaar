import { PrinterPrintMode } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";

export const defaultReceiptPrinterModel = "XP-P501A";
export const defaultLabelPrinterModel = "XP-365B";
export const defaultPrintProvider = "DISABLED";
export const defaultManualFallbackProvider = "MANUAL_BROWSER_PRINT";
export const defaultReceiptTemplateUsage = "BOTH";
export const defaultReceiptPaperSize = "58MM";
export const defaultReceiptWidthMm = 58;
export const defaultReceiptHeightMm = 0;
export const defaultReceiptMarginTopMm = 3;
export const defaultReceiptMarginRightMm = 2;
export const defaultReceiptMarginBottomMm = 3;
export const defaultReceiptMarginLeftMm = 2;
export const defaultReceiptFontSize = 8.4;
export const defaultLabelTemplate = "xp365b-roll-58x40";
export const defaultLabelPaperMode = "ROLL";
export const defaultLabelBarcodeType = "auto";
export const defaultLabelLayoutOrder = "NAME_BARCODE_PRICE";
export const defaultLabelCopies = 1;
export const defaultLabelWidthMm = 58;
export const defaultLabelHeightMm = 40;
export const defaultLabelBarcodeHeightMm = 12;
export const defaultLabelFontSize = 8;
export const defaultLabelRollGapMm = 3.5;
export const defaultLabelRollXOffsetMm = 0;
export const defaultLabelRollYOffsetMm = 0;
export const defaultLabelMarginMm = 0;

const normalizePrinterModel = (value: string | null | undefined, fallback: string) => {
  const next = value?.trim();
  return next ? next : fallback;
};

const normalizeTextSetting = (value: string | null | undefined, fallback: string) => {
  const next = value?.trim();
  return next ? next : fallback;
};

const normalizePrintProvider = (value: string | null | undefined) => {
  const next = normalizeTextSetting(value, defaultPrintProvider);
  return next === "LOCAL_PRINT_AGENT" ? defaultPrintProvider : next;
};

export const getStorePrinterSettings = async (input: {
  organizationId: string;
  storeId: string;
}) => {
  const store = await prisma.store.findFirst({
    where: {
      id: input.storeId,
      organizationId: input.organizationId,
    },
    select: {
      id: true,
      name: true,
      code: true,
    },
  });

  if (!store) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }

  const [settings, devices] = await Promise.all([
    prisma.storePrinterSettings.findUnique({
      where: { storeId: input.storeId },
      select: {
        id: true,
        storeId: true,
        receiptPrintMode: true,
        labelPrintMode: true,
        receiptPrintProvider: true,
        labelPrintProvider: true,
        receiptAutoPrintEnabled: true,
        receiptFallbackMode: true,
        receiptTemplateUsage: true,
        receiptPaperSize: true,
        receiptCustomWidthMm: true,
        receiptCustomHeightMm: true,
        receiptMarginTopMm: true,
        receiptMarginRightMm: true,
        receiptMarginBottomMm: true,
        receiptMarginLeftMm: true,
        receiptFontSize: true,
        receiptShowStoreName: true,
        receiptShowStoreAddress: true,
        receiptShowStorePhone: true,
        receiptShowLogo: true,
        receiptShowCashierName: true,
        receiptShowSaleNumber: true,
        receiptShowDateTime: true,
        receiptShowProductName: true,
        receiptShowProductSku: true,
        receiptShowProductBarcode: true,
        receiptShowProductUnitPrice: true,
        receiptShowProductQuantity: true,
        receiptShowDiscount: true,
        receiptShowSubtotal: true,
        receiptShowPaymentMethod: true,
        receiptShowTotal: true,
        receiptShowChange: true,
        receiptFooterText: true,
        receiptPrinterModel: true,
        labelPrinterModel: true,
        labelTemplate: true,
        labelPaperMode: true,
        labelBarcodeType: true,
        labelLayoutOrder: true,
        labelDefaultCopies: true,
        labelShowProductName: true,
        labelShowPrice: true,
        labelShowSku: true,
        labelShowBarcodeText: true,
        labelShowCurrency: true,
        labelShowStoreName: true,
        labelBarcodeHeightMm: true,
        labelFontSize: true,
        labelRollGapMm: true,
        labelRollXOffsetMm: true,
        labelRollYOffsetMm: true,
        labelWidthMm: true,
        labelHeightMm: true,
        labelMarginTopMm: true,
        labelMarginRightMm: true,
        labelMarginBottomMm: true,
        labelMarginLeftMm: true,
        labelLastPrintedAt: true,
        connectorDeviceId: true,
        updatedById: true,
        updatedAt: true,
        connectorDevice: {
          select: {
            id: true,
            name: true,
            isActive: true,
            lastSeenAt: true,
          },
        },
      },
    }),
    prisma.kkmConnectorDevice.findMany({
      where: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        isActive: true,
        lastSeenAt: true,
      },
      orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
      take: 20,
    }),
  ]);

  return {
    store,
    settings: settings
      ? {
          ...settings,
          receiptPrintProvider: normalizePrintProvider(settings.receiptPrintProvider),
          labelPrintProvider: normalizePrintProvider(settings.labelPrintProvider),
          receiptAutoPrintEnabled: settings.receiptAutoPrintEnabled,
          receiptFallbackMode: settings.receiptFallbackMode ?? defaultManualFallbackProvider,
          receiptTemplateUsage: settings.receiptTemplateUsage ?? defaultReceiptTemplateUsage,
          receiptPaperSize: settings.receiptPaperSize ?? defaultReceiptPaperSize,
          receiptCustomWidthMm: settings.receiptCustomWidthMm ?? defaultReceiptWidthMm,
          receiptCustomHeightMm: settings.receiptCustomHeightMm ?? defaultReceiptHeightMm,
          receiptMarginTopMm: settings.receiptMarginTopMm ?? defaultReceiptMarginTopMm,
          receiptMarginRightMm: settings.receiptMarginRightMm ?? defaultReceiptMarginRightMm,
          receiptMarginBottomMm: settings.receiptMarginBottomMm ?? defaultReceiptMarginBottomMm,
          receiptMarginLeftMm: settings.receiptMarginLeftMm ?? defaultReceiptMarginLeftMm,
          receiptFontSize: settings.receiptFontSize ?? defaultReceiptFontSize,
          receiptShowStoreName: settings.receiptShowStoreName,
          receiptShowStoreAddress: settings.receiptShowStoreAddress,
          receiptShowStorePhone: settings.receiptShowStorePhone,
          receiptShowLogo: settings.receiptShowLogo,
          receiptShowCashierName: settings.receiptShowCashierName,
          receiptShowSaleNumber: settings.receiptShowSaleNumber,
          receiptShowDateTime: settings.receiptShowDateTime,
          receiptShowProductName: settings.receiptShowProductName,
          receiptShowProductSku: settings.receiptShowProductSku,
          receiptShowProductBarcode: settings.receiptShowProductBarcode,
          receiptShowProductUnitPrice: settings.receiptShowProductUnitPrice,
          receiptShowProductQuantity: settings.receiptShowProductQuantity,
          receiptShowDiscount: settings.receiptShowDiscount,
          receiptShowSubtotal: settings.receiptShowSubtotal,
          receiptShowPaymentMethod: settings.receiptShowPaymentMethod,
          receiptShowTotal: settings.receiptShowTotal,
          receiptShowChange: settings.receiptShowChange,
          receiptFooterText: settings.receiptFooterText ?? "",
          receiptPrinterModel: settings.receiptPrinterModel ?? defaultReceiptPrinterModel,
          labelPrinterModel: settings.labelPrinterModel ?? defaultLabelPrinterModel,
          labelTemplate: settings.labelTemplate ?? defaultLabelTemplate,
          labelPaperMode: settings.labelPaperMode ?? defaultLabelPaperMode,
          labelBarcodeType: settings.labelBarcodeType ?? defaultLabelBarcodeType,
          labelLayoutOrder: settings.labelLayoutOrder ?? defaultLabelLayoutOrder,
          labelDefaultCopies: settings.labelDefaultCopies ?? defaultLabelCopies,
          labelShowProductName: settings.labelShowProductName,
          labelShowPrice: settings.labelShowPrice,
          labelShowSku: settings.labelShowSku,
          labelShowBarcodeText: settings.labelShowBarcodeText,
          labelShowCurrency: settings.labelShowCurrency,
          labelShowStoreName: settings.labelShowStoreName,
          labelBarcodeHeightMm: settings.labelBarcodeHeightMm ?? defaultLabelBarcodeHeightMm,
          labelFontSize: settings.labelFontSize ?? defaultLabelFontSize,
          labelRollGapMm: settings.labelRollGapMm ?? defaultLabelRollGapMm,
          labelRollXOffsetMm: settings.labelRollXOffsetMm ?? defaultLabelRollXOffsetMm,
          labelRollYOffsetMm: settings.labelRollYOffsetMm ?? defaultLabelRollYOffsetMm,
          labelWidthMm: settings.labelWidthMm ?? defaultLabelWidthMm,
          labelHeightMm: settings.labelHeightMm ?? defaultLabelHeightMm,
          labelMarginTopMm: settings.labelMarginTopMm ?? defaultLabelMarginMm,
          labelMarginRightMm: settings.labelMarginRightMm ?? defaultLabelMarginMm,
          labelMarginBottomMm: settings.labelMarginBottomMm ?? defaultLabelMarginMm,
          labelMarginLeftMm: settings.labelMarginLeftMm ?? defaultLabelMarginMm,
        }
      : {
          id: null,
          storeId: input.storeId,
          receiptPrintMode: PrinterPrintMode.PDF,
          labelPrintMode: PrinterPrintMode.PDF,
          receiptPrintProvider: defaultPrintProvider,
          labelPrintProvider: defaultPrintProvider,
          receiptAutoPrintEnabled: false,
          receiptFallbackMode: defaultManualFallbackProvider,
          receiptTemplateUsage: defaultReceiptTemplateUsage,
          receiptPaperSize: defaultReceiptPaperSize,
          receiptCustomWidthMm: defaultReceiptWidthMm,
          receiptCustomHeightMm: defaultReceiptHeightMm,
          receiptMarginTopMm: defaultReceiptMarginTopMm,
          receiptMarginRightMm: defaultReceiptMarginRightMm,
          receiptMarginBottomMm: defaultReceiptMarginBottomMm,
          receiptMarginLeftMm: defaultReceiptMarginLeftMm,
          receiptFontSize: defaultReceiptFontSize,
          receiptShowStoreName: true,
          receiptShowStoreAddress: true,
          receiptShowStorePhone: true,
          receiptShowLogo: false,
          receiptShowCashierName: true,
          receiptShowSaleNumber: true,
          receiptShowDateTime: true,
          receiptShowProductName: true,
          receiptShowProductSku: true,
          receiptShowProductBarcode: false,
          receiptShowProductUnitPrice: true,
          receiptShowProductQuantity: true,
          receiptShowDiscount: true,
          receiptShowSubtotal: true,
          receiptShowPaymentMethod: true,
          receiptShowTotal: true,
          receiptShowChange: true,
          receiptFooterText: "",
          receiptPrinterModel: defaultReceiptPrinterModel,
          labelPrinterModel: defaultLabelPrinterModel,
          labelTemplate: defaultLabelTemplate,
          labelPaperMode: defaultLabelPaperMode,
          labelBarcodeType: defaultLabelBarcodeType,
          labelLayoutOrder: defaultLabelLayoutOrder,
          labelDefaultCopies: defaultLabelCopies,
          labelShowProductName: true,
          labelShowPrice: true,
          labelShowSku: true,
          labelShowBarcodeText: true,
          labelShowCurrency: true,
          labelShowStoreName: false,
          labelBarcodeHeightMm: defaultLabelBarcodeHeightMm,
          labelFontSize: defaultLabelFontSize,
          labelRollGapMm: defaultLabelRollGapMm,
          labelRollXOffsetMm: defaultLabelRollXOffsetMm,
          labelRollYOffsetMm: defaultLabelRollYOffsetMm,
          labelWidthMm: defaultLabelWidthMm,
          labelHeightMm: defaultLabelHeightMm,
          labelMarginTopMm: defaultLabelMarginMm,
          labelMarginRightMm: defaultLabelMarginMm,
          labelMarginBottomMm: defaultLabelMarginMm,
          labelMarginLeftMm: defaultLabelMarginMm,
          labelLastPrintedAt: null,
          connectorDeviceId: null,
          updatedById: null,
          updatedAt: null,
          connectorDevice: null,
        },
    connectorDevices: devices,
  };
};

export const updateStorePrinterSettings = async (input: {
  organizationId: string;
  storeId: string;
  actorId: string;
  requestId: string;
  receiptPrintMode: PrinterPrintMode;
  labelPrintMode: PrinterPrintMode;
  receiptPrintProvider?: string | null;
  labelPrintProvider?: string | null;
  receiptAutoPrintEnabled?: boolean;
  receiptFallbackMode?: string | null;
  receiptTemplateUsage?: string | null;
  receiptPaperSize?: string | null;
  receiptCustomWidthMm?: number | null;
  receiptCustomHeightMm?: number | null;
  receiptMarginTopMm?: number | null;
  receiptMarginRightMm?: number | null;
  receiptMarginBottomMm?: number | null;
  receiptMarginLeftMm?: number | null;
  receiptFontSize?: number | null;
  receiptShowStoreName?: boolean;
  receiptShowStoreAddress?: boolean;
  receiptShowStorePhone?: boolean;
  receiptShowLogo?: boolean;
  receiptShowCashierName?: boolean;
  receiptShowSaleNumber?: boolean;
  receiptShowDateTime?: boolean;
  receiptShowProductName?: boolean;
  receiptShowProductSku?: boolean;
  receiptShowProductBarcode?: boolean;
  receiptShowProductUnitPrice?: boolean;
  receiptShowProductQuantity?: boolean;
  receiptShowDiscount?: boolean;
  receiptShowSubtotal?: boolean;
  receiptShowPaymentMethod?: boolean;
  receiptShowTotal?: boolean;
  receiptShowChange?: boolean;
  receiptFooterText?: string | null;
  receiptPrinterModel?: string | null;
  labelPrinterModel?: string | null;
  labelTemplate?: string | null;
  labelPaperMode?: string | null;
  labelBarcodeType?: string | null;
  labelLayoutOrder?: string | null;
  labelDefaultCopies?: number | null;
  labelShowProductName?: boolean;
  labelShowPrice?: boolean;
  labelShowSku?: boolean;
  labelShowBarcodeText?: boolean;
  labelShowCurrency?: boolean;
  labelShowStoreName?: boolean;
  labelBarcodeHeightMm?: number | null;
  labelFontSize?: number | null;
  labelRollGapMm?: number | null;
  labelRollXOffsetMm?: number | null;
  labelRollYOffsetMm?: number | null;
  labelWidthMm?: number | null;
  labelHeightMm?: number | null;
  labelMarginTopMm?: number | null;
  labelMarginRightMm?: number | null;
  labelMarginBottomMm?: number | null;
  labelMarginLeftMm?: number | null;
  connectorDeviceId?: string | null;
}) => {
  return prisma.$transaction(async (tx) => {
    const store = await tx.store.findFirst({
      where: {
        id: input.storeId,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });
    if (!store) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }

    if (input.connectorDeviceId) {
      const connectorDevice = await tx.kkmConnectorDevice.findUnique({
        where: { id: input.connectorDeviceId },
        select: {
          id: true,
          organizationId: true,
          storeId: true,
          isActive: true,
        },
      });
      if (
        !connectorDevice ||
        connectorDevice.organizationId !== input.organizationId ||
        connectorDevice.storeId !== input.storeId ||
        !connectorDevice.isActive
      ) {
        throw new AppError("printerConnectorDeviceNotFound", "BAD_REQUEST", 400);
      }
    }

    const before = await tx.storePrinterSettings.findUnique({
      where: { storeId: input.storeId },
    });

    const updated = await tx.storePrinterSettings.upsert({
      where: { storeId: input.storeId },
      create: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        receiptPrintMode: input.receiptPrintMode,
        labelPrintMode: input.labelPrintMode,
        receiptPrintProvider: normalizePrintProvider(input.receiptPrintProvider),
        labelPrintProvider: normalizePrintProvider(input.labelPrintProvider),
        receiptAutoPrintEnabled: input.receiptAutoPrintEnabled ?? false,
        receiptFallbackMode: normalizeTextSetting(
          input.receiptFallbackMode,
          defaultManualFallbackProvider,
        ),
        receiptTemplateUsage: normalizeTextSetting(
          input.receiptTemplateUsage,
          defaultReceiptTemplateUsage,
        ),
        receiptPaperSize: normalizeTextSetting(input.receiptPaperSize, defaultReceiptPaperSize),
        receiptCustomWidthMm: input.receiptCustomWidthMm ?? defaultReceiptWidthMm,
        receiptCustomHeightMm: input.receiptCustomHeightMm ?? defaultReceiptHeightMm,
        receiptMarginTopMm: input.receiptMarginTopMm ?? defaultReceiptMarginTopMm,
        receiptMarginRightMm: input.receiptMarginRightMm ?? defaultReceiptMarginRightMm,
        receiptMarginBottomMm: input.receiptMarginBottomMm ?? defaultReceiptMarginBottomMm,
        receiptMarginLeftMm: input.receiptMarginLeftMm ?? defaultReceiptMarginLeftMm,
        receiptFontSize: input.receiptFontSize ?? defaultReceiptFontSize,
        receiptShowStoreName: input.receiptShowStoreName ?? true,
        receiptShowStoreAddress: input.receiptShowStoreAddress ?? true,
        receiptShowStorePhone: input.receiptShowStorePhone ?? true,
        receiptShowLogo: input.receiptShowLogo ?? false,
        receiptShowCashierName: input.receiptShowCashierName ?? true,
        receiptShowSaleNumber: input.receiptShowSaleNumber ?? true,
        receiptShowDateTime: input.receiptShowDateTime ?? true,
        receiptShowProductName: input.receiptShowProductName ?? true,
        receiptShowProductSku: input.receiptShowProductSku ?? true,
        receiptShowProductBarcode: input.receiptShowProductBarcode ?? false,
        receiptShowProductUnitPrice: input.receiptShowProductUnitPrice ?? true,
        receiptShowProductQuantity: input.receiptShowProductQuantity ?? true,
        receiptShowDiscount: input.receiptShowDiscount ?? true,
        receiptShowSubtotal: input.receiptShowSubtotal ?? true,
        receiptShowPaymentMethod: input.receiptShowPaymentMethod ?? true,
        receiptShowTotal: input.receiptShowTotal ?? true,
        receiptShowChange: input.receiptShowChange ?? true,
        receiptFooterText: input.receiptFooterText?.trim() ?? "",
        receiptPrinterModel: normalizePrinterModel(
          input.receiptPrinterModel,
          defaultReceiptPrinterModel,
        ),
        labelPrinterModel: normalizePrinterModel(input.labelPrinterModel, defaultLabelPrinterModel),
        labelTemplate: input.labelTemplate ?? defaultLabelTemplate,
        labelPaperMode: input.labelPaperMode ?? defaultLabelPaperMode,
        labelBarcodeType: input.labelBarcodeType ?? defaultLabelBarcodeType,
        labelLayoutOrder: input.labelLayoutOrder ?? defaultLabelLayoutOrder,
        labelDefaultCopies: input.labelDefaultCopies ?? defaultLabelCopies,
        labelShowProductName: input.labelShowProductName ?? true,
        labelShowPrice: input.labelShowPrice ?? true,
        labelShowSku: input.labelShowSku ?? true,
        labelShowBarcodeText: input.labelShowBarcodeText ?? true,
        labelShowCurrency: input.labelShowCurrency ?? true,
        labelShowStoreName: input.labelShowStoreName ?? false,
        labelBarcodeHeightMm: input.labelBarcodeHeightMm ?? defaultLabelBarcodeHeightMm,
        labelFontSize: input.labelFontSize ?? defaultLabelFontSize,
        labelRollGapMm: input.labelRollGapMm ?? defaultLabelRollGapMm,
        labelRollXOffsetMm: input.labelRollXOffsetMm ?? defaultLabelRollXOffsetMm,
        labelRollYOffsetMm: input.labelRollYOffsetMm ?? defaultLabelRollYOffsetMm,
        labelWidthMm: input.labelWidthMm ?? defaultLabelWidthMm,
        labelHeightMm: input.labelHeightMm ?? defaultLabelHeightMm,
        labelMarginTopMm: input.labelMarginTopMm ?? defaultLabelMarginMm,
        labelMarginRightMm: input.labelMarginRightMm ?? defaultLabelMarginMm,
        labelMarginBottomMm: input.labelMarginBottomMm ?? defaultLabelMarginMm,
        labelMarginLeftMm: input.labelMarginLeftMm ?? defaultLabelMarginMm,
        connectorDeviceId: input.connectorDeviceId ?? null,
        updatedById: input.actorId,
      },
      update: {
        receiptPrintMode: input.receiptPrintMode,
        labelPrintMode: input.labelPrintMode,
        receiptPrintProvider: normalizePrintProvider(input.receiptPrintProvider),
        labelPrintProvider: normalizePrintProvider(input.labelPrintProvider),
        receiptAutoPrintEnabled: input.receiptAutoPrintEnabled,
        receiptFallbackMode: normalizeTextSetting(
          input.receiptFallbackMode,
          defaultManualFallbackProvider,
        ),
        receiptTemplateUsage: normalizeTextSetting(
          input.receiptTemplateUsage,
          defaultReceiptTemplateUsage,
        ),
        receiptPaperSize: normalizeTextSetting(input.receiptPaperSize, defaultReceiptPaperSize),
        receiptCustomWidthMm: input.receiptCustomWidthMm ?? undefined,
        receiptCustomHeightMm: input.receiptCustomHeightMm ?? undefined,
        receiptMarginTopMm: input.receiptMarginTopMm ?? undefined,
        receiptMarginRightMm: input.receiptMarginRightMm ?? undefined,
        receiptMarginBottomMm: input.receiptMarginBottomMm ?? undefined,
        receiptMarginLeftMm: input.receiptMarginLeftMm ?? undefined,
        receiptFontSize: input.receiptFontSize ?? undefined,
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
        receiptFooterText: input.receiptFooterText?.trim() ?? "",
        receiptPrinterModel: normalizePrinterModel(
          input.receiptPrinterModel,
          defaultReceiptPrinterModel,
        ),
        labelPrinterModel: normalizePrinterModel(input.labelPrinterModel, defaultLabelPrinterModel),
        labelTemplate: input.labelTemplate ?? undefined,
        labelPaperMode: input.labelPaperMode ?? undefined,
        labelBarcodeType: input.labelBarcodeType ?? undefined,
        labelLayoutOrder: input.labelLayoutOrder ?? undefined,
        labelDefaultCopies: input.labelDefaultCopies ?? undefined,
        labelShowProductName: input.labelShowProductName,
        labelShowPrice: input.labelShowPrice,
        labelShowSku: input.labelShowSku,
        labelShowBarcodeText: input.labelShowBarcodeText,
        labelShowCurrency: input.labelShowCurrency,
        labelShowStoreName: input.labelShowStoreName,
        labelBarcodeHeightMm: input.labelBarcodeHeightMm ?? undefined,
        labelFontSize: input.labelFontSize ?? undefined,
        labelRollGapMm: input.labelRollGapMm ?? undefined,
        labelRollXOffsetMm: input.labelRollXOffsetMm ?? undefined,
        labelRollYOffsetMm: input.labelRollYOffsetMm ?? undefined,
        labelWidthMm: input.labelWidthMm ?? undefined,
        labelHeightMm: input.labelHeightMm ?? undefined,
        labelMarginTopMm: input.labelMarginTopMm ?? undefined,
        labelMarginRightMm: input.labelMarginRightMm ?? undefined,
        labelMarginBottomMm: input.labelMarginBottomMm ?? undefined,
        labelMarginLeftMm: input.labelMarginLeftMm ?? undefined,
        connectorDeviceId: input.connectorDeviceId ?? null,
        updatedById: input.actorId,
      },
      select: {
        id: true,
        storeId: true,
        receiptPrintMode: true,
        labelPrintMode: true,
        receiptPrintProvider: true,
        labelPrintProvider: true,
        receiptAutoPrintEnabled: true,
        receiptFallbackMode: true,
        receiptTemplateUsage: true,
        receiptPaperSize: true,
        receiptCustomWidthMm: true,
        receiptCustomHeightMm: true,
        receiptMarginTopMm: true,
        receiptMarginRightMm: true,
        receiptMarginBottomMm: true,
        receiptMarginLeftMm: true,
        receiptFontSize: true,
        receiptShowStoreName: true,
        receiptShowStoreAddress: true,
        receiptShowStorePhone: true,
        receiptShowLogo: true,
        receiptShowCashierName: true,
        receiptShowSaleNumber: true,
        receiptShowDateTime: true,
        receiptShowProductName: true,
        receiptShowProductSku: true,
        receiptShowProductBarcode: true,
        receiptShowProductUnitPrice: true,
        receiptShowProductQuantity: true,
        receiptShowDiscount: true,
        receiptShowSubtotal: true,
        receiptShowPaymentMethod: true,
        receiptShowTotal: true,
        receiptShowChange: true,
        receiptFooterText: true,
        receiptPrinterModel: true,
        labelPrinterModel: true,
        labelTemplate: true,
        labelPaperMode: true,
        labelBarcodeType: true,
        labelLayoutOrder: true,
        labelDefaultCopies: true,
        labelShowProductName: true,
        labelShowPrice: true,
        labelShowSku: true,
        labelShowBarcodeText: true,
        labelShowCurrency: true,
        labelShowStoreName: true,
        labelBarcodeHeightMm: true,
        labelFontSize: true,
        labelRollGapMm: true,
        labelRollXOffsetMm: true,
        labelRollYOffsetMm: true,
        labelWidthMm: true,
        labelHeightMm: true,
        labelMarginTopMm: true,
        labelMarginRightMm: true,
        labelMarginBottomMm: true,
        labelMarginLeftMm: true,
        labelLastPrintedAt: true,
        connectorDeviceId: true,
        updatedById: true,
        updatedAt: true,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "STORE_PRINTER_SETTINGS_UPDATE",
      entity: "StorePrinterSettings",
      entityId: updated.id,
      before: toJson(before),
      after: toJson(updated),
      requestId: input.requestId,
    });

    return {
      ...updated,
      receiptPrintProvider: normalizePrintProvider(updated.receiptPrintProvider),
      labelPrintProvider: normalizePrintProvider(updated.labelPrintProvider),
      receiptFallbackMode: updated.receiptFallbackMode ?? defaultManualFallbackProvider,
      receiptTemplateUsage: updated.receiptTemplateUsage ?? defaultReceiptTemplateUsage,
      receiptPaperSize: updated.receiptPaperSize ?? defaultReceiptPaperSize,
      receiptCustomWidthMm: updated.receiptCustomWidthMm ?? defaultReceiptWidthMm,
      receiptCustomHeightMm: updated.receiptCustomHeightMm ?? defaultReceiptHeightMm,
      receiptMarginTopMm: updated.receiptMarginTopMm ?? defaultReceiptMarginTopMm,
      receiptMarginRightMm: updated.receiptMarginRightMm ?? defaultReceiptMarginRightMm,
      receiptMarginBottomMm: updated.receiptMarginBottomMm ?? defaultReceiptMarginBottomMm,
      receiptMarginLeftMm: updated.receiptMarginLeftMm ?? defaultReceiptMarginLeftMm,
      receiptFontSize: updated.receiptFontSize ?? defaultReceiptFontSize,
      receiptFooterText: updated.receiptFooterText ?? "",
      receiptPrinterModel: updated.receiptPrinterModel ?? defaultReceiptPrinterModel,
      labelPrinterModel: updated.labelPrinterModel ?? defaultLabelPrinterModel,
      labelTemplate: updated.labelTemplate ?? defaultLabelTemplate,
      labelPaperMode: updated.labelPaperMode ?? defaultLabelPaperMode,
      labelBarcodeType: updated.labelBarcodeType ?? defaultLabelBarcodeType,
      labelLayoutOrder: updated.labelLayoutOrder ?? defaultLabelLayoutOrder,
      labelDefaultCopies: updated.labelDefaultCopies ?? defaultLabelCopies,
      labelBarcodeHeightMm: updated.labelBarcodeHeightMm ?? defaultLabelBarcodeHeightMm,
      labelFontSize: updated.labelFontSize ?? defaultLabelFontSize,
      labelRollGapMm: updated.labelRollGapMm ?? defaultLabelRollGapMm,
      labelRollXOffsetMm: updated.labelRollXOffsetMm ?? defaultLabelRollXOffsetMm,
      labelRollYOffsetMm: updated.labelRollYOffsetMm ?? defaultLabelRollYOffsetMm,
      labelWidthMm: updated.labelWidthMm ?? defaultLabelWidthMm,
      labelHeightMm: updated.labelHeightMm ?? defaultLabelHeightMm,
      labelMarginTopMm: updated.labelMarginTopMm ?? defaultLabelMarginMm,
      labelMarginRightMm: updated.labelMarginRightMm ?? defaultLabelMarginMm,
      labelMarginBottomMm: updated.labelMarginBottomMm ?? defaultLabelMarginMm,
      labelMarginLeftMm: updated.labelMarginLeftMm ?? defaultLabelMarginMm,
    };
  });
};
