import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { formatKgsMoney } from "@/lib/currencyDisplay";
import { formatDateTime } from "@/lib/i18nFormat";
import { toIntlLocale } from "@/lib/locales";
import {
  correctionDifferenceLabelKind,
  type CorrectionDifferenceLabelKind,
} from "@/lib/salesOrderCorrectionDisplay";
import type { SalesDocumentKind, SalesDocumentPayload } from "@/server/services/salesDocuments";

export type SalesDocumentPdfLabels = {
  invoice: string; goodsReceipt: string; number: string; date: string; status: string;
  seller: string; customer: string; unnamedCustomer: string; store: string; inn: string;
  phone: string; email: string; address: string; product: string; sku: string; quantity: string;
  unit: string; price: string; amount: string; subtotal: string; discount: string; total: string;
  issuedBy: string; receivedBy: string; nonFiscal: string; empty: string; page: string;
  statuses: Record<SalesDocumentPayload["status"], string>;
};

type Pdf = InstanceType<typeof PDFDocument>;
const BLACK = "#000000";
const GRAY = "#555555";
const mm = (value: number) => value * 72 / 25.4;

const fontPath = () => {
  const primary = join(process.cwd(), "assets", "fonts", "NotoSans-Regular.ttf");
  const fallback = join(process.cwd(), "assets", "fonts", "ArialUnicode.ttf");
  if (existsSync(primary)) return primary;
  if (existsSync(fallback)) return fallback;
  throw new Error("salesDocumentFontUnavailable");
};

/** Wrap even an unbroken SKU/name, so it cannot escape a table cell. */
const wrap = (doc: Pdf, text: string, width: number, size: number): string[] => {
  doc.fontSize(size);
  const result: string[] = [];
  for (const paragraph of text.replace(/\r/g, "").split("\n")) {
    let line = "";
    for (const character of paragraph) {
      if (line && doc.widthOfString(line + character) > width) {
        const split = line.lastIndexOf(" ");
        if (split > line.length / 2) {
          result.push(line.slice(0, split));
          line = line.slice(split + 1) + character;
        } else {
          result.push(line.trimEnd());
          line = character;
        }
      } else line += character;
    }
    result.push(line.trimEnd());
  }
  return result.length ? result : [""];
};

const drawLines = (doc: Pdf, lines: string[], x: number, y: number, width: number, size: number, align: "left" | "right" | "center" = "left", color = BLACK) => {
  doc.fontSize(size).fillColor(color);
  for (const [index, line] of lines.entries()) {
    doc.text(line, x, y + index * (size + 3), { width, lineBreak: false, align });
  }
};

const money = (job: SalesDocumentPayload, amount: number, locale: string) =>
  formatKgsMoney(amount, toIntlLocale(locale), job, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const quantity = (value: number, locale: string) =>
  new Intl.NumberFormat(toIntlLocale(locale), { maximumFractionDigits: 6 }).format(value);

export async function buildSalesDocumentPdf(input: {
  job: SalesDocumentPayload;
  kind: SalesDocumentKind;
  locale: string;
  labels: SalesDocumentPdfLabels;
}): Promise<Buffer> {
  const doc = new PDFDocument({ autoFirstPage: false, margin: 0, bufferPages: true });
  doc.registerFont("Body", fontPath()).font("Body");
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const { job, labels, locale } = input;
  const title = input.kind === "invoice" ? labels.invoice : labels.goodsReceipt;
  doc.info.Title = `${title} ${job.number}`;
  doc.info.Author = job.seller.name;
  if (input.kind === "invoice") renderInvoice(doc, job, labels, locale, title);
  else renderGoodsReceipt(doc, job, labels, locale, title);
  doc.end();
  return finished;
}

function renderInvoice(doc: Pdf, job: SalesDocumentPayload, labels: SalesDocumentPdfLabels, locale: string, title: string) {
  const left = 36;
  const width = 523.28;
  const bottom = 782;
  const cols = [30, 226, 48, 35, 90, 94.28];
  const font = 8.5;
  const lineHeight = font + 3;
  let y = 0;
  let page = 0;
  let rowsOnPage = 0;

  const newPage = (table = false) => {
    doc.addPage({ size: "A4", margin: 0 });
    page += 1;
    rowsOnPage = 0;
    if (job.status === "DRAFT" || job.status === "CANCELED") {
      doc.save().fillOpacity(0.055).translate(298, 420).rotate(-25);
      doc.fontSize(58).fillColor(BLACK).text(labels.statuses[job.status], -240, -32, { width: 480, align: "center", lineBreak: false });
      doc.restore();
    }
    drawLines(doc, ["BAZAAR"], left, 26, width, 8, "left", GRAY);
    const heading = wrap(doc, page === 1 ? title : `${title} · ${job.number}`, width, page === 1 ? 19 : 12);
    drawLines(doc, heading, left, 43, width, page === 1 ? 19 : 12);
    y = 43 + heading.length * (page === 1 ? 22 : 15) + 12;
    if (page > 1) y += 2;
    if (table) tableHeader();
  };

  const ensure = (height: number, table = false) => {
    if (y + height > bottom) newPage(table);
  };

  const paragraph = (text: string, size = 9, gap = 4) => {
    const lines = wrap(doc, text, width, size);
    for (const line of lines) {
      ensure(size + 3);
      drawLines(doc, [line], left, y, width, size);
      y += size + 3;
    }
    y += gap;
  };

  const tableHeader = () => {
    const headers = ["№", labels.product, labels.quantity, labels.unit, labels.price, labels.amount];
    let x = left;
    const lines = headers.map((text, index) => wrap(doc, text, cols[index]! - 8, 8));
    const height = Math.max(...lines.map((value) => value.length)) * 11 + 12;
    doc.rect(left, y, width, height).fill("#f0f0f0");
    for (let index = 0; index < cols.length; index += 1) {
      drawLines(doc, lines[index]!, x + 4, y + 6, cols[index]! - 8, 8, index >= 4 ? "right" : "left");
      x += cols[index]!;
    }
    y += height;
  };

  newPage();
  paragraph(`${labels.number}: ${job.number}    ${labels.date}: ${formatDateTime(job.createdAt, locale)}`, 9);
  paragraph(`${labels.status}: ${labels.statuses[job.status]}`, 9, 12);
  paragraph(`${labels.seller}: ${job.seller.name}`, 10);
  if (job.seller.storeName !== job.seller.name) paragraph(`${labels.store}: ${job.seller.storeName}`);
  for (const [label, value] of [[labels.inn, job.seller.inn], [labels.address, job.seller.address], [labels.phone, job.seller.phone]]) {
    if (value) paragraph(`${label}: ${value}`);
  }
  y += 5;
  paragraph(`${labels.customer}: ${job.customer.name || labels.unnamedCustomer}`, 10);
  for (const [label, value] of [[labels.phone, job.customer.phone], [labels.email, job.customer.email], [labels.address, job.customer.address]]) {
    if (value) paragraph(`${label}: ${value}`);
  }
  y += 10;
  ensure(50);
  tableHeader();

  // Reserve the closing block (totals plus signatures) before the last rows.
  // A row that would leave the totals or signatures behind moves to the next
  // page together with them, so no near-empty signature-only page is created.
  const totalRows: Array<{ label: string; value: number; emphasis: boolean }> = [];
  if (job.discountKgs > 0 || job.subtotalKgs !== job.totalKgs)
    totalRows.push({ label: labels.subtotal, value: job.subtotalKgs, emphasis: false });
  if (job.discountKgs > 0)
    totalRows.push({ label: labels.discount, value: job.discountKgs, emphasis: false });
  totalRows.push({ label: labels.total, value: job.totalKgs, emphasis: true });
  const totalsHeight = totalRows.reduce((total, row) => {
    const size = row.emphasis ? 13 : 9;
    const lines = wrap(doc, `${row.label}: ${money(job, row.value, locale)}`, width, size);
    return total + lines.length * (size + 3) + 7;
  }, 0);
  const footerHeight = 14 + totalsHeight + 46;
  const footerReserve = footerHeight <= bottom - 125 ? footerHeight : 0;

  for (const [index, item] of job.items.entries()) {
    const name = [item.name, item.variantName, item.sku ? `${labels.sku}: ${item.sku}` : null].filter(Boolean).join("\n");
    const cells = [String(index + 1), name, quantity(item.qty, locale), item.unit, money(job, item.unitPriceKgs, locale), money(job, item.lineTotalKgs, locale)]
      .map((text, column) => wrap(doc, text, cols[column]! - 8, font));
    const maxLines = Math.max(...cells.map((cell) => cell.length));
    const rowHeight = maxLines * lineHeight + 12;
    // A normal row should start and finish on one page. Split only a row that
    // is taller than an entire continuation page (for example an enormous name).
    if (
      rowHeight <= bottom - 125 &&
      (rowsOnPage > 0 ? y + rowHeight + footerReserve > bottom : y + rowHeight > bottom)
    ) {
      newPage(true);
    }
    let offset = 0;
    while (offset < maxLines) {
      const minHeight = Math.min(maxLines - offset, 3) * lineHeight + 12;
      ensure(minHeight, true);
      const count = Math.min(maxLines - offset, Math.max(1, Math.floor((bottom - y - 12) / lineHeight)));
      let x = left;
      for (let column = 0; column < cells.length; column += 1) {
        drawLines(doc, cells[column]!.slice(offset, offset + count), x + 4, y + 6, cols[column]! - 8, font, column >= 4 ? "right" : "left");
        x += cols[column]!;
      }
      y += count * lineHeight + 12;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.4).strokeColor("#cccccc").stroke();
      offset += count;
      if (offset < maxLines) newPage(true);
    }
    rowsOnPage += 1;
  }
  if (!job.items.length) paragraph(labels.empty, 9, 8);
  // Huge split rows can still end near the bottom; move the whole closing
  // block rather than letting `ensure(46)` orphan the signatures.
  if (footerReserve && y + footerReserve > bottom) newPage(true);
  y += 14;
  const totalRow = (label: string, value: number, emphasis = false) => {
    const text = `${label}: ${money(job, value, locale)}`;
    const size = emphasis ? 13 : 9;
    const lines = wrap(doc, text, width, size);
    drawLines(doc, lines, left, y, width, size, "right");
    y += lines.length * (size + 3) + 7;
  };
  for (const row of totalRows) totalRow(row.label, row.value, row.emphasis);
  y += 22;
  doc.moveTo(left, y).lineTo(left + 205, y).strokeColor(BLACK).lineWidth(0.6).stroke();
  doc.moveTo(left + 285, y).lineTo(left + width, y).stroke();
  drawLines(doc, [labels.issuedBy], left, y + 5, 205, 8, "left", GRAY);
  drawLines(doc, [labels.receivedBy], left + 285, y + 5, width - 285, 8, "left", GRAY);

  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(index);
    drawLines(doc, wrap(doc, labels.nonFiscal, width - 75, 7.5), left, 811, width - 75, 7.5, "left", GRAY);
    drawLines(doc, [`${labels.page} ${index + 1}/${range.count}`], left + width - 70, 811, 70, 7.5, "right", GRAY);
  }
}

function renderGoodsReceipt(doc: Pdf, job: SalesDocumentPayload, labels: SalesDocumentPdfLabels, locale: string, title: string) {
  const pageWidth = mm(80);
  const left = 10;
  const width = pageWidth - left * 2;
  const maxHeight = mm(297);
  const titleLines = wrap(doc, title, width, 11);
  const numberLines = wrap(doc, `${labels.number}: ${job.number}`, width, 8);
  const numberY = 10 + titleLines.length * 14 + 4;
  const statusLines = wrap(doc, `${labels.status}: ${labels.statuses[job.status]}`, width, 7);
  const statusY = numberY + numberLines.length * 11 + 3;
  const headerHeight = statusY + statusLines.length * 10 + 10;
  const footerHeight = 31;
  type Block = { lines: string[]; size: number; align?: "left" | "right" | "center"; gap: number; rule?: boolean; itemGroup?: number };
  const blocks: Block[] = [];
  const add = (text: string, size = 8, gap = 3, align?: Block["align"]) => {
    const lines = wrap(doc, text, width, size);
    // Long names are split into bounded blocks, never clipped or shrunk away.
    for (let offset = 0; offset < lines.length; offset += 35) blocks.push({ lines: lines.slice(offset, offset + 35), size, gap, align });
  };
  const rule = () => blocks.push({ lines: [], size: 0, gap: 7, rule: true });
  add(job.seller.name, 10);
  if (job.seller.storeName !== job.seller.name) add(job.seller.storeName);
  if (job.seller.inn) add(`${labels.inn}: ${job.seller.inn}`);
  if (job.seller.address) add(`${labels.address}: ${job.seller.address}`);
  if (job.seller.phone) add(`${labels.phone}: ${job.seller.phone}`);
  add(`${labels.date}: ${formatDateTime(job.createdAt, locale)}`);
  add(`${labels.customer}: ${job.customer.name || labels.unnamedCustomer}`);
  rule();
  for (const [index, item] of job.items.entries()) {
    const start = blocks.length;
    add(`${index + 1}. ${[item.name, item.variantName].filter(Boolean).join(" · ")}`, 9);
    if (item.sku) add(`${labels.sku}: ${item.sku}`, 7);
    add(`${quantity(item.qty, locale)} ${item.unit} × ${money(job, item.unitPriceKgs, locale)}`, 8);
    add(`${labels.amount}: ${money(job, item.lineTotalKgs, locale)}`, 9, 3, "right");
    rule();
    for (let block = start; block < blocks.length; block += 1) blocks[block]!.itemGroup = index;
  }
  if (!job.items.length) add(labels.empty);
  if (job.discountKgs > 0 || job.subtotalKgs !== job.totalKgs) add(`${labels.subtotal}: ${money(job, job.subtotalKgs, locale)}`, 8, 4, "right");
  if (job.discountKgs > 0) add(`${labels.discount}: ${money(job, job.discountKgs, locale)}`, 8, 4, "right");
  add(`${labels.total}: ${money(job, job.totalKgs, locale)}`, 11, 8, "right");

  const pages: Block[][] = [[]];
  let used = headerHeight + footerHeight;
  for (const [index, block] of blocks.entries()) {
    const height = block.lines.length * (block.size + 3) + block.gap;
    if (block.itemGroup !== undefined && block.itemGroup !== blocks[index - 1]?.itemGroup) {
      let groupHeight = 0;
      for (let cursor = index; blocks[cursor]?.itemGroup === block.itemGroup; cursor += 1) {
        const part = blocks[cursor]!;
        groupHeight += part.lines.length * (part.size + 3) + part.gap;
      }
      // Keep a normal item together; exceptionally long names can still flow.
      if (groupHeight <= maxHeight - headerHeight - footerHeight && used + groupHeight > maxHeight && pages[pages.length - 1]!.length) {
        pages.push([]); used = headerHeight + footerHeight;
      }
    }
    if (used + height > maxHeight && pages[pages.length - 1]!.length) {
      pages.push([]); used = headerHeight + footerHeight;
    }
    pages[pages.length - 1]!.push(block);
    used += height;
  }
  for (const [pageIndex, pageBlocks] of pages.entries()) {
    const height = Math.max(mm(62), headerHeight + footerHeight + pageBlocks.reduce((sum, block) => sum + block.lines.length * (block.size + 3) + block.gap, 0));
    doc.addPage({ size: [pageWidth, height], margin: 0 });
    drawLines(doc, titleLines, left, 10, width, 11, "center");
    drawLines(doc, numberLines, left, numberY, width, 8, "center");
    drawLines(doc, statusLines, left, statusY, width, 7, "center");
    let y = headerHeight;
    for (const block of pageBlocks) {
      if (block.rule) doc.moveTo(left, y + 2).lineTo(left + width, y + 2).lineWidth(0.5).strokeColor(BLACK).stroke();
      else drawLines(doc, block.lines, left, y, width, block.size, block.align);
      y += block.lines.length * (block.size + 3) + block.gap;
    }
    drawLines(doc, wrap(doc, labels.nonFiscal, width, 7), left, height - footerHeight + 3, width, 7, "center", GRAY);
    if (pages.length > 1) drawLines(doc, [`${labels.page} ${pageIndex + 1}/${pages.length}`], left, height - 12, width, 6.5, "right", GRAY);
  }
}

export type SalesCorrectionPdfPayload = {
  correctionNumber: string;
  createdAt: Date;
  reason: string;
  notes: string | null;
  originalNumber: string;
  originalCreatedAt: Date;
  storeName: string;
  customerName: string;
  sellerName: string;
  sellerInn: string | null;
  returnedKgs: number;
  addedKgs: number;
  /** Part of the return settled by added goods instead of money. */
  offsetKgs: number;
  refundKgs: number;
  chargeKgs: number;
  /** Status of the linked manual refund request, when the refund is not immediate. */
  refundRequestStatus: "OPEN" | "RESOLVED" | "CANCELED" | null;
  returnedItems: Array<{ name: string; sku: string; qty: number; unitPriceKgs: number; lineTotalKgs: number }>;
  addedItems: Array<{ name: string; sku: string; qty: number; unitPriceKgs: number; lineTotalKgs: number }>;
  currencyCode: string;
  currencyRateKgsPerUnit: number;
};

export type SalesCorrectionPdfLabels = {
  title: string;
  number: string;
  date: string;
  original: string;
  reason: string;
  notes: string;
  store: string;
  customer: string;
  seller: string;
  inn: string;
  returnedTitle: string;
  addedTitle: string;
  product: string;
  sku: string;
  quantity: string;
  price: string;
  amount: string;
  returnedTotal: string;
  addedTotal: string;
  offsetSettled: string;
  difference: string;
  toRefund: string;
  toRefundPending: string;
  toRefundPaid: string;
  refundCanceled: string;
  toPay: string;
  noDifference: string;
  empty: string;
  issuedBy: string;
  receivedBy: string;
  nonFiscal: string;
  page: string;
};

/**
 * The act must state the actual money state of a manual refund instead of
 * always claiming money is still owed. Kept pure so the PDF route and tests
 * share the same labels.
 */
export const correctionPdfDifferenceLabel = (
  kind: CorrectionDifferenceLabelKind,
  labels: Pick<
    SalesCorrectionPdfLabels,
    "toRefund" | "toRefundPending" | "toRefundPaid" | "refundCanceled"
  >,
) => {
  if (kind === "refundPending") return labels.toRefundPending;
  if (kind === "refundPaid") return labels.toRefundPaid;
  if (kind === "refundCanceled") return labels.refundCanceled;
  return labels.toRefund;
};

/** Builds the act's single money-difference line; also used by PDF tests. */
export const correctionPdfDifferenceText = (input: {
  refundKgs: number;
  chargeKgs: number;
  refundRequestStatus: "OPEN" | "RESOLVED" | "CANCELED" | null;
  labels: SalesCorrectionPdfLabels;
  moneyText: (value: number) => string;
}) => {
  const kind = correctionDifferenceLabelKind({
    refundRequestStatus: input.refundRequestStatus,
    refundKgs: input.refundKgs,
    chargeKgs: input.chargeKgs,
  });
  const difference =
    input.refundKgs > 0
      ? `${correctionPdfDifferenceLabel(kind, input.labels)} — ${input.moneyText(input.refundKgs)}`
      : input.chargeKgs > 0
        ? `${input.labels.toPay} — ${input.moneyText(input.chargeKgs)}`
        : input.labels.noDifference;
  return `${input.labels.difference}: ${difference}`;
};

/** A correction is its own document; the original invoice is never rewritten. */
export async function buildSalesCorrectionPdf(input: {
  job: SalesCorrectionPdfPayload;
  locale: string;
  labels: SalesCorrectionPdfLabels;
}): Promise<Buffer> {
  const { job, labels, locale } = input;
  const doc = new PDFDocument({ autoFirstPage: false, margin: 0, bufferPages: true });
  doc.registerFont("Body", fontPath()).font("Body");
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const left = 36;
  const width = 523.28;
  const bottom = 780;
  let y = 0;
  const moneyText = (value: number) =>
    formatKgsMoney(value, toIntlLocale(locale), {
      currencyCode: job.currencyCode,
      currencyRateKgsPerUnit: job.currencyRateKgsPerUnit,
    } as never, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const line = (text: string, size = 9, color = BLACK, gap = 4) => {
    const lines = wrap(doc, text, width, size);
    for (const value of lines) {
      if (y + size + 3 > bottom) newPage();
      drawLines(doc, [value], left, y, width, size, "left", color);
      y += size + 3;
    }
    y += gap;
  };
  const newPage = () => {
    doc.addPage({ size: "A4", margin: 0 });
    y = 34;
    drawLines(doc, ["BAZAAR"], left, 24, width, 8, "left", GRAY);
    drawLines(doc, wrap(doc, labels.title, width, 17), left, 40, width, 17);
    y = 74;
  };
  const table = (title: string, items: SalesCorrectionPdfPayload["returnedItems"]) => {
    line(title, 11, BLACK, 6);
    if (!items.length) {
      line(labels.empty, 8.5, GRAY, 6);
      return;
    }
    const cols = [235, 45, 65, 85, 93];
    const header = [labels.product, labels.quantity, labels.price, labels.amount, labels.sku];
    let x = left;
    for (let index = 0; index < header.length; index += 1) {
      drawLines(doc, [header[index]!], x + 3, y, cols[index]! - 6, 8, index === 0 || index === 4 ? "left" : "right");
      x += cols[index]!;
    }
    y += 13;
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor("#999999").stroke();
    y += 5;
    for (const item of items) {
      const nameLines = wrap(doc, item.name, cols[0]! - 6, 8.5);
      const skuLines = wrap(doc, item.sku, cols[4]! - 4, 7.5);
      const rowLines = Math.max(nameLines.length, skuLines.length);
      const height = rowLines * 11 + 8;
      if (y + height > bottom) newPage();
      drawLines(doc, nameLines, left + 3, y, cols[0]! - 6, 8.5);
      drawLines(doc, [String(item.qty)], left + cols[0]! + 3, y, cols[1]! - 6, 8.5, "right");
      drawLines(doc, [moneyText(item.unitPriceKgs)], left + cols[0]! + cols[1]! + 3, y, cols[2]! - 6, 8.5, "right");
      drawLines(doc, [moneyText(item.lineTotalKgs)], left + cols[0]! + cols[1]! + cols[2]! + 3, y, cols[3]! - 6, 8.5, "right");
      drawLines(doc, skuLines, left + cols[0]! + cols[1]! + cols[2]! + cols[3]! + 3, y, cols[4]! - 4, 7.5, "left", GRAY);
      y += height;
      doc.moveTo(left, y - 3).lineTo(left + width, y - 3).lineWidth(0.3).strokeColor("#cccccc").stroke();
    }
    y += 5;
  };

  newPage();
  line(`${labels.number}: ${job.correctionNumber}    ${labels.date}: ${formatDateTime(job.createdAt, locale)}`, 9);
  line(`${labels.original}: ${job.originalNumber}    ${labels.date}: ${formatDateTime(job.originalCreatedAt, locale)}`, 9);
  y += 4;
  line(`${labels.seller}: ${job.sellerName}`, 9);
  if (job.sellerInn) line(`${labels.inn}: ${job.sellerInn}`, 9);
  line(`${labels.store}: ${job.storeName}`, 9);
  line(`${labels.customer}: ${job.customerName || "—"}`, 9);
  y += 6;
  line(`${labels.reason}: ${job.reason}`, 9);
  if (job.notes) line(`${labels.notes}: ${job.notes}`, 8.5, GRAY);
  y += 8;

  table(labels.returnedTitle, job.returnedItems);
  table(labels.addedTitle, job.addedItems);

  const differenceText = correctionPdfDifferenceText({
    refundKgs: job.refundKgs,
    chargeKgs: job.chargeKgs,
    refundRequestStatus: job.refundRequestStatus,
    labels,
    moneyText,
  });
  const closingLines: Array<{ text: string; size: number }> = [
    { text: `${labels.returnedTotal}: ${moneyText(job.returnedKgs)}`, size: 9 },
    { text: `${labels.addedTotal}: ${moneyText(job.addedKgs)}`, size: 9 },
  ];
  if (job.offsetKgs > 0) {
    closingLines.push({ text: `${labels.offsetSettled}: ${moneyText(job.offsetKgs)}`, size: 9 });
  }
  closingLines.push({ text: differenceText, size: 11 });
  // Keep the totals and signatures together: reserve the whole closing block
  // before drawing it, so a long act does not orphan the signatures.
  const closingHeight =
    closingLines.reduce(
      (total, entry) =>
        total + wrap(doc, entry.text, width, entry.size).length * (entry.size + 3) + 4,
      0,
    ) + 20 + 50;
  if (y + closingHeight > bottom) newPage();
  for (const entry of closingLines) line(entry.text, entry.size);
  y += 20;
  doc.moveTo(left, y).lineTo(left + 205, y).strokeColor(BLACK).lineWidth(0.6).stroke();
  doc.moveTo(left + 285, y).lineTo(left + width, y).stroke();
  drawLines(doc, [labels.issuedBy], left, y + 5, 205, 8, "left", GRAY);
  drawLines(doc, [labels.receivedBy], left + 285, y + 5, width - 285, 8, "left", GRAY);

  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(index);
    drawLines(doc, wrap(doc, labels.nonFiscal, width - 75, 7.5), left, 811, width - 75, 7.5, "left", GRAY);
    drawLines(doc, [`${labels.page} ${index + 1}/${range.count}`], left + width - 70, 811, 70, 7.5, "right", GRAY);
  }
  doc.end();
  return finished;
}
