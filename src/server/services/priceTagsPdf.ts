import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { buildPriceTagLayout } from "@/server/services/priceTagsLayout";
import { resolveBarcodeRenderSpec } from "@/server/services/barcodes";

export type PriceTagLabel = {
  name: string;
  sku: string;
  barcode: string;
  price: number | null;
};

type PriceTagsPdfInput = {
  labels: PriceTagLabel[];
  template: "3x8" | "2x5";
  locale: string;
  storeName: string | null;
  noPriceLabel: string;
  noBarcodeLabel: string;
  skuLabel: string;
};
type BwipModule = { toBuffer: (options: Record<string, unknown>) => Promise<Buffer> };

const formatCurrency = (amount: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: "currency", currency: "KGS" }).format(amount);

const truncateLine = (doc: InstanceType<typeof PDFDocument>, text: string, maxWidth: number, fontSize: number) => {
  doc.fontSize(fontSize);
  if (doc.widthOfString(text) <= maxWidth) {
    return text;
  }
  const ellipsis = "…";
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${text.slice(0, mid)}${ellipsis}`;
    if (doc.widthOfString(candidate) <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${text.slice(0, low)}${ellipsis}`;
};

const clampTextLines = (
  doc: InstanceType<typeof PDFDocument>,
  text: string,
  maxWidth: number,
  maxLines: number,
  fontSize: number,
) => {
  doc.fontSize(fontSize);
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [];
  }
  const lines: string[] = [];
  let current = "";
  let index = 0;

  while (index < words.length) {
    const word = words[index];
    const candidate = current ? `${current} ${word}` : word;
    if (doc.widthOfString(candidate) <= maxWidth) {
      current = candidate;
      index += 1;
      continue;
    }

    if (!current) {
      let slice = "";
      let charIndex = 0;
      while (charIndex < word.length) {
        const next = slice + word[charIndex];
        if (doc.widthOfString(next) > maxWidth && slice) {
          break;
        }
        slice = next;
        charIndex += 1;
      }
      lines.push(slice);
      const remaining = word.slice(slice.length);
      if (remaining) {
        words[index] = remaining;
      } else {
        index += 1;
      }
    } else {
      lines.push(current);
      current = "";
    }

    if (lines.length >= maxLines) {
      break;
    }
  }

  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  if (index < words.length || lines.length > maxLines) {
    const lastIndex = Math.min(lines.length, maxLines) - 1;
    const remaining = words.slice(index).join(" ");
    const merged = remaining ? `${lines[lastIndex]} ${remaining}` : lines[lastIndex];
    lines[lastIndex] = truncateLine(doc, merged, maxWidth, fontSize);
    return lines.slice(0, maxLines);
  }

  return lines;
};

const createBarcodePng = async (spec: { bcid: "ean13" | "code128"; text: string }) => {
  const bwipModule = (await import("bwip-js")) as unknown as BwipModule & { default?: BwipModule };
  const bwip = bwipModule.default ?? bwipModule;
  return bwip.toBuffer({
    bcid: spec.bcid,
    text: spec.text,
    scale: 2,
    height: 10,
    includetext: false,
  });
};

export const buildPriceTagsPdf = async ({
  labels,
  template,
  locale,
  storeName,
  noPriceLabel,
  noBarcodeLabel,
  skuLabel,
}: PriceTagsPdfInput) => {
  const layout = buildPriceTagLayout(template, { storeName });
  const doc = new PDFDocument({ size: "A4", margin: layout.margin });
  const fontPath = join(process.cwd(), "assets", "fonts", "NotoSans-Regular.ttf");
  const fallbackPath = join(process.cwd(), "assets", "fonts", "ArialUnicode.ttf");
  const resolvedFont = existsSync(fontPath) ? fontPath : existsSync(fallbackPath) ? fallbackPath : null;
  if (resolvedFont) {
    doc.registerFont("Body", resolvedFont);
    doc.font("Body");
  }
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const barcodeCache = new Map<string, { image: Buffer; text: string }>();

  const cols = template === "3x8" ? 3 : 2;
  const rows = template === "3x8" ? 8 : 5;
  const labelWidth = layout.labelWidth;
  const labelHeight = layout.labelHeight;

  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    const position = index % (cols * rows);
    const row = Math.floor(position / cols);
    const col = position % cols;

    if (position === 0 && index > 0) {
      doc.addPage();
    }

    const x = doc.page.margins.left + col * labelWidth;
    const y = doc.page.margins.top + row * labelHeight;

    doc.rect(x, y, labelWidth, labelHeight).strokeColor("#EEEEEE").stroke();

    const contentX = x + layout.padding;
    const contentWidth = layout.contentWidth;
    const drawNoBarcode = () => {
      const fallback = truncateLine(doc, noBarcodeLabel, contentWidth, layout.config.metaFont);
      doc.fontSize(layout.config.metaFont).fillColor("#666666");
      doc.text(fallback, contentX, y + layout.barcodeValue.y, {
        width: contentWidth,
        align: "center",
        lineBreak: false,
      });
    };

    const nameLines = clampTextLines(
      doc,
      label.name,
      contentWidth,
      layout.config.nameLines,
      layout.config.nameFont,
    );
    doc.fontSize(layout.config.nameFont).fillColor("#111111");
    nameLines.forEach((line, lineIndex) => {
      doc.text(
        line,
        contentX,
        y + layout.name.y + lineIndex * layout.config.nameLineHeight,
        { width: contentWidth, lineBreak: false },
      );
    });

    const priceText =
      label.price !== null ? formatCurrency(label.price, locale) : noPriceLabel;
    const priceFont =
      label.price !== null ? layout.config.priceFont : Math.max(layout.config.priceFont - 2, 9);
    const priceLine = truncateLine(doc, priceText, contentWidth, priceFont);
    doc.fontSize(priceFont).fillColor("#000000");
    doc.text(priceLine, contentX, y + layout.price.y, { width: contentWidth, lineBreak: false });

    doc.fontSize(layout.config.metaFont).fillColor("#444444");
    const skuText = truncateLine(doc, `${skuLabel}: ${label.sku}`, contentWidth, layout.config.metaFont);
    doc.text(skuText, contentX, y + layout.meta.y, { width: contentWidth, lineBreak: false });
    if (storeName) {
      const storeLine = truncateLine(doc, storeName, contentWidth, layout.config.metaFont);
      doc.text(storeLine, contentX, y + layout.meta.y + layout.config.metaLineHeight, {
        width: contentWidth,
        lineBreak: false,
      });
    }

    const spec = resolveBarcodeRenderSpec(label.barcode);
    if (spec) {
      try {
        const cacheKey = `${spec.bcid}:${spec.text}`;
        let barcodeEntry = barcodeCache.get(cacheKey);
        if (!barcodeEntry) {
          const image = await createBarcodePng(spec);
          barcodeEntry = { image, text: spec.text };
          barcodeCache.set(cacheKey, barcodeEntry);
        }
        const quiet = layout.config.quietZone;
        const imageX = contentX + quiet;
        const imageY = y + layout.barcode.y + quiet;
        const imageWidth = Math.max(30, layout.barcode.width - quiet * 2);
        const imageHeight = Math.max(12, layout.barcode.height - quiet * 2);
        doc.image(barcodeEntry.image, imageX, imageY, {
          width: imageWidth,
          height: imageHeight,
        });
        const valueLine = truncateLine(doc, barcodeEntry.text, contentWidth, layout.config.metaFont);
        doc.fontSize(layout.config.metaFont).fillColor("#000000");
        doc.text(valueLine, contentX, y + layout.barcodeValue.y, {
          width: contentWidth,
          align: "center",
          lineBreak: false,
        });
      } catch {
        drawNoBarcode();
      }
    } else {
      drawNoBarcode();
    }
  }

  doc.end();

  await new Promise((resolve) => doc.on("end", resolve));

  return Buffer.concat(chunks);
};
