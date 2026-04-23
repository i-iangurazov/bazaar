import type { Prisma } from "@prisma/client";
import { normalizeScanValue } from "@/lib/scanning/normalize";
import { decimalToNumber, sanitizeListImageUrl } from "@/server/services/products/serializers";

export type ScanLookupMatch = "barcode" | "sku" | "name";

export type ScanLookupItem = {
  id: string;
  sku: string;
  name: string;
  matchType: ScanLookupMatch;
  type: "product" | "bundle";
  primaryImage: string | null;
  primaryBarcode?: string | null;
  category?: string | null;
  categories?: string[];
  basePriceKgs?: number | null;
  effectivePriceKgs?: number | null;
  onHandQty?: number | null;
};

export type ScanLookupResult = {
  exactMatch: boolean;
  items: ScanLookupItem[];
};

const scanMatchRank: Record<ScanLookupMatch, number> = {
  barcode: 0,
  sku: 1,
  name: 2,
};

type ScanLookupClient = {
  productBarcode: Pick<Prisma.ProductBarcodeDelegate, "findFirst">;
  productPack: Pick<Prisma.ProductPackDelegate, "findFirst">;
  product: Pick<Prisma.ProductDelegate, "findFirst" | "findMany">;
};

const scanProductSelect = {
  id: true,
  sku: true,
  name: true,
  isBundle: true,
  photoUrl: true,
  category: true,
  categories: true,
  basePriceKgs: true,
  barcodes: {
    select: { value: true },
    take: 3,
  },
  inventorySnapshots: {
    select: { storeId: true, onHand: true },
  },
  images: {
    select: { url: true },
    where: { url: { not: { startsWith: "data:image/" } } },
    orderBy: { position: "asc" },
    take: 1,
  },
} satisfies Prisma.ProductSelect;

export const lookupScanProducts = async (
  client: ScanLookupClient,
  organizationId: string,
  query: string,
): Promise<ScanLookupResult> => {
  const normalized = normalizeScanValue(query);
  const trimmed = query.trim();
  const exactNeedle = normalized || trimmed;
  if (!exactNeedle) {
    return { exactMatch: false, items: [] };
  }

  const toItem = (item: {
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
    images?: Array<{ url: string }>;
    primaryBarcode?: string | null;
    matchType: ScanLookupMatch;
  }): ScanLookupItem => ({
    id: item.id,
    sku: item.sku,
    name: item.name,
    matchType: item.matchType,
    type: item.isBundle ? "bundle" : "product",
    primaryImage:
      sanitizeListImageUrl(item.images?.[0]?.url) ?? sanitizeListImageUrl(item.photoUrl) ?? null,
    primaryBarcode:
      item.primaryBarcode ?? item.barcodes?.find((barcode) => barcode.value.trim())?.value ?? null,
    category: item.categories?.[0] ?? item.category ?? null,
    categories: item.categories ?? [],
    basePriceKgs: decimalToNumber(item.basePriceKgs),
    effectivePriceKgs: decimalToNumber(item.basePriceKgs),
    onHandQty:
      item.inventorySnapshots?.reduce((sum, snapshot) => sum + snapshot.onHand, 0) ?? null,
  });

  const barcodeMatch = await client.productBarcode.findFirst({
    where: {
      organizationId,
      value: exactNeedle,
      product: { isDeleted: false },
    },
    select: {
      value: true,
      product: {
        select: scanProductSelect,
      },
    },
  });

  if (barcodeMatch?.product) {
    return {
      exactMatch: true,
      items: [
        toItem({
          ...barcodeMatch.product,
          primaryBarcode: barcodeMatch.value,
          matchType: "barcode",
        }),
      ],
    };
  }

  const packMatch = await client.productPack.findFirst({
    where: {
      organizationId,
      packBarcode: exactNeedle,
      product: { isDeleted: false },
    },
    select: {
      product: {
        select: scanProductSelect,
      },
    },
  });

  if (packMatch?.product) {
    return {
      exactMatch: true,
      items: [
        toItem({
          ...packMatch.product,
          matchType: "barcode",
        }),
      ],
    };
  }

  const skuMatch = await client.product.findFirst({
    where: {
      organizationId,
      isDeleted: false,
      sku: { equals: exactNeedle, mode: "insensitive" },
    },
    select: scanProductSelect,
  });

  if (skuMatch) {
    return {
      exactMatch: true,
      items: [
        toItem({
          ...skuMatch,
          matchType: "sku",
        }),
      ],
    };
  }

  const fuzzyNeedle = trimmed || exactNeedle;
  const barcodeNeedle = normalized || fuzzyNeedle;
  const fuzzyNeedleLower = fuzzyNeedle.toLowerCase();

  const products = await client.product.findMany({
    where: {
      organizationId,
      isDeleted: false,
      OR: [
        { name: { contains: fuzzyNeedle, mode: "insensitive" } },
        { sku: { contains: fuzzyNeedle, mode: "insensitive" } },
        {
          barcodes: {
            some: {
              value: { contains: barcodeNeedle, mode: "insensitive" },
            },
          },
        },
        {
          packs: {
            some: {
              packBarcode: { contains: barcodeNeedle, mode: "insensitive" },
            },
          },
        },
      ],
    },
    select: {
      ...scanProductSelect,
      barcodes: {
        where: { value: { contains: barcodeNeedle, mode: "insensitive" } },
        select: { value: true },
        take: 1,
      },
      packs: {
        where: { packBarcode: { contains: barcodeNeedle, mode: "insensitive" } },
        select: { id: true },
        take: 1,
      },
      images: {
        select: { url: true },
        where: { url: { not: { startsWith: "data:image/" } } },
        orderBy: { position: "asc" },
        take: 1,
      },
    },
    orderBy: { name: "asc" },
    take: 10,
  });

  return {
    exactMatch: false,
    items: products
      .map((product) => {
        const hasBarcodeMatch = product.barcodes.length > 0 || product.packs.length > 0;
        const hasSkuMatch = product.sku.toLowerCase().includes(fuzzyNeedleLower);
        return toItem({
          ...product,
          matchType: hasBarcodeMatch ? "barcode" : hasSkuMatch ? "sku" : "name",
        });
      })
      .sort(
        (left, right) =>
          scanMatchRank[left.matchType] - scanMatchRank[right.matchType] ||
          left.name.localeCompare(right.name, "ru"),
      ),
  };
};
