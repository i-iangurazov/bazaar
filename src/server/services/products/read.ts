import { Prisma, type PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { Logger } from "pino";

import { normalizeScanValue } from "@/lib/scanning/normalize";
import { logProfileSection } from "@/server/profiling/perf";
import {
  listProductCategoriesFromDb,
  listStoreProductCategoriesFromDb,
} from "@/server/services/productCategories";
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

type PrismaDbClient = PrismaClient | Prisma.TransactionClient;

const dbSortableProductListKeys = new Set<ProductSortKey>(["updatedAt", "name", "sku"]);

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
  accessibleStoreIds?: string[],
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
  } else if (accessibleStoreIds) {
    filters.push(productStoreAssignmentInWhere(accessibleStoreIds));
  }

  return {
    ...(input?.includeArchived ? {} : { isDeleted: false }),
    organizationId,
    ...(filters.length ? { AND: filters } : {}),
  };
};

const resolveReadinessProductIds = async ({
  prisma,
  organizationId,
  input,
  accessibleStoreIds,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  input: ProductListIdsInput;
  accessibleStoreIds?: string[];
}) => {
  const scopedStoreIds = input?.storeId
    ? [input.storeId]
    : accessibleStoreIds
      ? accessibleStoreIds
      : undefined;
  if (scopedStoreIds && !scopedStoreIds.length) {
    return [];
  }

  if (input?.readiness === "negativeStock") {
    const rows = await prisma.inventorySnapshot.findMany({
      where: {
        ...(scopedStoreIds ? { storeId: { in: scopedStoreIds } } : {}),
        onHand: { lt: 0 },
        product: {
          organizationId,
          ...(input.includeArchived ? {} : { isDeleted: false }),
        },
      },
      select: { productId: true },
      distinct: ["productId"],
    });
    return rows.map((row) => row.productId);
  }

  if (input?.readiness === "outOfStock") {
    const rows = await prisma.inventorySnapshot.findMany({
      where: {
        ...(scopedStoreIds ? { storeId: { in: scopedStoreIds } } : {}),
        onHand: { lte: 0 },
        product: {
          organizationId,
          ...(input.includeArchived ? {} : { isDeleted: false }),
        },
      },
      select: { productId: true },
      distinct: ["productId"],
    });
    return rows.map((row) => row.productId);
  }

  if (input?.readiness === "lowStock") {
    const rows = input.storeId
      ? await prisma.$queryRaw<{ productId: string }[]>`
          SELECT DISTINCT s."productId" AS "productId"
          FROM "InventorySnapshot" s
          INNER JOIN "ReorderPolicy" p
            ON p."storeId" = s."storeId"
           AND p."productId" = s."productId"
          INNER JOIN "Product" pr
            ON pr.id = s."productId"
          WHERE s."storeId" = ${input.storeId}
            AND pr."organizationId" = ${organizationId}
            AND pr."isDeleted" = false
            AND p."minStock" > 0
            AND s."onHand" <= p."minStock"
        `
      : scopedStoreIds
        ? await prisma.$queryRaw<{ productId: string }[]>`
          SELECT DISTINCT s."productId" AS "productId"
          FROM "InventorySnapshot" s
          INNER JOIN "ReorderPolicy" p
            ON p."storeId" = s."storeId"
           AND p."productId" = s."productId"
          INNER JOIN "Product" pr
            ON pr.id = s."productId"
          WHERE s."storeId" IN (${Prisma.join(scopedStoreIds)})
            AND pr."organizationId" = ${organizationId}
            AND pr."isDeleted" = false
            AND p."minStock" > 0
            AND s."onHand" <= p."minStock"
        `
        : await prisma.$queryRaw<{ productId: string }[]>`
          SELECT DISTINCT s."productId" AS "productId"
          FROM "InventorySnapshot" s
          INNER JOIN "ReorderPolicy" p
            ON p."storeId" = s."storeId"
           AND p."productId" = s."productId"
          INNER JOIN "Store" st
            ON st.id = s."storeId"
          INNER JOIN "Product" pr
            ON pr.id = s."productId"
          WHERE st."organizationId" = ${organizationId}
            AND pr."organizationId" = ${organizationId}
            AND pr."isDeleted" = false
            AND p."minStock" > 0
            AND s."onHand" <= p."minStock"
        `;
    return rows.map((row) => row.productId);
  }

  return undefined;
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

const productListSelect = {
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
  inventorySnapshots: { select: { storeId: true, onHand: true } },
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
type ProductListItem = ReturnType<typeof serializeProductListItem>;

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
    return await lookupScanProducts(prisma, organizationId, query, {
      productWhere: productStoreAssignmentInWhere(accessibleStoreIds),
      storeIds: accessibleStoreIds,
    });
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
  const productScopeWhere = productStoreAssignmentInWhere(accessibleStoreIds);

  const match = await prisma.productBarcode.findFirst({
    where: {
      organizationId,
      value: normalized,
      product: { isDeleted: false, ...productScopeWhere },
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
      product: { isDeleted: false, ...productScopeWhere },
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
      ...productScopeWhere,
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
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  user?: StoreAccessUser;
  query: string;
  storeId?: string;
}) => {
  const trimmed = query.trim();
  const normalized = normalizeScanValue(query);
  const exactNeedle = normalized || trimmed;
  if (!exactNeedle) {
    return [];
  }

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
  const storeAssignmentWhere = storeId
    ? productStoreAssignmentWhere(storeId)
    : productStoreAssignmentInWhere(accessibleStoreIds);

  const [exactBarcodeMatches, exactSkuMatches, fuzzyMatches] = await Promise.all([
    prisma.productBarcode.findMany({
      where: {
        organizationId,
        value: exactNeedle,
        product: { isDeleted: false, ...storeAssignmentWhere },
      },
      select: {
        value: true,
        product: {
          select: productPreviewSelect,
        },
      },
      take: 10,
    }),
    prisma.product.findMany({
      where: {
        organizationId,
        isDeleted: false,
        ...storeAssignmentWhere,
        sku: { equals: exactNeedle, mode: "insensitive" },
      },
      select: productPreviewSelect,
      take: 10,
    }),
    prisma.product.findMany({
      where: {
        organizationId,
        isDeleted: false,
        ...storeAssignmentWhere,
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
      take: 40,
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

  const orderedProducts = Array.from(items.values()).slice(0, 10);
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
    priceOverrides.map((price) => [price.productId, Number(price.priceKgs)]),
  );

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

const sortProductListItems = ({
  items,
  sortKey,
  sortDirection,
  storeNameById,
  selectedStoreId,
}: {
  items: ProductListItem[];
  sortKey: ProductSortKey;
  sortDirection: ProductSortDirection;
  storeNameById: Map<string, string>;
  selectedStoreId?: string;
}) => {
  const comparator = createProductListItemComparator({
    sortKey,
    sortDirection,
    storeNameById,
    selectedStoreId,
  });

  items.sort(comparator);
};

const createProductListItemComparator = ({
  sortKey,
  sortDirection,
  storeNameById,
  selectedStoreId,
}: {
  sortKey: ProductSortKey;
  sortDirection: ProductSortDirection;
  storeNameById: Map<string, string>;
  selectedStoreId?: string;
}) => {
  const sortCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const directionMultiplier = sortDirection === "asc" ? 1 : -1;
  const resolveSalePriceForSort = (product: ProductListItem) => {
    const value = selectedStoreId ? product.effectivePriceKgs : product.basePriceKgs;
    return value ?? Number.NEGATIVE_INFINITY;
  };
  const resolveBarcodeSortValue = (product: ProductListItem) =>
    product.barcodes
      .map((entry) => entry.value.trim())
      .filter(Boolean)
      .sort((left, right) => sortCollator.compare(left, right))
      .join(", ");
  const resolveStoreSortValue = (product: ProductListItem) =>
    Array.from(
      new Set(
        product.inventorySnapshots
          .map((snapshot) => storeNameById.get(snapshot.storeId))
          .filter((name): name is string => Boolean(name)),
      ),
    )
      .sort((left, right) => sortCollator.compare(left, right))
      .join(", ");

  return (left: ProductListItem, right: ProductListItem) => {
    let result = 0;
    switch (sortKey) {
      case "sku":
        result = sortCollator.compare(left.sku, right.sku);
        break;
      case "updatedAt":
        result = left.updatedAt.getTime() - right.updatedAt.getTime();
        break;
      case "name":
        result = sortCollator.compare(left.name, right.name);
        break;
      case "category":
        result = sortCollator.compare(left.category ?? "", right.category ?? "");
        break;
      case "unit":
        result = sortCollator.compare(left.unit ?? "", right.unit ?? "");
        break;
      case "onHandQty":
        result = left.onHandQty - right.onHandQty;
        break;
      case "salePrice":
        result = resolveSalePriceForSort(left) - resolveSalePriceForSort(right);
        break;
      case "avgCost":
        result =
          (left.avgCostKgs ?? Number.NEGATIVE_INFINITY) -
          (right.avgCostKgs ?? Number.NEGATIVE_INFINITY);
        break;
      case "barcodes":
        result = sortCollator.compare(
          resolveBarcodeSortValue(left),
          resolveBarcodeSortValue(right),
        );
        break;
      case "stores":
        result = sortCollator.compare(resolveStoreSortValue(left), resolveStoreSortValue(right));
        break;
      default:
        result = 0;
    }

    if (result === 0) {
      result = sortCollator.compare(left.name, right.name);
    }
    if (result === 0) {
      result = sortCollator.compare(left.sku, right.sku);
    }
    if (result === 0) {
      result = left.id.localeCompare(right.id);
    }

    return result * directionMultiplier;
  };
};

const sortProductListItemsBySearchRelevance = ({
  items,
  query,
  sortKey,
  sortDirection,
  storeNameById,
  selectedStoreId,
}: {
  items: ProductListItem[];
  query: string;
  sortKey: ProductSortKey;
  sortDirection: ProductSortDirection;
  storeNameById: Map<string, string>;
  selectedStoreId?: string;
}) => {
  const relevanceCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const tieBreaker = createProductListItemComparator({
    sortKey,
    sortDirection,
    storeNameById,
    selectedStoreId,
  });

  items.sort((left, right) =>
    compareProductSearchRelevance({
      query,
      left,
      right,
      collator: relevanceCollator,
      tieBreaker,
    }),
  );
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

  const page = input?.page ?? 1;
  const pageSize = input?.pageSize ?? 25;
  const sortKey = input?.sortKey ?? "updatedAt";
  const sortDirection = input?.sortDirection ?? "desc";
  const searchQuery = input?.search?.trim() ?? "";
  const readinessProductIds = await resolveReadinessProductIds({
    prisma,
    organizationId,
    input,
    accessibleStoreIds,
  });
  const where = buildProductListWhere(
    organizationId,
    input,
    readinessProductIds,
    accessibleStoreIds,
  );
  const paginatedOrderBy = searchQuery ? null : getDbProductOrderBy(sortKey, sortDirection);
  const visibleSnapshotStoreIds = input?.storeId ? [input.storeId] : accessibleStoreIds;

  const baseReadStartedAt = Date.now();
  const [total, products] = paginatedOrderBy
    ? await Promise.all([
        prisma.product.count({ where }),
        prisma.product.findMany({
          where,
          select: productListSelect,
          orderBy: paginatedOrderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ])
    : await (async () => {
        const fullProducts = await prisma.product.findMany({
          where,
          select: productListSelect,
          orderBy: [{ name: "asc" }, { sku: "asc" }],
        });
        return [fullProducts.length, fullProducts] as const;
      })();
  if (logger) {
    logProfileSection({
      logger,
      scope: "products.list",
      section: paginatedOrderBy ? "paginatedRead" : "fullReadForSort",
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
  const [baseCosts, latestPurchaseLines, storeNames, storePrices] = productIds.length
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
        sortKey === "stores" || !paginatedOrderBy
          ? prisma.store.findMany({
              where: {
                organizationId,
                ...(visibleSnapshotStoreIds ? { id: { in: visibleSnapshotStoreIds } } : {}),
              },
              select: { id: true, name: true },
            })
          : Promise.resolve([] as Array<{ id: string; name: string }>),
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
              },
            })
          : Promise.resolve([] as Array<{ productId: string; priceKgs: Prisma.Decimal }>),
      ])
    : [[], [], [], []];
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
        storeNames: storeNames.length,
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
  const storeNameById = new Map(storeNames.map((store) => [store.id, store.name]));
  const storePriceByProductId = new Map(
    storePrices.map((storePrice) => [storePrice.productId, Number(storePrice.priceKgs)]),
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

  if (searchQuery) {
    const sortStartedAt = Date.now();
    sortProductListItemsBySearchRelevance({
      items,
      query: searchQuery,
      sortKey,
      sortDirection,
      storeNameById,
      selectedStoreId: input?.storeId,
    });
    if (logger) {
      logProfileSection({
        logger,
        scope: "products.list",
        section: "relevanceSort",
        startedAt: sortStartedAt,
        details: {
          itemCount: items.length,
          sortKey,
        },
      });
    }
  } else if (!paginatedOrderBy) {
    const sortStartedAt = Date.now();
    sortProductListItems({
      items,
      sortKey,
      sortDirection,
      storeNameById,
      selectedStoreId: input?.storeId,
    });
    if (logger) {
      logProfileSection({
        logger,
        scope: "products.list",
        section: "inMemorySort",
        startedAt: sortStartedAt,
        details: {
          itemCount: items.length,
          sortKey,
        },
      });
    }
  }

  return {
    items: paginatedOrderBy ? items : items.slice((page - 1) * pageSize, page * pageSize),
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
  const categories = selectedStoreId
    ? (
        await listStoreProductCategoriesFromDb(prisma, {
          organizationId,
          storeId: selectedStoreId,
          includeHidden: false,
        })
      ).map((category) => category.name)
    : await listProductCategoriesFromDb(prisma, organizationId);
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

  const rows = await prisma.product.findMany({
    where: buildProductListWhere(
      organizationId,
      input,
      await resolveReadinessProductIds({ prisma, organizationId, input, accessibleStoreIds }),
      accessibleStoreIds,
    ),
    select: { id: true },
    orderBy: { name: "asc" },
  });

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
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, organizationId: true, basePriceKgs: true },
  });
  if (!product || product.organizationId !== organizationId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "productNotFound" });
  }

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

    const assignment = await prisma.storeProduct.findFirst({
      where: {
        organizationId,
        storeId,
        productId,
        isActive: true,
      },
      select: { id: true },
    });
    if (!assignment) {
      throw new TRPCError({ code: "NOT_FOUND", message: "productNotFound" });
    }
  }

  const [storePrice, cost] = await Promise.all([
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
  ]);

  return serializeProductPricing({
    basePriceKgs: product.basePriceKgs,
    effectivePriceKgs: storePrice?.priceKgs ?? product.basePriceKgs,
    avgCostKgs: cost?.avgCostKgs ?? null,
    priceOverridden: Boolean(storePrice),
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
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      organizationId: true,
      basePriceKgs: true,
    },
  });
  if (!product || product.organizationId !== organizationId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "productNotFound" });
  }

  const stores = await prisma.store.findMany({
    where: {
      organizationId,
      storeProducts: {
        some: {
          organizationId,
          productId,
          isActive: true,
        },
      },
      ...(user && !userHasAllStoreAccess(user)
        ? {
            userAccesses: {
              some: {
                organizationId,
                userId: user.id,
              },
            },
          }
        : {}),
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

  const [overrides, cost, snapshots, variants, variantSnapshots] = await Promise.all([
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
      },
    }),
  ]);

  const basePrice = decimalToNumber(product.basePriceKgs);
  const overrideByStore = new Map(
    overrides.map((override) => [override.storeId, Number(override.priceKgs)]),
  );
  const onHandByStore = new Map(snapshots.map((snapshot) => [snapshot.storeId, snapshot.onHand]));
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
      const effective = override ?? basePrice;
      return {
        storeId: store.id,
        storeName: store.name,
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
        variants: variants.map((variant) => ({
          variantId: variant.id,
          variantName: variant.name,
          variantSku: variant.sku,
          attributes: variant.attributes,
          onHand: variantOnHandByStore.get(`${store.id}:${variant.id}`) ?? 0,
        })),
      };
    }),
  };
};

export const exportProductsCsv = async ({
  prisma,
  organizationId,
  user,
  storeId,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  user?: StoreAccessUser;
  storeId?: string;
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
    orderBy: { name: "asc" },
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
    storePrices.map((price) => [price.productId, decimalToNumber(price.priceKgs)]),
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

  const header = [
    "SKU",
    "Название",
    "Ед. измерения",
    "Категории",
    "Описание",
    "Цена продажи",
    "Цена закупки",
    "Себестоимость",
    "Минимальный остаток",
    "Фото / ссылки на изображения",
    "Варианты",
    "Штрихкоды",
  ];
  const keys = [
    "sku",
    "name",
    "unit",
    "categories",
    "description",
    "basePriceKgs",
    "purchasePriceKgs",
    "avgCostKgs",
    "minStock",
    "images",
    "variants",
    "barcodes",
  ];
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
      images: serializeImages(product),
      variants: serializeVariants(product),
      barcodes: product.barcodes.map((barcode) => barcode.value).join(", "),
    };
  });

  return toCsv(header, rows, keys);
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
