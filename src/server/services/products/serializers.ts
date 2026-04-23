import type { Prisma } from "@prisma/client";

const maxListImageUrlLength = 2_048;
const maxDetailImageUrlLength = 8_192;

type ProductPreviewRecord = {
  id: string;
  sku: string;
  name: string;
  isBundle: boolean;
  photoUrl?: string | null;
  category?: string | null;
  categories?: string[];
  basePriceKgs?: Prisma.Decimal | null;
  barcodes?: Array<{ value: string }>;
  inventorySnapshots?: Array<{ storeId: string; onHand: number }>;
  images: Array<{ url: string }>;
};

type ProductListRecord = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  categories: string[];
  unit: string;
  baseUnitId: string;
  isBundle: boolean;
  isDeleted: boolean;
  photoUrl: string | null;
  basePriceKgs: Prisma.Decimal | null;
  barcodes: Array<{ value: string }>;
  inventorySnapshots: Array<{ storeId: string; onHand: number }>;
  images: Array<{ id: string; url: string; position: number }>;
};

type ProductDetailRecord = {
  photoUrl: string | null;
  basePriceKgs: Prisma.Decimal | null;
  images: Array<{
    id: string;
    url: string;
    position: number;
  }>;
  barcodes: Array<{ value: string }>;
  variants: Array<{
    id: string;
    name: string | null;
    sku: string | null;
    attributes: Prisma.JsonValue;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>;
};

type SerializedProductDetail<TProduct extends ProductDetailRecord> = Omit<
  TProduct,
  "images" | "photoUrl" | "barcodes" | "variants" | "basePriceKgs"
> & {
  images: Array<{
    id: string;
    url: string;
    position: number;
  }>;
  photoUrl: string | null;
  barcodes: string[];
  variants: Array<TProduct["variants"][number] & { canDelete: boolean }>;
  basePriceKgs: number | null;
  purchasePriceKgs: number | null;
  avgCostKgs: number | null;
};

export const decimalToNumber = (value: Prisma.Decimal | null | undefined) =>
  value === null || value === undefined ? null : Number(value);

export const sanitizeListImageUrl = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  if (value.startsWith("data:image/")) {
    return null;
  }
  if (value.length > maxListImageUrlLength) {
    return null;
  }
  return value;
};

export const sanitizeDetailImageUrl = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  if (value.startsWith("data:image/")) {
    return null;
  }
  if (value.length > maxDetailImageUrlLength) {
    return null;
  }
  return value;
};

export const serializeProductPreview = (
  product: ProductPreviewRecord,
  options?: {
    selectedStoreId?: string;
    effectivePriceKgs?: number | null;
    primaryBarcode?: string | null;
  },
) => {
  const basePrice = decimalToNumber(product.basePriceKgs);
  const onHandQty = product.inventorySnapshots?.reduce((sum, snapshot) => {
    if (options?.selectedStoreId && snapshot.storeId !== options.selectedStoreId) {
      return sum;
    }
    return sum + snapshot.onHand;
  }, 0) ?? null;

  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    type: product.isBundle ? ("bundle" as const) : ("product" as const),
    isBundle: product.isBundle,
    category: product.categories?.[0] ?? product.category ?? null,
    categories: product.categories ?? [],
    basePriceKgs: basePrice,
    effectivePriceKgs: options?.effectivePriceKgs ?? basePrice,
    onHandQty,
    primaryBarcode:
      options?.primaryBarcode ?? product.barcodes?.find((barcode) => barcode.value.trim())?.value ?? null,
    primaryImage:
      sanitizeListImageUrl(product.images[0]?.url) ?? sanitizeListImageUrl(product.photoUrl) ?? null,
  };
};

export const serializeProductListItem = ({
  product,
  selectedStoreId,
  avgCostKgs,
  purchasePriceKgs,
  overridePriceKgs,
}: {
  product: ProductListRecord;
  selectedStoreId?: string;
  avgCostKgs: number | null;
  purchasePriceKgs: number | null;
  overridePriceKgs?: number | null;
}) => {
  const basePrice = decimalToNumber(product.basePriceKgs);
  const effectivePrice = overridePriceKgs ?? basePrice;
  const onHandQty = product.inventorySnapshots.reduce((sum, snapshot) => {
    if (selectedStoreId && snapshot.storeId !== selectedStoreId) {
      return sum;
    }
    return sum + snapshot.onHand;
  }, 0);

  return {
    ...product,
    images: product.images.flatMap((image) => {
      const sanitized = sanitizeListImageUrl(image.url);
      return sanitized ? [{ ...image, url: sanitized }] : [];
    }),
    photoUrl: sanitizeListImageUrl(product.photoUrl),
    basePriceKgs: basePrice,
    effectivePriceKgs: effectivePrice,
    purchasePriceKgs,
    avgCostKgs,
    onHandQty,
    priceOverridden: overridePriceKgs !== undefined && overridePriceKgs !== null,
  };
};

export const serializeProductDetail = <TProduct extends ProductDetailRecord>({
  product,
  avgCostKgs,
  purchasePriceKgs,
  blockedVariantIds,
}: {
  product: TProduct;
  avgCostKgs: number | null;
  purchasePriceKgs: number | null;
  blockedVariantIds: Set<string>;
}): SerializedProductDetail<TProduct> => {
  const detailProduct = product as TProduct & Record<string, unknown>;
  const images = product.images.flatMap((image) => {
    const sanitized = sanitizeDetailImageUrl(image.url);
    return sanitized ? [{ ...image, url: sanitized }] : [];
  });
  const photoUrl = sanitizeDetailImageUrl(product.photoUrl) ?? images[0]?.url ?? null;

  return {
    ...detailProduct,
    images,
    photoUrl,
    barcodes: product.barcodes.map((barcode) => barcode.value),
    variants: product.variants.map((variant) => ({
      ...variant,
      canDelete: !blockedVariantIds.has(variant.id),
    })),
    basePriceKgs: decimalToNumber(product.basePriceKgs),
    purchasePriceKgs,
    avgCostKgs,
  } as SerializedProductDetail<TProduct>;
};

export const serializeProductPricing = ({
  basePriceKgs,
  effectivePriceKgs,
  avgCostKgs,
  priceOverridden,
}: {
  basePriceKgs: Prisma.Decimal | null;
  effectivePriceKgs: Prisma.Decimal | null;
  avgCostKgs: Prisma.Decimal | null;
  priceOverridden: boolean;
}) => ({
  basePriceKgs: decimalToNumber(basePriceKgs),
  effectivePriceKgs: decimalToNumber(effectivePriceKgs),
  priceOverridden,
  avgCostKgs: decimalToNumber(avgCostKgs),
});
