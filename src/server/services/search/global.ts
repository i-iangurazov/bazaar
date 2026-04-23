import type { Prisma, PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import { normalizeScanValue } from "@/lib/scanning/normalize";
import { logProfileSection } from "@/server/profiling/perf";
import { serializeProductPreview } from "@/server/services/products/serializers";

export type SearchResult = {
  id: string;
  type: "product" | "supplier" | "store" | "purchaseOrder";
  label: string;
  sublabel?: string | null;
  href: string;
  matchKind?: "exact" | "prefix" | "fuzzy";
  product?: ReturnType<typeof serializeProductPreview>;
};

const exactLookupLikePattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

const productSearchSelect = {
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

type ProductSearchRecord = Prisma.ProductGetPayload<{ select: typeof productSearchSelect }>;

const pushUnique = (
  items: SearchResult[],
  seen: Set<string>,
  next: SearchResult,
) => {
  const key = `${next.type}:${next.id}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  items.push(next);
};

const buildNameSearchFilter = (query: string) =>
  query.length >= 3
    ? { contains: query, mode: "insensitive" as const }
    : { startsWith: query, mode: "insensitive" as const };

const buildEmailSearchFilter = (query: string) =>
  query.length >= 3
    ? { contains: query, mode: "insensitive" as const }
    : { startsWith: query, mode: "insensitive" as const };

const buildProductResult = ({
  product,
  matchKind,
  primaryBarcode,
}: {
  product: ProductSearchRecord;
  matchKind: NonNullable<SearchResult["matchKind"]>;
  primaryBarcode?: string | null;
}): SearchResult => {
  const preview = serializeProductPreview(product, { primaryBarcode });
  const sublabel = [preview.sku, preview.primaryBarcode].filter(Boolean).join(" • ");

  return {
    id: product.id,
    type: "product",
    label: product.name,
    sublabel: sublabel || product.sku,
    href: `/products/${product.id}`,
    matchKind,
    product: preview,
  };
};

export const isExactLikeGlobalSearchQuery = ({
  query,
  normalizedScanQuery,
}: {
  query: string;
  normalizedScanQuery: string;
}) => {
  if (!query || query.includes(" ") || !exactLookupLikePattern.test(query)) {
    return false;
  }

  return (
    normalizedScanQuery !== query ||
    /[\d._:/-]/.test(query) ||
    query === query.toUpperCase()
  );
};

export const resolveGlobalSearchPlan = ({
  query,
  normalizedScanQuery,
  exactMatchCount,
}: {
  query: string;
  normalizedScanQuery: string;
  exactMatchCount: number;
}) => {
  const exactLookupLike = isExactLikeGlobalSearchQuery({ query, normalizedScanQuery });
  const shortCircuitOnExact = exactLookupLike && exactMatchCount > 0;
  const productOnlyFuzzy = exactLookupLike && exactMatchCount === 0;

  return {
    exactLookupLike,
    shortCircuitOnExact,
    productOnlyFuzzy,
    includeGroupedEntities: !productOnlyFuzzy,
    includePurchaseOrders: !productOnlyFuzzy && query.length >= 3,
  };
};

export const searchGlobal = async ({
  prisma,
  organizationId,
  rawQuery,
  logger,
}: {
  prisma: PrismaClient;
  organizationId: string;
  rawQuery: string;
  logger?: Logger;
}) => {
  const query = rawQuery.trim();
  if (!query) {
    return { results: [] as SearchResult[] };
  }

  const normalizedScanQuery = normalizeScanValue(query);
  const exactNeedle = normalizedScanQuery || query;
  const planlessProductFilters = [
    { sku: { startsWith: query, mode: "insensitive" as const } },
    { name: buildNameSearchFilter(query) },
    ...(normalizedScanQuery
      ? [
          { barcodes: { some: { value: { startsWith: normalizedScanQuery } } } },
          { packs: { some: { packBarcode: { startsWith: normalizedScanQuery } } } },
        ]
      : []),
  ];

  const exactLookupStartedAt = Date.now();
  const [exactBarcodeMatches, exactSkuMatches, exactStoreCodeMatches] = await Promise.all([
    normalizedScanQuery
      ? prisma.productBarcode.findMany({
          where: {
            organizationId,
            value: normalizedScanQuery,
            product: { isDeleted: false },
          },
          select: {
            product: {
              select: productSearchSelect,
            },
          },
          take: 5,
        })
      : Promise.resolve([]),
    prisma.product.findMany({
      where: {
        organizationId,
        isDeleted: false,
        sku: { equals: exactNeedle, mode: "insensitive" },
      },
      select: productSearchSelect,
      take: 5,
    }),
    prisma.store.findMany({
      where: {
        organizationId,
        code: { equals: exactNeedle, mode: "insensitive" },
      },
      select: {
        id: true,
        name: true,
        code: true,
      },
      take: 5,
    }),
  ]);
  const plan = resolveGlobalSearchPlan({
    query,
    normalizedScanQuery,
    exactMatchCount:
      exactBarcodeMatches.length + exactSkuMatches.length + exactStoreCodeMatches.length,
  });
  if (logger) {
    logProfileSection({
      logger,
      scope: "search.global",
      section: "exactLookup",
      startedAt: exactLookupStartedAt,
      details: {
        queryLength: query.length,
        exactLookupLike: plan.exactLookupLike,
        shortCircuitOnExact: plan.shortCircuitOnExact,
        exactBarcodeMatches: exactBarcodeMatches.length,
        exactSkuMatches: exactSkuMatches.length,
        exactStoreCodeMatches: exactStoreCodeMatches.length,
      },
      slowThresholdMs: 80,
    });
  }

  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const queryLower = query.toLowerCase();

  exactBarcodeMatches.forEach((match) => {
    if (!match.product) {
      return;
    }
    pushUnique(results, seen, {
      ...buildProductResult({
        product: match.product,
        matchKind: "exact",
        primaryBarcode: normalizedScanQuery,
      }),
    });
  });

  exactSkuMatches.forEach((product) => {
    pushUnique(results, seen, buildProductResult({ product, matchKind: "exact" }));
  });

  exactStoreCodeMatches.forEach((store) => {
    pushUnique(results, seen, {
      id: store.id,
      type: "store",
      label: store.name,
      sublabel: store.code,
      href: "/stores",
      matchKind: "exact",
    });
  });

  if (plan.shortCircuitOnExact) {
    return { results };
  }

  const fuzzyProductFilters = [
    ...planlessProductFilters,
  ];

  const queryStartedAt = Date.now();
  const [fuzzyProducts, suppliers, stores, purchaseOrders] = await Promise.all([
    prisma.product.findMany({
      where: {
        organizationId,
        isDeleted: false,
        OR: fuzzyProductFilters,
      },
      select: {
        ...productSearchSelect,
      },
      orderBy: [{ sku: "asc" }, { name: "asc" }],
      take: plan.productOnlyFuzzy ? 8 : 6,
    }),
    plan.includeGroupedEntities
      ? prisma.supplier.findMany({
          where: {
            organizationId,
            OR: [
              { name: buildNameSearchFilter(query) },
              { email: buildEmailSearchFilter(query) },
            ],
          },
          select: {
            id: true,
            name: true,
            email: true,
          },
          orderBy: { name: "asc" },
          take: 4,
        })
      : Promise.resolve([]),
    plan.includeGroupedEntities
      ? prisma.store.findMany({
          where: {
            organizationId,
            OR: [
              { code: { startsWith: query, mode: "insensitive" } },
              { name: buildNameSearchFilter(query) },
            ],
          },
          select: {
            id: true,
            name: true,
            code: true,
          },
          orderBy: [{ code: "asc" }, { name: "asc" }],
          take: 4,
        })
      : Promise.resolve([]),
    plan.includePurchaseOrders
      ? prisma.purchaseOrder.findMany({
          where: {
            organizationId,
            OR: [
              { id: { startsWith: query, mode: "insensitive" } },
              { supplier: { name: { contains: query, mode: "insensitive" } } },
            ],
          },
          select: {
            id: true,
            supplier: {
              select: {
                name: true,
              },
            },
            store: {
              select: {
                name: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 3,
        })
      : Promise.resolve([]),
  ]);
  if (logger) {
    logProfileSection({
      logger,
      scope: "search.global",
      section: "queryGroups",
      startedAt: queryStartedAt,
      details: {
        queryLength: query.length,
        strategy: plan.productOnlyFuzzy ? "productOnly" : "grouped",
        exactLookupLike: plan.exactLookupLike,
        includePurchaseOrders: plan.includePurchaseOrders,
        fuzzyProducts: fuzzyProducts.length,
        suppliers: suppliers.length,
        stores: stores.length,
        purchaseOrders: purchaseOrders.length,
      },
      slowThresholdMs: 120,
    });
  }
  fuzzyProducts.forEach((product) => {
    pushUnique(
      results,
      seen,
      buildProductResult({
        product,
        matchKind: product.sku.toLowerCase().startsWith(queryLower) ? "prefix" : "fuzzy",
      }),
    );
  });

  suppliers.forEach((supplier) => {
    pushUnique(results, seen, {
      id: supplier.id,
      type: "supplier",
      label: supplier.name,
      sublabel: supplier.email ?? null,
      href: "/suppliers",
      matchKind:
        supplier.email?.toLowerCase() === queryLower || supplier.name.toLowerCase() === queryLower
          ? "exact"
          : "fuzzy",
    });
  });

  stores.forEach((store) => {
    pushUnique(results, seen, {
      id: store.id,
      type: "store",
      label: store.name,
      sublabel: store.code ?? null,
      href: "/stores",
      matchKind:
        store.code.toLowerCase() === queryLower || store.name.toLowerCase() === queryLower
          ? "exact"
          : store.code.toLowerCase().startsWith(queryLower)
            ? "prefix"
            : "fuzzy",
    });
  });

  purchaseOrders.forEach((order) => {
    const supplierLabel = order.supplier?.name ? `${order.supplier.name} • ` : "";
    pushUnique(results, seen, {
      id: order.id,
      type: "purchaseOrder",
      label: order.id.slice(0, 8).toUpperCase(),
      sublabel: `${supplierLabel}${order.store.name}`,
      href: `/purchase-orders/${order.id}`,
      matchKind: order.id.toLowerCase().startsWith(queryLower) ? "prefix" : "fuzzy",
    });
  });

  return { results };
};
