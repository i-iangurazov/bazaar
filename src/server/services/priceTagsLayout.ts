import {
  ROLL_PRICE_TAG_DIMENSIONS_MM,
  ROLL_PRICE_TAG_TEMPLATE,
  type PriceTagsTemplate,
} from "@/lib/priceTags";

export type LayoutBlock = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PriceTagLayout = {
  margin: number;
  pageWidth: number;
  pageHeight: number;
  cols: number;
  rows: number;
  labelWidth: number;
  labelHeight: number;
  padding: number;
  contentWidth: number;
  contentHeight: number;
  name: LayoutBlock;
  price: LayoutBlock;
  meta: LayoutBlock;
  barcode: LayoutBlock;
  barcodeValue: LayoutBlock;
  config: {
    nameFont: number;
    nameLineHeight: number;
    nameLines: number;
    priceFont: number;
    priceLineHeight: number;
    metaFont: number;
    metaLineHeight: number;
    gap: number;
    barcodeHeight: number;
    barcodeTextHeight: number;
    quietZone: number;
    metaLines: number;
  };
};

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

export const mmToPoints = (millimeters: number) => (millimeters * 72) / 25.4;

type ClampInput = {
  text: string;
  maxLines: number;
  canFit: (value: string) => boolean;
};

const appendEllipsis = (value: string, canFit: (candidate: string) => boolean) => {
  const ellipsis = "…";
  if (!value) {
    return ellipsis;
  }
  if (canFit(`${value}${ellipsis}`)) {
    return `${value}${ellipsis}`;
  }
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${value.slice(0, mid)}${ellipsis}`;
    if (canFit(candidate)) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${value.slice(0, low)}${ellipsis}`;
};

export const clampPriceTagTextLines = ({ text, maxLines, canFit }: ClampInput) => {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length || maxLines <= 0) {
    return [] as string[];
  }

  const lines: string[] = [];
  let current = "";
  let index = 0;

  while (index < words.length) {
    const word = words[index] ?? "";
    const candidate = current ? `${current} ${word}` : word;

    if (canFit(candidate)) {
      current = candidate;
      index += 1;
      continue;
    }

    if (!current) {
      let slice = "";
      for (let charIndex = 0; charIndex < word.length; charIndex += 1) {
        const next = `${slice}${word[charIndex] ?? ""}`;
        if (!canFit(next) && slice) {
          break;
        }
        slice = next;
      }
      if (!slice) {
        lines.push(appendEllipsis(word, canFit));
        index += 1;
      } else {
        lines.push(slice);
        const remaining = word.slice(slice.length);
        if (remaining) {
          words[index] = remaining;
        } else {
          index += 1;
        }
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

  if (index < words.length && lines.length) {
    const lastIndex = Math.min(lines.length, maxLines) - 1;
    const remaining = words.slice(index).join(" ");
    const base = lines[lastIndex] ?? "";
    lines[lastIndex] = appendEllipsis(remaining ? `${base} ${remaining}`.trim() : base, canFit);
  }

  return lines.slice(0, maxLines);
};

const templateConfig = {
  "3x8": {
    cols: 3,
    rows: 8,
    margin: 20,
    padding: 8,
    nameFont: 8,
    nameLineHeight: 9,
    nameLines: 2,
    priceFont: 11,
    priceLineHeight: 12,
    metaFont: 6,
    metaLineHeight: 7,
    barcodeHeight: 22,
    barcodeTextHeight: 7,
    gap: 1,
    quietZone: 2,
  },
  "2x5": {
    cols: 2,
    rows: 5,
    margin: 20,
    padding: 10,
    nameFont: 10,
    nameLineHeight: 12,
    nameLines: 2,
    priceFont: 14,
    priceLineHeight: 16,
    metaFont: 8,
    metaLineHeight: 9,
    barcodeHeight: 34,
    barcodeTextHeight: 9,
    gap: 3,
    quietZone: 2,
  },
  [ROLL_PRICE_TAG_TEMPLATE]: {
    cols: 1,
    rows: 1,
    margin: 0,
    padding: mmToPoints(5),
    nameFont: 7,
    nameLineHeight: mmToPoints(3),
    nameLines: 2,
    priceFont: 13,
    priceLineHeight: mmToPoints(3.8),
    metaFont: 6,
    metaLineHeight: mmToPoints(2),
    barcodeHeight: mmToPoints(12),
    barcodeTextHeight: mmToPoints(1.8),
    gap: mmToPoints(0.55),
    quietZone: mmToPoints(1),
  },
} as const;

export const buildPriceTagLayout = (
  template: PriceTagsTemplate,
  options: { storeName?: string | null; rollDimensionsMm?: { width: number; height: number } } = {},
): PriceTagLayout => {
  const config = templateConfig[template];
  const rollWidthMm =
    options.rollDimensionsMm?.width && Number.isFinite(options.rollDimensionsMm.width)
      ? options.rollDimensionsMm.width
      : ROLL_PRICE_TAG_DIMENSIONS_MM.width;
  const rollHeightMm =
    options.rollDimensionsMm?.height && Number.isFinite(options.rollDimensionsMm.height)
      ? options.rollDimensionsMm.height
      : ROLL_PRICE_TAG_DIMENSIONS_MM.height;

  const pageWidth = template === ROLL_PRICE_TAG_TEMPLATE ? mmToPoints(rollWidthMm) : A4_WIDTH;
  const pageHeight = template === ROLL_PRICE_TAG_TEMPLATE ? mmToPoints(rollHeightMm) : A4_HEIGHT;

  const labelWidth = (pageWidth - config.margin * 2) / config.cols;
  const labelHeight = (pageHeight - config.margin * 2) / config.rows;
  const padding = config.padding;
  const contentWidth = labelWidth - padding * 2;
  const contentHeight = labelHeight - padding * 2;
  const metaLines = template === ROLL_PRICE_TAG_TEMPLATE ? 1 : options.storeName ? 2 : 1;

  let nameLines = Number(config.nameLines);
  let barcodeHeight = Number(config.barcodeHeight);
  let verticalGap = Number(config.gap);

  const computeTotal = (nameLineCount: number, barcodeH: number, gap: number) => {
    const nameHeight = config.nameLineHeight * nameLineCount;
    const priceHeight = config.priceLineHeight;
    const metaHeight = config.metaLineHeight * metaLines;
    const barcodeBlockHeight = barcodeH + config.quietZone * 2;
    const barcodeValueHeight = config.barcodeTextHeight;
    const gaps = gap * 4;
    return nameHeight + priceHeight + metaHeight + barcodeBlockHeight + barcodeValueHeight + gaps;
  };

  let totalHeight = computeTotal(nameLines, barcodeHeight, verticalGap);
  const minBarcodeHeight = template === ROLL_PRICE_TAG_TEMPLATE ? mmToPoints(12) : 18;
  if (totalHeight > contentHeight && nameLines > 1) {
    nameLines = 1;
    totalHeight = computeTotal(nameLines, barcodeHeight, verticalGap);
  }
  if (template === ROLL_PRICE_TAG_TEMPLATE && totalHeight > contentHeight && verticalGap > 0) {
    const overflow = totalHeight - contentHeight;
    const maxGapReduction = verticalGap * 4;
    verticalGap = overflow >= maxGapReduction ? 0 : verticalGap - overflow / 4;
    totalHeight = computeTotal(nameLines, barcodeHeight, verticalGap);
  }
  if (totalHeight > contentHeight) {
    const overflow = totalHeight - contentHeight;
    barcodeHeight = Math.max(minBarcodeHeight, barcodeHeight - overflow);
  }
  totalHeight = computeTotal(nameLines, barcodeHeight, verticalGap);

  // On taller custom roll labels, spend part of free height on readable spacing
  // between blocks instead of leaving all extra area as top/bottom whitespace.
  if (template === ROLL_PRICE_TAG_TEMPLATE && totalHeight < contentHeight) {
    const available = contentHeight - totalHeight;
    const extraGap = Math.min(mmToPoints(2), available / 4);
    verticalGap += extraGap;
    totalHeight = computeTotal(nameLines, barcodeHeight, verticalGap);
  }

  const nameHeight = config.nameLineHeight * nameLines;
  const priceHeight = config.priceLineHeight;
  const metaHeight = config.metaLineHeight * metaLines;
  const barcodeBlockHeight = barcodeHeight + config.quietZone * 2;
  const barcodeValueHeight = config.barcodeTextHeight;
  const verticalOffset =
    template === ROLL_PRICE_TAG_TEMPLATE ? Math.max(0, (contentHeight - totalHeight) / 2) : 0;

  let cursor = padding + verticalOffset;
  const nameBlock: LayoutBlock = { x: padding, y: cursor, width: contentWidth, height: nameHeight };
  cursor += nameHeight + verticalGap;
  const priceBlock: LayoutBlock = { x: padding, y: cursor, width: contentWidth, height: priceHeight };
  cursor += priceHeight + verticalGap;
  const metaBlock: LayoutBlock = { x: padding, y: cursor, width: contentWidth, height: metaHeight };
  cursor += metaHeight + verticalGap;
  const barcodeBlock: LayoutBlock = {
    x: padding,
    y: cursor,
    width: contentWidth,
    height: barcodeBlockHeight,
  };
  cursor += barcodeBlockHeight + verticalGap;
  const barcodeValueBlock: LayoutBlock = {
    x: padding,
    y: cursor,
    width: contentWidth,
    height: barcodeValueHeight,
  };

  return {
    margin: config.margin,
    pageWidth,
    pageHeight,
    cols: config.cols,
    rows: config.rows,
    labelWidth,
    labelHeight,
    padding,
    contentWidth,
    contentHeight,
    name: nameBlock,
    price: priceBlock,
    meta: metaBlock,
    barcode: barcodeBlock,
    barcodeValue: barcodeValueBlock,
    config: {
      nameFont: config.nameFont,
      nameLineHeight: config.nameLineHeight,
      nameLines,
      priceFont: config.priceFont,
      priceLineHeight: config.priceLineHeight,
      metaFont: config.metaFont,
      metaLineHeight: config.metaLineHeight,
      gap: verticalGap,
      barcodeHeight,
      barcodeTextHeight: config.barcodeTextHeight,
      quietZone: config.quietZone,
      metaLines,
    },
  };
};
