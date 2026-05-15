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

const resolveBarcodeSpec = (
  value: string,
  barcodeType: "auto" | "ean13" | "code128",
) => {
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

export const buildPriceTagsPdf = async ({
  labels,
  template,
  locale,
  currencyCode,
  currencyRateKgsPerUnit,
  storeName,
  noPriceLabel,
  noBarcodeLabel,
  skuLabel,
  rollCalibration,
  showProductName = true,
  showPrice = true,
  showSku = true,
  showBarcodeText = true,
  showCurrency = true,
  showStoreName = true,
  barcodeType = "auto",
  labelLayoutOrder = "NAME_BARCODE_PRICE",
  barcodeHeightMm,
  labelFontSize,
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
    const nameFont = labelFontSize ?? layout.config.nameFont;
    const metaFont = Math.max(6, (labelFontSize ?? layout.config.metaFont) - 1);
    const barcodeHeight = barcodeHeightMm ? mmToPoints(barcodeHeightMm) : layout.barcode.height;
    const drawNoBarcode = () => {
      const fallback = truncateLine(doc, noBarcodeLabel, contentWidth, metaFont);
      doc.fontSize(metaFont).fillColor("#666666");
      doc.text(fallback, contentX, y + layout.barcodeValue.y, {
        width: contentWidth,
        align: "center",
        lineBreak: false,
      });
    };
    const priceText =
      label.price !== null
        ? showCurrency
          ? formatPriceTagCurrency(label.price, locale, currencyCode, currencyRateKgsPerUnit)
          : formatPriceTagAmount(label.price, locale, currencyCode, currencyRateKgsPerUnit)
        : noPriceLabel;
    const renderPriceAt = (targetY: number, fontSize = layout.config.priceFont) => {
      if (!showPrice) {
        return;
      }
      const priceFont = label.price !== null ? fontSize : Math.max(fontSize - 2, 9);
      const priceLine = truncateLine(doc, priceText, contentWidth, priceFont);
      doc.fontSize(priceFont).fillColor("#000000");
      doc.text(priceLine, contentX, targetY, {
        width: contentWidth,
        lineBreak: false,
        align: "center",
      });
    };
    const renderNameAt = (targetY: number) => {
      if (!showProductName) {
        return 0;
      }
      doc.fontSize(nameFont);
      const nameLines = clampPriceTagTextLines({
        text: label.name,
        maxLines: layout.config.nameLines,
        canFit: (candidate) => doc.widthOfString(candidate) <= contentWidth,
      });
      doc.fillColor("#111111");
      nameLines.forEach((line, lineIndex) => {
        doc.text(line, contentX, targetY + lineIndex * layout.config.nameLineHeight, {
          width: contentWidth,
          lineBreak: false,
          align: "center",
        });
      });
      return nameLines.length * layout.config.nameLineHeight;
    };

    const drawBarcodeAt = async (targetY: number) => {
      const spec = resolveBarcodeSpec(label.barcode, barcodeType);
      if (!spec) {
        drawNoBarcode();
        return;
      }
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
        const imageWidth = Math.max(30, Math.min(maxBarcodeWidth, maxBarcodeWidth * 0.98));
        const imageHeight = Math.max(mmToPoints(8), barcodeHeight - quiet * 2);
        const imageX = contentX + (layout.barcode.width - imageWidth) / 2;
        const imageY = targetY + quiet;
        doc.image(barcodeEntry.image, imageX, imageY, {
          width: imageWidth,
          height: imageHeight,
        });
        if (showBarcodeText) {
          const valueLine = truncateLine(doc, barcodeEntry.text, contentWidth, metaFont);
          doc.fontSize(metaFont).fillColor("#000000");
          doc.text(valueLine, contentX, targetY + barcodeHeight + 2, {
            width: contentWidth,
            align: "center",
            lineBreak: false,
          });
        }
      } catch {
        drawNoBarcode();
      }
    };

    if (isRollTemplate) {
      const order =
        labelLayoutOrder === "PRICE_NAME_BARCODE"
          ? ["price", "name", "barcode"]
          : labelLayoutOrder === "BARCODE_ONLY"
            ? ["barcode"]
            : labelLayoutOrder === "NAME_BARCODE"
              ? ["name", "barcode"]
              : labelLayoutOrder === "PRICE_BARCODE"
                ? ["price", "barcode"]
                : ["name", "barcode", "price"];
      let cursor = y + mmToPoints(3);
      for (const block of order) {
        if (block === "price" && showPrice) {
          renderPriceAt(cursor, Math.max(10, layout.config.priceFont - 1));
          cursor += Math.max(13, layout.config.priceFont + 3);
        }
        if (block === "name" && showProductName) {
          cursor += renderNameAt(cursor) + 2;
        }
        if (block === "barcode") {
          await drawBarcodeAt(cursor);
          cursor += barcodeHeight + (showBarcodeText ? metaFont + 4 : 2);
        }
      }
      if (showSku && label.sku.trim()) {
        const skuText = truncateLine(doc, `${skuLabel}: ${label.sku}`, contentWidth, metaFont);
        doc.fontSize(metaFont).fillColor("#444444");
        doc.text(skuText, contentX, Math.min(cursor, y + layout.labelHeight - metaFont - 2), {
          width: contentWidth,
          align: "center",
          lineBreak: false,
        });
      }
      continue;
    }

    if (showProductName) {
      doc.fontSize(nameFont);
      const nameLines = clampPriceTagTextLines({
        text: label.name,
        maxLines: layout.config.nameLines,
        canFit: (candidate) => doc.widthOfString(candidate) <= contentWidth,
      });
      doc.fillColor("#111111");
      nameLines.forEach((line, lineIndex) => {
        doc.text(line, contentX, y + layout.name.y + lineIndex * layout.config.nameLineHeight, {
          width: contentWidth,
          lineBreak: false,
        });
      });
    }

    if (showPrice) {
      const priceFont =
        label.price !== null ? layout.config.priceFont : Math.max(layout.config.priceFont - 2, 9);
      const priceLine = truncateLine(doc, priceText, contentWidth, priceFont);
      doc.fontSize(priceFont).fillColor("#000000");
      doc.text(priceLine, contentX, y + layout.price.y, {
        width: contentWidth,
        lineBreak: false,
      });
    }

    doc.fontSize(metaFont).fillColor("#444444");
    if (showSku && label.sku.trim()) {
      const skuText = truncateLine(doc, `${skuLabel}: ${label.sku}`, contentWidth, metaFont);
      doc.text(skuText, contentX, y + layout.meta.y, {
        width: contentWidth,
        lineBreak: false,
      });
    }
    if (showStoreName && !isRollTemplate && storeName && layout.config.metaLines > 1) {
      const storeLine = truncateLine(doc, storeName, contentWidth, layout.config.metaFont);
      doc.text(storeLine, contentX, y + layout.meta.y + layout.config.metaLineHeight, {
        width: contentWidth,
        lineBreak: false,
      });
    }

    const spec = resolveBarcodeSpec(label.barcode, barcodeType);
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
        const imageHeight = Math.max(mmToPoints(8), barcodeHeight - quiet * 2);
        const imageX = contentX + (layout.barcode.width - imageWidth) / 2;
        const imageY = y + layout.barcode.y + quiet;
        doc.image(barcodeEntry.image, imageX, imageY, {
          width: imageWidth,
          height: imageHeight,
        });

        if (showBarcodeText) {
          const valueLine = truncateLine(doc, barcodeEntry.text, contentWidth, metaFont);
          doc.fontSize(metaFont).fillColor("#000000");
          doc.text(valueLine, contentX, y + layout.barcodeValue.y, {
            width: contentWidth,
            align: "center",
            lineBreak: false,
          });
        }
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
