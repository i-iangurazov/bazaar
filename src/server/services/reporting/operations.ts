import { Prisma } from "@prisma/client";
import { AppError } from "@/server/services/errors";
import { REPORT_EXPORT_LIMIT, reportPeriod, type ReportingClient } from "./sales";

export const operationViews = [
  "receipts",
  "suppliers",
  "payments",
  "cash",
  "debts",
  "movements",
  "stock",
  "stockouts",
  "slowMovers",
  "writeOffs",
] as const;
export type OperationView = (typeof operationViews)[number];
export type OperationInput = {
  organizationId: string;
  storeIds: string[];
  dateFrom: string;
  dateTo: string;
  view: OperationView;
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: "date" | "amount" | "name";
  direction?: "asc" | "desc";
};
export type OperationRow = {
  id: string;
  name: string;
  date: Date | null;
  storeId: string;
  storeName: string;
  productId: string | null;
  documentId: string | null;
  referenceType: string | null;
  kind: string;
  quantity: number | null;
  unit: string | null;
  amountKgs: number | null;
  knownAmountKgs: number;
  unknownRows: number;
  count: number;
};

/** Independent populations: no joining payments to document lines, no use of today's cost in receipts. */
export async function getOperationsReport(
  client: ReportingClient,
  input: OperationInput,
  options: { exportAll?: boolean; now?: Date } = {},
) {
  const period = reportPeriod(input.dateFrom, input.dateTo, options.now);
  const stores = input.storeIds.length
    ? Prisma.sql`s.id IN (${Prisma.join(input.storeIds)})`
    : Prisma.sql`false`;
  const storeScope = Prisma.sql`s."organizationId" = ${input.organizationId} AND ${stores}`;
  const dates = (field: Prisma.Sql) =>
    Prisma.sql`${field} >= ${period.from} AND ${field} < ${period.until}`;
  const movements = Prisma.sql`
    SELECT m.id, p.name || COALESCE(' · ' || v.name, '') AS name, m."createdAt" AS date, s.id AS "storeId", s.name AS "storeName",
      p.id AS "productId", m."referenceId" AS "documentId", m."referenceType", m.type::text AS kind,
      m."qtyDelta"::numeric AS quantity, p.unit,
      COALESCE(m."lineTotalKgs", m."unitCostKgs" * m."qtyDelta")::numeric AS amount,
      po."supplierId", supplier.name AS "supplierName"
    FROM "StockMovement" m JOIN "Store" s ON s.id = m."storeId"
    JOIN "Product" p ON p.id = m."productId" AND p."organizationId" = ${input.organizationId}
    LEFT JOIN "ProductVariant" v ON v.id = m."variantId" AND v."productId" = p.id
    LEFT JOIN "PurchaseOrder" po ON m."referenceType" = 'PURCHASE_ORDER' AND po.id = m."referenceId"
      AND po."organizationId" = ${input.organizationId} AND po."storeId" = s.id
    LEFT JOIN "Supplier" supplier ON supplier.id = po."supplierId" AND supplier."organizationId" = ${input.organizationId}
    WHERE ${storeScope} AND ${dates(Prisma.sql`m."createdAt"`)}
    ${input.view === "receipts" || input.view === "suppliers" ? Prisma.sql`AND m.type = 'RECEIVE' AND m."referenceType" IN ('PURCHASE_ORDER', 'STOCK_RECEIVING')` : Prisma.empty}
    ${input.view === "writeOffs" ? Prisma.sql`AND (m.type = 'WRITE_OFF' OR m."referenceType" = 'WRITE_OFF')` : Prisma.empty}`;
  const population =
    input.view === "stock" || input.view === "slowMovers" || input.view === "stockouts"
      ? Prisma.sql`
    SELECT i.id, p.name || COALESCE(' · ' || v.name, '') AS name, i."updatedAt" AS date, s.id AS "storeId", s.name AS "storeName", p.id AS "productId",
      NULL::text AS "documentId", 'INVENTORY'::text AS "referenceType",
      CASE WHEN i."onHand" < 0 THEN 'negativeStock' WHEN i."onHand" = 0 THEN 'zeroStock'
        WHEN i."onHand" <= COALESCE(r."minStock", 0) THEN 'lowStock' ELSE 'stock' END AS kind,
      i."onHand"::numeric AS quantity, p.unit, (i."onHand" * c."avgCostKgs")::numeric AS amount
    FROM "InventorySnapshot" i JOIN "Store" s ON s.id = i."storeId"
    JOIN "Product" p ON p.id = i."productId" AND p."organizationId" = ${input.organizationId}
    LEFT JOIN "ProductVariant" v ON v.id = i."variantId" AND v."productId" = p.id
    LEFT JOIN "ProductCost" c ON c."organizationId" = ${input.organizationId} AND c."productId" = p.id AND c."variantKey" = i."variantKey"
    LEFT JOIN "ReorderPolicy" r ON r."storeId" = s.id AND r."productId" = p.id
    WHERE ${storeScope}
    ${input.view === "stockouts" ? Prisma.sql`AND i."onHand" <= 0` : Prisma.empty}
    ${
      input.view === "slowMovers"
        ? Prisma.sql`AND i."onHand" > 0 AND NOT EXISTS (
      SELECT 1 FROM "StockMovement" m WHERE m."storeId" = s.id AND m."productId" = p.id
      AND m."variantId" IS NOT DISTINCT FROM i."variantId" AND ${dates(Prisma.sql`m."createdAt"`)})`
        : Prisma.empty
    }`
      : input.view === "payments"
        ? Prisma.sql`
    SELECT pay.id, o.number AS name, pay."createdAt" AS date, s.id AS "storeId", s.name AS "storeName",
      NULL::text AS "productId", o.id AS "documentId", 'SALE'::text AS "referenceType",
      pay.method::text || CASE WHEN pay."isRefund" THEN '_REFUND' ELSE '' END AS kind,
      NULL::numeric AS quantity, NULL::text AS unit,
      CASE WHEN pay."isRefund" THEN -pay."amountKgs" ELSE pay."amountKgs" END::numeric AS amount
    FROM "SalePayment" pay JOIN "Store" s ON s.id = pay."storeId"
    JOIN "CustomerOrder" o ON o.id = pay."customerOrderId" AND o."organizationId" = ${input.organizationId}
    WHERE ${storeScope} AND pay."organizationId" = ${input.organizationId} AND ${dates(Prisma.sql`pay."createdAt"`)}`
        : input.view === "cash"
          ? Prisma.sql`
    SELECT m.id, m.reason AS name, m."createdAt" AS date, s.id AS "storeId", s.name AS "storeName",
      NULL::text AS "productId", m."shiftId" AS "documentId", 'SHIFT'::text AS "referenceType", m.type::text AS kind,
      NULL::numeric AS quantity, NULL::text AS unit,
      CASE WHEN m.type = 'PAY_OUT' THEN -m."amountKgs" ELSE m."amountKgs" END::numeric AS amount
    FROM "CashDrawerMovement" m JOIN "Store" s ON s.id = m."storeId"
    WHERE ${storeScope} AND m."organizationId" = ${input.organizationId} AND ${dates(Prisma.sql`m."createdAt"`)}`
          : input.view === "debts"
            ? Prisma.sql`
    SELECT o.id, o.number || ' · ' || COALESCE(o."debtCustomerName", o."customerName", '') AS name,
      o."completedAt" AS date, s.id AS "storeId", s.name AS "storeName", NULL::text AS "productId",
      o.id AS "documentId", 'SALE'::text AS "referenceType", 'DEBT'::text AS kind,
      NULL::numeric AS quantity, NULL::text AS unit, o."totalKgs"::numeric AS amount
    FROM "CustomerOrder" o JOIN "Store" s ON s.id = o."storeId"
    WHERE ${storeScope} AND o."organizationId" = ${input.organizationId} AND o.status = 'COMPLETED'
      AND o."isHeld" = false AND o."isDebt" = true AND o."debtSettledAt" IS NULL`
            : movements;
  const search = input.search?.trim();
  const pattern = search ? `%${search.replace(/[\\%_]/g, "\\$&")}%` : null;
  const suppliers = input.view === "suppliers";
  const page = Math.max(1, input.page ?? 1);
  const pageSize = options.exportAll
    ? REPORT_EXPORT_LIMIT + 1
    : Math.min(100, Math.max(1, input.pageSize ?? 25));
  const direction = Prisma.raw(input.direction === "asc" ? "ASC" : "DESC");
  const sort = { date: Prisma.sql`date`, amount: Prisma.sql`"amountKgs"`, name: Prisma.sql`name` }[
    input.sort ?? "date"
  ];
  type Summary = {
    knownAmountKgs: number;
    unknownRows: number;
    count: number;
    inflowKgs: number;
    outflowKgs: number;
    negativeStock: number;
    zeroStock: number;
    lowStock: number;
  };
  const [result] = await client.$queryRaw<
    Array<{
      items: OperationRow[];
      total: number;
      summary: Summary;
      organizationName: string;
      breakdown: Array<{ kind: string; count: number; amountKgs: number | null }>;
    }>
  >(Prisma.sql`
    WITH population AS (${population}), filtered AS MATERIALIZED (
      SELECT * FROM population WHERE (${pattern}::text IS NULL OR name ILIKE ${pattern} OR "storeName" ILIKE ${pattern}
        ${suppliers ? Prisma.sql`OR "supplierName" ILIKE ${pattern}` : Prisma.empty})
    ), grouped AS (
      ${
        suppliers
          ? Prisma.sql`
        SELECT COALESCE("supplierId", '__unassigned__') AS id, COALESCE(MIN("supplierName"), '__unassigned__') AS name,
          MAX(date) AS date, ''::text AS "storeId", ''::text AS "storeName", NULL::text AS "productId",
          NULL::text AS "documentId", 'SUPPLIER'::text AS "referenceType", 'RECEIVE'::text AS kind,
          NULL::numeric AS quantity, NULL::text AS unit, COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE amount IS NULL)::int AS "unknownRows",
          CASE WHEN COUNT(*) FILTER (WHERE amount IS NULL) = 0 THEN SUM(amount) END AS "amountKgs",
          COALESCE(SUM(amount), 0) AS "knownAmountKgs" FROM filtered GROUP BY "supplierId"`
          : Prisma.sql`SELECT id, name, date, "storeId", "storeName", "productId", "documentId", "referenceType", kind,
          quantity, unit, 1::int AS count, (amount IS NULL)::int AS "unknownRows",
          amount AS "amountKgs", COALESCE(amount, 0) AS "knownAmountKgs" FROM filtered`
      }
    ) SELECT
      (SELECT name FROM "Organization" WHERE id = ${input.organizationId}) AS "organizationName",
      (SELECT COALESCE(json_agg(t), '[]'::json) FROM (SELECT * FROM grouped ORDER BY ${sort} ${direction} NULLS LAST, id
        LIMIT ${pageSize} OFFSET ${options.exportAll ? 0 : (page - 1) * pageSize}) t) AS items,
      (SELECT COUNT(*)::int FROM grouped) AS total,
      (SELECT row_to_json(t) FROM (SELECT COALESCE(SUM(amount), 0) AS "knownAmountKgs",
        COUNT(*) FILTER (WHERE amount IS NULL)::int AS "unknownRows", COUNT(*)::int AS count,
        COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS "inflowKgs",
        -COALESCE(SUM(amount) FILTER (WHERE amount < 0), 0) AS "outflowKgs",
        COUNT(*) FILTER (WHERE kind = 'negativeStock')::int AS "negativeStock",
        COUNT(*) FILTER (WHERE kind = 'zeroStock')::int AS "zeroStock",
        COUNT(*) FILTER (WHERE kind = 'lowStock')::int AS "lowStock" FROM filtered) t) AS summary,
      (SELECT COALESCE(json_agg(t), '[]'::json) FROM (SELECT kind, COUNT(*)::int AS count,
        CASE WHEN COUNT(*) FILTER (WHERE amount IS NULL) = 0 THEN SUM(amount) END AS "amountKgs"
        FROM filtered GROUP BY kind ORDER BY kind) t) AS breakdown
  `);
  if (options.exportAll && result.total > REPORT_EXPORT_LIMIT)
    throw new AppError("analyticsExportRowLimit", "BAD_REQUEST", 400);
  return {
    ...result,
    summary: {
      ...result.summary,
      // Movement amount conventions belong to their source document (e.g. a
      // write-off records positive cost). A mixed journal has no monetary total.
      amountKgs:
        input.view === "movements" || result.summary.unknownRows
          ? null
          : result.summary.knownAmountKgs,
    },
    page: options.exportAll ? 1 : page,
    pageSize,
    view: input.view,
    meta: {
      organizationName: result.organizationName,
      generatedAt: period.generatedAt,
      currency: "KGS" as const,
      timeZone: period.timeZone,
      currentSnapshot: ["stock", "stockouts", "debts"].includes(input.view),
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
    },
  };
}
