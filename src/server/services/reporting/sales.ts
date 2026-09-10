import { Prisma } from "@prisma/client";
import {
  addBusinessDays,
  businessDateKey,
  businessDateOnlyToUtc,
  defaultTimeZone,
} from "@/lib/timezone";
import { AppError } from "@/server/services/errors";

export const reportViews = [
  "products",
  "categories",
  "stores",
  "staff",
  "customers",
  "days",
  "documents",
  "costGaps",
] as const;
export type ReportView = (typeof reportViews)[number];
export type SalesReportInput = {
  organizationId: string;
  storeIds: string[];
  dateFrom: string;
  dateTo: string;
  channel?: "all" | "pos" | "orders";
  registerId?: string;
  cashierId?: string;
  category?: string;
  search?: string;
  productId?: string;
  variantKey?: string;
  customerKey?: string;
  documentId?: string;
  kind?: "sale" | "return";
  view?: ReportView;
  sort?: "revenue" | "profit" | "cost" | "returns" | "name" | "date";
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  /** Server-built inventory cohort for the administrator's current-stock view. Never accepted by an API. */
  inventoryScope?: Prisma.Sql;
};
export const REPORT_EXPORT_LIMIT = 10_000;
export type ReportingClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export function reportPeriod(dateFrom: string, dateTo: string, now = new Date()) {
  let from: Date, end: Date;
  try {
    from = businessDateOnlyToUtc(dateFrom);
    end = businessDateOnlyToUtc(dateTo, 1);
  } catch {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  const days = (end.getTime() - from.getTime()) / 86_400_000;
  if (days < 1 || days > 366) throw new AppError("invalidInput", "BAD_REQUEST", 400);
  const until = new Date(Math.max(from.getTime(), Math.min(end.getTime(), now.getTime())));
  const previousFrom = new Date(from.getTime() - days * 86_400_000);
  const previousUntil = new Date(previousFrom.getTime() + until.getTime() - from.getTime());
  return {
    dateFrom,
    dateTo,
    from,
    end,
    until,
    previousFrom,
    previousUntil,
    days,
    partial: until < end,
    comparisonAvailable: until > from,
    timeZone: defaultTimeZone,
    generatedAt: now,
  };
}

/** Only the immutable sale snapshot is evidence. A current ProductCost is never a fallback. */
export function historicalCostSql(alias: string) {
  if (!/^[a-z]+$/.test(alias)) throw new Error("Invalid internal SQL alias");
  const a = Prisma.raw(alias);
  return Prisma.sql`CASE
    WHEN ${a}.qty <= 0 OR ${a}."unitCostKgs" < 0 OR ${a}."lineCostTotalKgs" < 0 THEN NULL
    WHEN ${a}."lineCostTotalKgs" IS NOT NULL AND ${a}."unitCostKgs" IS NOT NULL
      AND ${a}."lineCostTotalKgs" <> ROUND(${a}."unitCostKgs" * ${a}.qty, 2) THEN NULL
    ELSE COALESCE(${a}."lineCostTotalKgs", ROUND(${a}."unitCostKgs" * ${a}.qty, 2)) END`;
}

const inStores = (field: Prisma.Sql, ids: string[]) =>
  ids.length ? Prisma.sql`${field} IN (${Prisma.join(ids)})` : Prisma.sql`false`;

/** One event population for cards, charts, all dimensions, document detail and export. */
export function salesEventsSql(
  input: SalesReportInput,
  period = reportPeriod(input.dateFrom, input.dateTo),
) {
  const channel = input.channel ?? "all";
  const dates = (field: Prisma.Sql) => Prisma.sql`(
    (${field} >= ${period.from} AND ${field} < ${period.until}) OR
    (${field} >= ${period.previousFrom} AND ${field} < ${period.previousUntil})
  )`;
  const orderScope = Prisma.sql`o."organizationId" = ${input.organizationId}
    AND ${inStores(Prisma.sql`o."storeId"`, input.storeIds)}
    AND o.status = 'COMPLETED' AND o."isHeld" = false AND o."completedAt" IS NOT NULL
    AND (${channel} = 'all' OR o."isPosSale" = (${channel} = 'pos'))
    ${input.registerId ? Prisma.sql`AND o."registerId" = ${input.registerId}` : Prisma.empty}
    ${input.cashierId === "__unknown__" ? Prisma.sql`AND o."createdById" IS NULL` : input.cashierId ? Prisma.sql`AND o."createdById" = ${input.cashierId}` : Prisma.empty}`;
  const returnScope = Prisma.sql`r."organizationId" = ${input.organizationId}
    AND ${inStores(Prisma.sql`r."storeId"`, input.storeIds)}
    AND r.status = 'COMPLETED' AND r."completedAt" IS NOT NULL AND ${channel} <> 'orders'
    ${input.registerId ? Prisma.sql`AND r."registerId" = ${input.registerId}` : Prisma.empty}
    ${input.cashierId === "__unknown__" ? Prisma.sql`AND COALESCE(r."completedById", r."createdById") IS NULL` : input.cashierId ? Prisma.sql`AND COALESCE(r."completedById", r."createdById") = ${input.cashierId}` : Prisma.empty}`;
  const filter: Prisma.Sql[] = [];
  if (input.inventoryScope) filter.push(input.inventoryScope);
  if (input.category)
    filter.push(
      Prisma.sql`(e.category = ${input.category} OR ${input.category} = ANY(e.categories))`,
    );
  if (input.search?.trim()) {
    // Treat search as literal text, not SQL wildcard syntax.
    const pattern = `%${input.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
    filter.push(
      Prisma.sql`(e."productName" ILIKE ${pattern} OR e.sku ILIKE ${pattern} OR EXISTS (
        SELECT 1 FROM "ProductBarcode" search_barcode WHERE search_barcode."organizationId" = ${input.organizationId}
          AND search_barcode."productId" = e."productId" AND search_barcode.value ILIKE ${pattern}))`,
    );
  }
  if (input.productId)
    filter.push(
      input.productId === "__unallocated__"
        ? Prisma.sql`e.unallocated`
        : Prisma.sql`e."productId" = ${input.productId}`,
    );
  if (input.variantKey) filter.push(Prisma.sql`e."variantKey" = ${input.variantKey}`);
  if (input.customerKey) filter.push(Prisma.sql`e."customerKey" = ${input.customerKey}`);
  if (input.documentId) filter.push(Prisma.sql`e."documentId" = ${input.documentId}`);
  if (input.kind) filter.push(Prisma.sql`e.kind = ${input.kind}`);
  return Prisma.sql`
    WITH sale_docs AS MATERIALIZED (
      SELECT o.* FROM "CustomerOrder" o WHERE ${orderScope} AND ${dates(Prisma.sql`o."completedAt"`)}
    ), return_docs AS MATERIALIZED (
      SELECT r.*, o."customerEmail", o."customerPhone", o."customerName", o."isPosSale"
      FROM "SaleReturn" r JOIN "CustomerOrder" o ON o.id = r."originalSaleId"
        AND o."organizationId" = ${input.organizationId}
      WHERE ${returnScope} AND ${dates(Prisma.sql`r."completedAt"`)}
    ), documents AS MATERIALIZED (
      SELECT id, number, "completedAt", "storeId", "registerId", "createdById" AS "employeeId",
        "customerEmail", "customerPhone", "customerName", "isPosSale", "totalKgs", "discountKgs",
        'sale'::text AS kind, id AS "originalSaleId" FROM sale_docs
      UNION ALL
      SELECT id, number, "completedAt", "storeId", "registerId", COALESCE("completedById", "createdById"),
        "customerEmail", "customerPhone", "customerName", "isPosSale", "totalKgs", 0::numeric,
        'return'::text, "originalSaleId" FROM return_docs
    ), original_return_lines AS MATERIALIZED (
      SELECT DISTINCT l."customerOrderLineId" AS id
      FROM "SaleReturnLine" l JOIN return_docs d ON d.id = l."saleReturnId"
    ), return_history AS MATERIALIZED (
      SELECT l.*, ol.qty AS "originalQty", ${historicalCostSql("ol")} AS "originalCost",
        SUM(l.qty) OVER (PARTITION BY l."customerOrderLineId"
          ORDER BY r."completedAt", r.id, l.id ROWS UNBOUNDED PRECEDING) AS "returnedThrough"
      FROM original_return_lines selected
      JOIN "SaleReturnLine" l ON l."customerOrderLineId" = selected.id
      JOIN "SaleReturn" r ON r.id = l."saleReturnId" AND r."organizationId" = ${input.organizationId}
        AND r.status = 'COMPLETED' AND r."completedAt" IS NOT NULL
      JOIN "CustomerOrderLine" ol ON ol.id = selected.id AND ol."productId" = l."productId"
        AND ol."variantKey" = l."variantKey"
      JOIN "CustomerOrder" o ON o.id = ol."customerOrderId" AND o."organizationId" = ${input.organizationId}
    ), lines AS MATERIALIZED (
      SELECT l.id, d.id AS "documentId", 'sale'::text AS kind, l."productId", l."variantId", l."variantKey",
        l.qty::numeric AS qty, l."lineTotalKgs" AS "rawRevenue", ${historicalCostSql("l")} AS cost,
        GREATEST(COALESCE(l."baseUnitPriceKgs", l."unitPriceKgs") - l."unitPriceKgs", 0) * l.qty AS "catalogDiscount",
        (${historicalCostSql("l")} IS NULL AND (l."unitCostKgs" IS NOT NULL OR l."lineCostTotalKgs" IS NOT NULL)) AS "costConflict",
        false AS "derivedReturnCost"
      FROM sale_docs d JOIN "CustomerOrderLine" l ON l."customerOrderId" = d.id
      UNION ALL
      SELECT l.id, d.id, 'return', l."productId", l."variantId", l."variantKey", l.qty::numeric, l."lineTotalKgs",
        CASE WHEN l."originalQty" > 0 AND l."returnedThrough" <= l."originalQty" AND l.qty > 0
          THEN ROUND(l."originalCost" * l."returnedThrough" / l."originalQty", 2)
            - ROUND(l."originalCost" * (l."returnedThrough" - l.qty) / l."originalQty", 2)
          ELSE NULL END,
        0::numeric,
        (l."returnedThrough" > l."originalQty" OR (l."originalCost" IS NULL AND l."lineCostTotalKgs" IS NOT NULL)),
        (l."originalCost" IS NOT NULL AND (l."lineCostTotalKgs" IS NULL OR
          l."lineCostTotalKgs" <> ROUND(l."originalCost" * l."returnedThrough" / NULLIF(l."originalQty", 0), 2)
            - ROUND(l."originalCost" * (l."returnedThrough" - l.qty) / NULLIF(l."originalQty", 0), 2)))
      FROM return_docs d JOIN return_history l ON l."saleReturnId" = d.id
    ), decorated AS MATERIALIZED (
      SELECT l.*, p.name AS "productName", COALESCE(v.sku, p.sku) AS sku, v.name AS "variantName", p.unit,
        COALESCE(NULLIF(TRIM(p.category), ''), NULLIF(TRIM(p.categories[1]), ''), '__uncategorized__') AS category,
        p.categories, b.value AS barcode
      FROM lines l JOIN "Product" p ON p.id = l."productId" AND p."organizationId" = ${input.organizationId}
      LEFT JOIN "ProductVariant" v ON v.id = l."variantId" AND v."productId" = p.id
      LEFT JOIN LATERAL (SELECT value FROM "ProductBarcode" b WHERE b."productId" = p.id
        ORDER BY b."createdAt", b.id LIMIT 1) b ON true
    ), weighted AS MATERIALIZED (
      SELECT l.*, SUM("rawRevenue") OVER (PARTITION BY kind, "documentId") AS "lineSum",
        SUM("rawRevenue") OVER (PARTITION BY kind, "documentId" ORDER BY id ROWS UNBOUNDED PRECEDING) AS "runningRevenue"
      FROM decorated l
    ), allocated AS MATERIALIZED (
      SELECT l.*, d."totalKgs", d."discountKgs",
        CASE WHEN l."lineSum" > 0 THEN
          ROUND(d."totalKgs" * l."runningRevenue" / l."lineSum", 2)
          - ROUND(d."totalKgs" * (l."runningRevenue" - l."rawRevenue") / l."lineSum", 2)
        ELSE 0 END AS revenue,
        CASE WHEN l."lineSum" > 0 THEN
          ROUND(d."discountKgs" * l."runningRevenue" / l."lineSum", 2)
          - ROUND(d."discountKgs" * (l."runningRevenue" - l."rawRevenue") / l."lineSum", 2)
        ELSE 0 END + l."catalogDiscount" AS discount
      FROM weighted l JOIN documents d ON d.id = l."documentId" AND d.kind = l.kind
    ), valued_lines AS (
      SELECT id, "documentId", kind, "productId", "variantId", "variantKey", "productName", sku, "variantName", unit,
        category, categories, barcode, qty, revenue, discount, cost, "costConflict", "derivedReturnCost", false AS unallocated,
        ("lineSum" - "discountKgs" <> "totalKgs") AS "amountConflict"
      FROM allocated
      UNION ALL
      SELECT 'unallocated:' || d.kind || d.id, d.id, d.kind, NULL, NULL, 'BASE', '__unallocated__', '', NULL, '',
        '__uncategorized__', ARRAY[]::text[], NULL, 0::numeric, d."totalKgs", d."discountKgs", NULL::numeric,
        false, false, true, true
      FROM documents d WHERE (d."totalKgs" <> 0 OR NOT EXISTS
        (SELECT 1 FROM weighted w WHERE w."documentId" = d.id AND w.kind = d.kind)) AND NOT EXISTS
        (SELECT 1 FROM weighted w WHERE w."documentId" = d.id AND w.kind = d.kind AND w."lineSum" > 0)
    ), event_population AS MATERIALIZED (
      SELECT l.*, d.number AS "documentNumber", d."originalSaleId", d."completedAt" AS "eventAt", d."storeId", s.name AS "storeName",
        d."registerId", d."employeeId", COALESCE(u.name, u.email, '__unknown__') AS "employeeName",
        CASE WHEN NULLIF(TRIM(d."customerEmail"), '') IS NOT NULL THEN 'email:' || LOWER(TRIM(d."customerEmail"))
          WHEN NULLIF(regexp_replace(COALESCE(d."customerPhone", ''), '[^0-9]', '', 'g'), '') IS NOT NULL
          THEN 'phone:' || regexp_replace(d."customerPhone", '[^0-9]', '', 'g') ELSE '__anonymous__' END AS "customerKey",
        COALESCE(NULLIF(TRIM(d."customerName"), ''), NULLIF(TRIM(d."customerEmail"), ''), NULLIF(TRIM(d."customerPhone"), ''), '__anonymous__') AS "customerName",
        CASE WHEN d."isPosSale" THEN 'pos' ELSE 'orders' END AS channel,
        to_char(d."completedAt" + interval '6 hours', 'YYYY-MM-DD') AS date,
        CASE WHEN d."completedAt" >= ${period.from} AND d."completedAt" < ${period.until} THEN 'current' ELSE 'previous' END AS period
      FROM valued_lines l JOIN documents d ON d.id = l."documentId" AND d.kind = l.kind
      JOIN "Store" s ON s.id = d."storeId" AND s."organizationId" = ${input.organizationId}
      LEFT JOIN "User" u ON u.id = d."employeeId" AND u."organizationId" = ${input.organizationId}
    ), events AS MATERIALIZED (
      SELECT * FROM event_population e ${filter.length ? Prisma.sql`WHERE ${Prisma.join(filter, " AND ")}` : Prisma.empty}
    )
  `;
}

export const salesTotalsSql = Prisma.sql`
  COALESCE(SUM(CASE WHEN kind = 'sale' THEN revenue ELSE 0 END), 0) AS "grossSalesKgs",
  COALESCE(SUM(CASE WHEN kind = 'return' THEN revenue ELSE 0 END), 0) AS "returnsKgs",
  COALESCE(SUM(CASE WHEN kind = 'sale' THEN revenue ELSE -revenue END), 0) AS "netSalesKgs",
  COALESCE(SUM(CASE WHEN kind = 'sale' THEN cost ELSE -cost END), 0) AS "knownCostKgs",
  COALESCE(SUM(CASE WHEN cost IS NOT NULL THEN CASE WHEN kind = 'sale' THEN revenue - cost ELSE cost - revenue END ELSE 0 END), 0) AS "knownProfitKgs",
  COALESCE(SUM(CASE WHEN kind = 'sale' THEN discount ELSE 0 END), 0) AS "discountKgs",
  COUNT(DISTINCT "documentId") FILTER (WHERE kind = 'sale') AS "receiptCount",
  COUNT(DISTINCT "documentId") FILTER (WHERE kind = 'return') AS "returnCount",
  COUNT(*) AS "lineCount", COUNT(*) FILTER (WHERE cost IS NULL) AS "unknownCostLines",
  COUNT(*) FILTER (WHERE cost = 0) AS "zeroCostLines",
  COUNT(*) FILTER (WHERE "costConflict") AS "costConflictLines",
  COUNT(*) FILTER (WHERE "derivedReturnCost") AS "derivedReturnCostLines",
  COUNT(DISTINCT kind || ':' || "documentId") FILTER (WHERE "amountConflict") AS "amountConflictDocuments",
  COUNT(*) FILTER (WHERE unallocated) AS "unallocatedLines",
  COALESCE(SUM(CASE WHEN kind = 'sale' THEN qty ELSE 0 END), 0) AS "quantitySold",
  COALESCE(SUM(CASE WHEN kind = 'return' THEN qty ELSE 0 END), 0) AS "quantityReturned",
  COUNT(DISTINCT "customerKey") FILTER (WHERE kind = 'sale' AND "customerKey" <> '__anonymous__') AS "identifiedCustomers",
  COUNT(DISTINCT "documentId") FILTER (WHERE kind = 'sale' AND "customerKey" = '__anonymous__') AS "anonymousSales"
`;

type RawTotals = Record<string, number | string | null>;
const numericKeys = [
  "grossSalesKgs",
  "returnsKgs",
  "netSalesKgs",
  "knownCostKgs",
  "knownProfitKgs",
  "discountKgs",
  "receiptCount",
  "returnCount",
  "lineCount",
  "unknownCostLines",
  "zeroCostLines",
  "costConflictLines",
  "derivedReturnCostLines",
  "amountConflictDocuments",
  "unallocatedLines",
  "quantitySold",
  "quantityReturned",
  "identifiedCustomers",
  "anonymousSales",
] as const;
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export function mapSalesTotals(raw?: RawTotals | null) {
  const data = Object.fromEntries(
    numericKeys.map((key) => [key, Number(raw?.[key] ?? 0)]),
  ) as Record<(typeof numericKeys)[number], number>;
  const complete = data.unknownCostLines === 0;
  const grossProfitKgs = complete ? round(data.netSalesKgs - data.knownCostKgs) : null;
  return {
    ...data,
    costKgs: complete ? data.knownCostKgs : null,
    grossProfitKgs,
    averageReceiptKgs: data.receiptCount ? round(data.grossSalesKgs / data.receiptCount) : null,
    marginPercent:
      grossProfitKgs !== null && data.netSalesKgs > 0
        ? round((grossProfitKgs / data.netSalesKgs) * 100)
        : null,
    markupPercent:
      grossProfitKgs !== null && data.knownCostKgs > 0
        ? round((grossProfitKgs / data.knownCostKgs) * 100)
        : null,
    coveragePercent: data.lineCount
      ? round(((data.lineCount - data.unknownCostLines) / data.lineCount) * 100)
      : null,
    returnRatePercent:
      data.grossSalesKgs > 0 ? round((data.returnsKgs / data.grossSalesKgs) * 100) : null,
    netQuantity: data.quantitySold - data.quantityReturned,
  };
}
export type SalesTotals = ReturnType<typeof mapSalesTotals>;
export type SalesReportRow = SalesTotals & {
  key: string;
  name: string;
  productId: string | null;
  variantKey: string | null;
  sku: string | null;
  unit: string | null;
  category: string | null;
  storeId: string | null;
  employeeId: string | null;
  customerKey: string | null;
  documentId: string | null;
  originalSaleId: string | null;
  documentNumber: string | null;
  kind: string | null;
  channel: string | null;
  date: string | null;
};
const grouping = {
  products: Prisma.sql`COALESCE("productId", '__unallocated__') || ':' || "variantKey"`,
  categories: Prisma.sql`category`,
  stores: Prisma.sql`"storeId"`,
  staff: Prisma.sql`COALESCE("employeeId", '__unknown__')`,
  customers: Prisma.sql`"customerKey"`,
  days: Prisma.sql`date`,
  documents: Prisma.sql`kind || ':' || "documentId"`,
  costGaps: Prisma.sql`kind || ':' || id`,
};
const groupNames = {
  products: Prisma.sql`"productName" || CASE WHEN "variantName" IS NULL THEN '' ELSE ' · ' || "variantName" END`,
  categories: Prisma.sql`category`,
  stores: Prisma.sql`"storeName"`,
  staff: Prisma.sql`"employeeName"`,
  customers: Prisma.sql`CASE WHEN "customerKey" = '__anonymous__' THEN '__anonymous__' ELSE "customerName" END`,
  days: Prisma.sql`date`,
  documents: Prisma.sql`"documentNumber"`,
  costGaps: Prisma.sql`"productName"`,
};

export async function getSalesReport(
  client: ReportingClient,
  input: SalesReportInput,
  options: { exportAll?: boolean; now?: Date } = {},
) {
  const period = reportPeriod(input.dateFrom, input.dateTo, options.now);
  const view = input.view ?? "products";
  const page = Math.max(1, input.page ?? 1),
    pageSize = options.exportAll
      ? REPORT_EXPORT_LIMIT + 1
      : Math.min(100, Math.max(1, input.pageSize ?? 25));
  const sort = {
    revenue: Prisma.sql`"netSalesKgs"`,
    profit: Prisma.sql`CASE WHEN "unknownCostLines" = 0 THEN "netSalesKgs" - "knownCostKgs" END`,
    cost: Prisma.sql`CASE WHEN "unknownCostLines" = 0 THEN "knownCostKgs" END`,
    returns: Prisma.sql`"returnsKgs"`,
    name: Prisma.sql`name`,
    date: Prisma.sql`date`,
  }[input.sort ?? "revenue"];
  const direction = Prisma.raw(input.direction === "asc" ? "ASC" : "DESC");
  type RawRow = RawTotals & Omit<SalesReportRow, keyof SalesTotals>;
  const [result] = await client.$queryRaw<
    Array<{
      summary: RawTotals;
      organizationName: string;
      previous: RawTotals;
      days: Array<RawTotals & { date: string }>;
      items: RawRow[];
      total: number;
    }>
  >(Prisma.sql`
    ${salesEventsSql(input, period)}, grouped AS (
      SELECT ${grouping[view]} AS key, MIN(${groupNames[view]}) AS name,
        MIN("productId") AS "productId", MIN("variantKey") AS "variantKey", MIN(sku) AS sku, MIN(unit) AS unit,
        MIN(category) AS category, MIN("storeId") AS "storeId", MIN("employeeId") AS "employeeId", MIN("customerKey") AS "customerKey",
        MIN("documentId") AS "documentId", MIN("originalSaleId") AS "originalSaleId", MIN("documentNumber") AS "documentNumber", MIN(kind) AS kind,
        MIN(channel) AS channel, MAX(date) AS date, ${salesTotalsSql}
      FROM events WHERE period = 'current' ${view === "costGaps" ? Prisma.sql`AND cost IS NULL` : Prisma.empty}
      GROUP BY ${grouping[view]}
    )
    SELECT
      (SELECT name FROM "Organization" WHERE id = ${input.organizationId}) AS "organizationName",
      (SELECT row_to_json(t) FROM (SELECT ${salesTotalsSql} FROM events WHERE period = 'current') t) AS summary,
      (SELECT row_to_json(t) FROM (SELECT ${salesTotalsSql} FROM events WHERE period = 'previous') t) AS previous,
      COALESCE((SELECT json_agg(t ORDER BY date) FROM (SELECT date, ${salesTotalsSql} FROM events WHERE period = 'current' GROUP BY date) t), '[]') AS days,
      COALESCE((SELECT json_agg(t) FROM (SELECT * FROM grouped ORDER BY ${sort} ${direction} NULLS LAST, key ASC
        LIMIT ${pageSize} OFFSET ${options.exportAll ? 0 : (page - 1) * pageSize}) t), '[]') AS items,
      (SELECT count(*)::int FROM grouped) AS total
  `);
  if (options.exportAll && result.total > REPORT_EXPORT_LIMIT)
    throw new AppError("analyticsExportRowLimit", "BAD_REQUEST", 400);
  const dayMap = new Map(result.days.map((day) => [day.date, day]));
  const series = [];
  for (let i = 0; i < period.days; i++) {
    const date = addBusinessDays(input.dateFrom, i);
    if (businessDateOnlyToUtc(date) >= period.until) break;
    series.push({ date, ...mapSalesTotals(dayMap.get(date)) });
  }
  return {
    totals: mapSalesTotals(result.summary),
    previous: mapSalesTotals(result.previous),
    series,
    items: result.items.map((row) => ({ ...row, ...mapSalesTotals(row) })) as SalesReportRow[],
    total: result.total,
    page: options.exportAll ? 1 : page,
    pageSize,
    view,
    period: {
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      fromUtc: period.from,
      toUtcExclusive: period.end,
      effectiveToUtc: period.until,
      timeZone: period.timeZone,
      partial: period.partial,
      comparisonAvailable: period.comparisonAvailable,
      previousFromUtc: period.previousFrom,
      previousToUtcExclusive: period.previousUntil,
      previousDateFrom: businessDateKey(period.previousFrom),
      previousDateTo: businessDateKey(
        new Date(Math.max(period.previousFrom.getTime(), period.previousUntil.getTime() - 1)),
      ),
    },
    meta: {
      organizationName: result.organizationName,
      generatedAt: period.generatedAt,
      currency: "KGS" as const,
      population: "all-filtered" as const,
      channel: input.channel ?? "all",
      cache: "none" as const,
      exportLimit: REPORT_EXPORT_LIMIT,
    },
  };
}
