import { Prisma, type PrismaClient } from "@prisma/client";

import { normalizeScanValue } from "@/lib/scanning/normalize";

type PrismaDbClient = PrismaClient | Prisma.TransactionClient;

export type ProductDuplicateMatch = {
  id: string;
  sku: string;
  name: string;
  isDeleted: boolean;
};

export type ProductBarcodeDuplicateMatch = ProductDuplicateMatch & {
  barcode: string;
};

export const normalizeProductNameForDiagnostics = (value?: string | null) =>
  value
    ?.toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";

const normalizeBarcodesForDiagnostics = (barcodes?: string[]) =>
  Array.from(
    new Set(
      (barcodes ?? [])
        .map((value) => normalizeScanValue(value))
        .filter((value) => value.length > 0),
    ),
  );

export const listProductsByNormalizedNames = async ({
  prisma,
  organizationId,
  normalizedNames,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  normalizedNames: string[];
}) => {
  const uniqueNames = Array.from(
    new Set(normalizedNames.map((value) => value.trim()).filter((value) => value.length >= 4)),
  );
  if (!uniqueNames.length) {
    return [] as Array<ProductDuplicateMatch & { normalizedName: string }>;
  }

  return prisma.$queryRaw<Array<ProductDuplicateMatch & { normalizedName: string }>>(Prisma.sql`
    SELECT
      "id",
      "sku",
      "name",
      "isDeleted",
      btrim(regexp_replace(lower("name"), '[^[:alnum:]]+', ' ', 'g')) AS "normalizedName"
    FROM "Product"
    WHERE "organizationId" = ${organizationId}
      AND btrim(regexp_replace(lower("name"), '[^[:alnum:]]+', ' ', 'g')) IN (${Prisma.join(uniqueNames)})
    ORDER BY "isDeleted" ASC, "name" ASC, "sku" ASC
    LIMIT 250
  `);
};

export const getProductDuplicateDiagnostics = async ({
  prisma,
  organizationId,
  productId,
  sku,
  name,
  barcodes,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  productId?: string;
  sku?: string;
  name?: string;
  barcodes?: string[];
}) => {
  const trimmedSku = sku?.trim() ?? "";
  const normalizedName = normalizeProductNameForDiagnostics(name);
  const normalizedBarcodes = normalizeBarcodesForDiagnostics(barcodes);

  const [exactSkuMatch, barcodeMatches, likelyNameMatches] = await Promise.all([
    trimmedSku.length >= 2
      ? prisma.product.findFirst({
          where: {
            organizationId,
            sku: trimmedSku,
            ...(productId ? { id: { not: productId } } : {}),
          },
          select: {
            id: true,
            sku: true,
            name: true,
            isDeleted: true,
          },
        })
      : Promise.resolve(null),
    normalizedBarcodes.length
      ? prisma.productBarcode.findMany({
          where: {
            organizationId,
            value: { in: normalizedBarcodes },
            ...(productId ? { productId: { not: productId } } : {}),
          },
          select: {
            value: true,
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                isDeleted: true,
              },
            },
          },
          orderBy: [{ value: "asc" }, { product: { name: "asc" } }],
        })
      : Promise.resolve([]),
    normalizedName.length >= 4
      ? listProductsByNormalizedNames({
          prisma,
          organizationId,
          normalizedNames: [normalizedName],
        })
      : Promise.resolve([]),
  ]);

  const filteredNameMatches = likelyNameMatches.filter((match) => {
    if (productId && match.id === productId) {
      return false;
    }
    if (exactSkuMatch && match.id === exactSkuMatch.id) {
      return false;
    }
    return match.normalizedName === normalizedName;
  });

  return {
    exactSkuMatch,
    exactBarcodeMatches: barcodeMatches.map((match) => ({
      barcode: match.value,
      id: match.product.id,
      sku: match.product.sku,
      name: match.product.name,
      isDeleted: match.product.isDeleted,
    })),
    likelyNameMatches: filteredNameMatches.map(({ normalizedName: _normalizedName, ...match }) => match),
  };
};
