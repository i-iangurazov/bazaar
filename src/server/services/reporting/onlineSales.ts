import { Prisma } from "@prisma/client";

import { addBusinessDays, businessDateOnlyToUtc, businessDateKey } from "@/lib/timezone";
import { AppError } from "@/server/services/errors";
import {
  reportPeriod,
  utcReportTimestamp,
  type ReportingClient,
} from "@/server/services/reporting/sales";

export const ONLINE_SALES_EXPORT_LIMIT = 10_000;

export const onlineSalesSources = ["CATALOG", "API", "MANUAL"] as const;
export type OnlineSalesSourceFilter = "all" | (typeof onlineSalesSources)[number];
/** `ONLINE` is the commercial channel; `UNKNOWN` holds legacy orders with no channel recorded. */
export type OnlineSalesChannelFilter = "ONLINE" | "UNKNOWN";

export type OnlineSalesReportInput = {
  organizationId: string;
  storeIds: string[];
  dateFrom: string;
  dateTo: string;
  channel?: OnlineSalesChannelFilter;
  source?: OnlineSalesSourceFilter;
  page?: number;
  pageSize?: number;
  sort?: "date" | "amount" | "number";
  direction?: "asc" | "desc";
};

export type OnlineSalesPaymentStatus = "PAID" | "PARTIAL" | "DEBT" | "NO_DATA";

export type OnlineSalesOrderRow = {
  id: string;
  number: string;
  createdAt: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  storeId: string;
  storeName: string;
  source: string;
  status: string;
  totalKgs: number;
  discountKgs: number;
  paidKgs: number;
  paymentCount: number;
  returnsKgs: number;
  paymentStatus: OnlineSalesPaymentStatus;
};

export type OnlineSalesDayPoint = {
  date: string;
  createdCount: number;
  createdKgs: number;
  completedCount: number;
  completedKgs: number;
  returnsKgs: number;
};

// Only an unambiguous alias is interpolated into SQL; every value stays bound.
const rawAlias = (value: string) => {
  if (!/^[a-z_]+$/.test(value)) throw new Error("Invalid internal SQL alias");
  return Prisma.raw(value);
};

const inStores = (field: Prisma.Sql, ids: string[]) =>
  ids.length ? Prisma.sql`${field} IN (${Prisma.join(ids)})` : Prisma.sql`false`;

const channelScope = (aliasName: string, channel: OnlineSalesChannelFilter) => {
  const a = rawAlias(aliasName);
  return channel === "UNKNOWN"
    ? Prisma.sql`${a}."saleChannel" IS NULL`
    : Prisma.sql`${a}."saleChannel"::text = 'ONLINE'`;
};

const sourceScope = (aliasName: string, source: OnlineSalesSourceFilter) => {
  if (source === "all") return Prisma.empty;
  const a = rawAlias(aliasName);
  return Prisma.sql`AND ${a}.source::text = ${source}`;
};

const orderScope = (input: OnlineSalesReportInput, channel: OnlineSalesChannelFilter) =>
  Prisma.sql`o."organizationId" = ${input.organizationId}
    AND ${inStores(Prisma.sql`o."storeId"`, input.storeIds)}
    AND ${channelScope("o", channel)}
    ${sourceScope("o", input.source ?? "all")}`;

const numberOrZero = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const derivePaymentStatus = (row: {
  status: string;
  totalKgs: number;
  paidKgs: number;
  paymentCount: number;
  isDebt: boolean;
  debtSettledAt: string | null;
}): OnlineSalesPaymentStatus => {
  if (row.isDebt && !row.debtSettledAt) return "DEBT";
  if (row.paymentCount > 0) {
    if (row.totalKgs > 0 && row.paidKgs + 0.005 >= row.totalKgs) return "PAID";
    if (row.paidKgs > 0) return "PARTIAL";
  }
  // Absence of a payment row is not proof of non-payment for online orders.
  return "NO_DATA";
};

/**
 * Online-sales report.
 *
 * The commercial fact is `saleChannel = ONLINE`. Created orders are the cohort of
 * orders created in the period (`createdAt`); completed sales are counted by
 * `completedAt`; returns by the return completion date. Payment evidence comes
 * only from recorded `SalePayment` rows — an online order without payment rows is
 * reported as "no payment data", never as unpaid.
 */
export async function getOnlineSalesReport(
  client: ReportingClient,
  input: OnlineSalesReportInput,
  options: { exportAll?: boolean; now?: Date } = {},
) {
  const period = reportPeriod(input.dateFrom, input.dateTo, options.now);
  const channel = input.channel ?? "ONLINE";
  const page = Math.max(1, input.page ?? 1);
  const pageSize = options.exportAll
    ? ONLINE_SALES_EXPORT_LIMIT + 1
    : Math.min(100, Math.max(1, input.pageSize ?? 25));
  const scope = orderScope(input, channel);
  const createdWindow = Prisma.sql`${utcReportTimestamp(period.from)} AND o."createdAt" < ${utcReportTimestamp(period.until)}`;
  const prevCreatedWindow = Prisma.sql`${utcReportTimestamp(period.previousFrom)} AND o."createdAt" < ${utcReportTimestamp(period.previousUntil)}`;
  const completedWindow = Prisma.sql`o."completedAt" >= ${utcReportTimestamp(period.from)} AND o."completedAt" < ${utcReportTimestamp(period.until)}`;
  const prevCompletedWindow = Prisma.sql`o."completedAt" >= ${utcReportTimestamp(period.previousFrom)} AND o."completedAt" < ${utcReportTimestamp(period.previousUntil)}`;
  const returnScope = Prisma.sql`r."organizationId" = ${input.organizationId}
    AND ${inStores(Prisma.sql`r."storeId"`, input.storeIds)}
    AND o."organizationId" = ${input.organizationId}
    AND ${channelScope("o", channel)}`;

  type SummaryRow = Record<string, unknown>;
  const [summary] = await client.$queryRaw<SummaryRow[]>(Prisma.sql`
    WITH created AS (
      SELECT o.* FROM "CustomerOrder" o WHERE ${scope} AND o."createdAt" >= ${createdWindow}
    ), created_prev AS (
      SELECT o.* FROM "CustomerOrder" o WHERE ${scope} AND o."createdAt" >= ${prevCreatedWindow}
    ), completed AS (
      SELECT o.* FROM "CustomerOrder" o WHERE ${scope} AND o.status = 'COMPLETED' AND ${completedWindow}
    ), completed_prev AS (
      SELECT o.* FROM "CustomerOrder" o WHERE ${scope} AND o.status = 'COMPLETED' AND ${prevCompletedWindow}
    ), returns AS (
      SELECT r."totalKgs" AS "totalKgs" FROM "SaleReturn" r JOIN "CustomerOrder" o ON o.id = r."originalSaleId"
      WHERE ${returnScope} AND r.status = 'COMPLETED' AND r."completedAt" >= ${utcReportTimestamp(period.from)} AND r."completedAt" < ${utcReportTimestamp(period.until)}
    ), returns_prev AS (
      SELECT r."totalKgs" AS "totalKgs" FROM "SaleReturn" r JOIN "CustomerOrder" o ON o.id = r."originalSaleId"
      WHERE ${returnScope} AND r.status = 'COMPLETED' AND r."completedAt" >= ${utcReportTimestamp(period.previousFrom)} AND r."completedAt" < ${utcReportTimestamp(period.previousUntil)}
    ), unknown_created AS (
      SELECT count(*) AS count FROM "CustomerOrder" o
      WHERE o."organizationId" = ${input.organizationId}
        AND ${inStores(Prisma.sql`o."storeId"`, input.storeIds)}
        AND o."saleChannel" IS NULL
        ${sourceScope("o", input.source ?? "all")}
        AND o."createdAt" >= ${utcReportTimestamp(period.from)} AND o."createdAt" < ${utcReportTimestamp(period.until)}
    ), sources AS (
      SELECT o.source::text AS source, count(*) AS count, COALESCE(SUM(o."totalKgs"), 0) AS total
      FROM created o GROUP BY o.source
    )
    SELECT
      (SELECT count(*)::int FROM created) AS "createdCount",
      (SELECT COALESCE(SUM(o."totalKgs"), 0)::float8 FROM created o) AS "createdKgs",
      (SELECT COALESCE(SUM(o."discountKgs"), 0)::float8 FROM created o) AS "createdDiscountKgs",
      (SELECT count(*)::int FROM created o WHERE o.status = 'DRAFT') AS "createdDraft",
      (SELECT count(*)::int FROM created o WHERE o.status = 'CONFIRMED') AS "createdConfirmed",
      (SELECT count(*)::int FROM created o WHERE o.status = 'READY') AS "createdReady",
      (SELECT count(*)::int FROM created o WHERE o.status = 'COMPLETED') AS "createdCompleted",
      (SELECT count(*)::int FROM created o WHERE o.status = 'CANCELED') AS "createdCanceled",
      (SELECT count(*)::int FROM created_prev) AS "prevCreatedCount",
      (SELECT COALESCE(SUM(o."totalKgs"), 0)::float8 FROM created_prev o) AS "prevCreatedKgs",
      (SELECT COALESCE(SUM(o."discountKgs"), 0)::float8 FROM created_prev o) AS "prevCreatedDiscountKgs",
      (SELECT count(*)::int FROM completed) AS "completedCount",
      (SELECT COALESCE(SUM(o."totalKgs"), 0)::float8 FROM completed o) AS "completedGrossKgs",
      (SELECT COALESCE(SUM(o."discountKgs"), 0)::float8 FROM completed o) AS "completedDiscountKgs",
      (SELECT count(*)::int FROM returns) AS "returnCount",
      (SELECT COALESCE(SUM(r."totalKgs"), 0)::float8 FROM returns r) AS "returnsKgs",
      (SELECT COALESCE(SUM(r."totalKgs"), 0)::float8 FROM returns_prev r) AS "prevReturnsKgs",
      (SELECT count(*)::int FROM completed_prev) AS "prevCompletedCount",
      (SELECT COALESCE(SUM(o."totalKgs"), 0)::float8 FROM completed_prev o) AS "prevCompletedGrossKgs",
      (SELECT count(*)::int FROM "SalePayment" p WHERE p."organizationId" = ${input.organizationId}
        AND p."isRefund" = false AND p."customerOrderId" IN (SELECT id FROM completed)) AS "paidOrderCount",
      (SELECT COALESCE(SUM(p."amountKgs"), 0)::float8 FROM "SalePayment" p WHERE p."organizationId" = ${input.organizationId}
        AND p."isRefund" = false AND p."customerOrderId" IN (SELECT id FROM completed)) AS "paidKgs",
      (SELECT COALESCE(SUM(o."totalKgs"), 0)::float8 FROM completed o WHERE o."isDebt" = true AND o."debtSettledAt" IS NULL) AS "debtKgs",
      (SELECT count(*)::int FROM unknown_created) AS "unknownCreatedCount",
      COALESCE((SELECT json_agg(json_build_object('source', source, 'count', count, 'totalKgs', total) ORDER BY source) FROM sources), '[]') AS "sources"
  `);

  const sorted = {
    date: Prisma.sql`o."createdAt"`,
    number: Prisma.sql`o.number`,
    amount: Prisma.sql`o."totalKgs"`,
  }[input.sort ?? "date"];
  const direction = Prisma.raw(input.direction === "asc" ? "ASC" : "DESC");

  type ItemRow = {
    id: string;
    number: string;
    createdAt: Date;
    customerName: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    storeId: string;
    storeName: string;
    source: string;
    status: string;
    totalKgs: number;
    discountKgs: number;
    paidKgs: number;
    paymentCount: number;
    returnsKgs: number;
    isDebt: boolean;
    debtSettledAt: Date | null;
    total: number;
  };
  const items = await client.$queryRaw<ItemRow[]>(Prisma.sql`
    WITH created AS (
      SELECT o.* FROM "CustomerOrder" o WHERE ${scope} AND o."createdAt" >= ${createdWindow}
    ), payments AS (
      SELECT p."customerOrderId" AS id, COALESCE(SUM(p."amountKgs"), 0)::float8 AS paid, COUNT(*)::int AS count
      FROM "SalePayment" p
      WHERE p."organizationId" = ${input.organizationId} AND p."isRefund" = false
        AND p."customerOrderId" IN (SELECT id FROM created)
      GROUP BY p."customerOrderId"
    ), returns AS (
      SELECT r."originalSaleId" AS id, COALESCE(SUM(r."totalKgs"), 0)::float8 AS returns
      FROM "SaleReturn" r
      WHERE r."organizationId" = ${input.organizationId} AND r.status = 'COMPLETED'
        AND r."originalSaleId" IN (SELECT id FROM created)
      GROUP BY r."originalSaleId"
    )
    SELECT o.id, o.number, o."createdAt", o."customerName", o."customerEmail", o."customerPhone",
      o."storeId", s.name AS "storeName", o.source::text AS source, o.status::text AS status,
      o."totalKgs"::float8 AS "totalKgs", o."discountKgs"::float8 AS "discountKgs",
      COALESCE(p.paid, 0)::float8 AS "paidKgs", COALESCE(p.count, 0)::int AS "paymentCount",
      COALESCE(rt.returns, 0)::float8 AS "returnsKgs",
      o."isDebt", o."debtSettledAt", count(*) OVER ()::int AS total
    FROM created o
    JOIN "Store" s ON s.id = o."storeId"
    LEFT JOIN payments p ON p.id = o.id
    LEFT JOIN returns rt ON rt.id = o.id
    ORDER BY ${sorted} ${direction} NULLS LAST, o.id ASC
    LIMIT ${pageSize} OFFSET ${options.exportAll ? 0 : (page - 1) * pageSize}
  `);
  if (options.exportAll && (items[0]?.total ?? 0) > ONLINE_SALES_EXPORT_LIMIT)
    throw new AppError("analyticsExportRowLimit", "BAD_REQUEST", 400);

  type DayRow = { date: string; createdCount: number; createdKgs: number; completedCount: number; completedKgs: number; returnsKgs: number };
  const dayRows = await client.$queryRaw<DayRow[]>(Prisma.sql`
    WITH created AS (
      SELECT o.* FROM "CustomerOrder" o WHERE ${scope} AND o."createdAt" >= ${createdWindow}
    ), completed AS (
      SELECT o.* FROM "CustomerOrder" o WHERE ${scope} AND o.status = 'COMPLETED' AND ${completedWindow}
    ), returns AS (
      SELECT r."totalKgs" AS "totalKgs", r."completedAt" AS "completedAt" FROM "SaleReturn" r JOIN "CustomerOrder" o ON o.id = r."originalSaleId"
      WHERE ${returnScope} AND r.status = 'COMPLETED' AND r."completedAt" >= ${utcReportTimestamp(period.from)} AND r."completedAt" < ${utcReportTimestamp(period.until)}
    ), events AS (
      SELECT to_char(o."createdAt" + interval '6 hours', 'YYYY-MM-DD') AS date, 1 AS created_count, o."totalKgs"::float8 AS created_kgs, 0 AS completed_count, 0::float8 AS completed_kgs, 0::float8 AS returns_kgs FROM created o
      UNION ALL
      SELECT to_char(o."completedAt" + interval '6 hours', 'YYYY-MM-DD'), 0, 0, 1, o."totalKgs"::float8, 0 FROM completed o
      UNION ALL
      SELECT to_char(r."completedAt" + interval '6 hours', 'YYYY-MM-DD'), 0, 0, 0, 0, r."totalKgs"::float8 FROM returns r
    )
    SELECT date,
      SUM(created_count)::int AS "createdCount", COALESCE(SUM(created_kgs), 0)::float8 AS "createdKgs",
      SUM(completed_count)::int AS "completedCount", COALESCE(SUM(completed_kgs), 0)::float8 AS "completedKgs",
      COALESCE(SUM(returns_kgs), 0)::float8 AS "returnsKgs"
    FROM events GROUP BY date ORDER BY date
  `);
  const dayMap = new Map(dayRows.map((row) => [row.date, row]));
  const series: OnlineSalesDayPoint[] = [];
  if (period.days <= 366) {
    for (let i = 0; i < period.days; i++) {
      const date = addBusinessDays(input.dateFrom, i);
      if (businessDateOnlyToUtc(date) >= period.until) break;
      const row = dayMap.get(date);
      series.push({
        date,
        createdCount: numberOrZero(row?.createdCount),
        createdKgs: round(numberOrZero(row?.createdKgs)),
        completedCount: numberOrZero(row?.completedCount),
        completedKgs: round(numberOrZero(row?.completedKgs)),
        returnsKgs: round(numberOrZero(row?.returnsKgs)),
      });
    }
  } else {
    for (const row of dayRows)
      series.push({
        date: row.date,
        createdCount: numberOrZero(row.createdCount),
        createdKgs: round(numberOrZero(row.createdKgs)),
        completedCount: numberOrZero(row.completedCount),
        completedKgs: round(numberOrZero(row.completedKgs)),
        returnsKgs: round(numberOrZero(row.returnsKgs)),
      });
  }

  const createdCount = numberOrZero(summary?.createdCount);
  const completedCount = numberOrZero(summary?.completedCount);
  const returnsKgs = round(numberOrZero(summary?.returnsKgs));
  const completedGrossKgs = round(numberOrZero(summary?.completedGrossKgs));
  const paidOrderCount = numberOrZero(summary?.paidOrderCount);
  const bySource = (summary?.sources as Array<{ source: string; count: number; totalKgs: number }> | undefined ?? []).map(
    (row) => ({ source: row.source, count: numberOrZero(row.count), totalKgs: round(numberOrZero(row.totalKgs)) }),
  );

  return {
    channel,
    created: {
      count: createdCount,
      totalKgs: round(numberOrZero(summary?.createdKgs)),
      discountKgs: round(numberOrZero(summary?.createdDiscountKgs)),
      draft: numberOrZero(summary?.createdDraft),
      confirmed: numberOrZero(summary?.createdConfirmed),
      ready: numberOrZero(summary?.createdReady),
      completed: numberOrZero(summary?.createdCompleted),
      canceled: numberOrZero(summary?.createdCanceled),
      inProgress:
        numberOrZero(summary?.createdDraft) +
        numberOrZero(summary?.createdConfirmed) +
        numberOrZero(summary?.createdReady),
      bySource,
      previous: {
        count: numberOrZero(summary?.prevCreatedCount),
        totalKgs: round(numberOrZero(summary?.prevCreatedKgs)),
        discountKgs: round(numberOrZero(summary?.prevCreatedDiscountKgs)),
      },
    },
    sales: {
      count: completedCount,
      grossKgs: completedGrossKgs,
      discountKgs: round(numberOrZero(summary?.completedDiscountKgs)),
      returnsKgs,
      netKgs: round(completedGrossKgs - returnsKgs),
      averageKgs: completedCount ? round(completedGrossKgs / completedCount) : null,
      returnCount: numberOrZero(summary?.returnCount),
      paidKgs: round(numberOrZero(summary?.paidKgs)),
      paidOrderCount,
      /** True only when at least one recorded payment proves money movement. */
      paymentsKnown: paidOrderCount > 0,
      debtKgs: round(numberOrZero(summary?.debtKgs)),
      previous: {
        count: numberOrZero(summary?.prevCompletedCount),
        grossKgs: round(numberOrZero(summary?.prevCompletedGrossKgs)),
        returnsKgs: round(numberOrZero(summary?.prevReturnsKgs)),
      },
    },
    unknownCreatedCount: numberOrZero(summary?.unknownCreatedCount),
    series,
    items: items.map((row) => ({
      id: row.id,
      number: row.number,
      createdAt: row.createdAt.toISOString(),
      customerName: row.customerName,
      customerEmail: row.customerEmail,
      customerPhone: row.customerPhone,
      storeId: row.storeId,
      storeName: row.storeName,
      source: row.source,
      status: row.status,
      totalKgs: round(numberOrZero(row.totalKgs)),
      discountKgs: round(numberOrZero(row.discountKgs)),
      paidKgs: round(numberOrZero(row.paidKgs)),
      paymentCount: numberOrZero(row.paymentCount),
      returnsKgs: round(numberOrZero(row.returnsKgs)),
      paymentStatus: derivePaymentStatus({
        status: row.status,
        totalKgs: numberOrZero(row.totalKgs),
        paidKgs: numberOrZero(row.paidKgs),
        paymentCount: numberOrZero(row.paymentCount),
        isDebt: Boolean(row.isDebt),
        debtSettledAt: row.debtSettledAt ? row.debtSettledAt.toISOString() : null,
      }),
    })) satisfies OnlineSalesOrderRow[],
    total: numberOrZero(items[0]?.total),
    page: options.exportAll ? 1 : page,
    pageSize,
    period: {
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      fromUtc: period.from,
      toUtcExclusive: period.end,
      effectiveToUtc: period.until,
      timeZone: period.timeZone,
      partial: period.partial,
      comparisonAvailable: period.comparisonAvailable,
      previousDateFrom: businessDateKey(period.previousFrom),
      previousDateTo: businessDateKey(
        new Date(Math.max(period.previousFrom.getTime(), period.previousUntil.getTime() - 1)),
      ),
    },
    meta: {
      generatedAt: period.generatedAt,
      currency: "KGS" as const,
      channel,
      source: input.source ?? "all",
      exportLimit: ONLINE_SALES_EXPORT_LIMIT,
    },
  };
}

export type OnlineSalesReport = Awaited<ReturnType<typeof getOnlineSalesReport>>;
