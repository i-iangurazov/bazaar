import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";

export const adminMetricsWarningFilters = [
  "all",
  "noCost",
  "noPrice",
  "noImage",
  "negativeStock",
  "lowStock",
  "unassigned",
] as const;

export const adminMetricsSortKeys = [
  "retailValue",
  "costValue",
  "profit",
  "stockQty",
  "margin",
  "product",
  "store",
  "warnings",
] as const;

export const adminMetricsSortDirections = ["asc", "desc"] as const;

export type AdminMetricsWarningFilter = (typeof adminMetricsWarningFilters)[number];
export type AdminMetricsSortKey = (typeof adminMetricsSortKeys)[number];
export type AdminMetricsSortDirection = (typeof adminMetricsSortDirections)[number];

export type AdminMetricsInput = {
  organizationId: string;
  storeId?: string | null;
  category?: string | null;
  search?: string | null;
  includeArchived?: boolean;
  warning?: AdminMetricsWarningFilter;
  sortKey?: AdminMetricsSortKey;
  sortDirection?: AdminMetricsSortDirection;
  page?: number;
  pageSize?: number;
};

type NormalizedAdminMetricsInput = {
  organizationId: string;
  storeId: string | null;
  category: string | null;
  search: string | null;
  includeArchived: boolean;
  warning: AdminMetricsWarningFilter;
  sortKey: AdminMetricsSortKey;
  sortDirection: AdminMetricsSortDirection;
  page: number;
  pageSize: number;
};

export type InventoryValuationCalculationRow = {
  stockQty: number;
  costPriceKgs: number | null;
  salePriceKgs: number | null;
  hasImage: boolean;
  minStock: number | null;
  isAssigned: boolean;
};

export type InventoryValuationTotals = {
  totalStockQty: number;
  costValueKgs: number;
  retailValueKgs: number;
  potentialGrossProfitKgs: number;
  potentialMarginPercent: number | null;
  rowsWithCost: number;
  rowsWithPrice: number;
  rowsWithProfitData: number;
  warningCounts: {
    noCost: number;
    noPrice: number;
    noImage: number;
    negativeStock: number;
    lowStock: number;
    unassigned: number;
  };
};

type SummaryRow = {
  total_stock_qty: number | bigint | null;
  product_count: number | bigint | null;
  snapshot_count: number | bigint | null;
  cost_value_kgs: Prisma.Decimal | number | string | null;
  retail_value_kgs: Prisma.Decimal | number | string | null;
  profit_value_kgs: Prisma.Decimal | number | string | null;
  profit_retail_value_kgs: Prisma.Decimal | number | string | null;
  rows_with_cost: number | bigint | null;
  rows_with_price: number | bigint | null;
  rows_with_profit_data: number | bigint | null;
  no_cost_count: number | bigint | null;
  no_price_count: number | bigint | null;
  no_image_count: number | bigint | null;
  negative_stock_count: number | bigint | null;
  low_stock_count: number | bigint | null;
  unassigned_count: number | bigint | null;
};

type StoreSummaryRow = SummaryRow & {
  store_id: string;
  store_name: string;
};

type CategorySummaryRow = SummaryRow & {
  category_name: string | null;
};

type ProductTableRow = {
  snapshot_id: string;
  product_id: string;
  product_name: string;
  product_sku: string | null;
  barcode: string | null;
  store_id: string;
  store_name: string;
  category_name: string | null;
  variant_name: string | null;
  variant_sku: string | null;
  stock_qty: number | bigint | null;
  cost_price_kgs: Prisma.Decimal | number | string | null;
  sale_price_kgs: Prisma.Decimal | number | string | null;
  cost_value_kgs: Prisma.Decimal | number | string | null;
  retail_value_kgs: Prisma.Decimal | number | string | null;
  profit_value_kgs: Prisma.Decimal | number | string | null;
  margin_percent: Prisma.Decimal | number | string | null;
  min_stock: number | bigint | null;
  has_image: boolean | null;
  is_assigned: boolean | null;
  is_archived: boolean | null;
  warning_count: number | bigint | null;
};

type ProductCountRow = {
  total_count: number | bigint | null;
};

type CategoryOptionRow = {
  category: string | null;
};

type SalesPeriodRow = {
  orders: number | bigint | null;
  revenue_kgs: Prisma.Decimal | number | string | null;
  sold_qty: Prisma.Decimal | number | string | null;
  line_cost_kgs: Prisma.Decimal | number | string | null;
};

const uncategorizedLabel = "Без категории";

const toNumber = (value: Prisma.Decimal | number | string | bigint | null | undefined) => {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    return Number(value);
  }
  return value.toNumber();
};

const nullableNumber = (
  value: Prisma.Decimal | number | string | bigint | null | undefined,
): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return toNumber(value);
};

const normalizeInput = (input: AdminMetricsInput): NormalizedAdminMetricsInput => {
  const pageSize = Math.min(Math.max(Math.trunc(input.pageSize ?? 25), 10), 100);
  return {
    organizationId: input.organizationId,
    storeId: input.storeId?.trim() || null,
    category: input.category?.trim() || null,
    search: input.search?.trim() || null,
    includeArchived: Boolean(input.includeArchived),
    warning: input.warning ?? "all",
    sortKey: input.sortKey ?? "retailValue",
    sortDirection: input.sortDirection ?? "desc",
    page: Math.max(Math.trunc(input.page ?? 1), 1),
    pageSize,
  };
};

const buildBaseCte = (input: NormalizedAdminMetricsInput) => {
  const searchPattern = input.search ? `%${input.search}%` : null;

  return Prisma.sql`
    WITH base AS (
      SELECT
        snapshot.id AS snapshot_id,
        snapshot."storeId" AS store_id,
        store.name AS store_name,
        snapshot."productId" AS product_id,
        snapshot."variantKey" AS variant_key,
        snapshot."variantId" AS variant_id,
        snapshot."onHand" AS stock_qty,
        product.name AS product_name,
        product.sku AS product_sku,
        product."isDeleted" AS is_archived,
        COALESCE(NULLIF(TRIM(product.category), ''), ${uncategorizedLabel}) AS category_name,
        variant.name AS variant_name,
        variant.sku AS variant_sku,
        cost."avgCostKgs" AS cost_price_kgs,
        COALESCE(price."priceKgs", product."basePriceKgs") AS sale_price_kgs,
        COALESCE(policy."minStock", 0) AS min_stock,
        EXISTS (
          SELECT 1
          FROM "ProductImage" image
          WHERE image."productId" = product.id
            AND NULLIF(TRIM(image.url), '') IS NOT NULL
            AND image.url NOT LIKE 'data:image/%'
        )
        OR (
          NULLIF(TRIM(COALESCE(product."photoUrl", '')), '') IS NOT NULL
          AND product."photoUrl" NOT LIKE 'data:image/%'
        ) AS has_image,
        EXISTS (
          SELECT 1
          FROM "StoreProduct" assignment
          WHERE assignment."storeId" = snapshot."storeId"
            AND assignment."productId" = snapshot."productId"
            AND assignment."isActive" = true
        ) AS is_assigned,
        (
          SELECT barcode.value
          FROM "ProductBarcode" barcode
          WHERE barcode."productId" = product.id
          ORDER BY barcode."createdAt" ASC
          LIMIT 1
        ) AS barcode
      FROM "InventorySnapshot" snapshot
      INNER JOIN "Store" store
        ON store.id = snapshot."storeId"
        AND store."organizationId" = ${input.organizationId}
      INNER JOIN "Product" product
        ON product.id = snapshot."productId"
        AND product."organizationId" = ${input.organizationId}
      LEFT JOIN "ProductVariant" variant
        ON variant.id = snapshot."variantId"
      LEFT JOIN "ProductCost" cost
        ON cost."organizationId" = ${input.organizationId}
        AND cost."productId" = snapshot."productId"
        AND cost."variantKey" = snapshot."variantKey"
      LEFT JOIN "StorePrice" price
        ON price."organizationId" = ${input.organizationId}
        AND price."storeId" = snapshot."storeId"
        AND price."productId" = snapshot."productId"
        AND price."variantKey" = snapshot."variantKey"
      LEFT JOIN "ReorderPolicy" policy
        ON policy."storeId" = snapshot."storeId"
        AND policy."productId" = snapshot."productId"
      WHERE (${input.includeArchived} = true OR product."isDeleted" = false)
        AND (${input.storeId}::text IS NULL OR snapshot."storeId" = ${input.storeId})
        AND (
          ${input.category}::text IS NULL
          OR ${input.category} = ${uncategorizedLabel}
            AND NULLIF(TRIM(product.category), '') IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM unnest(product.categories) category_value
              WHERE NULLIF(TRIM(category_value), '') IS NOT NULL
            )
          OR product.category = ${input.category}
          OR ${input.category} = ANY(product.categories)
        )
        AND (
          ${searchPattern}::text IS NULL
          OR product.name ILIKE ${searchPattern}
          OR product.sku ILIKE ${searchPattern}
          OR variant.name ILIKE ${searchPattern}
          OR variant.sku ILIKE ${searchPattern}
          OR EXISTS (
            SELECT 1
            FROM "ProductBarcode" search_barcode
            WHERE search_barcode."productId" = product.id
              AND search_barcode.value ILIKE ${searchPattern}
          )
        )
    )
  `;
};

const warningWhereSql = (warning: AdminMetricsWarningFilter) => {
  switch (warning) {
    case "noCost":
      return Prisma.sql`WHERE cost_price_kgs IS NULL`;
    case "noPrice":
      return Prisma.sql`WHERE sale_price_kgs IS NULL`;
    case "noImage":
      return Prisma.sql`WHERE has_image = false`;
    case "negativeStock":
      return Prisma.sql`WHERE stock_qty < 0`;
    case "lowStock":
      return Prisma.sql`WHERE min_stock > 0 AND stock_qty >= 0 AND stock_qty <= min_stock`;
    case "unassigned":
      return Prisma.sql`WHERE is_assigned = false`;
    case "all":
    default:
      return Prisma.empty;
  }
};

const orderSql = (input: NormalizedAdminMetricsInput) => {
  const direction = input.sortDirection === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const secondaryDirection = input.sortDirection === "asc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;

  switch (input.sortKey) {
    case "costValue":
      return Prisma.sql`ORDER BY cost_value_kgs ${direction} NULLS LAST, product_name ASC, store_name ASC`;
    case "profit":
      return Prisma.sql`ORDER BY profit_value_kgs ${direction} NULLS LAST, product_name ASC, store_name ASC`;
    case "stockQty":
      return Prisma.sql`ORDER BY stock_qty ${direction} NULLS LAST, product_name ASC, store_name ASC`;
    case "margin":
      return Prisma.sql`ORDER BY margin_percent ${direction} NULLS LAST, product_name ASC, store_name ASC`;
    case "product":
      return Prisma.sql`ORDER BY product_name ${direction}, store_name ASC`;
    case "store":
      return Prisma.sql`ORDER BY store_name ${direction}, product_name ASC`;
    case "warnings":
      return Prisma.sql`ORDER BY warning_count ${direction}, retail_value_kgs ${secondaryDirection} NULLS LAST, product_name ASC`;
    case "retailValue":
    default:
      return Prisma.sql`ORDER BY retail_value_kgs ${direction} NULLS LAST, product_name ASC, store_name ASC`;
  }
};

const summaryProjectionSql = Prisma.sql`
  COALESCE(SUM(stock_qty), 0)::integer AS total_stock_qty,
  COUNT(DISTINCT product_id)::integer AS product_count,
  COUNT(*)::integer AS snapshot_count,
  COALESCE(SUM(CASE WHEN cost_price_kgs IS NOT NULL THEN stock_qty * cost_price_kgs ELSE 0 END), 0)::numeric AS cost_value_kgs,
  COALESCE(SUM(CASE WHEN sale_price_kgs IS NOT NULL THEN stock_qty * sale_price_kgs ELSE 0 END), 0)::numeric AS retail_value_kgs,
  COALESCE(SUM(CASE WHEN cost_price_kgs IS NOT NULL AND sale_price_kgs IS NOT NULL THEN stock_qty * (sale_price_kgs - cost_price_kgs) ELSE 0 END), 0)::numeric AS profit_value_kgs,
  COALESCE(SUM(CASE WHEN cost_price_kgs IS NOT NULL AND sale_price_kgs IS NOT NULL THEN stock_qty * sale_price_kgs ELSE 0 END), 0)::numeric AS profit_retail_value_kgs,
  (COUNT(*) FILTER (WHERE cost_price_kgs IS NOT NULL))::integer AS rows_with_cost,
  (COUNT(*) FILTER (WHERE sale_price_kgs IS NOT NULL))::integer AS rows_with_price,
  (COUNT(*) FILTER (WHERE cost_price_kgs IS NOT NULL AND sale_price_kgs IS NOT NULL))::integer AS rows_with_profit_data,
  (COUNT(*) FILTER (WHERE cost_price_kgs IS NULL))::integer AS no_cost_count,
  (COUNT(*) FILTER (WHERE sale_price_kgs IS NULL))::integer AS no_price_count,
  (COUNT(*) FILTER (WHERE has_image = false))::integer AS no_image_count,
  (COUNT(*) FILTER (WHERE stock_qty < 0))::integer AS negative_stock_count,
  (COUNT(*) FILTER (WHERE min_stock > 0 AND stock_qty >= 0 AND stock_qty <= min_stock))::integer AS low_stock_count,
  (COUNT(*) FILTER (WHERE is_assigned = false))::integer AS unassigned_count
`;

const mapTotals = (row: SummaryRow | null | undefined): InventoryValuationTotals => {
  const profitRetailValueKgs = toNumber(row?.profit_retail_value_kgs);
  const potentialGrossProfitKgs = toNumber(row?.profit_value_kgs);

  return {
    totalStockQty: toNumber(row?.total_stock_qty),
    costValueKgs: toNumber(row?.cost_value_kgs),
    retailValueKgs: toNumber(row?.retail_value_kgs),
    potentialGrossProfitKgs,
    potentialMarginPercent:
      profitRetailValueKgs !== 0 ? (potentialGrossProfitKgs / profitRetailValueKgs) * 100 : null,
    rowsWithCost: toNumber(row?.rows_with_cost),
    rowsWithPrice: toNumber(row?.rows_with_price),
    rowsWithProfitData: toNumber(row?.rows_with_profit_data),
    warningCounts: {
      noCost: toNumber(row?.no_cost_count),
      noPrice: toNumber(row?.no_price_count),
      noImage: toNumber(row?.no_image_count),
      negativeStock: toNumber(row?.negative_stock_count),
      lowStock: toNumber(row?.low_stock_count),
      unassigned: toNumber(row?.unassigned_count),
    },
  };
};

const mapStoreSummary = (row: StoreSummaryRow) => ({
  storeId: row.store_id,
  storeName: row.store_name,
  productCount: toNumber(row.product_count),
  snapshotCount: toNumber(row.snapshot_count),
  ...mapTotals(row),
});

const mapCategorySummary = (row: CategorySummaryRow) => ({
  category: row.category_name || uncategorizedLabel,
  productCount: toNumber(row.product_count),
  snapshotCount: toNumber(row.snapshot_count),
  ...mapTotals(row),
});

const productWarningsFor = (row: ProductTableRow) => {
  const warnings: AdminMetricsWarningFilter[] = [];
  const stockQty = toNumber(row.stock_qty);
  const minStock = toNumber(row.min_stock);

  if (row.cost_price_kgs === null) {
    warnings.push("noCost");
  }
  if (row.sale_price_kgs === null) {
    warnings.push("noPrice");
  }
  if (!row.has_image) {
    warnings.push("noImage");
  }
  if (stockQty < 0) {
    warnings.push("negativeStock");
  }
  if (minStock > 0 && stockQty >= 0 && stockQty <= minStock) {
    warnings.push("lowStock");
  }
  if (!row.is_assigned) {
    warnings.push("unassigned");
  }
  return warnings;
};

const mapProductRow = (row: ProductTableRow) => ({
  snapshotId: row.snapshot_id,
  productId: row.product_id,
  productName: row.product_name,
  productSku: row.product_sku,
  barcode: row.barcode,
  storeId: row.store_id,
  storeName: row.store_name,
  category: row.category_name || uncategorizedLabel,
  variantName: row.variant_name,
  variantSku: row.variant_sku,
  stockQty: toNumber(row.stock_qty),
  costPriceKgs: nullableNumber(row.cost_price_kgs),
  salePriceKgs: nullableNumber(row.sale_price_kgs),
  costValueKgs: nullableNumber(row.cost_value_kgs),
  retailValueKgs: nullableNumber(row.retail_value_kgs),
  potentialProfitKgs: nullableNumber(row.profit_value_kgs),
  marginPercent: nullableNumber(row.margin_percent),
  minStock: toNumber(row.min_stock),
  hasImage: Boolean(row.has_image),
  isAssigned: Boolean(row.is_assigned),
  isArchived: Boolean(row.is_archived),
  warningCount: toNumber(row.warning_count),
  warnings: productWarningsFor(row),
});

export const calculateInventoryValuation = (
  rows: InventoryValuationCalculationRow[],
): InventoryValuationTotals => {
  return rows.reduce<InventoryValuationTotals>(
    (totals, row) => {
      totals.totalStockQty += row.stockQty;

      if (row.costPriceKgs !== null) {
        totals.costValueKgs += row.stockQty * row.costPriceKgs;
        totals.rowsWithCost += 1;
      } else {
        totals.warningCounts.noCost += 1;
      }

      if (row.salePriceKgs !== null) {
        totals.retailValueKgs += row.stockQty * row.salePriceKgs;
        totals.rowsWithPrice += 1;
      } else {
        totals.warningCounts.noPrice += 1;
      }

      if (row.costPriceKgs !== null && row.salePriceKgs !== null) {
        totals.potentialGrossProfitKgs += row.stockQty * (row.salePriceKgs - row.costPriceKgs);
        totals.rowsWithProfitData += 1;
      }

      if (!row.hasImage) {
        totals.warningCounts.noImage += 1;
      }
      if (row.stockQty < 0) {
        totals.warningCounts.negativeStock += 1;
      }
      if ((row.minStock ?? 0) > 0 && row.stockQty >= 0 && row.stockQty <= (row.minStock ?? 0)) {
        totals.warningCounts.lowStock += 1;
      }
      if (!row.isAssigned) {
        totals.warningCounts.unassigned += 1;
      }

      return totals;
    },
    {
      totalStockQty: 0,
      costValueKgs: 0,
      retailValueKgs: 0,
      potentialGrossProfitKgs: 0,
      potentialMarginPercent: null,
      rowsWithCost: 0,
      rowsWithPrice: 0,
      rowsWithProfitData: 0,
      warningCounts: {
        noCost: 0,
        noPrice: 0,
        noImage: 0,
        negativeStock: 0,
        lowStock: 0,
        unassigned: 0,
      },
    },
  );
};

const addCalculatedMargin = (totals: InventoryValuationTotals, rows: InventoryValuationCalculationRow[]) => {
  const profitRetailValueKgs = rows.reduce((sum, row) => {
    if (row.costPriceKgs === null || row.salePriceKgs === null) {
      return sum;
    }
    return sum + row.stockQty * row.salePriceKgs;
  }, 0);

  return {
    ...totals,
    potentialMarginPercent:
      profitRetailValueKgs !== 0 ? (totals.potentialGrossProfitKgs / profitRetailValueKgs) * 100 : null,
  };
};

export const calculateInventoryValuationWithMargin = (
  rows: InventoryValuationCalculationRow[],
) => addCalculatedMargin(calculateInventoryValuation(rows), rows);

export const getAdminMetrics = async (input: AdminMetricsInput) => {
  const normalized = normalizeInput(input);
  const startedAt = Date.now();
  const baseCte = buildBaseCte(normalized);
  const warningWhere = warningWhereSql(normalized.warning);
  const offset = (normalized.page - 1) * normalized.pageSize;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const selectedStoreId = normalized.storeId;

  const [
    stores,
    categoryOptions,
    summaryRows,
    storeRows,
    categoryRows,
    productCountRows,
    productRows,
    salesRows,
  ] = await Promise.all([
      prisma.store.findMany({
        where: { organizationId: normalized.organizationId },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),

      prisma.$queryRaw<CategoryOptionRow[]>`
        SELECT DISTINCT category
        FROM (
          SELECT COALESCE(NULLIF(TRIM(product.category), ''), ${uncategorizedLabel}) AS category
          FROM "Product" product
          WHERE product."organizationId" = ${normalized.organizationId}
            AND (${normalized.includeArchived} = true OR product."isDeleted" = false)
          UNION
          SELECT NULLIF(TRIM(category_value), '') AS category
          FROM "Product" product
          CROSS JOIN LATERAL unnest(product.categories) category_value
          WHERE product."organizationId" = ${normalized.organizationId}
            AND (${normalized.includeArchived} = true OR product."isDeleted" = false)
        ) category_options
        WHERE category IS NOT NULL
        ORDER BY category ASC
      `,

      prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
        ${baseCte}
        SELECT ${summaryProjectionSql}
        FROM base
      `),

      prisma.$queryRaw<StoreSummaryRow[]>(Prisma.sql`
        ${baseCte}
        SELECT
          store_id,
          store_name,
          ${summaryProjectionSql}
        FROM base
        GROUP BY store_id, store_name
        ORDER BY retail_value_kgs DESC NULLS LAST, store_name ASC
      `),

      prisma.$queryRaw<CategorySummaryRow[]>(Prisma.sql`
        ${baseCte}
        SELECT
          category_name,
          ${summaryProjectionSql}
        FROM base
        GROUP BY category_name
        ORDER BY retail_value_kgs DESC NULLS LAST, category_name ASC
      `),

      prisma.$queryRaw<ProductCountRow[]>(Prisma.sql`
        ${baseCte}
        SELECT COUNT(*)::integer AS total_count
        FROM base
        ${warningWhere}
      `),

      prisma.$queryRaw<ProductTableRow[]>(Prisma.sql`
        ${baseCte}
        SELECT
          snapshot_id,
          product_id,
          product_name,
          product_sku,
          barcode,
          store_id,
          store_name,
          category_name,
          variant_name,
          variant_sku,
          stock_qty,
          cost_price_kgs,
          sale_price_kgs,
          CASE WHEN cost_price_kgs IS NOT NULL THEN stock_qty * cost_price_kgs ELSE NULL END::numeric AS cost_value_kgs,
          CASE WHEN sale_price_kgs IS NOT NULL THEN stock_qty * sale_price_kgs ELSE NULL END::numeric AS retail_value_kgs,
          CASE WHEN cost_price_kgs IS NOT NULL AND sale_price_kgs IS NOT NULL THEN stock_qty * (sale_price_kgs - cost_price_kgs) ELSE NULL END::numeric AS profit_value_kgs,
          CASE
            WHEN cost_price_kgs IS NOT NULL AND sale_price_kgs IS NOT NULL AND sale_price_kgs <> 0
              THEN ((sale_price_kgs - cost_price_kgs) / sale_price_kgs) * 100
            ELSE NULL
          END::numeric AS margin_percent,
          min_stock,
          has_image,
          is_assigned,
          is_archived,
          (
            CASE WHEN cost_price_kgs IS NULL THEN 1 ELSE 0 END
            + CASE WHEN sale_price_kgs IS NULL THEN 1 ELSE 0 END
            + CASE WHEN has_image = false THEN 1 ELSE 0 END
            + CASE WHEN stock_qty < 0 THEN 1 ELSE 0 END
            + CASE WHEN min_stock > 0 AND stock_qty >= 0 AND stock_qty <= min_stock THEN 1 ELSE 0 END
            + CASE WHEN is_assigned = false THEN 1 ELSE 0 END
          )::integer AS warning_count
        FROM base
        ${warningWhere}
        ${orderSql(normalized)}
        LIMIT ${normalized.pageSize}
        OFFSET ${offset}
      `),

      prisma.$queryRaw<SalesPeriodRow[]>(Prisma.sql`
        SELECT
          COUNT(DISTINCT orders.id)::integer AS orders,
          COALESCE(SUM(lines."lineTotalKgs"), 0)::numeric AS revenue_kgs,
          COALESCE(SUM(lines.qty), 0)::numeric AS sold_qty,
          COALESCE(SUM(lines."lineCostTotalKgs"), 0)::numeric AS line_cost_kgs
        FROM "CustomerOrder" orders
        LEFT JOIN "CustomerOrderLine" lines ON lines."customerOrderId" = orders.id
        WHERE orders."organizationId" = ${normalized.organizationId}
          AND orders.status = 'COMPLETED'
          AND orders."createdAt" >= ${thirtyDaysAgo}
          AND (${selectedStoreId}::text IS NULL OR orders."storeId" = ${selectedStoreId})
      `),
    ]);

  const summary = mapTotals(summaryRows[0]);
  const totalProducts = toNumber(productCountRows[0]?.total_count);
  const totalPages = Math.max(Math.ceil(totalProducts / normalized.pageSize), 1);
  const sales = salesRows[0];
  const salesRevenueKgs = toNumber(sales?.revenue_kgs);
  const salesCostKgs = toNumber(sales?.line_cost_kgs);
  const salesProfitKgs = salesRevenueKgs - salesCostKgs;

  return {
    generatedAt: new Date(),
    queryTimingMs: Date.now() - startedAt,
    filters: {
      storeId: normalized.storeId,
      category: normalized.category,
      search: normalized.search,
      includeArchived: normalized.includeArchived,
      warning: normalized.warning,
      sortKey: normalized.sortKey,
      sortDirection: normalized.sortDirection,
      page: normalized.page,
      pageSize: normalized.pageSize,
    },
    filterOptions: {
      stores,
      categories: categoryOptions.map((row) => row.category).filter((category): category is string => Boolean(category)),
    },
    inventory: {
      summary,
      productCount: toNumber(summaryRows[0]?.product_count),
      snapshotCount: toNumber(summaryRows[0]?.snapshot_count),
      storeSummaries: storeRows.map(mapStoreSummary),
      categorySummaries: categoryRows.map(mapCategorySummary),
      products: {
        rows: productRows.map(mapProductRow),
        pagination: {
          page: normalized.page,
          pageSize: normalized.pageSize,
          totalItems: totalProducts,
          totalPages,
          hasPreviousPage: normalized.page > 1,
          hasNextPage: normalized.page < totalPages,
        },
      },
    },
    sales30d: {
      orders: toNumber(sales?.orders),
      revenueKgs: salesRevenueKgs,
      soldQty: toNumber(sales?.sold_qty),
      grossProfitKgs: salesProfitKgs,
      grossMarginPercent: salesRevenueKgs > 0 ? (salesProfitKgs / salesRevenueKgs) * 100 : null,
    },
  };
};
