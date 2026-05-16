import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { formatKgsMoney } from "@/lib/currencyDisplay";
import type { ReceiptPrintJob, ReceiptTemplateSettings } from "@/server/printing/types";

export type PosReceiptPdfLabels = {
  title: string;
  precheckTitle: string;
  precheckHint: string;
  fiscalBlockTitle: string;
  fiscalStatus: string;
  fiscalStatusSent: string;
  fiscalStatusNotSent: string;
  fiscalStatusFailed: string;
  fiscalRetryHint: string;
  fiscalizedAt: string;
  kkmFactoryNumber: string;
  kkmRegistrationNumber: string;
  fiscalNumber: string;
  upfdOrFiscalMemory: string;
  qrPayload: string;
  saleNumber: string;
  createdAt: string;
  register: string;
  cashier: string;
  shift: string;
  inn: string;
  address: string;
  phone: string;
  qty: string;
  barcode: string;
  subtotal: string;
  discount: string;
  total: string;
  payments: string;
  change: string;
  footer: string;
};

const mmToPoints = (millimeters: number) => (millimeters * 72) / 25.4;
const RECEIPT_WIDTH_MM = 58;
const RECEIPT_MIN_HEIGHT_MM = 62;
const RECEIPT_HEIGHT_BUFFER_MM = 4;
const RECEIPT_MARGIN_X_MM = 2;
const RECEIPT_MARGIN_Y_MM = 3;
const PRINT_BLACK = "#000000";

export const defaultReceiptTemplateSettings: ReceiptTemplateSettings = {
  receiptPaperSize: "58MM",
  receiptCustomWidthMm: RECEIPT_WIDTH_MM,
  receiptCustomHeightMm: 0,
  receiptMarginTopMm: RECEIPT_MARGIN_Y_MM,
  receiptMarginRightMm: RECEIPT_MARGIN_X_MM,
  receiptMarginBottomMm: RECEIPT_MARGIN_Y_MM,
  receiptMarginLeftMm: RECEIPT_MARGIN_X_MM,
  receiptFontSize: 8.4,
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
};

export const resolveReceiptTemplateSettings = (
  settings?: Partial<ReceiptTemplateSettings> | null,
): ReceiptTemplateSettings => ({
  ...defaultReceiptTemplateSettings,
  ...settings,
  receiptFooterText: settings?.receiptFooterText?.trim() ?? "",
});

const resolveReceiptWidthMm = (settings: ReceiptTemplateSettings) => {
  if (settings.receiptPaperSize === "80MM") {
    return 80;
  }
  if (settings.receiptPaperSize === "A4") {
    return 210;
  }
  if (settings.receiptPaperSize === "CUSTOM") {
    return Math.max(40, Math.min(210, settings.receiptCustomWidthMm || RECEIPT_WIDTH_MM));
  }
  return RECEIPT_WIDTH_MM;
};

const resolveMinimumReceiptHeightMm = (settings: ReceiptTemplateSettings) => {
  if (settings.receiptPaperSize === "A4") {
    return 297;
  }
  if (settings.receiptPaperSize === "CUSTOM" && settings.receiptCustomHeightMm > 0) {
    return settings.receiptCustomHeightMm;
  }
  return RECEIPT_MIN_HEIGHT_MM;
};

const formatReceiptCurrency = (amountKgs: number, job: ReceiptPrintJob) =>
  formatKgsMoney(amountKgs, job.locale, {
    currencyCode: job.currencyCode,
    currencyRateKgsPerUnit: job.currencyRateKgsPerUnit,
  });

export const __formatReceiptCurrencyForTests = formatReceiptCurrency;

const formatDateTime = (value: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);

const amountsEqual = (left: number, right: number) => Math.abs(left - right) < 0.0001;

const buildReceiptMetaLines = (input: {
  job: ReceiptPrintJob;
  labels: PosReceiptPdfLabels;
  settings: ReceiptTemplateSettings;
}) => {
  const businessName = input.job.legalName?.trim() || input.job.storeName;
  const businessLines: string[] = [];
  const saleLines: string[] = [];

  if (input.settings.receiptShowStoreAddress && input.job.address?.trim()) {
    businessLines.push(`${input.labels.address}: ${input.job.address}`);
  }
  if (input.settings.receiptShowStorePhone && input.job.phone?.trim()) {
    businessLines.push(`${input.labels.phone}: ${input.job.phone}`);
  }
  if (input.settings.receiptShowSaleNumber) {
    saleLines.push(`${input.labels.saleNumber}: ${input.job.number}`);
  }
  if (input.settings.receiptShowDateTime) {
    saleLines.push(
      `${input.labels.createdAt}: ${formatDateTime(input.job.createdAt, input.job.locale)}`,
    );
  }
  if (input.settings.receiptShowCashierName && input.job.registerName) {
    saleLines.push(`${input.labels.register}: ${input.job.registerName}`);
  }
  if (input.settings.receiptShowCashierName && input.job.cashierName) {
    saleLines.push(`${input.labels.cashier}: ${input.job.cashierName}`);
  }

  return {
    businessName,
    businessLines,
    saleLines,
  };
};

export const __buildReceiptMetaLinesForTests = buildReceiptMetaLines;

const truncateSingleLine = (
  doc: InstanceType<typeof PDFDocument>,
  text: string,
  width: number,
  fontSize: number,
) => {
  doc.fontSize(fontSize);
  if (doc.widthOfString(text) <= width) {
    return text;
  }
  const ellipsis = "…";
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${text.slice(0, mid)}${ellipsis}`;
    if (doc.widthOfString(candidate) <= width) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${text.slice(0, low)}${ellipsis}`;
};

const estimateReceiptHeight = (input: {
  job: ReceiptPrintJob;
  labels: PosReceiptPdfLabels;
  settings: ReceiptTemplateSettings;
  doc: InstanceType<typeof PDFDocument>;
  marginY: number;
  contentWidth: number;
}) => {
  const { doc, contentWidth, marginY } = input;
  const settings = input.settings;
  const showSubtotal =
    settings.receiptShowSubtotal &&
    !amountsEqual(input.job.totals.subtotalKgs, input.job.totals.totalKgs);
  const metaLines = buildReceiptMetaLines({
    job: input.job,
    labels: input.labels,
    settings,
  });
  let y = marginY;

  const measureMetaLine = (text: string, fontSize: number, gap = 2) => {
    doc.fontSize(fontSize);
    y += doc.heightOfString(text, { width: contentWidth }) + gap;
  };

  y += 14;

  if (settings.receiptShowStoreName) {
    measureMetaLine(metaLines.businessName, settings.receiptFontSize + 0.4);
  }
  for (const line of metaLines.businessLines) {
    measureMetaLine(line, 7.5);
  }

  y += 2;
  for (const line of metaLines.saleLines) {
    measureMetaLine(line, 7.5);
  }

  y += 6;

  for (const item of input.job.items) {
    const titleParts = [
      settings.receiptShowProductName ? item.name : "",
      settings.receiptShowProductSku && item.sku ? `(${item.sku})` : "",
    ].filter(Boolean);
    if (titleParts.length) {
      doc.fontSize(settings.receiptFontSize);
      y += doc.heightOfString(titleParts.join(" "), { width: contentWidth }) + 1;
    }
    if (settings.receiptShowProductBarcode && item.barcode) {
      y += 9;
    }
    if (settings.receiptShowProductQuantity || settings.receiptShowProductUnitPrice) {
      y += 11;
    }
    y += 4;
  }

  if (showSubtotal) {
    y += 12;
  }
  y += 13;

  if (settings.receiptShowPaymentMethod && input.job.totals.payments.length) {
    y += 2;
    y += 4;
    y += 11;
    y += input.job.totals.payments.length * 11;
  }

  y += 6;

  return y + marginY + mmToPoints(RECEIPT_HEIGHT_BUFFER_MM);
};

export const buildPosReceiptPdf = async (input: {
  job: ReceiptPrintJob;
  labels: PosReceiptPdfLabels;
  settings?: Partial<ReceiptTemplateSettings> | null;
}) => {
  const settings = resolveReceiptTemplateSettings(input.settings);
  const receiptWidth = mmToPoints(resolveReceiptWidthMm(settings));
  const marginLeft = mmToPoints(settings.receiptMarginLeftMm);
  const marginRight = mmToPoints(settings.receiptMarginRightMm);
  const marginTop = mmToPoints(settings.receiptMarginTopMm);
  const marginBottom = mmToPoints(settings.receiptMarginBottomMm);
  const marginY = marginTop;
  const baseFont = settings.receiptFontSize;
  const fontPath = join(process.cwd(), "assets", "fonts", "NotoSans-Regular.ttf");
  const fallbackPath = join(process.cwd(), "assets", "fonts", "ArialUnicode.ttf");
  const resolvedFont = existsSync(fontPath)
    ? fontPath
    : existsSync(fallbackPath)
      ? fallbackPath
      : null;
  const left = marginLeft;
  const rightEdge = receiptWidth - marginRight;
  const contentWidth = rightEdge - left;
  const amountColumnWidth = Math.max(56, contentWidth * 0.44);
  const showSubtotal =
    settings.receiptShowSubtotal &&
    !amountsEqual(input.job.totals.subtotalKgs, input.job.totals.totalKgs);
  const showDiscount =
    settings.receiptShowDiscount &&
    !amountsEqual(input.job.totals.subtotalKgs, input.job.totals.totalKgs);
  const showLineTotalPerItem = input.job.items.length > 1;
  const paymentsTotal = input.job.totals.payments.reduce(
    (sum, payment) => sum + payment.amountKgs,
    0,
  );
  const change = Math.max(0, paymentsTotal - input.job.totals.totalKgs);
  const metaLines = buildReceiptMetaLines({
    job: input.job,
    labels: input.labels,
    settings,
  });

  const measureDoc = new PDFDocument({
    autoFirstPage: false,
    size: [receiptWidth, mmToPoints(500)],
    margin: 0,
    compress: false,
  });
  if (resolvedFont) {
    measureDoc.registerFont("Body", resolvedFont);
    measureDoc.font("Body");
  }
  measureDoc.addPage({ size: [receiptWidth, mmToPoints(500)], margin: 0 });
  const receiptPageHeight = Math.max(
    mmToPoints(RECEIPT_MIN_HEIGHT_MM),
    estimateReceiptHeight({
      job: input.job,
      labels: input.labels,
      settings,
      doc: measureDoc,
      marginY,
      contentWidth,
    }),
    mmToPoints(resolveMinimumReceiptHeightMm(settings)),
  );
  measureDoc.end();

  const doc = new PDFDocument({
    autoFirstPage: false,
    size: [receiptWidth, receiptPageHeight],
    margin: 0,
    compress: false,
  });
  if (resolvedFont) {
    doc.registerFont("Body", resolvedFont);
    doc.font("Body");
  }

  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  doc.addPage({ size: [receiptWidth, receiptPageHeight], margin: 0 });

  let y = marginTop;

  const drawSeparator = () => {
    doc.moveTo(left, y).lineTo(rightEdge, y).strokeColor(PRINT_BLACK).lineWidth(0.9).stroke();
    y += 4;
  };

  const drawMetaLine = (text: string, fontSize = 7.5, gap = 2) => {
    doc.fontSize(fontSize).fillColor(PRINT_BLACK);
    const height = doc.heightOfString(text, { width: contentWidth });
    doc.text(text, left, y, { width: contentWidth });
    y += height + gap;
  };

  const drawAmountRow = (label: string, value: string, emphasized = false) => {
    const labelFont = emphasized ? 9 : 8;
    const valueFont = emphasized ? 9.5 : 8;
    doc.fontSize(labelFont).fillColor(PRINT_BLACK);
    doc.text(label, left, y, {
      width: contentWidth - amountColumnWidth - 4,
      lineBreak: false,
    });
    doc.fontSize(valueFont).fillColor(PRINT_BLACK);
    doc.text(value, rightEdge - amountColumnWidth, y, {
      width: amountColumnWidth,
      align: "right",
      lineBreak: false,
    });
    y += emphasized ? 13 : 12;
  };

  doc
    .fontSize(baseFont + 1.6)
    .fillColor(PRINT_BLACK)
    .text(input.labels.title, left, y, {
      width: contentWidth,
      align: "center",
      lineBreak: false,
    });
  y += baseFont + 5;

  if (settings.receiptShowStoreName) {
    doc.fontSize(baseFont + 0.4).fillColor(PRINT_BLACK);
    const businessHeight = doc.heightOfString(metaLines.businessName, { width: contentWidth });
    doc.text(metaLines.businessName, left, y, { width: contentWidth, align: "left" });
    y += businessHeight + 2;
  }

  for (const line of metaLines.businessLines) {
    drawMetaLine(line);
  }

  y += 2;
  for (const line of metaLines.saleLines) {
    drawMetaLine(line);
  }

  y += 2;
  drawSeparator();

  for (const item of input.job.items) {
    const nameParts = [
      settings.receiptShowProductName ? item.name : "",
      settings.receiptShowProductSku && item.sku ? `(${item.sku})` : "",
    ].filter(Boolean);
    if (nameParts.length) {
      doc.fontSize(baseFont).fillColor(PRINT_BLACK);
      const name = nameParts.join(" ");
      const nameHeight = doc.heightOfString(name, { width: contentWidth });
      doc.text(name, left, y, {
        width: contentWidth,
      });
      y += nameHeight + 1;
    }

    if (settings.receiptShowProductBarcode && item.barcode) {
      doc.fontSize(baseFont - 1).fillColor(PRINT_BLACK);
      doc.text(`${input.labels.barcode}: ${item.barcode}`, left, y, {
        width: contentWidth,
        lineBreak: false,
      });
      y += 9;
    }

    if (settings.receiptShowProductQuantity || settings.receiptShowProductUnitPrice) {
      const detailWidth = showLineTotalPerItem
        ? contentWidth - amountColumnWidth - 4
        : contentWidth;
      const detailParts = [
        settings.receiptShowProductQuantity ? `${input.labels.qty}: ${item.qty}` : "",
        settings.receiptShowProductUnitPrice
          ? formatReceiptCurrency(item.unitPriceKgs, input.job)
          : "",
      ].filter(Boolean);
      const qtyLine = truncateSingleLine(doc, detailParts.join(" × "), detailWidth, baseFont - 0.9);
      doc.fontSize(baseFont - 0.9).fillColor(PRINT_BLACK);
      doc.text(qtyLine, left, y, {
        width: detailWidth,
        lineBreak: false,
      });
      if (showLineTotalPerItem) {
        doc.text(
          formatReceiptCurrency(item.lineTotalKgs, input.job),
          rightEdge - amountColumnWidth,
          y,
          {
            width: amountColumnWidth,
            align: "right",
            lineBreak: false,
          },
        );
      }
      y += 11;
    }
    drawSeparator();
  }

  if (showSubtotal) {
    drawAmountRow(
      input.labels.subtotal,
      formatReceiptCurrency(input.job.totals.subtotalKgs, input.job),
    );
  }
  if (showDiscount) {
    drawAmountRow(
      input.labels.discount,
      formatReceiptCurrency(input.job.totals.subtotalKgs - input.job.totals.totalKgs, input.job),
    );
  }
  if (settings.receiptShowTotal) {
    drawAmountRow(
      input.labels.total,
      formatReceiptCurrency(input.job.totals.totalKgs, input.job),
      true,
    );
  }

  if (settings.receiptShowPaymentMethod && input.job.totals.payments.length) {
    y += 2;
    drawSeparator();
    doc.fontSize(8).fillColor(PRINT_BLACK).text(input.labels.payments, left, y, {
      width: contentWidth,
      lineBreak: false,
    });
    y += 11;
    for (const payment of input.job.totals.payments) {
      doc.fontSize(7.5).fillColor(PRINT_BLACK);
      doc.text(payment.methodLabel, left, y, {
        width: contentWidth - amountColumnWidth - 4,
        lineBreak: false,
      });
      doc.text(
        formatReceiptCurrency(payment.amountKgs, input.job),
        rightEdge - amountColumnWidth,
        y,
        {
          width: amountColumnWidth,
          align: "right",
          lineBreak: false,
        },
      );
      y += 11;
    }
  }
  if (settings.receiptShowChange && change > 0.009) {
    drawAmountRow(input.labels.change, formatReceiptCurrency(change, input.job));
  }

  y += 2;
  drawSeparator();

  if (settings.receiptFooterText) {
    doc.fontSize(baseFont - 0.7).fillColor(PRINT_BLACK);
    doc.text(settings.receiptFooterText, left, y, {
      width: contentWidth,
      align: "center",
    });
    y += doc.heightOfString(settings.receiptFooterText, { width: contentWidth }) + 2;
  }

  y += marginBottom;

  doc.end();
  await new Promise((resolve) => doc.on("end", resolve));
  return Buffer.concat(chunks);
};
