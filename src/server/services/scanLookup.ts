import type { Prisma } from "@prisma/client";

export type ScanLookupMatch = "barcode" | "sku" | "name";

export type ScanLookupItem = {
  id: string;
  sku: string;
  name: string;
  matchType: ScanLookupMatch;
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
  const normalized = query.trim();
  if (!normalized) {
    return { exactMatch: false, items: [] };
  }

  const barcodeMatch = await client.productBarcode.findFirst({
    where: {
      organizationId,
      value: normalized,
      product: { isDeleted: false },
    },
    select: { product: { select: { id: true, sku: true, name: true } } },
  });

  if (barcodeMatch?.product) {
    return {
      exactMatch: true,
      items: [
        {
          id: barcodeMatch.product.id,
          sku: barcodeMatch.product.sku,
          name: barcodeMatch.product.name,
          matchType: "barcode",
        },
      ],
    };
  }

  const packMatch = await client.productPack.findFirst({
    where: {
      organizationId,
      packBarcode: normalized,
      product: { isDeleted: false },
    },
    select: { product: { select: { id: true, sku: true, name: true } } },
  });

  if (packMatch?.product) {
    return {
      exactMatch: true,
      items: [
        {
          id: packMatch.product.id,
          sku: packMatch.product.sku,
          name: packMatch.product.name,
          matchType: "barcode",
        },
      ],
    };
  }

  const skuMatch = await client.product.findFirst({
    where: {
      organizationId,
      isDeleted: false,
      sku: { equals: normalized, mode: "insensitive" },
    },
    select: { id: true, sku: true, name: true },
  });

  if (skuMatch) {
    return {
      exactMatch: true,
      items: [
        {
          id: skuMatch.id,
          sku: skuMatch.sku,
          name: skuMatch.name,
          matchType: "sku",
        },
      ],
    };
  }

  const products = await client.product.findMany({
    where: {
      organizationId,
      isDeleted: false,
      name: { contains: normalized, mode: "insensitive" },
    },
    select: { id: true, sku: true, name: true },
    orderBy: { name: "asc" },
    take: 10,
  });

  return {
    exactMatch: false,
    items: products.map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      matchType: "name",
    })),
  };
};
