import { Prisma, type PrismaClient } from "@prisma/client";

import { normalizeScanValue } from "@/lib/scanning/normalize";
import { normalizeProductCategoryNames } from "@/server/services/productCategories";
import { normalizeProductNameForDiagnostics } from "@/server/services/products/diagnostics";

type PrismaDbClient = PrismaClient | Prisma.TransactionClient;

const importMatchProductSelect = {
  id: true,
  sku: true,
  name: true,
  isDeleted: true,
  category: true,
  categories: true,
  basePriceKgs: true,
} as const;

export type ProductImportMatchProduct = Prisma.ProductGetPayload<{
  select: typeof importMatchProductSelect;
}>;

export type ProductImportMatchReason =
  | "barcode"
  | "sku"
  | "name_category"
  | "name_price"
  | "possible_duplicate"
  | "cross_store_barcode"
  | "cross_store_sku"
  | "none";

export type ProductImportMatch = {
  reason: ProductImportMatchReason;
  product: ProductImportMatchProduct | null;
  barcode?: string;
};

export const normalizeImportBarcodesForMatch = (barcodes?: string[]) =>
  Array.from(
    new Set(
      (barcodes ?? [])
        .map((value) => normalizeScanValue(value))
        .filter((value) => value.length > 0),
    ),
  );

export const normalizeImportCategoriesForMatch = (categories?: string[] | null) =>
  normalizeProductCategoryNames(categories ?? []);

const productStoreScope = (storeId: string): Prisma.ProductWhereInput => ({
  storeProducts: {
    some: {
      storeId,
      isActive: true,
    },
  },
});

const decimalToNumber = (value: Prisma.Decimal | null) => (value === null ? null : Number(value));

const pricesMatch = (left: Prisma.Decimal | null, right?: number) => {
  if (right === undefined || !Number.isFinite(right)) {
    return false;
  }
  const existing = decimalToNumber(left);
  return existing !== null && Math.abs(existing - right) < 0.005;
};

const productCategoryKeys = (product: Pick<ProductImportMatchProduct, "category" | "categories">) =>
  normalizeImportCategoriesForMatch(
    product.categories.length ? product.categories : product.category ? [product.category] : [],
  );

const findStoreScopedProductsByNormalizedName = async ({
  prisma,
  organizationId,
  storeId,
  normalizedName,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  storeId: string;
  normalizedName: string;
}) => {
  if (normalizedName.length < 4) {
    return [] as ProductImportMatchProduct[];
  }

  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT p."id"
    FROM "Product" p
    INNER JOIN "StoreProduct" sp ON sp."productId" = p."id"
    WHERE p."organizationId" = ${organizationId}
      AND sp."storeId" = ${storeId}
      AND sp."isActive" = true
      AND btrim(regexp_replace(lower(p."name"), '[^[:alnum:]]+', ' ', 'g')) = ${normalizedName}
    ORDER BY p."isDeleted" ASC, p."name" ASC, p."sku" ASC
    LIMIT 25
  `);

  const ids = rows.map((row) => row.id);
  if (!ids.length) {
    return [];
  }

  const products = await prisma.product.findMany({
    where: { id: { in: ids }, organizationId },
    select: importMatchProductSelect,
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  return ids
    .map((id) => byId.get(id))
    .filter((product): product is ProductImportMatchProduct => Boolean(product));
};

export const resolveProductImportMatch = async ({
  prisma,
  organizationId,
  storeId,
  sku,
  barcodes,
  name,
  categories,
  basePriceKgs,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  storeId: string;
  sku?: string | null;
  barcodes?: string[];
  name?: string | null;
  categories?: string[] | null;
  basePriceKgs?: number;
}): Promise<ProductImportMatch> => {
  const normalizedSku = sku?.trim() ?? "";
  const normalizedBarcodes = normalizeImportBarcodesForMatch(barcodes);

  if (normalizedBarcodes.length) {
    const barcodeMatch = await prisma.productBarcode.findFirst({
      where: {
        organizationId,
        value: { in: normalizedBarcodes },
        product: productStoreScope(storeId),
      },
      select: {
        value: true,
        product: { select: importMatchProductSelect },
      },
      orderBy: [{ value: "asc" }, { product: { name: "asc" } }],
    });
    if (barcodeMatch) {
      return { reason: "barcode", product: barcodeMatch.product, barcode: barcodeMatch.value };
    }
  }

  if (normalizedSku.length >= 2) {
    const skuMatch = await prisma.product.findFirst({
      where: {
        organizationId,
        sku: normalizedSku,
        ...productStoreScope(storeId),
      },
      select: importMatchProductSelect,
      orderBy: [{ isDeleted: "asc" }, { createdAt: "asc" }],
    });
    if (skuMatch) {
      return { reason: "sku", product: skuMatch };
    }
  }

  if (normalizedBarcodes.length) {
    const crossStoreBarcode = await prisma.productBarcode.findFirst({
      where: {
        organizationId,
        value: { in: normalizedBarcodes },
        product: {
          NOT: productStoreScope(storeId),
        },
      },
      select: {
        value: true,
        product: { select: importMatchProductSelect },
      },
      orderBy: [{ value: "asc" }, { product: { name: "asc" } }],
    });
    if (crossStoreBarcode) {
      return {
        reason: "cross_store_barcode",
        product: crossStoreBarcode.product,
        barcode: crossStoreBarcode.value,
      };
    }
  }

  if (normalizedSku.length >= 2) {
    const crossStoreSku = await prisma.product.findFirst({
      where: {
        organizationId,
        sku: normalizedSku,
        NOT: productStoreScope(storeId),
      },
      select: importMatchProductSelect,
      orderBy: [{ isDeleted: "asc" }, { createdAt: "asc" }],
    });
    if (crossStoreSku) {
      return { reason: "cross_store_sku", product: crossStoreSku };
    }
  }

  const normalizedName = normalizeProductNameForDiagnostics(name);
  const nameCandidates = await findStoreScopedProductsByNormalizedName({
    prisma,
    organizationId,
    storeId,
    normalizedName,
  });

  if (nameCandidates.length) {
    const rowCategories = normalizeImportCategoriesForMatch(categories);
    if (rowCategories.length) {
      const categoryMatch = nameCandidates.find((product) => {
        const existingCategories = productCategoryKeys(product);
        return rowCategories.some((category) => existingCategories.includes(category));
      });
      if (categoryMatch) {
        return { reason: "name_category", product: categoryMatch };
      }
    }

    const priceMatch = nameCandidates.find((product) =>
      pricesMatch(product.basePriceKgs, basePriceKgs),
    );
    if (priceMatch) {
      return { reason: "name_price", product: priceMatch };
    }

    return { reason: "possible_duplicate", product: nameCandidates[0] ?? null };
  }

  return { reason: "none", product: null };
};

export const productImportMatchIsExisting = (match: ProductImportMatch) =>
  match.reason === "barcode" ||
  match.reason === "sku" ||
  match.reason === "name_category" ||
  match.reason === "name_price";

export const productImportMatchIsBlocking = (match: ProductImportMatch) =>
  match.reason === "cross_store_barcode" || match.reason === "cross_store_sku";
