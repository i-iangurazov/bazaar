import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { formatKgsMoney } from "@/lib/currencyDisplay";
import { formatDateTime } from "@/lib/i18nFormat";
import { toIntlLocale } from "@/lib/locales";
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

  const newPage = (table = false) => {
    doc.addPage({ size: "A4", margin: 0 });
    page += 1;
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

  for (const [index, item] of job.items.entries()) {
    const name = [item.name, item.variantName, item.sku ? `${labels.sku}: ${item.sku}` : null].filter(Boolean).join("\n");
    const cells = [String(index + 1), name, quantity(item.qty, locale), item.unit, money(job, item.unitPriceKgs, locale), money(job, item.lineTotalKgs, locale)]
      .map((text, column) => wrap(doc, text, cols[column]! - 8, font));
    const maxLines = Math.max(...cells.map((cell) => cell.length));
    const rowHeight = maxLines * lineHeight + 12;
    // A normal row should start and finish on one page. Split only a row that
    // is taller than an entire continuation page (for example an enormous name).
    if (rowHeight <= bottom - 125 && y + rowHeight > bottom) newPage(true);
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
  }
  if (!job.items.length) paragraph(labels.empty, 9, 8);
  y += 14;
  const totalRow = (label: string, value: number, emphasis = false) => {
    const text = `${label}: ${money(job, value, locale)}`;
    const size = emphasis ? 13 : 9;
    const lines = wrap(doc, text, width, size);
    ensure(lines.length * (size + 3) + 7);
    drawLines(doc, lines, left, y, width, size, "right");
    y += lines.length * (size + 3) + 7;
  };
  if (job.discountKgs > 0 || job.subtotalKgs !== job.totalKgs) totalRow(labels.subtotal, job.subtotalKgs);
  if (job.discountKgs > 0) totalRow(labels.discount, job.discountKgs);
  totalRow(labels.total, job.totalKgs, true);
  ensure(72);
  y += 30;
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
