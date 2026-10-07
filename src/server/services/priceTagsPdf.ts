import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  PRICE_TAG_ROLL_DEFAULTS,
  ROLL_PRICE_TAG_TEMPLATE,
  type PriceTagRollCalibration,
  type PriceTagsTemplate,
} from "@/lib/priceTags";
import {
  convertFromKgs,
  formatCurrencyAmount,
  normalizeCurrencyCode,
  normalizeCurrencyRateKgsPerUnit,
} from "@/lib/currency";
import { resolveBarcodeRenderSpec } from "@/server/services/barcodes";
import {
  buildPriceTagLayout,
  mmToPoints,
} from "@/server/services/priceTagsLayout";

import { LABEL_TEXT_FIELDS, resolveLabelTextStyles, type LabelMargins, type LabelTextField } from "@/lib/labelTextStyles";
import { AppError } from "@/server/services/errors";

const PRINT_BLACK = "#000000";
const PRINT_WHITE = "#FFFFFF";

export type PriceTagLabel = {
  name: string;
  sku: string;
  barcode: string;
  price: number | null;
};

export type PriceTagsPdfInput = {
  labels: PriceTagLabel[];
  template: PriceTagsTemplate;
  locale: string;
  currencyCode?: string | null;
  currencyRateKgsPerUnit?: number | string | null;
  storeName: string | null;
  noPriceLabel: string;
  noBarcodeLabel: string;
  skuLabel: string;
  rollCalibration?: PriceTagRollCalibration;
  showProductName?: boolean;
  showPrice?: boolean;
  showSku?: boolean;
  showBarcodeText?: boolean;
  showCurrency?: boolean;
  showStoreName?: boolean;
  barcodeType?: "auto" | "ean13" | "code128";
  labelLayoutOrder?: string;
  barcodeHeightMm?: number;
  labelFontSize?: number;
  labelTextStyles?: unknown;
  labelMargins?: LabelMargins;
  layoutWarnings?: string[];
  allowOverflowPreview?: boolean;
};
type BwipModule = { toBuffer: (options: Record<string, unknown>) => Promise<Buffer> };

export const formatPriceTagCurrency = (
  amountKgs: number,
  locale: string,
  currencyCodeInput?: string | null,
  currencyRateInput?: number | string | null,
) => {
  const currencyCode = normalizeCurrencyCode(currencyCodeInput);
  const currencyRateKgsPerUnit = normalizeCurrencyRateKgsPerUnit(currencyRateInput, currencyCode);
  const displayAmount = convertFromKgs(amountKgs, currencyRateKgsPerUnit, currencyCode);
  return formatCurrencyAmount(displayAmount, locale, currencyCode);
};

const formatPriceTagAmount = (
  amountKgs: number,
  locale: string,
  currencyCodeInput?: string | null,
  currencyRateInput?: number | string | null,
) => {
  const currencyCode = normalizeCurrencyCode(currencyCodeInput);
  const currencyRateKgsPerUnit = normalizeCurrencyRateKgsPerUnit(currencyRateInput, currencyCode);
  const displayAmount = convertFromKgs(amountKgs, currencyRateKgsPerUnit, currencyCode);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(displayAmount);
};

const createBarcodePng = async (spec: { bcid: "ean13" | "code128"; text: string }) => {
  const bwipModule = (await import("bwip-js")) as unknown as BwipModule & { default?: BwipModule };
  const bwip = bwipModule.default ?? bwipModule;
  return bwip.toBuffer({
    bcid: spec.bcid,
    text: spec.text,
    scale: 3,
    paddingwidth: 10,
    height: 10,
    includetext: false,
    barcolor: PRINT_BLACK.replace("#", ""),
    backgroundcolor: PRINT_WHITE.replace("#", ""),
  });
};

const toRollCalibration = (input?: PriceTagRollCalibration): PriceTagRollCalibration => ({
  gapMm: input?.gapMm ?? PRICE_TAG_ROLL_DEFAULTS.gapMm,
  xOffsetMm: input?.xOffsetMm ?? PRICE_TAG_ROLL_DEFAULTS.xOffsetMm,
  yOffsetMm: input?.yOffsetMm ?? PRICE_TAG_ROLL_DEFAULTS.yOffsetMm,
  widthMm: input?.widthMm ?? PRICE_TAG_ROLL_DEFAULTS.widthMm,
  heightMm: input?.heightMm ?? PRICE_TAG_ROLL_DEFAULTS.heightMm,
});

const resolveBarcodeSpec = (value: string, barcodeType: "auto" | "ean13" | "code128") => {
  const text = value.trim();
  if (!text) {
    return null;
  }
  if (barcodeType === "code128") {
    return { bcid: "code128" as const, text };
  }
  if (barcodeType === "ean13") {
    return /^\d{13}$/.test(text) ? { bcid: "ean13" as const, text } : null;
  }
  return resolveBarcodeRenderSpec(text);
};

const renderPriceTagsPdf = async (input: PriceTagsPdfInput, cache: Map<string, Buffer>) => {
  const { labels, template, locale, currencyCode, currencyRateKgsPerUnit, storeName,
    noPriceLabel, noBarcodeLabel, skuLabel, barcodeType = "auto" } = input;
  const isRoll = template === ROLL_PRICE_TAG_TEMPLATE;
  const calibration = toRollCalibration(input.rollCalibration);
  const layout = buildPriceTagLayout(template, { storeName, rollDimensionsMm: isRoll ? {
    width: calibration.widthMm ?? 58, height: calibration.heightMm ?? 40,
  } : undefined });
  const styles = resolveLabelTextStyles(input.labelTextStyles, input.labelFontSize);
  const warnings: string[] = [];
  const doc = new PDFDocument({ size: [layout.pageWidth, layout.pageHeight], margin: 0 });
  const fontPath = join(process.cwd(), "assets", "fonts", "NotoSans-Regular.ttf");
  const fallbackPath = join(process.cwd(), "assets", "fonts", "ArialUnicode.ttf");
  doc.registerFont("Body", existsSync(fontPath) ? fontPath : fallbackPath).font("Body");
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const ended = new Promise<void>((resolve, reject) => { doc.on("end", resolve); doc.on("error", reject); });
  const margins = { top: input.labelMargins?.top ?? 0, right: input.labelMargins?.right ?? 0, bottom: input.labelMargins?.bottom ?? 0, left: input.labelMargins?.left ?? 0 };
  const order: Array<"name" | "price" | "barcode"> = input.labelLayoutOrder === "PRICE_NAME_BARCODE"
    ? ["price", "name", "barcode"] : input.labelLayoutOrder === "BARCODE_ONLY" ? ["barcode"]
    : input.labelLayoutOrder === "NAME_BARCODE" ? ["name", "barcode"]
    : input.labelLayoutOrder === "PRICE_BARCODE" ? ["price", "barcode"] : ["name", "barcode", "price"];
  const visibility = { name: input.showProductName ?? true, price: input.showPrice ?? true,
    currency: input.showCurrency ?? true, sku: input.showSku ?? true,
    barcodeText: input.showBarcodeText ?? true, storeName: input.showStoreName ?? true };
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index]!;
    const perPage = layout.cols * layout.rows;
    if (index && index % perPage === 0) doc.addPage({ size: [layout.pageWidth, layout.pageHeight], margin: 0 });
    const position = index % perPage;
    const x = layout.margin + (position % layout.cols) * layout.labelWidth + (isRoll ? mmToPoints(calibration.xOffsetMm) : 0);
    const y = layout.margin + Math.floor(position / layout.cols) * layout.labelHeight + (isRoll ? mmToPoints(calibration.yOffsetMm) : 0);
    const left = x + layout.padding + mmToPoints(margins.left);
    const width = layout.contentWidth - mmToPoints(margins.left + margins.right);
    const bottom = y + layout.labelHeight - layout.padding - mmToPoints(margins.bottom);
    let cursor = y + layout.padding + mmToPoints(margins.top);
    const warn = (field: string) => warnings.push(`${index + 1}:${field}`);
    if (width <= 0 || cursor >= bottom || x < 0 || y < 0 || x + layout.labelWidth > layout.pageWidth + 0.1 || y + layout.labelHeight > layout.pageHeight + 0.1) warn("margins");
    // Never draw outside the physical label, including diagnostic previews.
    doc.save().rect(Math.max(0, x), Math.max(0, y), layout.labelWidth, layout.labelHeight).clip();
    const text = (field: LabelTextField, value: string) => {
      if (!visibility[field] || !value) return;
      const style = styles[field];
      const padding = mmToPoints(style.paddingMm);
      const blockWidth = Math.max(1, width * style.widthPercent / 100 - 2 * padding);
      const targetX = left + (width - blockWidth) / 2;
      let size = style.fontSize;
      const linesFor = (fontSize: number) => {
        doc.fontSize(fontSize);
        if (style.overflow !== "wrap") return [value];
        const lines: string[] = []; let current = "";
        // Wrap at words where possible, including long SKUs without spaces.
        for (const part of value.split(/(\s+)/).filter(Boolean)) {
          if (doc.widthOfString(current + part) <= blockWidth) { current += part; continue; }
          if (current.trim()) { lines.push(current.trimEnd()); current = ""; }
          for (const char of part.trimStart()) {
            if (current && doc.widthOfString(current + char) > blockWidth) { lines.push(current); current = ""; }
            current += char;
          }
        }
        if (current.trim()) lines.push(current.trimEnd());
        return lines.length ? lines : [value];
      };
      if (style.overflow === "shrink") {
        while (size > style.minFontSize && doc.fontSize(size).widthOfString(value) > blockWidth) size = Math.max(style.minFontSize, size - 0.25);
      }
      let lines = linesFor(size);
      if (style.overflow === "truncate") {
        let line = value;
        if (doc.widthOfString(line) > blockWidth) {
          while (line.length && doc.widthOfString(`${line}…`) > blockWidth) line = line.slice(0, -1);
          line += "…";
        }
        lines = [line];
      } else if (lines.length > style.maxLines || lines.some((line) => doc.widthOfString(line) > blockWidth + 0.1)) warn(field);
      const lineHeight = doc.fontSize(size).currentLineHeight(false);
      const height = Math.min(lines.length, style.maxLines) * lineHeight + 2 * padding;
      if (cursor + height > bottom + 0.1) warn(field);
      doc.fontSize(size).fillColor(PRINT_BLACK).strokeColor(PRINT_BLACK).lineWidth(size / 55);
      lines.slice(0, style.maxLines).forEach((line, i) => {
        const measured = doc.widthOfString(line);
        const lineX = style.align === "left" ? targetX : style.align === "right" ? targetX + blockWidth - measured : targetX + (blockWidth - measured) / 2;
        doc.text(line, lineX, cursor + padding + i * lineHeight, { lineBreak: false, fill: true, stroke: style.weight === "bold" });
      });
      cursor += height + mmToPoints(field === "currency" ? 0 : styles.spacing[field]);
    };
    const priceRow = () => {
      if (!visibility.price) return;
      if (label.price === null) { text("price", noPriceLabel); return; }
      // The amount and its currency are one indivisible row. A narrow label must
      // report overflow (or use the chosen shrink/truncate policy), never wrap
      // a currency onto a different line or split a grouped monetary amount.
      const fields = ["price", ...(visibility.currency ? ["currency"] : [])] as Array<"price" | "currency">;
      const runs = fields.map((field) => ({
        field, style: styles[field], size: styles[field].fontSize,
        value: field === "price"
          ? formatPriceTagAmount(label.price!, locale, currencyCode, currencyRateKgsPerUnit)
          : normalizeCurrencyCode(currencyCode),
        padding: mmToPoints(styles[field].paddingMm),
      }));
      const measure = (run: typeof runs[number]) => doc.fontSize(run.size).widthOfString(run.value);
      const gap = visibility.currency ? mmToPoints(1) : 0;
      const rowWidth = Math.max(1, width * styles.price.widthPercent / 100);
      const fit = (run: typeof runs[number], limit: number, truncate: boolean) => {
        const available = Math.max(0, limit - 2 * run.padding);
        if (run.style.overflow === "shrink") {
          while (run.size > run.style.minFontSize && measure(run) > available) {
            run.size = Math.max(run.style.minFontSize, run.size - 0.25);
          }
        }
        if (truncate && run.style.overflow === "truncate" && measure(run) > available) {
          while (run.value && doc.fontSize(run.size).widthOfString(`${run.value}…`) > available) run.value = run.value.slice(0, -1);
          run.value += "…";
        }
      };
      const occupied = () => runs.reduce((sum, run) => sum + measure(run) + 2 * run.padding, gap);
      for (const run of runs) fit(run, width * run.style.widthPercent / 100, true);
      // Only settings that explicitly permit shrinking/truncation may reduce text.
      for (const truncate of [false, true]) {
        for (const run of runs) {
          if (occupied() > rowWidth) fit(run, measure(run) + 2 * run.padding - (occupied() - rowWidth), truncate);
        }
      }
      for (const run of runs) {
        if (measure(run) + 2 * run.padding > width * run.style.widthPercent / 100 + 0.1) warn(run.field);
      }
      const totalWidth = occupied();
      if (totalWidth > rowWidth + 0.1) warn("price");
      const verticalPadding = Math.max(...runs.map((run) => run.padding));
      const rowHeight = Math.max(...runs.map((run) => doc.fontSize(run.size).currentLineHeight(false))) + 2 * verticalPadding;
      if (cursor + rowHeight > bottom + 0.1) warn("price");
      const rowLeft = left + (width - rowWidth) / 2;
      let runX = styles.price.align === "left" ? rowLeft : styles.price.align === "right" ? rowLeft + rowWidth - totalWidth : rowLeft + (rowWidth - totalWidth) / 2;
      const baseline = cursor + verticalPadding + Math.max(...runs.map((run) => run.size));
      for (const run of runs) {
        doc.fontSize(run.size).fillColor(PRINT_BLACK).strokeColor(PRINT_BLACK).lineWidth(run.size / 55);
        doc.text(run.value, runX + run.padding, baseline, { lineBreak: false, baseline: "alphabetic", fill: true, stroke: run.style.weight === "bold" });
        runX += measure(run) + 2 * run.padding + gap;
      }
      cursor += rowHeight + mmToPoints(styles.spacing.price);
    };
    for (const block of order) {
      if (block === "name") text("name", label.name);
      if (block === "price") priceRow();
      if (block === "barcode") {
        const spec = resolveBarcodeSpec(label.barcode, barcodeType);
        if (!spec) { text("barcodeText", noBarcodeLabel); continue; }
        try {
          const key = `${spec.bcid}:${spec.text}`;
          let png = cache.get(key);
          if (!png) { png = await createBarcodePng(spec); cache.set(key, png); }
          const naturalWidth = png.readUInt32BE(16), naturalHeight = png.readUInt32BE(20);
          const maxHeight = input.barcodeHeightMm ? mmToPoints(input.barcodeHeightMm) : layout.config.barcodeHeight;
          const scale = Math.min(Math.max(1, width) / naturalWidth, maxHeight / naturalHeight);
          const imageWidth = naturalWidth * scale, imageHeight = naturalHeight * scale;
          // bwip uses three pixels per narrow module; reject sub-0.19 mm modules.
          if (scale * 3 < mmToPoints(0.19)) warn("barcode");
          if (cursor + imageHeight > bottom + 0.1) warn("barcode");
          doc.image(png, left + (width - imageWidth) / 2, cursor, { width: imageWidth });
          cursor += imageHeight + mmToPoints(styles.spacing.barcode);
          text("barcodeText", spec.text);
        } catch { warn("barcode"); text("barcodeText", noBarcodeLabel); }
      }
    }
    text("sku", label.sku.trim() ? `${skuLabel}: ${label.sku}` : "");
    text("storeName", storeName ?? "");
    doc.restore();
  }
  doc.end(); await ended;
  return { pdf: Buffer.concat(chunks), warnings };
};

/** Fit an overflowing saved profile at print time without changing store settings. */
export const fitPriceTagsPdf = async (input: PriceTagsPdfInput) => {
  const cache = new Map<string, Buffer>();
  let result = await renderPriceTagsPdf(input, cache);
  const styles = resolveLabelTextStyles(input.labelTextStyles, input.labelFontSize);
  let labelTextStyles = styles;
  let barcodeHeightMm = input.barcodeHeightMm ?? 12;
  // Bounded retries share barcode images. Fonts respect each field's readable
  // minimum; barcode rendering still enforces its minimum module width.
  for (const ratio of [0.85, 0.7, 0.55, 0.45, 0]) {
    if (!result.warnings.length || result.warnings.some((warning) => warning.endsWith(":margins"))) break;
    const fitted = structuredClone(styles);
    for (const field of LABEL_TEXT_FIELDS) {
      const style = fitted[field];
      style.fontSize = Math.max(style.minFontSize, Math.round(style.fontSize * ratio * 4) / 4);
      // Monetary values stay complete and on one line even with legacy wrap settings.
      if (field === "price" || field === "currency") style.overflow = "shrink";
    }
    for (const field of Object.keys(fitted.spacing) as Array<keyof typeof fitted.spacing>) {
      fitted.spacing[field] = Math.round(Math.min(fitted.spacing[field], 0.2) * ratio * 1000) / 1000;
    }
    labelTextStyles = fitted;
    barcodeHeightMm = Math.max(6, Math.round((input.barcodeHeightMm ?? 12) * ratio * 10) / 10);
    result = await renderPriceTagsPdf({
      ...input,
      labelTextStyles: fitted,
      barcodeHeightMm,
    }, cache);
  }
  input.layoutWarnings?.push(...result.warnings);
  if (result.warnings.length && !input.allowOverflowPreview) {
    throw new AppError("labelLayoutOverflow", "BAD_REQUEST", 400);
  }
  return { pdf: result.pdf, labelTextStyles, barcodeHeightMm };
};

export const buildPriceTagsPdf = async (input: PriceTagsPdfInput) =>
  (await fitPriceTagsPdf(input)).pdf;
