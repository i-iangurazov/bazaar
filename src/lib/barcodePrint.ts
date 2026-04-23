export type BarcodePrintProduct = {
  id: string;
  name?: string | null;
  sku?: string | null;
  barcodes?: Array<{ value?: string | null } | string>;
};

export type BarcodeLabelPrintItem = {
  productId: string;
  quantity: number;
};

export const hasPrintableBarcode = (product: BarcodePrintProduct) =>
  Boolean(
    product.barcodes?.some((entry) =>
      typeof entry === "string" ? entry.trim().length > 0 : entry.value?.trim(),
    ),
  );

export const findProductsMissingPrintableBarcode = <T extends BarcodePrintProduct>(
  products: T[],
) => products.filter((product) => !hasPrintableBarcode(product));

export const buildBarcodeLabelPrintItems = (input: {
  productIds: string[];
  quantity: number;
}): BarcodeLabelPrintItem[] => {
  const quantity = Math.trunc(input.quantity);
  if (!Number.isFinite(quantity) || quantity < 1) {
    return [];
  }

  const seen = new Set<string>();
  const ids = input.productIds.filter((id) => {
    const normalized = id.trim();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });

  return ids.map((productId) => ({ productId, quantity }));
};
