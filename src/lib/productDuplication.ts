export const QUICK_PRODUCT_DUPLICATION_PRESET = {
  status: "ACTIVE",
  copyImages: true,
  copyDescription: true,
  copyCategory: true,
  copyOtherDetails: true,
  copyPrice: true,
  copyCost: true,
  copyVariants: true,
  copyCharacteristics: true,
  copySku: true,
} as const;

export const buildQuickProductDuplicateInput = (input: {
  idempotencyKey: string;
  productId: string;
}) => ({
  ...input,
  ...QUICK_PRODUCT_DUPLICATION_PRESET,
});
