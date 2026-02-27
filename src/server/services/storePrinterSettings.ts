import { PrinterPrintMode } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";

export const defaultReceiptPrinterModel = "XP-P501A";
export const defaultLabelPrinterModel = "XP-365B";
export const defaultLabelRollGapMm = 3.5;
export const defaultLabelRollXOffsetMm = 0;
export const defaultLabelRollYOffsetMm = 0;

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
        labelRollGapMm: true,
        labelRollXOffsetMm: true,
        labelRollYOffsetMm: true,
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
          labelRollGapMm: settings.labelRollGapMm ?? defaultLabelRollGapMm,
          labelRollXOffsetMm: settings.labelRollXOffsetMm ?? defaultLabelRollXOffsetMm,
          labelRollYOffsetMm: settings.labelRollYOffsetMm ?? defaultLabelRollYOffsetMm,
        }
      : {
          id: null,
          storeId: input.storeId,
          receiptPrintMode: PrinterPrintMode.PDF,
          labelPrintMode: PrinterPrintMode.PDF,
          receiptPrinterModel: defaultReceiptPrinterModel,
          labelPrinterModel: defaultLabelPrinterModel,
          labelRollGapMm: defaultLabelRollGapMm,
          labelRollXOffsetMm: defaultLabelRollXOffsetMm,
          labelRollYOffsetMm: defaultLabelRollYOffsetMm,
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
  labelRollGapMm?: number | null;
  labelRollXOffsetMm?: number | null;
  labelRollYOffsetMm?: number | null;
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
        labelRollGapMm: input.labelRollGapMm ?? defaultLabelRollGapMm,
        labelRollXOffsetMm: input.labelRollXOffsetMm ?? defaultLabelRollXOffsetMm,
        labelRollYOffsetMm: input.labelRollYOffsetMm ?? defaultLabelRollYOffsetMm,
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
        labelRollGapMm: input.labelRollGapMm ?? undefined,
        labelRollXOffsetMm: input.labelRollXOffsetMm ?? undefined,
        labelRollYOffsetMm: input.labelRollYOffsetMm ?? undefined,
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
        labelRollGapMm: true,
        labelRollXOffsetMm: true,
        labelRollYOffsetMm: true,
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
      labelRollGapMm: updated.labelRollGapMm ?? defaultLabelRollGapMm,
      labelRollXOffsetMm: updated.labelRollXOffsetMm ?? defaultLabelRollXOffsetMm,
      labelRollYOffsetMm: updated.labelRollYOffsetMm ?? defaultLabelRollYOffsetMm,
    };
  });
};
