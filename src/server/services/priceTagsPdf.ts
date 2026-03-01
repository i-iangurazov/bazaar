import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  PRICE_TAG_ROLL_DEFAULTS,
  ROLL_PRICE_TAG_TEMPLATE,
  type PriceTagRollCalibration,
  type PriceTagsTemplate,
} from "@/lib/priceTags";
import { resolveBarcodeRenderSpec } from "@/server/services/barcodes";
import { buildPriceTagLayout, clampPriceTagTextLines, mmToPoints } from "@/server/services/priceTagsLayout";

export type PriceTagLabel = {
  name: string;
  sku: string;
  barcode: string;
  price: number | null;
};

type PriceTagsPdfInput = {
  labels: PriceTagLabel[];
  template: PriceTagsTemplate;
  locale: string;
  storeName: string | null;
  noPriceLabel: string;
  noBarcodeLabel: string;
  skuLabel: string;
  rollCalibration?: PriceTagRollCalibration;
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

const toRollCalibration = (input?: PriceTagRollCalibration): PriceTagRollCalibration => ({
  gapMm: input?.gapMm ?? PRICE_TAG_ROLL_DEFAULTS.gapMm,
  xOffsetMm: input?.xOffsetMm ?? PRICE_TAG_ROLL_DEFAULTS.xOffsetMm,
  yOffsetMm: input?.yOffsetMm ?? PRICE_TAG_ROLL_DEFAULTS.yOffsetMm,
  widthMm: input?.widthMm ?? PRICE_TAG_ROLL_DEFAULTS.widthMm,
  heightMm: input?.heightMm ?? PRICE_TAG_ROLL_DEFAULTS.heightMm,
});

export const buildPriceTagsPdf = async ({
  labels,
  template,
  locale,
  storeName,
  noPriceLabel,
  noBarcodeLabel,
  skuLabel,
  rollCalibration,
}: PriceTagsPdfInput) => {
  const isRollTemplate = template === ROLL_PRICE_TAG_TEMPLATE;
  const resolvedRollCalibration = toRollCalibration(rollCalibration);
  const layout = buildPriceTagLayout(template, {
    storeName,
    rollDimensionsMm: isRollTemplate
      ? {
          width: resolvedRollCalibration.widthMm ?? PRICE_TAG_ROLL_DEFAULTS.widthMm,
          height: resolvedRollCalibration.heightMm ?? PRICE_TAG_ROLL_DEFAULTS.heightMm,
        }
      : undefined,
  });

  const doc = new PDFDocument(
    isRollTemplate
      ? {
          size: [layout.pageWidth, layout.pageHeight],
          margin: 0,
        }
      : {
          size: "A4",
          margin: layout.margin,
        },
  );
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

  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    if (!label) {
      continue;
    }

    if (isRollTemplate) {
      if (index > 0) {
        doc.addPage({ size: [layout.pageWidth, layout.pageHeight], margin: 0 });
      }
    } else {
      const position = index % (layout.cols * layout.rows);
      if (position === 0 && index > 0) {
        doc.addPage();
      }
    }

    const position = isRollTemplate ? 0 : index % (layout.cols * layout.rows);
    const row = isRollTemplate ? 0 : Math.floor(position / layout.cols);
    const col = isRollTemplate ? 0 : position % layout.cols;

    const x = isRollTemplate ? 0 : doc.page.margins.left + col * layout.labelWidth;
    const y = isRollTemplate ? 0 : doc.page.margins.top + row * layout.labelHeight;

    if (!isRollTemplate) {
      doc.rect(x, y, layout.labelWidth, layout.labelHeight).strokeColor("#EEEEEE").stroke();
    }

    const contentX = x + layout.name.x;
    const contentWidth = layout.name.width;
    const drawNoBarcode = () => {
      const fallback = truncateLine(doc, noBarcodeLabel, contentWidth, layout.config.metaFont);
      doc.fontSize(layout.config.metaFont).fillColor("#666666");
      doc.text(fallback, contentX, y + layout.barcodeValue.y, {
        width: contentWidth,
        align: "center",
        lineBreak: false,
      });
    };

    doc.fontSize(layout.config.nameFont);
    const nameLines = clampPriceTagTextLines({
      text: label.name,
      maxLines: layout.config.nameLines,
      canFit: (candidate) => doc.widthOfString(candidate) <= contentWidth,
    });
    doc.fillColor("#111111");
    nameLines.forEach((line, lineIndex) => {
      doc.text(
        line,
        contentX,
        y + layout.name.y + lineIndex * layout.config.nameLineHeight,
        { width: contentWidth, lineBreak: false },
      );
    });

    const priceText = label.price !== null ? formatCurrency(label.price, locale) : noPriceLabel;
    const priceFont =
      label.price !== null ? layout.config.priceFont : Math.max(layout.config.priceFont - 2, 9);
    const priceLine = truncateLine(doc, priceText, contentWidth, priceFont);
    doc.fontSize(priceFont).fillColor("#000000");
    doc.text(priceLine, contentX, y + layout.price.y, {
      width: contentWidth,
      lineBreak: false,
    });

    doc.fontSize(layout.config.metaFont).fillColor("#444444");
    if (label.sku.trim()) {
      const skuText = truncateLine(doc, `${skuLabel}: ${label.sku}`, contentWidth, layout.config.metaFont);
      doc.text(skuText, contentX, y + layout.meta.y, {
        width: contentWidth,
        lineBreak: false,
      });
    }
    if (!isRollTemplate && storeName && layout.config.metaLines > 1) {
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
        const maxBarcodeWidth = layout.barcode.width - quiet * 2;
        const preferredBarcodeWidth = isRollTemplate ? maxBarcodeWidth * 0.98 : maxBarcodeWidth;
        const imageWidth = Math.max(30, Math.min(maxBarcodeWidth, preferredBarcodeWidth));
        const imageHeight = Math.max(mmToPoints(12), layout.barcode.height - quiet * 2);
        const imageX = contentX + (layout.barcode.width - imageWidth) / 2;
        const imageY = y + layout.barcode.y + quiet;
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

  await new Promise<void>((resolve) => doc.on("end", resolve));

  return Buffer.concat(chunks);
};
