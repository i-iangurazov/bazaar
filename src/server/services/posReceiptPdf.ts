import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ReceiptPrintJob } from "@/server/printing/types";

type BwipModule = { toBuffer: (options: Record<string, unknown>) => Promise<Buffer> };

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
  subtotal: string;
  total: string;
  payments: string;
};

const mmToPoints = (millimeters: number) => (millimeters * 72) / 25.4;
const RECEIPT_WIDTH_MM = 58;
const RECEIPT_MIN_HEIGHT_MM = 62;
const RECEIPT_HEIGHT_BUFFER_MM = 4;
const RECEIPT_MARGIN_X_MM = 2;
const RECEIPT_MARGIN_Y_MM = 3;
const QR_MM = 16;

const formatCurrency = (amount: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: "currency", currency: "KGS" }).format(amount);

const formatAmount = (amount: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

const formatDateTime = (value: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);

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

const createQrPng = async (value: string) => {
  const qrText = value.trim();
  if (!qrText) {
    return null;
  }

  const bwipModule = (await import("bwip-js")) as unknown as BwipModule & {
    default?: BwipModule;
  };
  const bwip = bwipModule.default ?? bwipModule;
  return bwip.toBuffer({
    bcid: "qrcode",
    text: qrText,
    scale: 3,
    includetext: false,
    paddingwidth: 0,
    paddingheight: 0,
  });
};

const fiscalStatusLabel = (job: ReceiptPrintJob, labels: PosReceiptPdfLabels) => {
  if (job.fiscal.modeStatus === "SENT") {
    return labels.fiscalStatusSent;
  }
  if (job.fiscal.modeStatus === "FAILED") {
    return labels.fiscalStatusFailed;
  }
  return labels.fiscalStatusNotSent;
};

const estimateReceiptHeight = (input: {
  job: ReceiptPrintJob;
  labels: PosReceiptPdfLabels;
  doc: InstanceType<typeof PDFDocument>;
  marginY: number;
  contentWidth: number;
  hasQr: boolean;
}) => {
  const { doc, contentWidth, marginY } = input;
  let y = marginY;

  const measureMetaLine = (text: string, fontSize: number, gap = 2) => {
    doc.fontSize(fontSize);
    y += doc.heightOfString(text, { width: contentWidth }) + gap;
  };

  y += 14;

  measureMetaLine(input.job.legalName?.trim() || input.job.storeName, 8.8);
  if (input.job.inn?.trim()) {
    measureMetaLine(`${input.labels.inn}: ${input.job.inn}`, 7.5);
  }
  if (input.job.address?.trim()) {
    measureMetaLine(`${input.labels.address}: ${input.job.address}`, 7.5);
  }
  if (input.job.phone?.trim()) {
    measureMetaLine(`${input.labels.phone}: ${input.job.phone}`, 7.5);
  }

  y += 2;
  measureMetaLine(`${input.labels.saleNumber}: ${input.job.number}`, 7.5);
  measureMetaLine(`${input.labels.createdAt}: ${formatDateTime(input.job.createdAt, input.job.locale)}`, 7.5);
  if (input.job.registerName) {
    measureMetaLine(`${input.labels.register}: ${input.job.registerName}`, 7.5);
  }
  if (input.job.cashierName) {
    measureMetaLine(`${input.labels.cashier}: ${input.job.cashierName}`, 7.5);
  }
  if (input.job.shiftLabel) {
    measureMetaLine(`${input.labels.shift}: ${input.job.shiftLabel}`, 7.5);
  }

  if (input.job.variant === "PRECHECK") {
    y += 6;
    doc.fontSize(8.6);
    y += doc.heightOfString(input.labels.precheckTitle, { width: contentWidth - 6 }) + 2;
    doc.fontSize(6.7);
    y += doc.heightOfString(input.labels.precheckHint, { width: contentWidth - 6 }) + 7;
  }

  y += 4;
  y += 4;

  for (const item of input.job.items) {
    const title = item.sku ? `${item.name} (${item.sku})` : item.name;
    doc.fontSize(8.4);
    y += doc.heightOfString(title, { width: contentWidth }) + 1;
    y += 11;
    y += 4;
  }

  y += 12;
  y += 13;

  if (input.job.totals.payments.length) {
    y += 2;
    y += 4;
    y += 11;
    y += input.job.totals.payments.length * 11;
  }

  y += 4;
  y += 11;
  measureMetaLine(`${input.labels.fiscalStatus}: ${fiscalStatusLabel(input.job, input.labels)}`, 7.5);
  if (input.job.variant === "PRECHECK") {
    if (input.job.fiscal.modeStatus === "FAILED") {
      measureMetaLine(input.labels.fiscalRetryHint, 7.2);
    }
  } else {
    if (input.job.fiscal.fiscalizedAt) {
      measureMetaLine(
        `${input.labels.fiscalizedAt}: ${formatDateTime(input.job.fiscal.fiscalizedAt, input.job.locale)}`,
        7.5,
      );
    }
    const fields = [
      input.job.fiscal.kkmFactoryNumber,
      input.job.fiscal.kkmRegistrationNumber,
      input.job.fiscal.fiscalNumber,
      input.job.fiscal.upfdOrFiscalMemory,
    ].filter(Boolean);
    y += fields.length * 10;
    if (input.hasQr) {
      y += mmToPoints(QR_MM) + 12;
    } else if (input.job.fiscal.qrPayload) {
      measureMetaLine(`${input.labels.qrPayload}: ${input.job.fiscal.qrPayload}`, 7.2);
    }
  }

  return y + marginY + mmToPoints(RECEIPT_HEIGHT_BUFFER_MM);
};

export const buildPosReceiptPdf = async (input: {
  job: ReceiptPrintJob;
  labels: PosReceiptPdfLabels;
}) => {
  const receiptWidth = mmToPoints(RECEIPT_WIDTH_MM);
  const marginX = mmToPoints(RECEIPT_MARGIN_X_MM);
  const marginY = mmToPoints(RECEIPT_MARGIN_Y_MM);
  const fontPath = join(process.cwd(), "assets", "fonts", "NotoSans-Regular.ttf");
  const fallbackPath = join(process.cwd(), "assets", "fonts", "ArialUnicode.ttf");
  const resolvedFont = existsSync(fontPath) ? fontPath : existsSync(fallbackPath) ? fallbackPath : null;
  const left = marginX;
  const rightEdge = receiptWidth - marginX;
  const contentWidth = rightEdge - left;
  const amountColumnWidth = Math.max(56, contentWidth * 0.44);
  const qrImage =
    input.job.variant === "FISCAL" && input.job.fiscal.qrPayload
      ? await createQrPng(input.job.fiscal.qrPayload).catch(() => null)
      : null;

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
      doc: measureDoc,
      marginY,
      contentWidth,
      hasQr: Boolean(qrImage),
    }),
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

  let y = marginY;

  const drawSeparator = () => {
    doc.moveTo(left, y).lineTo(rightEdge, y).strokeColor("#CFCFCF").lineWidth(0.7).stroke();
    y += 4;
  };

  const drawMetaLine = (text: string, fontSize = 7.5, gap = 2) => {
    doc.fontSize(fontSize).fillColor("#444444");
    const height = doc.heightOfString(text, { width: contentWidth });
    doc.text(text, left, y, { width: contentWidth });
    y += height + gap;
  };

  const drawAmountRow = (label: string, value: string, emphasized = false) => {
    const labelFont = emphasized ? 9 : 8;
    const valueFont = emphasized ? 9.5 : 8;
    doc.fontSize(labelFont).fillColor(emphasized ? "#111111" : "#333333");
    doc.text(label, left, y, {
      width: contentWidth - amountColumnWidth - 4,
      lineBreak: false,
    });
    doc.fontSize(valueFont).fillColor("#111111");
    doc.text(value, rightEdge - amountColumnWidth, y, {
      width: amountColumnWidth,
      align: "right",
      lineBreak: false,
    });
    y += emphasized ? 13 : 12;
  };

  doc.fontSize(10).fillColor("#111111").text(input.labels.title, left, y, {
    width: contentWidth,
    align: "center",
    lineBreak: false,
  });
  y += 14;

  const businessName = input.job.legalName?.trim() || input.job.storeName;
  doc.fontSize(8.8).fillColor("#111111");
  const businessHeight = doc.heightOfString(businessName, { width: contentWidth });
  doc.text(businessName, left, y, { width: contentWidth, align: "left" });
  y += businessHeight + 2;

  if (input.job.inn?.trim()) {
    drawMetaLine(`${input.labels.inn}: ${input.job.inn}`);
  }
  if (input.job.address?.trim()) {
    drawMetaLine(`${input.labels.address}: ${input.job.address}`);
  }
  if (input.job.phone?.trim()) {
    drawMetaLine(`${input.labels.phone}: ${input.job.phone}`);
  }

  y += 2;
  drawMetaLine(`${input.labels.saleNumber}: ${input.job.number}`);
  drawMetaLine(`${input.labels.createdAt}: ${formatDateTime(input.job.createdAt, input.job.locale)}`);
  if (input.job.registerName) {
    drawMetaLine(`${input.labels.register}: ${input.job.registerName}`);
  }
  if (input.job.cashierName) {
    drawMetaLine(`${input.labels.cashier}: ${input.job.cashierName}`);
  }
  if (input.job.shiftLabel) {
    drawMetaLine(`${input.labels.shift}: ${input.job.shiftLabel}`);
  }

  if (input.job.variant === "PRECHECK") {
    y += 2;
    const precheckBoxTop = y;
    const boxWidth = contentWidth;
    const boxX = left;
    const boxInnerX = boxX + 3;
    doc.fontSize(8.6).fillColor("#111111");
    const titleHeight = doc.heightOfString(input.labels.precheckTitle, { width: boxWidth - 6 });
    doc.fontSize(6.7);
    const hintHeight = doc.heightOfString(input.labels.precheckHint, { width: boxWidth - 6 });
    const boxHeight = titleHeight + hintHeight + 8;
    doc.rect(boxX, precheckBoxTop, boxWidth, boxHeight).fillColor("#F3F3F3").fill();
    doc.rect(boxX, precheckBoxTop, boxWidth, boxHeight).strokeColor("#D5D5D5").stroke();
    doc.fontSize(8.6).fillColor("#111111").text(input.labels.precheckTitle, boxInnerX, precheckBoxTop + 2, {
      width: boxWidth - 6,
      align: "center",
    });
    doc.fontSize(6.7).fillColor("#444444").text(input.labels.precheckHint, boxInnerX, precheckBoxTop + 4 + titleHeight, {
      width: boxWidth - 6,
      align: "left",
    });
    y += boxHeight + 2;
  }

  y += 2;
  drawSeparator();

  for (const item of input.job.items) {
    const name = item.sku ? `${item.name} (${item.sku})` : item.name;
    doc.fontSize(8.4).fillColor("#111111");
    const nameHeight = doc.heightOfString(name, { width: contentWidth });
    doc.text(name, left, y, {
      width: contentWidth,
    });
    y += nameHeight + 1;

    const qtyLine = truncateSingleLine(
      doc,
      `${input.labels.qty}: ${item.qty} × ${formatAmount(item.unitPriceKgs, input.job.locale)}`,
      contentWidth - amountColumnWidth - 4,
      7.5,
    );
    doc.fontSize(7.5).fillColor("#555555");
    doc.text(qtyLine, left, y, {
      width: contentWidth - amountColumnWidth - 4,
      lineBreak: false,
    });
    doc.text(formatCurrency(item.lineTotalKgs, input.job.locale), rightEdge - amountColumnWidth, y, {
      width: amountColumnWidth,
      align: "right",
      lineBreak: false,
    });
    y += 11;
    drawSeparator();
  }

  drawAmountRow(input.labels.subtotal, formatCurrency(input.job.totals.subtotalKgs, input.job.locale));
  drawAmountRow(input.labels.total, formatCurrency(input.job.totals.totalKgs, input.job.locale), true);

  if (input.job.totals.payments.length) {
    y += 2;
    drawSeparator();
    doc.fontSize(8).fillColor("#111111").text(input.labels.payments, left, y, {
      width: contentWidth,
      lineBreak: false,
    });
    y += 11;
    for (const payment of input.job.totals.payments) {
      doc.fontSize(7.5).fillColor("#444444");
      doc.text(payment.methodLabel, left, y, {
        width: contentWidth - amountColumnWidth - 4,
        lineBreak: false,
      });
      doc.text(formatCurrency(payment.amountKgs, input.job.locale), rightEdge - amountColumnWidth, y, {
        width: amountColumnWidth,
        align: "right",
        lineBreak: false,
      });
      y += 11;
    }
  }

  y += 2;
  drawSeparator();
  doc.fontSize(8).fillColor("#111111").text(input.labels.fiscalBlockTitle, left, y, {
    width: contentWidth,
    lineBreak: false,
  });
  y += 11;
  drawMetaLine(`${input.labels.fiscalStatus}: ${fiscalStatusLabel(input.job, input.labels)}`);

  if (input.job.variant === "PRECHECK") {
    if (input.job.fiscal.modeStatus === "FAILED") {
      drawMetaLine(input.labels.fiscalRetryHint, 7.2);
    }
  } else {
    if (input.job.fiscal.fiscalizedAt) {
      drawMetaLine(
        `${input.labels.fiscalizedAt}: ${formatDateTime(input.job.fiscal.fiscalizedAt, input.job.locale)}`,
      );
    }

    const fiscalFields: Array<[label: string, value: string | null]> = [
      [input.labels.kkmFactoryNumber, input.job.fiscal.kkmFactoryNumber],
      [input.labels.kkmRegistrationNumber, input.job.fiscal.kkmRegistrationNumber],
      [input.labels.fiscalNumber, input.job.fiscal.fiscalNumber],
      [input.labels.upfdOrFiscalMemory, input.job.fiscal.upfdOrFiscalMemory],
    ];

    for (const [label, value] of fiscalFields) {
      if (!value?.trim()) {
        continue;
      }
      const line = truncateSingleLine(doc, `${label}: ${value}`, contentWidth, 7.5);
      doc.fontSize(7.5).fillColor("#444444").text(line, left, y, {
        width: contentWidth,
        lineBreak: false,
      });
      y += 10;
    }

    if (qrImage) {
      const size = mmToPoints(QR_MM);
      const qrX = left + (contentWidth - size) / 2;
      doc.image(qrImage, qrX, y, { width: size, height: size });
      y += size + 2;
      const qrValue = truncateSingleLine(doc, input.job.fiscal.qrPayload ?? "", contentWidth, 6.5);
      doc.fontSize(6.5).fillColor("#444444").text(qrValue, left, y, {
        width: contentWidth,
        align: "center",
      });
      y += 10;
    } else if (input.job.fiscal.qrPayload) {
      drawMetaLine(`${input.labels.qrPayload}: ${input.job.fiscal.qrPayload}`, 7.2);
    }
  }

  doc.end();
  await new Promise((resolve) => doc.on("end", resolve));
  return Buffer.concat(chunks);
};
