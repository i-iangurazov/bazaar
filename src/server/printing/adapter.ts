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
      labelLayoutOrder: true,
      labelShowProductName: true,
      labelShowPrice: true,
      labelShowSku: true,
      labelShowBarcodeText: true,
      labelShowCurrency: true,
      labelShowStoreName: true,
      labelBarcodeHeightMm: true,
      labelFontSize: true,
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
      settings,
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
      labelLayoutOrder: settings?.labelLayoutOrder ?? undefined,
      showProductName: settings?.labelShowProductName ?? undefined,
      showPrice: settings?.labelShowPrice ?? undefined,
      showSku: settings?.labelShowSku ?? undefined,
      showBarcodeText: settings?.labelShowBarcodeText ?? undefined,
      showCurrency: settings?.labelShowCurrency ?? undefined,
      showStoreName: settings?.labelShowStoreName ?? undefined,
      barcodeHeightMm: settings?.labelBarcodeHeightMm ?? undefined,
      labelFontSize: settings?.labelFontSize ?? undefined,
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
