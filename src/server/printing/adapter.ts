import { PrinterPrintMode } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import type { LabelPrintJob, ReceiptPrintJob } from "@/server/printing/types";
import { buildPriceTagsPdf } from "@/server/services/priceTagsPdf";
import { buildPosReceiptPdf, type PosReceiptPdfLabels } from "@/server/services/posReceiptPdf";
import { AppError } from "@/server/services/errors";

export type PrintDispatchResult = {
  mode: "PDF";
  pdf: Buffer;
  fileName: string;
};

const resolveStoreSettings = async (storeId: string) => {
  return prisma.storePrinterSettings.findUnique({
    where: { storeId },
    select: {
      receiptPrintMode: true,
      labelPrintMode: true,
      connectorDeviceId: true,
    },
  });
};

const assertConnectorReady = async (input: {
  organizationId: string;
  storeId: string;
  connectorDeviceId?: string | null;
}) => {
  if (!input.connectorDeviceId) {
    throw new AppError("printerConnectorNotPaired", "CONFLICT", 409);
  }

  const device = await prisma.kkmConnectorDevice.findFirst({
    where: {
      id: input.connectorDeviceId,
      organizationId: input.organizationId,
      storeId: input.storeId,
      isActive: true,
    },
    select: { id: true },
  });

  if (!device) {
    throw new AppError("printerConnectorNotPaired", "CONFLICT", 409);
  }
};

export const printReceipt = async (input: {
  organizationId: string;
  job: ReceiptPrintJob;
  labels: PosReceiptPdfLabels;
}): Promise<PrintDispatchResult> => {
  const settings = await resolveStoreSettings(input.job.storeId);
  const mode = settings?.receiptPrintMode ?? PrinterPrintMode.PDF;

  if (mode === PrinterPrintMode.PDF) {
    const pdf = await buildPosReceiptPdf({
      job: input.job,
      labels: input.labels,
    });

    return {
      mode: "PDF",
      pdf,
      fileName: `pos-receipt-${input.job.number}-${input.job.variant.toLowerCase()}.pdf`,
    };
  }

  await assertConnectorReady({
    organizationId: input.organizationId,
    storeId: input.job.storeId,
    connectorDeviceId: settings?.connectorDeviceId,
  });

  throw new AppError("printerConnectorNotImplemented", "CONFLICT", 409);
};

export const printLabels = async (input: {
  organizationId: string;
  job: LabelPrintJob;
}): Promise<PrintDispatchResult> => {
  const settings = await resolveStoreSettings(input.job.storeId);
  const mode = settings?.labelPrintMode ?? PrinterPrintMode.PDF;

  if (mode === PrinterPrintMode.PDF) {
    const pdf = await buildPriceTagsPdf({
      labels: input.job.labels,
      template: input.job.template,
      locale: input.job.locale,
      storeName: input.job.storeName,
      noPriceLabel: input.job.noPriceLabel,
      noBarcodeLabel: input.job.noBarcodeLabel,
      skuLabel: input.job.skuLabel,
    });

    return {
      mode: "PDF",
      pdf,
      fileName: `price-tags-${input.job.template}.pdf`,
    };
  }

  await assertConnectorReady({
    organizationId: input.organizationId,
    storeId: input.job.storeId,
    connectorDeviceId: settings?.connectorDeviceId,
  });

  throw new AppError("printerConnectorNotImplemented", "CONFLICT", 409);
};
