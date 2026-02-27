import type { Prisma } from "@prisma/client";
import { normalizeScanValue } from "@/lib/scanning/normalize";

export type ScanLookupMatch = "barcode" | "sku" | "name";

export type ScanLookupItem = {
  id: string;
  sku: string;
  name: string;
  matchType: ScanLookupMatch;
  type: "product" | "bundle";
  primaryImage: string | null;
};

export type ScanLookupResult = {
  exactMatch: boolean;
  items: ScanLookupItem[];
};

type ScanLookupClient = {
  productBarcode: Pick<Prisma.ProductBarcodeDelegate, "findFirst">;
  productPack: Pick<Prisma.ProductPackDelegate, "findFirst">;
  product: Pick<Prisma.ProductDelegate, "findFirst" | "findMany">;
};

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
    images?: Array<{ url: string }>;
    matchType: ScanLookupMatch;
  }): ScanLookupItem => ({
    id: item.id,
    sku: item.sku,
    name: item.name,
    matchType: item.matchType,
    type: item.isBundle ? "bundle" : "product",
    primaryImage: item.images?.[0]?.url ?? null,
  });

  const barcodeMatch = await client.productBarcode.findFirst({
    where: {
      organizationId,
      value: exactNeedle,
      product: { isDeleted: false },
    },
    select: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          isBundle: true,
          images: {
            select: { url: true },
            where: { url: { not: { startsWith: "data:image/" } } },
            orderBy: { position: "asc" },
            take: 1,
          },
        },
      },
    },
  });

  if (barcodeMatch?.product) {
    return {
      exactMatch: true,
      items: [
        toItem({
          ...barcodeMatch.product,
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
        select: {
          id: true,
          sku: true,
          name: true,
          isBundle: true,
          images: {
            select: { url: true },
            where: { url: { not: { startsWith: "data:image/" } } },
            orderBy: { position: "asc" },
            take: 1,
          },
        },
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
    select: {
      id: true,
      sku: true,
      name: true,
      isBundle: true,
      images: {
        select: { url: true },
        where: { url: { not: { startsWith: "data:image/" } } },
        orderBy: { position: "asc" },
        take: 1,
      },
    },
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
      id: true,
      sku: true,
      name: true,
      isBundle: true,
      barcodes: {
        where: { value: { contains: barcodeNeedle, mode: "insensitive" } },
        select: { value: true },
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
    items: products.map((product) => {
      const hasBarcodeMatch = product.barcodes.length > 0;
      const skuMatchType = product.sku.toLowerCase().includes(fuzzyNeedleLower);
      return toItem({
        ...product,
        matchType: hasBarcodeMatch ? "barcode" : skuMatchType ? "sku" : "name",
      });
    }),
  };
};
