export type PriceTagsTemplate = "3x8" | "2x5";

export type LayoutBlock = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PriceTagLayout = {
  margin: number;
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
} as const;

export const buildPriceTagLayout = (
  template: PriceTagsTemplate,
  options: { storeName?: string | null } = {},
): PriceTagLayout => {
  const config = templateConfig[template];
  const labelWidth = (A4_WIDTH - config.margin * 2) / config.cols;
  const labelHeight = (A4_HEIGHT - config.margin * 2) / config.rows;
  const padding = config.padding;
  const contentWidth = labelWidth - padding * 2;
  const contentHeight = labelHeight - padding * 2;
  const metaLines = options.storeName ? 2 : 1;

  let nameLines = Number(config.nameLines);
  let barcodeHeight = Number(config.barcodeHeight);

  const computeTotal = (nameLineCount: number, barcodeH: number) => {
    const nameHeight = config.nameLineHeight * nameLineCount;
    const priceHeight = config.priceLineHeight;
    const metaHeight = config.metaLineHeight * metaLines;
    const barcodeBlockHeight = barcodeH + config.quietZone * 2;
    const barcodeValueHeight = config.barcodeTextHeight;
    const gaps = config.gap * 4;
    return nameHeight + priceHeight + metaHeight + barcodeBlockHeight + barcodeValueHeight + gaps;
  };

  let totalHeight = computeTotal(nameLines, barcodeHeight);
  if (totalHeight > contentHeight && nameLines > 1) {
    nameLines = 1;
    totalHeight = computeTotal(nameLines, barcodeHeight);
  }
  if (totalHeight > contentHeight) {
    const overflow = totalHeight - contentHeight;
    barcodeHeight = Math.max(18, barcodeHeight - overflow);
  }

  const nameHeight = config.nameLineHeight * nameLines;
  const priceHeight = config.priceLineHeight;
  const metaHeight = config.metaLineHeight * metaLines;
  const barcodeBlockHeight = barcodeHeight + config.quietZone * 2;
  const barcodeValueHeight = config.barcodeTextHeight;

  let cursor = padding;
  const nameBlock: LayoutBlock = { x: padding, y: cursor, width: contentWidth, height: nameHeight };
  cursor += nameHeight + config.gap;
  const priceBlock: LayoutBlock = { x: padding, y: cursor, width: contentWidth, height: priceHeight };
  cursor += priceHeight + config.gap;
  const metaBlock: LayoutBlock = { x: padding, y: cursor, width: contentWidth, height: metaHeight };
  cursor += metaHeight + config.gap;
  const barcodeBlock: LayoutBlock = {
    x: padding,
    y: cursor,
    width: contentWidth,
    height: barcodeBlockHeight,
  };
  cursor += barcodeBlockHeight + config.gap;
  const barcodeValueBlock: LayoutBlock = {
    x: padding,
    y: cursor,
    width: contentWidth,
    height: barcodeValueHeight,
  };

  return {
    margin: config.margin,
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
      gap: config.gap,
      barcodeHeight,
      barcodeTextHeight: config.barcodeTextHeight,
      quietZone: config.quietZone,
      metaLines,
    },
  };
};
