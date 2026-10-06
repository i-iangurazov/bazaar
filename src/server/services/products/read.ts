import { resolveStoreSellingPrice } from "@/server/services/storeSellingPrice";
import { Prisma, type PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { Logger } from "pino";

import { equivalentRetailBarcode, normalizeScanValue } from "@/lib/scanning/normalize";
import { logProfileSection } from "@/server/profiling/perf";
import { listProductCategoriesFromDb } from "@/server/services/productCategories";
import { toCsv } from "@/server/services/csv";
import { lookupScanProducts } from "@/server/services/scanLookup";
import { suggestNextProductSku } from "@/server/services/products";
import { getProductDuplicateDiagnostics } from "@/server/services/products/diagnostics";
import {
  compareProductSearchRelevance,
  tokenizeProductSearchText,
} from "@/server/services/products/searchRelevance";
import {
  assertUserCanAccessStore,
  productStoreAssignmentInWhere,
  productStoreAssignmentWhere,
  resolveAccessibleStoreIds,
  type StoreAccessUser,
  userHasAllStoreAccess,
} from "@/server/services/storeAccess";
import { toTRPCError } from "@/server/trpc/errors";
import type {
  ProductListIdsInput,
  ProductListInput,
  ProductDuplicateDiagnosticsInput,
  ProductBootstrapInput,
  ProductExportColumnKey,
  ProductSortDirection,
  ProductSortKey,
} from "@/server/trpc/routers/products.schemas";
import {
  decimalToNumber,
  sanitizeDetailImageUrl,
  serializeProductDetail,
  serializeProductListItem,
  serializeProductPreview,
  serializeProductPricing,
} from "@/server/services/products/serializers";
import { getEffectiveProductPrice } from "@/server/services/effectiveProductPrice";

type PrismaDbClient = PrismaClient | Prisma.TransactionClient;

const dbSortableProductListKeys = new Set<ProductSortKey>(["updatedAt", "name", "sku"]);
const productExportColumns: Array<{ key: ProductExportColumnKey; header: string }> = [
  { key: "sku", header: "SKU" },
  { key: "name", header: "Название" },
  { key: "unit", header: "Ед. измерения" },
  { key: "categories", header: "Категории" },
  { key: "description", header: "Описание" },
  { key: "basePriceKgs", header: "Цена продажи" },
  { key: "purchasePriceKgs", header: "Цена закупки" },
  { key: "avgCostKgs", header: "Себестоимость" },
  { key: "minStock", header: "Минимальный остаток" },
  { key: "onHandQty", header: "Остаток" },
  { key: "stockScope", header: "Магазин / сумма остатков" },
  { key: "images", header: "Фото / ссылки на изображения" },
  { key: "variants", header: "Варианты" },
  { key: "barcodes", header: "Штрихкоды" },
];

const buildProductCategoryWhere = (category?: string) =>
  category
    ? {
        OR: [{ category }, { categories: { has: category } }],
      }
    : {};

const buildProductListWhere = (
  organizationId: string,
  input: ProductListIdsInput,
  readinessProductIds?: string[],
  scopedStoreIds?: string[],
): Prisma.ProductWhereInput => {
  const filters: Prisma.ProductWhereInput[] = [];
  if (input?.search) {
    const normalizedScanSearch = normalizeScanValue(input.search);
    const barcodeSearch = normalizedScanSearch || input.search;
    const searchTokens = tokenizeProductSearchText(input.search);
    filters.push({
      OR: [
        { name: { contains: input.search, mode: "insensitive" } },
        ...(searchTokens.length > 1
          ? [
              {
                AND: searchTokens.map((token) => ({
                  name: { contains: token, mode: "insensitive" as const },
                })),
              },
            ]
          : []),
        { sku: { contains: input.search, mode: "insensitive" } },
        { barcodes: { some: { value: { contains: barcodeSearch, mode: "insensitive" } } } },
        { packs: { some: { packBarcode: { contains: barcodeSearch, mode: "insensitive" } } } },
      ],
    });
  }
  if (input?.category) {
    filters.push(buildProductCategoryWhere(input.category));
  }
  if (input?.type === "product") {
    filters.push({ isBundle: false });
  } else if (input?.type === "bundle") {
    filters.push({ isBundle: true });
  }
  if (input?.readiness === "missingBarcode") {
    filters.push({ barcodes: { none: {} } });
  }
  if (input?.readiness === "missingImage") {
    filters.push({
      AND: [
        { OR: [{ photoUrl: null }, { photoUrl: "" }] },
        {
          images: {
            none: {
              url: {
                not: "",
              },
            },
          },
        },
      ],
    });
  }
  if (input?.readiness === "missingPrice") {
    filters.push({ basePriceKgs: null });
  }
  if (readinessProductIds) {
    filters.push({ id: { in: readinessProductIds.length ? readinessProductIds : ["__none__"] } });
  }
  if (input?.storeId) {
    filters.push(productStoreAssignmentWhere(input.storeId));
  } else if (scopedStoreIds) {
    filters.push(productStoreAssignmentInWhere(scopedStoreIds));
  }
  return {
    ...(input?.includeArchived ? {} : { isDeleted: false }),
    organizationId,
    ...(filters.length ? { AND: filters } : {}),
  };
};

const getDbProductOrderBy = (
  sortKey: ProductSortKey,
  sortDirection: ProductSortDirection,
): Prisma.ProductOrderByWithRelationInput[] | null => {
  if (!dbSortableProductListKeys.has(sortKey)) {
    return null;
  }

  if (sortKey === "updatedAt") {
    return [
      { updatedAt: sortDirection },
      { createdAt: sortDirection },
      { name: "asc" },
      { sku: "asc" },
      { id: "asc" },
    ];
  }

  if (sortKey === "sku") {
    return [{ sku: sortDirection }, { name: sortDirection }, { id: sortDirection }];
  }

  return [{ name: sortDirection }, { sku: sortDirection }, { id: sortDirection }];
};

export const resolveProductsBootstrapStoreId = ({
  preferredStoreId,
  storeIds,
}: {
  preferredStoreId?: string;
  storeIds: string[];
}) => {
  if (preferredStoreId === "all") {
    return null;
  }
  if (preferredStoreId && storeIds.includes(preferredStoreId)) {
    return preferredStoreId;
  }

  return storeIds[0] ?? null;
};

const resolveProductStoreScopeIds = async (
  prisma: PrismaDbClient,
  user?: StoreAccessUser,
): Promise<string[] | undefined> => {
  if (!user || userHasAllStoreAccess(user)) {
    return undefined;
  }
  return resolveAccessibleStoreIds(prisma, user);
};

const filterProductInventorySnapshots = <
  TProduct extends { inventorySnapshots?: Array<{ storeId: string; onHand: number }> },
>(
  product: TProduct,
  storeIds?: string[],
): TProduct => {
  if (!storeIds || !product.inventorySnapshots) {
    return product;
  }
  const visibleStores = new Set(storeIds);
  return {
    ...product,
    inventorySnapshots: product.inventorySnapshots.filter((snapshot) =>
      visibleStores.has(snapshot.storeId),
    ),
  };
};

const productPreviewSelect = {
  _count: { select: { variants: { where: { isActive: true } } } },
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
    select: { storeId: true, onHand: true, variantId: true, version: true },
  },
  images: {
    select: { url: true },
    where: { url: { not: { startsWith: "data:image/" } } },
    orderBy: { position: "asc" },
    take: 1,
  },
} satisfies Prisma.ProductSelect;

const productListSelect = {
  _count: { select: { variants: { where: { isActive: true } } } },
  id: true,
  sku: true,
  name: true,
  category: true,
  categories: true,
  unit: true,
  baseUnitId: true,
  isBundle: true,
  isDeleted: true,
  photoUrl: true,
  basePriceKgs: true,
  createdAt: true,
  updatedAt: true,
  barcodes: { select: { value: true } },
  inventorySnapshots: { select: { storeId: true, onHand: true, variantId: true, version: true } },
  images: {
    where: {
      url: {
        not: { startsWith: "data:image/" },
      },
    },
    select: { id: true, url: true, position: true },
    orderBy: { position: "asc" },
    take: 1,
  },
} satisfies Prisma.ProductSelect;

type ProductPreviewRecord = Prisma.ProductGetPayload<{ select: typeof productPreviewSelect }>;
type ProductListRecord = Prisma.ProductGetPayload<{ select: typeof productListSelect }>;

const productHasListImageWhere: Prisma.ProductWhereInput = {
  OR: [
    {
      AND: [
        { photoUrl: { not: null } },
        { photoUrl: { not: "" } },
        { photoUrl: { not: { startsWith: "data:image/" } } },
      ],
    },
    {
      images: {
        some: {
          url: {
            not: { startsWith: "data:image/" },
          },
        },
      },
    },
  ],
};

const readProductsByImageSort = async ({
  prisma,
  where,
  sortDirection,
  page,
  pageSize,
}: {
  prisma: PrismaDbClient;
  where: Prisma.ProductWhereInput;
  sortDirection: ProductSortDirection;
  page: number;
  pageSize: number;
}): Promise<{ total: number; products: ProductListRecord[] }> => {
  const hasImageWhere: Prisma.ProductWhereInput = { AND: [where, productHasListImageWhere] };
  const missingImageWhere: Prisma.ProductWhereInput = {
    AND: [where, { NOT: productHasListImageWhere }],
  };
  const firstWhere = sortDirection === "desc" ? hasImageWhere : missingImageWhere;
  const secondWhere = sortDirection === "desc" ? missingImageWhere : hasImageWhere;
  const orderBy: Prisma.ProductOrderByWithRelationInput[] = [
    { name: sortDirection },
    { sku: sortDirection },
    { id: sortDirection },
  ];
  const offset = (page - 1) * pageSize;
  const [total, firstCount] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.count({ where: firstWhere }),
  ]);
  const products: ProductListRecord[] = [];

  if (offset < firstCount) {
    products.push(
      ...(await prisma.product.findMany({
        where: firstWhere,
        select: productListSelect,
        orderBy,
        skip: offset,
        take: pageSize,
      })),
    );
  }

  const remaining = pageSize - products.length;
  if (remaining > 0) {
    products.push(
      ...(await prisma.product.findMany({
        where: secondWhere,
        select: productListSelect,
        orderBy,
        skip: Math.max(0, offset - firstCount),
        take: remaining,
      })),
    );
  }

  return { total, products };
};

// Match the price used by the product list and POS, including legacy rows
// whose retail value predates synchronization with the ordinary store price.
const buildStoreSellingPriceSql = (
  organizationId: string,
  storeId: string,
  mode: "RETAIL" | "WHOLESALE" = "RETAIL",
  pricingTime?: Date,
) => {
  const typedPrice = mode === "WHOLESALE"
    ? Prisma.sql`COALESCE(extra."wholesalePriceKgs", extra."retailPriceKgs", price."priceKgs", p."basePriceKgs")`
    : Prisma.sql`COALESCE(extra."retailPriceKgs", extra."wholesalePriceKgs", price."priceKgs", p."basePriceKgs")`;
  const amount = Prisma.sql`CASE WHEN organization."retailWholesaleEnabled"
    THEN ${typedPrice} ELSE COALESCE(price."priceKgs", p."basePriceKgs") END`;
  const effective = pricingTime ? Prisma.sql`CASE
    WHEN price."discountType" = 'PERCENTAGE'
      AND price."discountPercentage" > 0 AND price."discountPercentage" < 100
      AND (price."discountStartsAt" IS NULL OR price."discountStartsAt" <= ${pricingTime})
      AND (price."discountEndsAt" IS NULL OR ${pricingTime} < price."discountEndsAt")
    THEN ROUND((${amount}) * (100 - price."discountPercentage") / 100, 2)
    ELSE ${amount} END` : amount;
  return Prisma.sql`(
    SELECT ${effective} FROM "Organization" organization
    LEFT JOIN "StorePrice" price ON price."organizationId" = organization.id
      AND price."storeId" = ${storeId} AND price."productId" = p.id AND price."variantKey" = 'BASE'
    LEFT JOIN "StorePriceTypes" extra ON extra."organizationId" = organization.id
      AND extra."storeId" = ${storeId} AND extra."productId" = p.id AND extra."variantKey" = 'BASE'
    WHERE organization.id = ${organizationId}
  )`;
};

export const buildProductSqlBase = ({
  organizationId,
  input,
  accessibleStoreIds,
}: {
  organizationId: string;
  input: ProductListInput;
  accessibleStoreIds?: string[];
}) => {
  const conditions: Prisma.Sql[] = [Prisma.sql`p."organizationId" = ${organizationId}`];
  if (!input?.includeArchived) {
    conditions.push(Prisma.sql`p."isDeleted" = false`);
  }

  const searchQuery = input?.search?.trim() ?? "";
  if (searchQuery) {
    const searchNeedle = searchQuery.toLocaleLowerCase();
    const barcodeNeedle = (normalizeScanValue(searchQuery) || searchQuery).toLocaleLowerCase();
    const searchTokens = tokenizeProductSearchText(searchQuery);
    const allNameTokensSql =
      searchTokens.length > 1
        ? Prisma.sql`OR (${Prisma.join(
            searchTokens.map((token) => Prisma.sql`POSITION(${token} IN LOWER(p."name")) > 0`),
            " AND ",
          )})`
        : Prisma.empty;
    conditions.push(Prisma.sql`(
      POSITION(${searchNeedle} IN LOWER(p."name")) > 0
      ${allNameTokensSql}
      OR POSITION(${searchNeedle} IN LOWER(p."sku")) > 0
      OR EXISTS (
        SELECT 1 FROM "ProductBarcode" b
        WHERE b."productId" = p.id
          AND POSITION(${barcodeNeedle} IN LOWER(b."value")) > 0
      )
      OR EXISTS (
        SELECT 1 FROM "ProductPack" pack
        WHERE pack."productId" = p.id
          AND POSITION(${barcodeNeedle} IN LOWER(pack."packBarcode")) > 0
      )
    )`);
  }

  if (input?.category) {
    conditions.push(
      Prisma.sql`(p."category" = ${input.category} OR ${input.category} = ANY(p."categories"))`,
    );
  }
  if (input?.type === "product") {
    conditions.push(Prisma.sql`p."isBundle" = false`);
  } else if (input?.type === "bundle") {
    conditions.push(Prisma.sql`p."isBundle" = true`);
  }
  if (input?.readiness === "missingBarcode") {
    conditions.push(
      Prisma.sql`NOT EXISTS (SELECT 1 FROM "ProductBarcode" b WHERE b."productId" = p.id)`,
    );
  } else if (input?.readiness === "missingImage") {
    conditions.push(Prisma.sql`
      NULLIF(TRIM(COALESCE(p."photoUrl", '')), '') IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "ProductImage" image
        WHERE image."productId" = p.id AND image."url" <> ''
      )
    `);
  } else if (input?.readiness === "missingPrice") {
    conditions.push(input?.storeId
      ? Prisma.sql`${buildStoreSellingPriceSql(organizationId, input.storeId)} IS NULL`
      : Prisma.sql`p."basePriceKgs" IS NULL`);
  }

  // Filter the same BASE cost shown in the product table. An unfilled variant
  // must not make a product with a populated average cost appear here.
  // There is no marker for an intentional zero in ProductCost.
  if (input?.readiness === "missingCost") {
    conditions.push(Prisma.sql`NOT EXISTS (
      SELECT 1 FROM "ProductCost" c
      WHERE c."productId" = p.id AND c."organizationId" = ${organizationId}
        AND c."variantKey" = 'BASE' AND c."avgCostKgs" > 0
    )`);
  }

  const scopedStoreIds = input?.storeId
    ? [input.storeId]
    : accessibleStoreIds !== undefined
      ? accessibleStoreIds
      : undefined;
  if (scopedStoreIds !== undefined) {
    if (!scopedStoreIds.length) {
      conditions.push(Prisma.sql`false`);
    } else {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM "StoreProduct" assignment
        WHERE assignment."productId" = p.id
          AND assignment."storeId" IN (${Prisma.join(scopedStoreIds)})
          AND assignment."isActive" = true
      )`);
    }
  }

  if (
    input?.readiness === "negativeStock" ||
    input?.readiness === "outOfStock" ||
    input?.readiness === "lowStock"
  ) {
    const snapshotStoreSql =
      scopedStoreIds !== undefined
        ? scopedStoreIds.length
          ? Prisma.sql`AND stock."storeId" IN (${Prisma.join(scopedStoreIds)})`
          : Prisma.sql`AND false`
        : Prisma.sql`AND EXISTS (
          SELECT 1 FROM "Store" stock_store
          WHERE stock_store.id = stock."storeId"
            AND stock_store."organizationId" = ${organizationId}
        )`;
    if (input.readiness === "negativeStock") {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM "InventorySnapshot" stock
        WHERE stock."productId" = p.id ${snapshotStoreSql} AND stock."onHand" < 0
      )`);
    } else if (input.readiness === "outOfStock") {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM "InventorySnapshot" stock
        WHERE stock."productId" = p.id ${snapshotStoreSql} AND stock."onHand" <= 0
      )`);
    } else {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1
        FROM "InventorySnapshot" stock
        INNER JOIN "ReorderPolicy" policy
          ON policy."storeId" = stock."storeId"
         AND policy."productId" = stock."productId"
        WHERE stock."productId" = p.id
          ${snapshotStoreSql}
          AND policy."minStock" > 0
          AND stock."onHand" <= policy."minStock"
      )`);
    }
  }

  return Prisma.sql`FROM "Product" p WHERE ${Prisma.join(conditions, " AND ")}`;
};

const buildProductSqlSortExpression = ({
  organizationId,
  input,
  sortKey,
  visibleStoreIds,
  pricingTime,
}: {
  organizationId: string;
  input: ProductListInput;
  sortKey: ProductSortKey;
  visibleStoreIds?: string[];
  pricingTime: Date;
}) => {
  const snapshotScopeSql = input?.storeId
    ? Prisma.sql`AND stock."storeId" = ${input.storeId}`
    : visibleStoreIds !== undefined
      ? visibleStoreIds.length
        ? Prisma.sql`AND stock."storeId" IN (${Prisma.join(visibleStoreIds)})`
        : Prisma.sql`AND false`
      : Prisma.sql`AND EXISTS (
          SELECT 1 FROM "Store" visible_store
          WHERE visible_store.id = stock."storeId"
            AND visible_store."organizationId" = ${organizationId}
        )`;

  switch (sortKey) {
    case "updatedAt":
      return Prisma.sql`p."updatedAt"`;
    case "sku":
      return Prisma.sql`LOWER(p."sku")`;
    case "image":
      return Prisma.sql`CASE WHEN (
        (NULLIF(TRIM(COALESCE(p."photoUrl", '')), '') IS NOT NULL AND p."photoUrl" NOT LIKE 'data:image/%')
        OR EXISTS (
          SELECT 1 FROM "ProductImage" image
          WHERE image."productId" = p.id AND image."url" NOT LIKE 'data:image/%'
        )
      ) THEN 1 ELSE 0 END`;
    case "name":
      return Prisma.sql`LOWER(p."name")`;
    case "category":
      return Prisma.sql`LOWER(COALESCE(p."category", ''))`;
    case "unit":
      return Prisma.sql`LOWER(COALESCE(p."unit", ''))`;
    case "onHandQty":
      return Prisma.sql`(
        SELECT COALESCE(SUM(stock."onHand"), 0)
        FROM "InventorySnapshot" stock
        WHERE stock."productId" = p.id ${snapshotScopeSql}
      )`;
    case "salePrice":
      return input?.storeId
        ? buildStoreSellingPriceSql(organizationId, input.storeId, input.priceMode ?? "RETAIL", pricingTime)
        : Prisma.sql`p."basePriceKgs"`;
    case "avgCost":
      return Prisma.sql`(
        SELECT cost."avgCostKgs"
        FROM "ProductCost" cost
        WHERE cost."organizationId" = ${organizationId}
          AND cost."productId" = p.id
          AND cost."variantKey" = 'BASE'
        LIMIT 1
      )`;
    case "barcodes":
      return Prisma.sql`COALESCE((
        SELECT STRING_AGG(LOWER(barcode."value"), ', ' ORDER BY LOWER(barcode."value"))
        FROM "ProductBarcode" barcode
        WHERE barcode."productId" = p.id
      ), '')`;
    case "stores":
      return Prisma.sql`COALESCE((
        SELECT STRING_AGG(store_names.name, ', ' ORDER BY store_names.name)
        FROM (
          SELECT DISTINCT LOWER(store.name) AS name
          FROM "InventorySnapshot" stock
          INNER JOIN "Store" store ON store.id = stock."storeId"
          WHERE stock."productId" = p.id
            AND store."organizationId" = ${organizationId}
            ${
              input?.storeId
                ? Prisma.sql`AND stock."storeId" = ${input.storeId}`
                : visibleStoreIds !== undefined
                  ? visibleStoreIds.length
                    ? Prisma.sql`AND stock."storeId" IN (${Prisma.join(visibleStoreIds)})`
                    : Prisma.sql`AND false`
                  : Prisma.empty
            }
        ) store_names
      ), '')`;
  }

  return Prisma.sql`LOWER(p."name")`;
};

const buildProductSearchScoreSql = (searchQuery: string) => {
  const needle = searchQuery.toLocaleLowerCase();
  const barcodeNeedle = (normalizeScanValue(searchQuery) || searchQuery).toLocaleLowerCase();
  const tokens = tokenizeProductSearchText(searchQuery);
  const missingTokensSql = tokens.length
    ? Prisma.join(
        tokens.map(
          (token) => Prisma.sql`CASE WHEN EXISTS (
            SELECT 1
            FROM UNNEST(REGEXP_SPLIT_TO_ARRAY(LOWER(p."name"), '[^[:alnum:]]+')) name_token
            WHERE POSITION(${token} IN name_token) > 0
          ) THEN 0 ELSE 1 END`,
        ),
        " + ",
      )
    : Prisma.sql`0`;
  const allTokensMatchSql =
    tokens.length > 1 ? Prisma.sql`(${missingTokensSql}) = 0` : Prisma.sql`false`;

  const rankSql = Prisma.sql`CASE
    WHEN LOWER(p."sku") = ${needle} OR EXISTS (
      SELECT 1 FROM "ProductBarcode" barcode
      WHERE barcode."productId" = p.id AND LOWER(barcode."value") = ${barcodeNeedle}
    ) THEN 0
    WHEN LOWER(p."name") = ${needle} THEN 1
    WHEN LEFT(LOWER(p."name"), CHAR_LENGTH(${needle})) = ${needle} THEN 2
    WHEN EXISTS (
      SELECT 1
      FROM UNNEST(REGEXP_SPLIT_TO_ARRAY(LOWER(p."name"), '[^[:alnum:]]+')) name_token
      WHERE LEFT(name_token, CHAR_LENGTH(${needle})) = ${needle}
    ) THEN 3
    WHEN POSITION(${needle} IN LOWER(p."name")) > 0 THEN 4
    WHEN ${allTokensMatchSql} THEN 5
    WHEN LEFT(LOWER(p."sku"), CHAR_LENGTH(${needle})) = ${needle} OR EXISTS (
      SELECT 1 FROM "ProductBarcode" barcode
      WHERE barcode."productId" = p.id
        AND LEFT(LOWER(barcode."value"), CHAR_LENGTH(${barcodeNeedle})) = ${barcodeNeedle}
    ) THEN 6
    WHEN POSITION(${needle} IN LOWER(p."sku")) > 0 OR EXISTS (
      SELECT 1 FROM "ProductBarcode" barcode
      WHERE barcode."productId" = p.id
        AND POSITION(${barcodeNeedle} IN LOWER(barcode."value")) > 0
    ) THEN 7
    ELSE 99
  END`;
  const tokenPrefixIndexSql = Prisma.sql`COALESCE((
    SELECT MIN(name_token.ordinality - 1)
    FROM UNNEST(REGEXP_SPLIT_TO_ARRAY(LOWER(p."name"), '[^[:alnum:]]+'))
      WITH ORDINALITY AS name_token(value, ordinality)
    WHERE LEFT(name_token.value, CHAR_LENGTH(${needle})) = ${needle}
  ), 9007199254740991)`;

  return {
    rankSql,
    missingTokensSql: Prisma.sql`CASE WHEN (${rankSql}) = 99 THEN 9007199254740991 ELSE (${missingTokensSql}) END`,
    indexSql: Prisma.sql`CASE
      WHEN (${rankSql}) = 3 THEN ${tokenPrefixIndexSql}
      WHEN (${rankSql}) = 4 THEN POSITION(${needle} IN LOWER(p."name")) - 1
      WHEN (${rankSql}) = 99 THEN 9007199254740991
      ELSE 0
    END`,
    nameLengthSql: Prisma.sql`CASE
      WHEN (${rankSql}) = 99 THEN 9007199254740991
      ELSE CHAR_LENGTH(LOWER(p."name"))
    END`,
  };
};

const readProductsByAdvancedSqlSort = async ({
  prisma,
  organizationId,
  input,
  accessibleStoreIds,
  sortKey,
  sortDirection,
  page,
  pageSize,
  pricingTime,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  input: ProductListInput;
  accessibleStoreIds?: string[];
  sortKey: ProductSortKey;
  sortDirection: ProductSortDirection;
  page: number;
  pageSize: number;
  pricingTime: Date;
}): Promise<{ total: number; products: ProductListRecord[] }> => {
  const baseSql = buildProductSqlBase({ organizationId, input, accessibleStoreIds });
  const visibleStoreIds = input?.storeId ? [input.storeId] : accessibleStoreIds;
  const sortExpression = buildProductSqlSortExpression({
    organizationId,
    input,
    sortKey,
    visibleStoreIds,
    pricingTime,
  });
  const directionSql = sortDirection === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  const nullsSql = sortDirection === "desc" ? Prisma.sql`NULLS LAST` : Prisma.sql`NULLS FIRST`;
  const searchQuery = input?.search?.trim() ?? "";
  const relevanceOrderSql = searchQuery
    ? (() => {
        const score = buildProductSearchScoreSql(searchQuery);
        return Prisma.sql`
          ${score.rankSql} ASC,
          ${score.missingTokensSql} ASC,
          ${score.indexSql} ASC,
          ${score.nameLengthSql} ASC,
        `;
      })()
    : Prisma.empty;
  const stableOrderSql =
    sortKey === "updatedAt" && !searchQuery
      ? Prisma.sql`
        ${sortExpression} ${directionSql},
        p."createdAt" ${directionSql},
        LOWER(p."name") ASC,
        LOWER(p."sku") ASC,
        p.id ASC
      `
      : Prisma.sql`
        ${sortExpression} ${directionSql} ${nullsSql},
        LOWER(p."name") ${directionSql},
        LOWER(p."sku") ${directionSql},
        p.id ${directionSql}
      `;

  const [countRows, idRows] = await Promise.all([
    prisma.$queryRaw<Array<{ count: number | bigint }>>(
      Prisma.sql`SELECT COUNT(*)::int AS count ${baseSql}`,
    ),
    prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT p.id
        ${baseSql}
        ORDER BY ${relevanceOrderSql} ${stableOrderSql}
        LIMIT ${pageSize}
        OFFSET ${(page - 1) * pageSize}
      `,
    ),
  ]);
  const productIds = idRows.map((row) => row.id);
  if (!productIds.length) {
    return { total: Number(countRows[0]?.count ?? 0), products: [] };
  }
  const unorderedProducts = await prisma.product.findMany({
    where: { id: { in: productIds }, organizationId },
    select: productListSelect,
  });
  const productMap = new Map(unorderedProducts.map((product) => [product.id, product]));
  return {
    total: Number(countRows[0]?.count ?? 0),
    products: productIds
      .map((productId) => productMap.get(productId))
      .filter((product): product is ProductListRecord => Boolean(product)),
  };
};

export const getSuggestedProductSku = async (organizationId: string) => {
  try {
    return await suggestNextProductSku(organizationId);
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const lookupProductScan = async ({
  prisma,
  organizationId,
  user,
  query,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  user?: StoreAccessUser;
  query: string;
}) => {
  try {
    const accessibleStoreIds = await resolveProductStoreScopeIds(prisma, user);
    const scope = {
      productWhere: productStoreAssignmentInWhere(accessibleStoreIds),
      storeIds: accessibleStoreIds,
    };
    const result = await lookupScanProducts(prisma, organizationId, query, scope);
    if (result.exactMatch) return result;
    const equivalent = equivalentRetailBarcode(normalizeScanValue(query));
    if (equivalent) {
      const fallback = await lookupScanProducts(prisma, organizationId, equivalent, scope);
      if (fallback.exactMatch && fallback.items.every((item) => item.matchType === "barcode"))
        return fallback;
    }
    return result;
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const findProductByBarcode = async ({
  prisma,
  organizationId,
  user,
  value,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  user?: StoreAccessUser;
  value: string;
}) => {
  const normalized = normalizeScanValue(value);
  if (!normalized) {
    return null;
  }

  const accessibleStoreIds = await resolveProductStoreScopeIds(prisma, user);
  const assignmentScope = productStoreAssignmentInWhere(accessibleStoreIds);

  const match = await prisma.productBarcode.findFirst({
    where: {
      organizationId,
      value: normalized,
      product: { isDeleted: false, ...assignmentScope },
    },
    select: {
      product: {
        select: productPreviewSelect,
      },
    },
  });

  if (match?.product) {
    return serializeProductPreview(
      filterProductInventorySnapshots(match.product, accessibleStoreIds),
    );
  }

  const packMatch = await prisma.productPack.findFirst({
    where: {
      organizationId,
      packBarcode: normalized,
      product: { isDeleted: false, ...assignmentScope },
    },
    select: {
      product: {
        select: productPreviewSelect,
      },
    },
  });

  if (packMatch?.product) {
    return serializeProductPreview(
      filterProductInventorySnapshots(packMatch.product, accessibleStoreIds),
    );
  }

  const skuMatch = await prisma.product.findFirst({
    where: {
      organizationId,
      isDeleted: false,
      ...assignmentScope,
      sku: { equals: normalized, mode: "insensitive" },
    },
    select: productPreviewSelect,
  });

  return skuMatch
    ? serializeProductPreview(filterProductInventorySnapshots(skuMatch, accessibleStoreIds))
    : null;
};

export const searchQuickProducts = async ({
  prisma,
  organizationId,
  user,
  query,
  storeId,
  limit,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  user?: StoreAccessUser;
  query: string;
  storeId?: string;
  limit?: number;
}) => {
  const trimmed = query.trim();
  const normalized = normalizeScanValue(query);
  const exactNeedle = normalized || trimmed;
  if (!exactNeedle) {
    return [];
  }

  const resultLimit = Math.min(Math.max(limit ?? 20, 1), 50);
  const candidateLimit = Math.min(Math.max(resultLimit * 10, 100), 500);
  const fuzzyNeedle = trimmed || exactNeedle;
  const barcodeNeedle = normalized || fuzzyNeedle;
  const fuzzyNeedleLower = fuzzyNeedle.toLowerCase();
  const barcodeNeedleLower = barcodeNeedle.toLowerCase();
  const fuzzyTokens = tokenizeProductSearchText(fuzzyNeedle);
  if (storeId && user) {
    try {
      await assertUserCanAccessStore(prisma, user, storeId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }
  const accessibleStoreIds = storeId ? undefined : await resolveProductStoreScopeIds(prisma, user);
  const visibleStoreIds = storeId ? [storeId] : accessibleStoreIds;
  const assignmentScope = storeId
    ? productStoreAssignmentWhere(storeId)
    : productStoreAssignmentInWhere(accessibleStoreIds);

  const [exactBarcodeMatches, exactSkuMatches, fuzzyMatches] = await Promise.all([
    prisma.productBarcode.findMany({
      where: {
        organizationId,
        value: exactNeedle,
        product: { isDeleted: false, ...assignmentScope },
      },
      select: {
        value: true,
        product: {
          select: productPreviewSelect,
        },
      },
      take: resultLimit,
    }),
    prisma.product.findMany({
      where: {
        organizationId,
        isDeleted: false,
        ...assignmentScope,
        sku: { equals: exactNeedle, mode: "insensitive" },
      },
      select: productPreviewSelect,
      take: resultLimit,
    }),
    prisma.product.findMany({
      where: {
        organizationId,
        isDeleted: false,
        ...assignmentScope,
        OR: [
          { name: { contains: fuzzyNeedle, mode: "insensitive" } },
          ...(fuzzyTokens.length > 1
            ? [
                {
                  AND: fuzzyTokens.map((token) => ({
                    name: { contains: token, mode: "insensitive" as const },
                  })),
                },
              ]
            : []),
          { sku: { contains: fuzzyNeedle, mode: "insensitive" } },
          {
            barcodes: {
              some: { value: { contains: barcodeNeedle, mode: "insensitive" } },
            },
          },
          {
            packs: {
              some: { packBarcode: { contains: barcodeNeedle, mode: "insensitive" } },
            },
          },
        ],
      },
      select: {
        ...productPreviewSelect,
        barcodes: {
          where: { value: { contains: barcodeNeedle, mode: "insensitive" } },
          select: { value: true },
          take: 1,
        },
      },
      orderBy: { name: "asc" },
      take: candidateLimit,
    }),
  ]);

  const items = new Map<
    string,
    ProductPreviewRecord & {
      matchType: "barcode" | "sku" | "name";
      barcodes?: Array<{ value: string }>;
      primaryBarcode?: string;
    }
  >();

  exactBarcodeMatches.forEach((match) => {
    if (!match.product || items.has(match.product.id)) {
      return;
    }
    items.set(match.product.id, {
      ...match.product,
      primaryBarcode: match.value,
      matchType: "barcode",
    });
  });

  exactSkuMatches.forEach((product) => {
    if (items.has(product.id)) {
      return;
    }
    items.set(product.id, { ...product, matchType: "sku" });
  });

  const searchCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const rankedFuzzyMatches = fuzzyMatches.sort((left, right) =>
    compareProductSearchRelevance({
      query: fuzzyNeedle,
      left,
      right,
      collator: searchCollator,
    }),
  );

  rankedFuzzyMatches.forEach((product) => {
    if (items.has(product.id)) {
      return;
    }
    const barcodeMatched = product.barcodes.some((barcode) =>
      barcode.value.toLowerCase().includes(barcodeNeedleLower),
    );
    const skuMatched = product.sku.toLowerCase().includes(fuzzyNeedleLower);
    items.set(product.id, {
      ...product,
      matchType: barcodeMatched ? "barcode" : skuMatched ? "sku" : "name",
    });
  });

  const orderedProducts = Array.from(items.values()).slice(0, resultLimit);
  const priceOverrides =
    storeId && orderedProducts.length
      ? await prisma.storePrice.findMany({
          where: {
            organizationId,
            storeId,
            productId: { in: orderedProducts.map((product) => product.id) },
            variantKey: "BASE",
          },
          select: { productId: true, priceKgs: true },
        })
      : [];
  const priceOverrideMap = new Map(
    priceOverrides.filter((price) => price.priceKgs != null).map((price) => [price.productId, Number(price.priceKgs)]),
  );
  const organization = storeId ? await prisma.organization.findUnique({
    where: { id: organizationId }, select: { retailWholesaleEnabled: true },
  }) : null;
  if (organization?.retailWholesaleEnabled && storeId && orderedProducts.length) {
    const extras = await prisma.storePriceTypes.findMany({
      where: { organizationId, storeId, productId: { in: orderedProducts.map(product => product.id) }, variantKey: "BASE" },
    });
    for (const extra of extras) {
      const price = extra.retailPriceKgs ?? extra.wholesalePriceKgs;
      if (price != null) priceOverrideMap.set(extra.productId, Number(price));
    }
  }

  return orderedProducts.map((product) => ({
    ...serializeProductPreview(filterProductInventorySnapshots(product, visibleStoreIds), {
      selectedStoreId: storeId,
      effectivePriceKgs: priceOverrideMap.get(product.id) ?? undefined,
      primaryBarcode: product.primaryBarcode,
    }),
    isBundle: product.isBundle,
    matchType: product.matchType,
  }));
};

export const listProducts = async ({
  prisma,
  organizationId,
  user,
  input,
  logger,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  user?: StoreAccessUser;
  input: ProductListInput;
  logger?: Logger;
}) => {
  const accessibleStoreIds = input?.storeId
    ? undefined
    : await resolveProductStoreScopeIds(prisma, user);
  if (input?.storeId) {
    const storeAccessStartedAt = Date.now();
    if (user) {
      try {
        await assertUserCanAccessStore(prisma, user, input.storeId);
      } catch (error) {
        throw toTRPCError(error);
      }
    } else {
      const store = await prisma.store.findFirst({
        where: { id: input.storeId, organizationId },
        select: { id: true },
      });
      if (!store) {
        throw new TRPCError({ code: "FORBIDDEN", message: "storeAccessDenied" });
      }
    }
    if (logger) {
      logProfileSection({
        logger,
        scope: "products.list",
        section: "storeAccess",
        startedAt: storeAccessStartedAt,
        details: { hasStoreId: true },
      });
    }
  }

  if (input?.readiness === "missingCost" && user && !["ADMIN", "MANAGER"].includes(user.role))
    throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
  const page = input?.page ?? 1;
  const pageSize = input?.pageSize ?? 25;
  const sortKey = input?.sortKey ?? "updatedAt";
  const sortDirection = input?.sortDirection ?? "desc";
  const searchQuery = input?.search?.trim() ?? "";
  const usesStockReadiness =
    input?.readiness === "missingImage" ||
    input?.readiness === "missingBarcode" ||
    input?.readiness === "missingCost" ||
    input?.readiness === "missingPrice" ||
    input?.readiness === "negativeStock" ||
    input?.readiness === "outOfStock" ||
    input?.readiness === "lowStock";
  const where = buildProductListWhere(
    organizationId,
    input,
    undefined,
    input?.storeId ? undefined : accessibleStoreIds,
  );
  const imageSortDbPaginated = !searchQuery && !usesStockReadiness && sortKey === "image";
  const paginatedOrderBy =
    searchQuery || usesStockReadiness || imageSortDbPaginated
      ? null
      : getDbProductOrderBy(sortKey, sortDirection);
  const advancedSqlPaginated = !paginatedOrderBy && !imageSortDbPaginated;
  const visibleSnapshotStoreIds = input?.storeId ? [input.storeId] : accessibleStoreIds;
  const pricingTime = new Date();
  const priceTypesEnabled = Boolean(input?.storeId && (await prisma.organization.findUnique({where:{id:organizationId},select:{retailWholesaleEnabled:true}}))?.retailWholesaleEnabled);

  const baseReadStartedAt = Date.now();
  const [total, products] = advancedSqlPaginated
    ? await readProductsByAdvancedSqlSort({
        prisma,
        organizationId,
        input,
        accessibleStoreIds,
        sortKey,
        sortDirection,
        page,
        pageSize,
        pricingTime,
      }).then((result) => [result.total, result.products] as const)
    : imageSortDbPaginated
      ? await readProductsByImageSort({
          prisma,
          where,
          sortDirection,
          page,
          pageSize,
        }).then((result) => [result.total, result.products] as const)
      : await Promise.all([
          prisma.product.count({ where }),
          prisma.product.findMany({
            where,
            select: productListSelect,
            orderBy: paginatedOrderBy ?? getDbProductOrderBy("updatedAt", "desc") ?? undefined,
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
        ]);
  if (logger) {
    logProfileSection({
      logger,
      scope: "products.list",
      section: advancedSqlPaginated ? "advancedPaginatedRead" : "paginatedRead",
      startedAt: baseReadStartedAt,
      details: {
        total,
        page,
        pageSize,
        sortKey,
        sortDirection,
      },
    });
  }

  const productIds = products.map((product) => product.id);
  const enrichmentStartedAt = Date.now();
  const [baseCosts, latestPurchaseLines, storePrices] = productIds.length
    ? await Promise.all([
        prisma.productCost.findMany({
          where: {
            organizationId,
            productId: { in: productIds },
            variantKey: "BASE",
          },
          select: {
            productId: true,
            avgCostKgs: true,
          },
        }),
        prisma.purchaseOrderLine.findMany({
          where: {
            productId: { in: productIds },
            variantId: null,
            unitCost: { not: null },
            purchaseOrder: {
              organizationId,
              status: { in: ["PARTIALLY_RECEIVED", "RECEIVED"] },
            },
          },
          select: {
            productId: true,
            unitCost: true,
          },
          orderBy: [{ productId: "asc" }, { purchaseOrder: { receivedAt: "desc" } }],
          distinct: ["productId"],
        }),
        input?.storeId
          ? prisma.storePrice.findMany({
              where: {
                organizationId,
                storeId: input.storeId,
                productId: { in: productIds },
                variantKey: "BASE",
              },
              select: {
                productId: true,
                priceKgs: true,
                retailPriceKgs: true,
                wholesalePriceKgs: true,
                discountType: true,
                discountPercentage: true,
                discountStartsAt: true,
                discountEndsAt: true,
              },
            })
          : Promise.resolve(
              [] as Array<{
                productId: string;
                priceKgs: Prisma.Decimal;
                retailPriceKgs: Prisma.Decimal | null;
                wholesalePriceKgs: Prisma.Decimal | null;
                discountType: "PERCENTAGE" | null;
                discountPercentage: Prisma.Decimal | null;
                discountStartsAt: Date | null;
                discountEndsAt: Date | null;
              }>,
            ),
      ])
    : [[], [], []];
  if (logger) {
    logProfileSection({
      logger,
      scope: "products.list",
      section: "enrichmentReads",
      startedAt: enrichmentStartedAt,
      details: {
        productIds: productIds.length,
        baseCosts: baseCosts.length,
        latestPurchaseLines: latestPurchaseLines.length,
        storePrices: storePrices.length,
      },
    });
  }

  const avgCostByProductId = new Map(
    baseCosts.map((cost) => [cost.productId, Number(cost.avgCostKgs)]),
  );
  const purchasePriceByProductId = new Map(
    latestPurchaseLines.map((line) => [line.productId, Number(line.unitCost)]),
  );
  const extraPrices = priceTypesEnabled && input?.storeId && productIds.length ? await prisma.storePriceTypes.findMany({ where: { organizationId, storeId: input.storeId, productId: { in: productIds }, variantKey: "BASE" } }) : [];
  const standardByProduct = new Map(storePrices.map(row => [row.productId, row]));
  const extrasByProduct = new Map(extraPrices.map(row => [row.productId, row]));
  const storePriceByProductId = new Map(
    products.flatMap((product) => {
      const storePrice = standardByProduct.get(product.id);
      const extra = extrasByProduct.get(product.id);
      if (!storePrice && !extra) return [];
      const selectedPrice = resolveStoreSellingPrice({enabled: priceTypesEnabled, mode: input?.priceMode ?? "RETAIL", standard: storePrice?.priceKgs ?? product.basePriceKgs ?? null, retail: extra?.retailPriceKgs, wholesale: extra?.wholesalePriceKgs}).price;
      if (selectedPrice === null) return [];
      const pricing = getEffectiveProductPrice({
        basePrice: selectedPrice,
        discount:
          storePrice?.discountType === "PERCENTAGE" && storePrice.discountPercentage
            ? {
                type: "PERCENTAGE",
                percentage: storePrice.discountPercentage,
                startsAt: storePrice.discountStartsAt,
                endsAt: storePrice.discountEndsAt,
              }
            : null,
        now: pricingTime,
        currency: "KGS",
      });
      return [[product.id, pricing.effectivePrice.toNumber()] as const];
    }),
  );

  const items = products.map((product) =>
    serializeProductListItem({
      product: filterProductInventorySnapshots(product, visibleSnapshotStoreIds),
      selectedStoreId: input?.storeId,
      avgCostKgs: avgCostByProductId.get(product.id) ?? null,
      purchasePriceKgs:
        purchasePriceByProductId.get(product.id) ?? avgCostByProductId.get(product.id) ?? null,
      overridePriceKgs: input?.storeId
        ? (storePriceByProductId.get(product.id) ?? null)
        : undefined,
    }),
  );

  return {
    items,
    total,
    page,
    pageSize,
  };
};

export const getProductsBootstrap = async ({
  prisma,
  organizationId,
  user,
  input,
  logger,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  user?: StoreAccessUser;
  input: ProductBootstrapInput;
  logger?: Logger;
}) => {
  const bootstrapReadsStartedAt = Date.now();
  const storeSelect = {
    id: true,
    name: true,
    currencyCode: true,
    currencyRateKgsPerUnit: true,
    enableSku: true,
    enableBarcode: true,
    enableSimilarProductCheck: true,
    printerSettings: { select: { id: true } },
  } satisfies Prisma.StoreSelect;
  const stores =
    user && !userHasAllStoreAccess(user)
      ? await prisma.userStoreAccess
          .findMany({
            where: {
              organizationId,
              userId: user.id,
              store: { organizationId },
            },
            select: { store: { select: storeSelect } },
            orderBy: { store: { name: "asc" } },
          })
          .then((rows) => rows.map((row) => row.store))
      : await prisma.store.findMany({
          where: { organizationId },
          select: storeSelect,
          orderBy: { name: "asc" },
        });
  const selectedStoreId = resolveProductsBootstrapStoreId({
    preferredStoreId: input?.storeId,
    storeIds: stores.map((store) => store.id),
  });
  const categories = await listProductCategoriesFromDb(prisma, organizationId);
  if (logger) {
    logProfileSection({
      logger,
      scope: "products.bootstrap",
      section: "bootstrapReads",
      startedAt: bootstrapReadsStartedAt,
      details: {
        stores: stores.length,
        categories: categories.length,
        selectedStoreId,
      },
    });
  }

  const list = await listProducts({
    prisma,
    organizationId,
    user,
    input: {
      ...input,
      storeId: selectedStoreId ?? undefined,
    },
    logger,
  });

  return {
    stores: stores.map((store) => ({
      ...store,
      currencyRateKgsPerUnit: Number(store.currencyRateKgsPerUnit),
    })),
    categories,
    selectedStoreId,
    list,
  };
};

export const listProductIds = async ({
  prisma,
  organizationId,
  user,
  input,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  user?: StoreAccessUser;
  input: ProductListIdsInput;
}) => {
  const accessibleStoreIds = input?.storeId
    ? undefined
    : await resolveProductStoreScopeIds(prisma, user);
  if (input?.storeId) {
    if (user) {
      try {
        await assertUserCanAccessStore(prisma, user, input.storeId);
      } catch (error) {
        throw toTRPCError(error);
      }
    }
  }

  if (input?.readiness === "missingCost" && user && !["ADMIN", "MANAGER"].includes(user.role))
    throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
  const base = buildProductSqlBase({ organizationId, input, accessibleStoreIds });
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT p.id ${base} ORDER BY p.id`);
  return rows.map((row) => row.id);
};

export const getProductDuplicateDiagnosticsQuery = async ({
  prisma,
  organizationId,
  input,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  input: ProductDuplicateDiagnosticsInput;
}) => {
  try {
    return await getProductDuplicateDiagnostics({
      prisma,
      organizationId,
      productId: input.productId,
      sku: input.sku,
      name: input.name,
      barcodes: input.barcodes,
    });
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const getProductsByIds = async ({
  prisma,
  organizationId,
  user,
  ids,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  user?: StoreAccessUser;
  ids: string[];
}) => {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) {
    return [];
  }
  const accessibleStoreIds = await resolveProductStoreScopeIds(prisma, user);

  const products = await prisma.product.findMany({
    where: {
      id: { in: uniqueIds },
      organizationId,
      ...productStoreAssignmentInWhere(accessibleStoreIds),
    },
    select: {
      id: true,
      sku: true,
      name: true,
      isDeleted: true,
      barcodes: { select: { value: true } },
    },
  });

  const productMap = new Map(products.map((product) => [product.id, product]));
  return uniqueIds.flatMap((id) => {
    const product = productMap.get(id);
    return product ? [product] : [];
  });
};

export const getProductById = async ({
  prisma,
  organizationId,
  user,
  productId,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  user?: StoreAccessUser;
  productId: string;
}) => {
  const accessibleStoreIds = await resolveProductStoreScopeIds(prisma, user);
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      organizationId,
      isDeleted: false,
      ...productStoreAssignmentInWhere(accessibleStoreIds),
    },
    include: {
      barcodes: true,
      variants: {
        where: { isActive: true },
        include: {
          image: {
            select: { id: true, url: true, position: true },
          },
        },
      },
      packs: true,
      baseUnit: true,
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!product) {
    return null;
  }

  const variantIds = product.variants.map((variant) => variant.id);
  const blockedVariantIds = new Set<string>();
  const [baseCost, latestPurchaseLine] = await Promise.all([
    prisma.productCost.findUnique({
      where: {
        organizationId_productId_variantKey: {
          organizationId,
          productId,
          variantKey: "BASE",
        },
      },
      select: { avgCostKgs: true },
    }),
    prisma.purchaseOrderLine.findFirst({
      where: {
        productId,
        variantId: null,
        unitCost: { not: null },
        purchaseOrder: {
          organizationId,
          status: { in: ["PARTIALLY_RECEIVED", "RECEIVED"] },
        },
      },
      select: { unitCost: true },
      orderBy: { purchaseOrder: { receivedAt: "desc" } },
    }),
  ]);

  if (variantIds.length) {
    const [movementVariants, snapshotVariants, lineVariants] = await Promise.all([
      prisma.stockMovement.findMany({
        where: { variantId: { in: variantIds } },
        select: { variantId: true },
        distinct: ["variantId"],
      }),
      prisma.inventorySnapshot.findMany({
        where: {
          variantId: { in: variantIds },
          OR: [{ onHand: { not: 0 } }, { onOrder: { not: 0 } }],
        },
        select: { variantId: true },
        distinct: ["variantId"],
      }),
      prisma.purchaseOrderLine.findMany({
        where: { variantId: { in: variantIds } },
        select: { variantId: true },
        distinct: ["variantId"],
      }),
    ]);

    [...movementVariants, ...snapshotVariants, ...lineVariants].forEach((entry) => {
      if (entry.variantId) {
        blockedVariantIds.add(entry.variantId);
      }
    });
  }

  const avgCostKgs = decimalToNumber(baseCost?.avgCostKgs);
  const purchasePriceKgs =
    latestPurchaseLine?.unitCost !== null && latestPurchaseLine?.unitCost !== undefined
      ? Number(latestPurchaseLine.unitCost)
      : avgCostKgs;

  return serializeProductDetail({
    product,
    avgCostKgs,
    purchasePriceKgs,
    blockedVariantIds,
  });
};

export const getProductPricing = async ({
  prisma,
  organizationId,
  user,
  productId,
  storeId,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  user?: StoreAccessUser;
  productId: string;
  storeId?: string;
}) => {
  let scopedStoreIds: string[] | undefined;
  if (storeId) {
    if (user) {
      try {
        await assertUserCanAccessStore(prisma, user, storeId);
      } catch (error) {
        throw toTRPCError(error);
      }
    } else {
      const store = await prisma.store.findFirst({
        where: { id: storeId, organizationId },
        select: { id: true },
      });
      if (!store) {
        throw new TRPCError({ code: "FORBIDDEN", message: "storeAccessDenied" });
      }
    }
    scopedStoreIds = [storeId];
  } else if (user) {
    scopedStoreIds = await resolveAccessibleStoreIds(prisma, user);
  }

  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      organizationId,
      ...(scopedStoreIds ? productStoreAssignmentInWhere(scopedStoreIds) : {}),
    },
    select: { id: true, organizationId: true, basePriceKgs: true },
  });
  if (!product) {
    throw new TRPCError({ code: "NOT_FOUND", message: "productNotFound" });
  }

  const [storePrice, cost, organization, extra] = await Promise.all([
    storeId
      ? prisma.storePrice.findUnique({
          where: {
            organizationId_storeId_productId_variantKey: {
              organizationId,
              storeId,
              productId,
              variantKey: "BASE",
            },
          },
          select: { priceKgs: true },
        })
      : Promise.resolve(null),
    prisma.productCost.findUnique({
      where: {
        organizationId_productId_variantKey: {
          organizationId,
          productId,
          variantKey: "BASE",
        },
      },
      select: { avgCostKgs: true },
    }),
    storeId ? prisma.organization.findUnique({
      where: { id: organizationId }, select: { retailWholesaleEnabled: true },
    }) : Promise.resolve(null),
    storeId ? prisma.storePriceTypes.findUnique({
      where: { organizationId_storeId_productId_variantKey: { organizationId, storeId, productId, variantKey: "BASE" } },
    }) : Promise.resolve(null),
  ]);
  const selected = resolveStoreSellingPrice({
    enabled: Boolean(organization?.retailWholesaleEnabled), mode: "RETAIL",
    standard: storePrice?.priceKgs ?? product.basePriceKgs,
    retail: extra?.retailPriceKgs, wholesale: extra?.wholesalePriceKgs,
  });
  return serializeProductPricing({
    basePriceKgs: product.basePriceKgs,
    effectivePriceKgs: selected.price,
    avgCostKgs: cost?.avgCostKgs ?? null,
    priceOverridden: Boolean(storePrice) || selected.source !== "STANDARD",
  });
};

export const getProductStorePricing = async ({
  prisma,
  organizationId,
  user,
  productId,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  user?: StoreAccessUser;
  productId: string;
}) => {
  const accessibleStoreIds = user ? await resolveAccessibleStoreIds(prisma, user) : undefined;
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      organizationId,
      ...(accessibleStoreIds ? productStoreAssignmentInWhere(accessibleStoreIds) : {}),
    },
    select: {
      id: true,
      organizationId: true,
      basePriceKgs: true,
    },
  });
  if (!product) {
    throw new TRPCError({ code: "NOT_FOUND", message: "productNotFound" });
  }

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { retailWholesaleEnabled: true },
  });

  const stores = await prisma.store.findMany({
    where: {
      organizationId,
      ...(accessibleStoreIds ? { id: { in: accessibleStoreIds } } : {}),
      storeProducts: {
        some: {
          organizationId,
          productId,
          isActive: true,
        },
      },
    },
    select: {
      id: true,
      name: true,
      trackExpiryLots: true,
      currencyCode: true,
      currencyRateKgsPerUnit: true,
      enableSku: true,
      enableBarcode: true,
      enableSimilarProductCheck: true,
    },
    orderBy: { name: "asc" },
  });
  const storeIds = stores.map((store) => store.id);

  const [overrides, variantOverrides, cost, snapshots, variants, variantSnapshots, policies] =
    await Promise.all([
      prisma.storePrice.findMany({
        where: {
          organizationId,
          productId,
          variantKey: "BASE",
          storeId: { in: storeIds },
        },
        select: {
          storeId: true,
          priceKgs: true,
          retailPriceKgs: true,
          wholesalePriceKgs: true,
        },
      }),
      prisma.storePrice.findMany({
        where: {
          organizationId,
          productId,
          storeId: { in: storeIds },
          variantKey: { not: "BASE" },
        },
        select: {
          storeId: true,
          variantId: true,
          variantKey: true,
          priceKgs: true,
          retailPriceKgs: true,
          wholesalePriceKgs: true,
        },
      }),
      prisma.productCost.findUnique({
        where: {
          organizationId_productId_variantKey: {
            organizationId,
            productId,
            variantKey: "BASE",
          },
        },
        select: { avgCostKgs: true },
      }),
      prisma.inventorySnapshot.findMany({
        where: {
          productId,
          variantId: null,
          storeId: { in: storeIds },
          store: {
            organizationId,
          },
        },
        select: {
          storeId: true,
          onHand: true,
          version: true,
        },
      }),
      prisma.productVariant.findMany({
        where: {
          productId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          sku: true,
          attributes: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      prisma.inventorySnapshot.findMany({
        where: {
          productId,
          variantId: { not: null },
          storeId: { in: storeIds },
          store: {
            organizationId,
          },
        },
        select: {
          storeId: true,
          variantId: true,
          onHand: true,
          version: true,
        },
      }),
      prisma.reorderPolicy.findMany({
        where: {
          productId,
          storeId: { in: storeIds },
        },
        select: {
          storeId: true,
          minStock: true,
        },
      }),
    ]);

  const extraPrices = await prisma.storePriceTypes.findMany({ where: { organizationId, productId, storeId: { in: storeIds } } });
  const extraByKey = new Map(extraPrices.map(row => [`${row.storeId}:${row.variantKey}`, row]));
  const basePrice = decimalToNumber(product.basePriceKgs);
  const overrideByStore = new Map(
    overrides.filter((override) => override.priceKgs != null).map((override) => [override.storeId, Number(override.priceKgs)]),
  );
  const variantOverrideByStoreAndVariant = new Map(
    variantOverrides.filter((override) => override.priceKgs != null).map((override) => [
      `${override.storeId}:${override.variantId ?? override.variantKey}`,
      Number(override.priceKgs),
    ]),
  );
  const onHandByStore = new Map(snapshots.map((snapshot) => [snapshot.storeId, snapshot.onHand]));
  const minStockByStore = new Map(policies.map((policy) => [policy.storeId, policy.minStock]));
  const variantOnHandByStore = new Map(
    variantSnapshots.map((snapshot) => [
      `${snapshot.storeId}:${snapshot.variantId ?? ""}`,
      snapshot.onHand,
    ]),
  );

  return {
    basePriceKgs: basePrice,
    avgCostKgs: decimalToNumber(cost?.avgCostKgs),
    stores: stores.map((store) => {
      const override = overrideByStore.get(store.id);
      const extras = extraByKey.get(`${store.id}:BASE`);
      const effective = resolveStoreSellingPrice({
        enabled: organization.retailWholesaleEnabled, mode: "RETAIL", standard: override ?? basePrice,
        retail: decimalToNumber(extras?.retailPriceKgs), wholesale: decimalToNumber(extras?.wholesalePriceKgs),
      }).price;
      return {
        storeId: store.id,
        storeName: store.name,
        retailWholesaleEnabled: organization.retailWholesaleEnabled,
        retailPriceKgs: decimalToNumber(extraByKey.get(`${store.id}:BASE`)?.retailPriceKgs),
        wholesalePriceKgs: decimalToNumber(extraByKey.get(`${store.id}:BASE`)?.wholesalePriceKgs),
        trackExpiryLots: store.trackExpiryLots,
        currencyCode: store.currencyCode,
        currencyRateKgsPerUnit: Number(store.currencyRateKgsPerUnit),
        enableSku: store.enableSku,
        enableBarcode: store.enableBarcode,
        enableSimilarProductCheck: store.enableSimilarProductCheck,
        effectivePriceKgs: effective,
        overridePriceKgs: override ?? null,
        priceOverridden: override !== undefined,
        onHand: onHandByStore.get(store.id) ?? 0,
        stockVersion: snapshots.find((snapshot) => snapshot.storeId === store.id)?.version ?? 0,
        minStock: minStockByStore.get(store.id) ?? 0,
        variants: variants.map((variant) => {
          const variantOverride = variantOverrideByStoreAndVariant.get(`${store.id}:${variant.id}`);
          const variantExtras = extraByKey.get(`${store.id}:${variant.id}`);
          const variantPrice = resolveStoreSellingPrice({
            enabled: organization.retailWholesaleEnabled, mode: "RETAIL", standard: variantOverride ?? effective,
            retail: decimalToNumber(variantExtras?.retailPriceKgs), wholesale: decimalToNumber(variantExtras?.wholesalePriceKgs),
          }).price;
          return {
            variantId: variant.id,
            retailPriceKgs: decimalToNumber(extraByKey.get(`${store.id}:${variant.id}`)?.retailPriceKgs),
            wholesalePriceKgs: decimalToNumber(extraByKey.get(`${store.id}:${variant.id}`)?.wholesalePriceKgs),
            variantName: variant.name,
            variantSku: variant.sku,
            attributes: variant.attributes,
            effectivePriceKgs: variantPrice,
            overridePriceKgs: variantOverride ?? null,
            priceOverridden: variantOverride !== undefined,
            onHand: variantOnHandByStore.get(`${store.id}:${variant.id}`) ?? 0,
            stockVersion:
              variantSnapshots.find(
                (snapshot) => snapshot.storeId === store.id && snapshot.variantId === variant.id,
              )?.version ?? 0,
          };
        }),
      };
    }),
  };
};

export const exportProductTableBatch = async ({
  prisma,
  organizationId,
  user,
  storeId,
  columns,
  input,
  ids,
  afterId,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  user?: StoreAccessUser;
  storeId?: string;
  columns?: ProductExportColumnKey[];
  input?: ProductListIdsInput;
  ids?: string[];
  afterId?: string;
}) => {
  const accessibleStoreIds = storeId ? undefined : await resolveProductStoreScopeIds(prisma, user);
  if (storeId && user) {
    try {
      await assertUserCanAccessStore(prisma, user, storeId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }
  const exportStore = storeId
    ? await prisma.store.findFirst({
        where: { id: storeId, organizationId },
        select: { id: true, name: true },
      })
    : null;
  const exportStoreId = exportStore?.id;
  if (storeId && !exportStore) throw new TRPCError({ code: "FORBIDDEN", message: "storeAccessDenied" });
  const canReadCost = !user || ["ADMIN", "MANAGER"].includes(user.role);
  if (input?.readiness === "missingCost" && !canReadCost) throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
  const base = buildProductSqlBase({ organizationId, input: { ...input, storeId }, accessibleStoreIds });
  const selectionSql = ids ? (ids.length ? Prisma.sql`AND p.id IN (${Prisma.join(ids)})` : Prisma.sql`AND false`) : Prisma.empty;
  const cursorSql = afterId ? Prisma.sql`AND p.id > ${afterId}` : Prisma.empty;
  const selected = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT p.id ${base} ${selectionSql} ${cursorSql} ORDER BY p.id LIMIT 500`);
  const products = await prisma.product.findMany({
    where: { organizationId, id: { in: selected.map((row) => row.id) } },
    select: {
      id: true,
      sku: true,
      name: true,
      category: true,
      categories: true,
      unit: true,
      description: true,
      photoUrl: true,
      barcodes: { select: { value: true } },
      basePriceKgs: true,
      inventorySnapshots: { where: { ...(storeId ? { storeId } : accessibleStoreIds ? { storeId: { in: accessibleStoreIds } } : { store: { organizationId } }) }, select: { onHand: true } },
      images: {
        select: { url: true, position: true },
        orderBy: { position: "asc" },
      },
      variants: {
        where: { isActive: true },
        select: { name: true, sku: true, attributes: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { id: "asc" },
  });

  const productIds = products.map((product) => product.id);
  const [baseCosts, latestPurchaseLines, minStockRows, storePrices] = productIds.length
    ? await Promise.all([
        prisma.productCost.findMany({
          where: {
            organizationId,
            productId: { in: productIds },
            variantKey: "BASE",
          },
          select: {
            productId: true,
            avgCostKgs: true,
          },
        }),
        prisma.purchaseOrderLine.findMany({
          where: {
            productId: { in: productIds },
            variantId: null,
            unitCost: { not: null },
            purchaseOrder: {
              organizationId,
              status: { in: ["PARTIALLY_RECEIVED", "RECEIVED"] },
            },
          },
          select: {
            productId: true,
            unitCost: true,
          },
          orderBy: [{ productId: "asc" }, { purchaseOrder: { receivedAt: "desc" } }],
          distinct: ["productId"],
        }),
        exportStoreId
          ? prisma.reorderPolicy.findMany({
              where: {
                storeId: exportStoreId,
                productId: { in: productIds },
              },
              select: {
                productId: true,
                minStock: true,
              },
            })
          : Promise.resolve([]),
        exportStoreId
          ? prisma.storePrice.findMany({
              where: {
                organizationId,
                storeId: exportStoreId,
                productId: { in: productIds },
                variantKey: "BASE",
              },
              select: {
                productId: true,
                priceKgs: true,
              },
            })
          : Promise.resolve([]),
      ])
    : [[], [], [], []];

  const avgCostByProductId = new Map(
    baseCosts.map((cost) => [cost.productId, decimalToNumber(cost.avgCostKgs)]),
  );
  const purchasePriceByProductId = new Map(
    latestPurchaseLines.map((line) => [line.productId, Number(line.unitCost)]),
  );
  const minStockByProductId = new Map(minStockRows.map((row) => [row.productId, row.minStock]));
  const storePriceByProductId = new Map(
    storePrices.filter((price) => price.priceKgs != null).map((price) => [price.productId, decimalToNumber(price.priceKgs)]),
  );

  const serializeVariants = (product: (typeof products)[number]) =>
    product.variants.length
      ? JSON.stringify(
          product.variants.map((variant) => {
            const attributes =
              variant.attributes &&
              typeof variant.attributes === "object" &&
              !Array.isArray(variant.attributes)
                ? (variant.attributes as Record<string, unknown>)
                : {};
            return {
              name: variant.name ?? undefined,
              sku: variant.sku ?? undefined,
              ...attributes,
            };
          }),
        )
      : "";

  const serializeImages = (product: (typeof products)[number]) => {
    const urls = [product.photoUrl, ...product.images.map((image) => image.url)]
      .map((url) => sanitizeDetailImageUrl(url))
      .filter((url): url is string => Boolean(url))
      .filter((url, index, list) => list.indexOf(url) === index);
    return urls.join(", ");
  };

  const selectedColumnSet = columns?.length ? new Set<ProductExportColumnKey>(columns) : null;
  const selectedColumns = productExportColumns.filter((column) =>
    (!selectedColumnSet || selectedColumnSet.has(column.key)) &&
    (canReadCost || !["avgCostKgs", "purchasePriceKgs"].includes(column.key)));
  const header = selectedColumns.map((column) => column.header);
  const keys = selectedColumns.map((column) => column.key);
  const rows = products.map((product) => {
    const avgCostKgs = avgCostByProductId.get(product.id) ?? null;
    const purchasePriceKgs = purchasePriceByProductId.get(product.id) ?? avgCostKgs;
    const basePriceKgs =
      storePriceByProductId.get(product.id) ?? decimalToNumber(product.basePriceKgs);
    return {
      sku: product.sku,
      name: product.name,
      unit: product.unit,
      categories: product.categories.length
        ? product.categories.join(", ")
        : (product.category ?? ""),
      description: product.description ?? "",
      basePriceKgs: basePriceKgs ?? "",
      purchasePriceKgs: purchasePriceKgs ?? "",
      avgCostKgs: avgCostKgs ?? "",
      minStock: minStockByProductId.get(product.id) ?? "",
      onHandQty: product.inventorySnapshots.reduce((sum, snapshot) => sum + snapshot.onHand, 0),
      stockScope: exportStore?.name ?? "Сумма по доступным магазинам",
      images: serializeImages(product),
      variants: serializeVariants(product),
      barcodes: product.barcodes.map((barcode) => barcode.value).join(", "),
    };
  });

  return { header, rows, keys, nextId: selected.at(-1)?.id, hasMore: selected.length === 500 };
};
export const exportProductsCsv = async (options: Parameters<typeof exportProductTableBatch>[0]) => {
  let afterId: string | undefined;
  const chunks: string[] = [];
  do {
    const batch = await exportProductTableBatch({ ...options, afterId });
    const csv = toCsv(batch.header, batch.rows, batch.keys);
    chunks.push(afterId ? batch.rows.length ? csv.slice(csv.indexOf("\r\n") + 2) : "" : csv);
    afterId = batch.hasMore ? batch.nextId : undefined;
  } while (afterId);
  return chunks.filter(Boolean).join("\r\n");
};

export const exportProductImagesData = async ({
  prisma,
  organizationId,
  user,
  storeId,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  user?: StoreAccessUser;
  storeId?: string;
}): Promise<{ name: string; images: string[] }[]> => {
  const accessibleStoreIds = storeId ? undefined : await resolveProductStoreScopeIds(prisma, user);
  if (storeId && user) {
    try {
      await assertUserCanAccessStore(prisma, user, storeId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }
  const exportStore = storeId
    ? await prisma.store.findFirst({
        where: { id: storeId, organizationId },
        select: { id: true },
      })
    : null;
  const exportStoreId = exportStore?.id;
  const products = await prisma.product.findMany({
    where: {
      organizationId,
      isDeleted: false,
      ...(exportStoreId
        ? productStoreAssignmentWhere(exportStoreId)
        : productStoreAssignmentInWhere(accessibleStoreIds)),
    },
    select: {
      name: true,
      photoUrl: true,
      images: {
        select: { url: true, position: true },
        orderBy: { position: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return products
    .map((product) => {
      const urls = [product.photoUrl, ...product.images.map((img) => img.url)]
        .map((url) => sanitizeDetailImageUrl(url))
        .filter((url): url is string => Boolean(url))
        .filter((url, i, arr) => arr.indexOf(url) === i);
      return { name: product.name, images: urls };
    })
    .filter((p) => p.images.length > 0);
};
