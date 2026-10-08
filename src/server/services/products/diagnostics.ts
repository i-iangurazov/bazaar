import { Prisma, type PrismaClient } from "@prisma/client";

import { normalizeScanValue } from "@/lib/scanning/normalize";
import { productStoreAssignmentInWhere, resolveAccessibleStoreIds, userHasAllStoreAccess, type StoreAccessUser } from "@/server/services/storeAccess";

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
      AND "isDeleted" = false
      AND btrim(regexp_replace(lower("name"), '[^[:alnum:]]+', ' ', 'g')) IN (${Prisma.join(uniqueNames)})
    ORDER BY "name" ASC, "sku" ASC
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
  user,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  productId?: string;
  sku?: string;
  name?: string;
  barcodes?: string[];
  user?: StoreAccessUser;
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
                storeProducts: { where: { isActive: true }, select: { store: { select: { id: true, name: true } } } },
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

  const canManage = user && (user.role === "ADMIN" || user.role === "MANAGER");
  const storeIds = canManage && !userHasAllStoreAccess(user)
    ? await resolveAccessibleStoreIds(prisma, user) : null;
  const matchingIds = barcodeMatches.map(m => m.product.id);
  const accessibleIds = new Set(canManage && matchingIds.length
    ? (await prisma.product.findMany({ where: {
        organizationId, id: { in: matchingIds },
        ...(storeIds === null ? {} : productStoreAssignmentInWhere(storeIds)),
      }, select: { id: true } })).map(p => p.id)
    : []);
  return {
    exactSkuMatch,
    exactBarcodeMatches: barcodeMatches.map((match) => ({
      barcode: match.value,
      id: match.product.id,
      sku: match.product.sku,
      name: match.product.name,
      isDeleted: match.product.isDeleted,
      canAccess: accessibleIds.has(match.product.id),
      canTransfer: match.product.isDeleted && accessibleIds.has(match.product.id),
      stores: match.product.storeProducts.map(a => a.store).filter(s => storeIds === null || storeIds.includes(s.id)),
    })),
    likelyNameMatches: filteredNameMatches.map(({ normalizedName: _normalizedName, ...match }) => match),
  };
};
