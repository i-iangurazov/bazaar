export const PRICE_TAG_TEMPLATES = ["3x8", "2x5", "xp365b-roll-58x40"] as const;

export type PriceTagsTemplate = (typeof PRICE_TAG_TEMPLATES)[number];

export const ROLL_PRICE_TAG_TEMPLATE: PriceTagsTemplate = "xp365b-roll-58x40";

export const ROLL_PRICE_TAG_DIMENSIONS_MM = {
  width: 58,
  height: 40,
} as const;

export const PRICE_TAG_ROLL_DEFAULTS = {
  gapMm: 3.5,
  xOffsetMm: 0,
  yOffsetMm: 0,
  widthMm: ROLL_PRICE_TAG_DIMENSIONS_MM.width,
  heightMm: ROLL_PRICE_TAG_DIMENSIONS_MM.height,
} as const;

export const PRICE_TAG_ROLL_LIMITS = {
  gapMm: { min: 0, max: 6, step: 0.5 },
  offsetMm: { min: -3, max: 3, step: 0.5 },
  widthMm: { min: 20, max: 82, step: 0.5 },
  heightMm: { min: 20, max: 100, step: 0.5 },
} as const;

export type PriceTagRollCalibration = {
  gapMm: number;
  xOffsetMm: number;
  yOffsetMm: number;
  widthMm?: number;
  heightMm?: number;
};

export const isRollPriceTagTemplate = (template: PriceTagsTemplate) =>
  template === ROLL_PRICE_TAG_TEMPLATE;
