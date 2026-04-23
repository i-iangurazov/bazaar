import type { Prisma, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { Logger } from "pino";

import { normalizeScanValue } from "@/lib/scanning/normalize";
import { logProfileSection } from "@/server/profiling/perf";
import { listProductCategoriesFromDb } from "@/server/services/productCategories";
import { sanitizeSpreadsheetValue } from "@/server/services/csv";
import { lookupScanProducts } from "@/server/services/scanLookup";
import { suggestNextProductSku } from "@/server/services/products";
import { getProductDuplicateDiagnostics } from "@/server/services/products/diagnostics";
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

const dbSortableProductListKeys = new Set<ProductSortKey>(["name", "sku"]);

const buildProductCategoryWhere = (category?: string) =>
  category
    ? {
        OR: [{ category }, { categories: { has: category } }],
      }
    : {};

const buildProductListWhere = (
  organizationId: string,
  input: ProductListIdsInput,
): Prisma.ProductWhereInput => {
  const filters: Prisma.ProductWhereInput[] = [];
  if (input?.search) {
    filters.push({
      OR: [
        { name: { contains: input.search, mode: "insensitive" } },
        { sku: { contains: input.search, mode: "insensitive" } },
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

  if (sortKey === "sku") {
    return [{ sku: sortDirection }, { name: sortDirection }, { id: sortDirection }];
  }

  return [{ name: sortDirection }, { sku: sortDirection }, { id: sortDirection }];
};

const assertStoreAccess = async ({
  prisma,
  storeId,
  organizationId,
}: {
  prisma: PrismaDbClient;
  storeId: string;
  organizationId: string;
}) => {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, organizationId: true },
  });
  if (!store || store.organizationId !== organizationId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "storeAccessDenied" });
  }
};

export const resolveProductsBootstrapStoreId = ({
  preferredStoreId,
  storeIds,
}: {
  preferredStoreId?: string;
  storeIds: string[];
}) => {
  if (preferredStoreId) {
    return preferredStoreId;
  }

  return storeIds.length === 1 ? storeIds[0] ?? null : null;
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
  query,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  query: string;
}) => {
  try {
    return await lookupScanProducts(prisma, organizationId, query);
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const findProductByBarcode = async ({
  prisma,
  organizationId,
  value,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  value: string;
}) => {
  const normalized = normalizeScanValue(value);
  if (!normalized) {
    return null;
  }

  const match = await prisma.productBarcode.findFirst({
    where: {
      organizationId,
      value: normalized,
      product: { isDeleted: false },
    },
    select: {
      product: {
        select: productPreviewSelect,
      },
    },
  });

  if (match?.product) {
    return serializeProductPreview(match.product);
  }

  const packMatch = await prisma.productPack.findFirst({
    where: {
      organizationId,
      packBarcode: normalized,
      product: { isDeleted: false },
    },
    select: {
      product: {
        select: productPreviewSelect,
      },
    },
  });

  if (packMatch?.product) {
    return serializeProductPreview(packMatch.product);
  }

  const skuMatch = await prisma.product.findFirst({
    where: {
      organizationId,
      isDeleted: false,
      sku: { equals: normalized, mode: "insensitive" },
    },
    select: productPreviewSelect,
  });

  return skuMatch ? serializeProductPreview(skuMatch) : null;
};

export const searchQuickProducts = async ({
  prisma,
  organizationId,
  query,
  storeId,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
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

  const [exactBarcodeMatches, exactSkuMatches, fuzzyMatches] = await Promise.all([
    prisma.productBarcode.findMany({
      where: {
        organizationId,
        value: exactNeedle,
        product: { isDeleted: false },
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
        sku: { equals: exactNeedle, mode: "insensitive" },
      },
      select: productPreviewSelect,
      take: 10,
    }),
    prisma.product.findMany({
      where: {
        organizationId,
        isDeleted: false,
        OR: [
          { name: { contains: fuzzyNeedle, mode: "insensitive" } },
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
      take: 10,
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

  fuzzyMatches.forEach((product) => {
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
    ...serializeProductPreview(product, {
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
  items: Awaited<ReturnType<typeof listProducts>>["items"];
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
  const resolveSalePriceForSort = (product: (typeof items)[number]) => {
    const value = selectedStoreId ? product.effectivePriceKgs : product.basePriceKgs;
    return value ?? Number.NEGATIVE_INFINITY;
  };
  const resolveBarcodeSortValue = (product: (typeof items)[number]) =>
    product.barcodes
      .map((entry) => entry.value.trim())
      .filter(Boolean)
      .sort((left, right) => sortCollator.compare(left, right))
      .join(", ");
  const resolveStoreSortValue = (product: (typeof items)[number]) =>
    Array.from(
      new Set(
        product.inventorySnapshots
          .map((snapshot) => storeNameById.get(snapshot.storeId))
          .filter((name): name is string => Boolean(name)),
      ),
    )
      .sort((left, right) => sortCollator.compare(left, right))
      .join(", ");

  items.sort((left, right) => {
    let result = 0;
    switch (sortKey) {
      case "sku":
        result = sortCollator.compare(left.sku, right.sku);
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
        result = sortCollator.compare(resolveBarcodeSortValue(left), resolveBarcodeSortValue(right));
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
  });
};

export const listProducts = async ({
  prisma,
  organizationId,
  input,
  logger,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  input: ProductListInput;
  logger?: Logger;
}) => {
  if (input?.storeId) {
    const storeAccessStartedAt = Date.now();
    await assertStoreAccess({
      prisma,
      storeId: input.storeId,
      organizationId,
    });
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
  const sortKey = input?.sortKey ?? "name";
  const sortDirection = input?.sortDirection ?? "asc";
  const where = buildProductListWhere(organizationId, input);
  const paginatedOrderBy = getDbProductOrderBy(sortKey, sortDirection);

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
              where: { organizationId },
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
      product,
      selectedStoreId: input?.storeId,
      avgCostKgs: avgCostByProductId.get(product.id) ?? null,
      purchasePriceKgs:
        purchasePriceByProductId.get(product.id) ?? avgCostByProductId.get(product.id) ?? null,
      overridePriceKgs: input?.storeId ? (storePriceByProductId.get(product.id) ?? null) : undefined,
    }),
  );

  if (!paginatedOrderBy) {
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
  input,
  logger,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  input: ProductBootstrapInput;
  logger?: Logger;
}) => {
  const bootstrapReadsStartedAt = Date.now();
  const [stores, categories] = await Promise.all([
    prisma.store.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
      },
      orderBy: { name: "asc" },
    }),
    listProductCategoriesFromDb(prisma, organizationId),
  ]);
  const selectedStoreId = resolveProductsBootstrapStoreId({
    preferredStoreId: input?.storeId,
    storeIds: stores.map((store) => store.id),
  });
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
    input: {
      ...input,
      storeId: selectedStoreId ?? undefined,
    },
    logger,
  });

  return {
    stores,
    categories,
    selectedStoreId,
    list,
  };
};

export const listProductIds = async ({
  prisma,
  organizationId,
  input,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  input: ProductListIdsInput;
}) => {
  if (input?.storeId) {
    await assertStoreAccess({
      prisma,
      storeId: input.storeId,
      organizationId,
    });
  }

  const rows = await prisma.product.findMany({
    where: buildProductListWhere(organizationId, input),
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
  ids,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  ids: string[];
}) => {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) {
    return [];
  }

  const products = await prisma.product.findMany({
    where: { id: { in: uniqueIds }, organizationId },
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
  productId,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
  productId: string;
}) => {
  const product = await prisma.product.findFirst({
    where: { id: productId, organizationId, isDeleted: false },
    include: {
      barcodes: true,
      variants: { where: { isActive: true } },
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
  productId,
  storeId,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
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
    await assertStoreAccess({ prisma, storeId, organizationId });
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
  productId,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
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

  const [stores, overrides, cost, snapshots] = await Promise.all([
    prisma.store.findMany({
      where: { organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.storePrice.findMany({
      where: {
        organizationId,
        productId,
        variantKey: "BASE",
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
        store: {
          organizationId,
        },
      },
      select: {
        storeId: true,
        onHand: true,
      },
    }),
  ]);

  const basePrice = decimalToNumber(product.basePriceKgs);
  const overrideByStore = new Map(
    overrides.map((override) => [override.storeId, Number(override.priceKgs)]),
  );
  const onHandByStore = new Map(
    snapshots.map((snapshot) => [snapshot.storeId, snapshot.onHand]),
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
        effectivePriceKgs: effective,
        overridePriceKgs: override ?? null,
        priceOverridden: override !== undefined,
        onHand: onHandByStore.get(store.id) ?? 0,
      };
    }),
  };
};

export const exportProductsCsv = async ({
  prisma,
  organizationId,
}: {
  prisma: PrismaDbClient;
  organizationId: string;
}) => {
  const products = await prisma.product.findMany({
    where: { organizationId, isDeleted: false },
    select: {
      sku: true,
      name: true,
      category: true,
      categories: true,
      unit: true,
      description: true,
      photoUrl: true,
      barcodes: { select: { value: true } },
    },
    orderBy: { name: "asc" },
  });

  const header = ["sku", "name", "category", "unit", "description", "photoUrl", "barcodes"];
  const lines = products.map((product) => {
    const barcodes = product.barcodes.map((barcode) => barcode.value).join("|");
    const exportedCategory =
      product.categories.length > 0 ? product.categories.join("|") : (product.category ?? "");
    const values = [
      product.sku,
      product.name,
      exportedCategory,
      product.unit,
      product.description ?? "",
      sanitizeDetailImageUrl(product.photoUrl) ?? "",
      barcodes,
    ];
    return values
      .map((value) => `"${sanitizeSpreadsheetValue(value).replace(/\"/g, '\"\"')}"`)
      .join(",");
  });

  return [header.join(","), ...lines].join("\n");
};
