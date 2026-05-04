import { PrinterPrintMode } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";

export const defaultReceiptPrinterModel = "XP-P501A";
export const defaultLabelPrinterModel = "XP-365B";
export const defaultLabelTemplate = "xp365b-roll-58x40";
export const defaultLabelPaperMode = "ROLL";
export const defaultLabelBarcodeType = "auto";
export const defaultLabelCopies = 1;
export const defaultLabelWidthMm = 58;
export const defaultLabelHeightMm = 40;
export const defaultLabelRollGapMm = 3.5;
export const defaultLabelRollXOffsetMm = 0;
export const defaultLabelRollYOffsetMm = 0;
export const defaultLabelMarginMm = 0;

const normalizePrinterModel = (value: string | null | undefined, fallback: string) => {
  const next = value?.trim();
  return next ? next : fallback;
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
        receiptPrinterModel: true,
        labelPrinterModel: true,
        labelTemplate: true,
        labelPaperMode: true,
        labelBarcodeType: true,
        labelDefaultCopies: true,
        labelShowProductName: true,
        labelShowPrice: true,
        labelShowSku: true,
        labelShowStoreName: true,
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
          receiptPrinterModel: settings.receiptPrinterModel ?? defaultReceiptPrinterModel,
          labelPrinterModel: settings.labelPrinterModel ?? defaultLabelPrinterModel,
          labelTemplate: settings.labelTemplate ?? defaultLabelTemplate,
          labelPaperMode: settings.labelPaperMode ?? defaultLabelPaperMode,
          labelBarcodeType: settings.labelBarcodeType ?? defaultLabelBarcodeType,
          labelDefaultCopies: settings.labelDefaultCopies ?? defaultLabelCopies,
          labelShowProductName: settings.labelShowProductName,
          labelShowPrice: settings.labelShowPrice,
          labelShowSku: settings.labelShowSku,
          labelShowStoreName: settings.labelShowStoreName,
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
          receiptPrinterModel: defaultReceiptPrinterModel,
          labelPrinterModel: defaultLabelPrinterModel,
          labelTemplate: defaultLabelTemplate,
          labelPaperMode: defaultLabelPaperMode,
          labelBarcodeType: defaultLabelBarcodeType,
          labelDefaultCopies: defaultLabelCopies,
          labelShowProductName: true,
          labelShowPrice: true,
          labelShowSku: true,
          labelShowStoreName: false,
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
  receiptPrinterModel?: string | null;
  labelPrinterModel?: string | null;
  labelTemplate?: string | null;
  labelPaperMode?: string | null;
  labelBarcodeType?: string | null;
  labelDefaultCopies?: number | null;
  labelShowProductName?: boolean;
  labelShowPrice?: boolean;
  labelShowSku?: boolean;
  labelShowStoreName?: boolean;
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
        receiptPrinterModel: normalizePrinterModel(
          input.receiptPrinterModel,
          defaultReceiptPrinterModel,
        ),
        labelPrinterModel: normalizePrinterModel(input.labelPrinterModel, defaultLabelPrinterModel),
        labelTemplate: input.labelTemplate ?? defaultLabelTemplate,
        labelPaperMode: input.labelPaperMode ?? defaultLabelPaperMode,
        labelBarcodeType: input.labelBarcodeType ?? defaultLabelBarcodeType,
        labelDefaultCopies: input.labelDefaultCopies ?? defaultLabelCopies,
        labelShowProductName: input.labelShowProductName ?? true,
        labelShowPrice: input.labelShowPrice ?? true,
        labelShowSku: input.labelShowSku ?? true,
        labelShowStoreName: input.labelShowStoreName ?? false,
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
        receiptPrinterModel: normalizePrinterModel(
          input.receiptPrinterModel,
          defaultReceiptPrinterModel,
        ),
        labelPrinterModel: normalizePrinterModel(input.labelPrinterModel, defaultLabelPrinterModel),
        labelTemplate: input.labelTemplate ?? undefined,
        labelPaperMode: input.labelPaperMode ?? undefined,
        labelBarcodeType: input.labelBarcodeType ?? undefined,
        labelDefaultCopies: input.labelDefaultCopies ?? undefined,
        labelShowProductName: input.labelShowProductName,
        labelShowPrice: input.labelShowPrice,
        labelShowSku: input.labelShowSku,
        labelShowStoreName: input.labelShowStoreName,
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
        receiptPrinterModel: true,
        labelPrinterModel: true,
        labelTemplate: true,
        labelPaperMode: true,
        labelBarcodeType: true,
        labelDefaultCopies: true,
        labelShowProductName: true,
        labelShowPrice: true,
        labelShowSku: true,
        labelShowStoreName: true,
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
      receiptPrinterModel: updated.receiptPrinterModel ?? defaultReceiptPrinterModel,
      labelPrinterModel: updated.labelPrinterModel ?? defaultLabelPrinterModel,
      labelTemplate: updated.labelTemplate ?? defaultLabelTemplate,
      labelPaperMode: updated.labelPaperMode ?? defaultLabelPaperMode,
      labelBarcodeType: updated.labelBarcodeType ?? defaultLabelBarcodeType,
      labelDefaultCopies: updated.labelDefaultCopies ?? defaultLabelCopies,
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
