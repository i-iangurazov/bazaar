import { CustomerOrderStatus, PosPaymentMethod, PosReturnStatus, Prisma } from "@prisma/client";

import { defaultTimeZone } from "@/lib/timezone";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";

const BUSINESS_TIME_ZONE_OFFSET_MINUTES = 6 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

const paymentMethods: PosPaymentMethod[] = [
  PosPaymentMethod.CASH,
  PosPaymentMethod.CARD,
  PosPaymentMethod.TRANSFER,
  PosPaymentMethod.OTHER,
];

export type SalesAnalyticsScope = {
  organizationId: string;
  storeId?: string;
  storeIds?: string[];
  registerId?: string;
  cashierId?: string;
};

export type SalesAnalyticsDateInput = {
  dateFrom: string;
  dateTo: string;
};

export type SalesAnalyticsRange = SalesAnalyticsDateInput & {
  fromUtc: Date;
  toUtcExclusive: Date;
  dayCount: number;
  timeZone: string;
};

type TimedResult<T> = {
  value: T;
  ms: number;
};

const timed = async <T>(loader: () => Promise<T>): Promise<TimedResult<T>> => {
  const startedAt = Date.now();
  const value = await loader();
  return { value, ms: Date.now() - startedAt };
};

const assertDateOnly = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
};

const parseDateOnlyParts = (value: string) => {
  assertDateOnly(value);
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
};

const dateOnlyToUtc = (value: string, extraDays = 0) => {
  const { year, month, day } = parseDateOnlyParts(value);
  return new Date(
    Date.UTC(year, month - 1, day + extraDays, 0, 0, 0, 0) -
      BUSINESS_TIME_ZONE_OFFSET_MINUTES * 60 * 1000,
  );
};

const addDaysToDateOnly = (value: string, days: number) => {
  const { year, month, day } = parseDateOnlyParts(value);
  return new Date(Date.UTC(year, month - 1, day + days, 0, 0, 0, 0)).toISOString().slice(0, 10);
};

const enumerateDateKeys = (dateFrom: string, dateTo: string) => {
  const keys: string[] = [];
  let cursor = dateFrom;
  while (cursor <= dateTo && keys.length <= MAX_RANGE_DAYS) {
    keys.push(cursor);
    cursor = addDaysToDateOnly(cursor, 1);
  }
  return keys;
};

export const resolveSalesAnalyticsDateRange = (
  input: SalesAnalyticsDateInput,
): SalesAnalyticsRange => {
  assertDateOnly(input.dateFrom);
  assertDateOnly(input.dateTo);
  if (input.dateFrom > input.dateTo) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  const fromUtc = dateOnlyToUtc(input.dateFrom);
  const toUtcExclusive = dateOnlyToUtc(input.dateTo, 1);
  const dayCount = Math.ceil((toUtcExclusive.getTime() - fromUtc.getTime()) / DAY_MS);
  if (dayCount < 1 || dayCount > MAX_RANGE_DAYS) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  return {
    ...input,
    fromUtc,
    toUtcExclusive,
    dayCount,
    timeZone: defaultTimeZone,
  };
};

const emptyPaymentBreakdown = () =>
  paymentMethods.reduce(
    (acc, method) => {
      acc[method] = 0;
      return acc;
    },
    {} as Record<PosPaymentMethod, number>,
  );

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const buildOrderScopeFilter = (scope: SalesAnalyticsScope) => {
  const filters: Prisma.Sql[] = [
    Prisma.sql`o."organizationId" = ${scope.organizationId}`,
    Prisma.sql`o."isPosSale" = true`,
    Prisma.sql`o."isHeld" = false`,
    Prisma.sql`o."status" = ${CustomerOrderStatus.COMPLETED}::"CustomerOrderStatus"`,
    Prisma.sql`o."completedAt" IS NOT NULL`,
  ];
  if (scope.storeId) {
    filters.push(Prisma.sql`o."storeId" = ${scope.storeId}`);
  } else if (scope.storeIds) {
    filters.push(Prisma.sql`o."storeId" IN (${Prisma.join(scope.storeIds)})`);
  }
  if (scope.registerId) {
    filters.push(Prisma.sql`o."registerId" = ${scope.registerId}`);
  }
  if (scope.cashierId) {
    filters.push(Prisma.sql`o."createdById" = ${scope.cashierId}`);
  }
  return Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`;
};

const buildReturnScopeFilter = (scope: SalesAnalyticsScope) => {
  const filters: Prisma.Sql[] = [
    Prisma.sql`r."organizationId" = ${scope.organizationId}`,
    Prisma.sql`r."status" = ${PosReturnStatus.COMPLETED}::"PosReturnStatus"`,
    Prisma.sql`r."completedAt" IS NOT NULL`,
  ];
  if (scope.storeId) {
    filters.push(Prisma.sql`r."storeId" = ${scope.storeId}`);
  } else if (scope.storeIds) {
    filters.push(Prisma.sql`r."storeId" IN (${Prisma.join(scope.storeIds)})`);
  }
  if (scope.registerId) {
    filters.push(Prisma.sql`r."registerId" = ${scope.registerId}`);
  }
  if (scope.cashierId) {
    filters.push(Prisma.sql`COALESCE(r."completedById", r."createdById") = ${scope.cashierId}`);
  }
  return Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`;
};

const localDaySql = (field: Prisma.Sql) =>
  Prisma.sql`to_char((${field} + (${BUSINESS_TIME_ZONE_OFFSET_MINUTES} * interval '1 minute')), 'YYYY-MM-DD')`;

const buildProductFilterSql = (input: { search?: string; category?: string }) => {
  const filters: Prisma.Sql[] = [];
  const search = input.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    filters.push(Prisma.sql`(
      p."name" ILIKE ${pattern}
      OR p."sku" ILIKE ${pattern}
      OR v."sku" ILIKE ${pattern}
      OR b."value" ILIKE ${pattern}
    )`);
  }
  if (input.category?.trim()) {
    const category = input.category.trim();
    filters.push(Prisma.sql`(p."category" = ${category} OR ${category} = ANY(p."categories"))`);
  }
  return filters.length ? Prisma.sql`AND ${Prisma.join(filters, " AND ")}` : Prisma.empty;
};

const noRows = (scope: SalesAnalyticsScope) => scope.storeIds && scope.storeIds.length === 0;

export const getSalesAnalyticsOverview = async (
  input: SalesAnalyticsScope & SalesAnalyticsDateInput,
) => {
  if (noRows(input)) {
    return emptySalesAnalyticsOverview(input);
  }
  const range = resolveSalesAnalyticsDateRange(input);
  const orderScope = buildOrderScopeFilter(input);
  const returnScope = buildReturnScopeFilter(input);

  const [salesByDay, returnsByDay, salesPayments, refundPayments] = await Promise.all([
    timed(() =>
      prisma.$queryRaw<
        Array<{
          date: string;
          receiptCount: number;
          grossSalesKgs: string | number | null;
          discountKgs: string | number | null;
        }>
      >(Prisma.sql`
        SELECT ${localDaySql(Prisma.sql`o."completedAt"`)} AS "date",
               COUNT(*)::int AS "receiptCount",
               SUM(o."totalKgs") AS "grossSalesKgs",
               SUM(o."discountKgs") AS "discountKgs"
        FROM "CustomerOrder" o
        ${orderScope}
          AND o."completedAt" >= ${range.fromUtc}
          AND o."completedAt" < ${range.toUtcExclusive}
        GROUP BY "date"
        ORDER BY "date"
      `),
    ),
    timed(() =>
      prisma.$queryRaw<
        Array<{ date: string; returnCount: number; returnsKgs: string | number | null }>
      >(Prisma.sql`
        SELECT ${localDaySql(Prisma.sql`r."completedAt"`)} AS "date",
               COUNT(*)::int AS "returnCount",
               SUM(r."totalKgs") AS "returnsKgs"
        FROM "SaleReturn" r
        ${returnScope}
          AND r."completedAt" >= ${range.fromUtc}
          AND r."completedAt" < ${range.toUtcExclusive}
        GROUP BY "date"
        ORDER BY "date"
      `),
    ),
    timed(() =>
      prisma.salePayment.groupBy({
        by: ["method"],
        where: {
          organizationId: input.organizationId,
          isRefund: false,
          customerOrder: {
            isPosSale: true,
            isHeld: false,
            status: CustomerOrderStatus.COMPLETED,
            completedAt: { gte: range.fromUtc, lt: range.toUtcExclusive },
            ...(input.storeId
              ? { storeId: input.storeId }
              : input.storeIds
                ? { storeId: { in: input.storeIds } }
                : {}),
            ...(input.registerId ? { registerId: input.registerId } : {}),
            ...(input.cashierId ? { createdById: input.cashierId } : {}),
          },
        },
        _sum: { amountKgs: true },
      }),
    ),
    timed(() =>
      prisma.salePayment.groupBy({
        by: ["method"],
        where: {
          organizationId: input.organizationId,
          isRefund: true,
          saleReturn: {
            status: PosReturnStatus.COMPLETED,
            completedAt: { gte: range.fromUtc, lt: range.toUtcExclusive },
            ...(input.storeId
              ? { storeId: input.storeId }
              : input.storeIds
                ? { storeId: { in: input.storeIds } }
                : {}),
            ...(input.registerId ? { registerId: input.registerId } : {}),
            ...(input.cashierId
              ? { OR: [{ completedById: input.cashierId }, { createdById: input.cashierId }] }
              : {}),
          },
        },
        _sum: { amountKgs: true },
      }),
    ),
  ]);

  const salesMap = new Map(salesByDay.value.map((row) => [row.date, row]));
  const returnsMap = new Map(returnsByDay.value.map((row) => [row.date, row]));

  const series = enumerateDateKeys(range.dateFrom, range.dateTo).map((date) => {
    const sales = salesMap.get(date);
    const returns = returnsMap.get(date);
    const grossSalesKgs = Number(sales?.grossSalesKgs ?? 0);
    const returnsKgs = Number(returns?.returnsKgs ?? 0);
    const receiptCount = Number(sales?.receiptCount ?? 0);
    return {
      date,
      grossSalesKgs: roundMoney(grossSalesKgs),
      returnsKgs: roundMoney(returnsKgs),
      netSalesKgs: roundMoney(grossSalesKgs - returnsKgs),
      receiptCount,
      returnCount: Number(returns?.returnCount ?? 0),
      averageReceiptKgs: receiptCount ? roundMoney(grossSalesKgs / receiptCount) : 0,
      discountKgs: roundMoney(Number(sales?.discountKgs ?? 0)),
    };
  });

  const paymentBreakdown = emptyPaymentBreakdown();
  for (const row of salesPayments.value) {
    paymentBreakdown[row.method] = roundMoney(Number(row._sum.amountKgs ?? 0));
  }
  const refundBreakdown = emptyPaymentBreakdown();
  for (const row of refundPayments.value) {
    refundBreakdown[row.method] = roundMoney(Number(row._sum.amountKgs ?? 0));
  }

  const grossSalesKgs = roundMoney(series.reduce((sum, row) => sum + row.grossSalesKgs, 0));
  const returnsKgs = roundMoney(series.reduce((sum, row) => sum + row.returnsKgs, 0));
  const receiptCount = series.reduce((sum, row) => sum + row.receiptCount, 0);
  const returnCount = series.reduce((sum, row) => sum + row.returnCount, 0);

  return {
    range,
    series,
    totals: {
      grossSalesKgs,
      returnsKgs,
      netSalesKgs: roundMoney(grossSalesKgs - returnsKgs),
      receiptCount,
      returnCount,
      averageReceiptKgs: receiptCount ? roundMoney(grossSalesKgs / receiptCount) : 0,
      discountKgs: roundMoney(series.reduce((sum, row) => sum + row.discountKgs, 0)),
      paymentBreakdown,
      refundBreakdown,
      cashSalesKgs: paymentBreakdown.CASH,
      nonCashSalesKgs: roundMoney(paymentBreakdown.CARD + paymentBreakdown.TRANSFER + paymentBreakdown.OTHER),
    },
    meta: {
      dataPolicy: {
        saleStatus: CustomerOrderStatus.COMPLETED,
        excludesHeld: true,
        returnsHandling: "completed_returns_subtracted_from_net_sales",
        paymentHandling: "split_payments_sum_by_payment_rows",
        dateField: "completedAt",
        timeZone: defaultTimeZone,
      },
      timingsMs: {
        salesByDay: salesByDay.ms,
        returnsByDay: returnsByDay.ms,
        salesPayments: salesPayments.ms,
        refundPayments: refundPayments.ms,
      },
    },
  };
};

const emptySalesAnalyticsOverview = (input: SalesAnalyticsDateInput) => {
  const range = resolveSalesAnalyticsDateRange(input);
  return {
    range,
    series: enumerateDateKeys(range.dateFrom, range.dateTo).map((date) => ({
      date,
      grossSalesKgs: 0,
      returnsKgs: 0,
      netSalesKgs: 0,
      receiptCount: 0,
      returnCount: 0,
      averageReceiptKgs: 0,
      discountKgs: 0,
    })),
    totals: {
      grossSalesKgs: 0,
      returnsKgs: 0,
      netSalesKgs: 0,
      receiptCount: 0,
      returnCount: 0,
      averageReceiptKgs: 0,
      discountKgs: 0,
      paymentBreakdown: emptyPaymentBreakdown(),
      refundBreakdown: emptyPaymentBreakdown(),
      cashSalesKgs: 0,
      nonCashSalesKgs: 0,
    },
    meta: {
      dataPolicy: {
        saleStatus: CustomerOrderStatus.COMPLETED,
        excludesHeld: true,
        returnsHandling: "completed_returns_subtracted_from_net_sales",
        paymentHandling: "split_payments_sum_by_payment_rows",
        dateField: "completedAt",
        timeZone: defaultTimeZone,
      },
      timingsMs: {},
    },
  };
};

export const getSalesAnalyticsFilterOptions = async (
  input: SalesAnalyticsScope & SalesAnalyticsDateInput,
) => {
  if (noRows(input)) {
    return { categories: [] as string[] };
  }
  const range = resolveSalesAnalyticsDateRange(input);
  const orderScope = buildOrderScopeFilter(input);
  const rows = await prisma.$queryRaw<Array<{ category: string }>>(Prisma.sql`
    SELECT DISTINCT category
    FROM (
      SELECT NULLIF(TRIM(p."category"), '') AS category
      FROM "CustomerOrderLine" l
      JOIN "CustomerOrder" o ON o.id = l."customerOrderId"
      JOIN "Product" p ON p.id = l."productId"
      ${orderScope}
        AND o."completedAt" >= ${range.fromUtc}
        AND o."completedAt" < ${range.toUtcExclusive}
      UNION
      SELECT NULLIF(TRIM(category_value), '') AS category
      FROM "CustomerOrderLine" l
      JOIN "CustomerOrder" o ON o.id = l."customerOrderId"
      JOIN "Product" p ON p.id = l."productId"
      CROSS JOIN LATERAL unnest(p."categories") AS category_value
      ${orderScope}
        AND o."completedAt" >= ${range.fromUtc}
        AND o."completedAt" < ${range.toUtcExclusive}
    ) categories
    WHERE category IS NOT NULL
    ORDER BY category
    LIMIT 100
  `);
  return { categories: rows.map((row) => row.category) };
};

export const getSoldProductsAnalytics = async (
  input: SalesAnalyticsScope &
    SalesAnalyticsDateInput & {
      category?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    },
) => {
  if (noRows(input)) {
    return { items: [], total: 0, page: input.page ?? 1, pageSize: input.pageSize ?? 25, meta: { timingsMs: {} } };
  }
  const range = resolveSalesAnalyticsDateRange(input);
  const page = input.page ?? 1;
  const pageSize = Math.min(Math.max(input.pageSize ?? 25, 1), 100);
  const offset = (page - 1) * pageSize;
  const orderScope = buildOrderScopeFilter(input);
  const returnScope = buildReturnScopeFilter(input);
  const productFilter = buildProductFilterSql(input);

  const [salesRows, totalRows] = await Promise.all([
    timed(() =>
      prisma.$queryRaw<
        Array<{
          productId: string;
          variantId: string | null;
          variantKey: string;
          productName: string;
          productSku: string;
          variantName: string | null;
          variantSku: string | null;
          barcode: string | null;
          category: string | null;
          quantitySold: number;
          grossRevenueKgs: string | number | null;
          receiptCount: number;
        }>
      >(Prisma.sql`
        SELECT l."productId" AS "productId",
               l."variantId" AS "variantId",
               l."variantKey" AS "variantKey",
               p."name" AS "productName",
               p."sku" AS "productSku",
               v."name" AS "variantName",
               v."sku" AS "variantSku",
               b."value" AS "barcode",
               COALESCE(p."categories"[1], p."category") AS "category",
               SUM(l."qty")::int AS "quantitySold",
               SUM(l."lineTotalKgs") AS "grossRevenueKgs",
               COUNT(DISTINCT o.id)::int AS "receiptCount"
        FROM "CustomerOrderLine" l
        JOIN "CustomerOrder" o ON o.id = l."customerOrderId"
        JOIN "Product" p ON p.id = l."productId"
        LEFT JOIN "ProductVariant" v ON v.id = l."variantId"
        LEFT JOIN LATERAL (
          SELECT pb."value"
          FROM "ProductBarcode" pb
          WHERE pb."productId" = p.id
          ORDER BY pb."createdAt" ASC
          LIMIT 1
        ) b ON true
        ${orderScope}
          AND o."completedAt" >= ${range.fromUtc}
          AND o."completedAt" < ${range.toUtcExclusive}
          ${productFilter}
        GROUP BY l."productId", l."variantId", l."variantKey", p."name", p."sku", v."name", v."sku", b."value", p."categories", p."category"
        ORDER BY SUM(l."lineTotalKgs") DESC, SUM(l."qty") DESC, p."name" ASC
        LIMIT ${pageSize}
        OFFSET ${offset}
      `),
    ),
    timed(() =>
      prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS total
        FROM (
          SELECT l."productId", l."variantKey"
          FROM "CustomerOrderLine" l
          JOIN "CustomerOrder" o ON o.id = l."customerOrderId"
          JOIN "Product" p ON p.id = l."productId"
          LEFT JOIN "ProductVariant" v ON v.id = l."variantId"
          LEFT JOIN LATERAL (
            SELECT pb."value"
            FROM "ProductBarcode" pb
            WHERE pb."productId" = p.id
            ORDER BY pb."createdAt" ASC
            LIMIT 1
          ) b ON true
          ${orderScope}
            AND o."completedAt" >= ${range.fromUtc}
            AND o."completedAt" < ${range.toUtcExclusive}
            ${productFilter}
          GROUP BY l."productId", l."variantKey"
        ) grouped
      `),
    ),
  ]);

  const productKeys = salesRows.value.map((row) => ({
    productId: row.productId,
    variantKey: row.variantKey,
  }));

  const returnsRows = productKeys.length
    ? await timed(() =>
        prisma.$queryRaw<
          Array<{
            productId: string;
            variantKey: string;
            quantityReturned: number;
            returnedRevenueKgs: string | number | null;
          }>
        >(Prisma.sql`
          SELECT rl."productId" AS "productId",
                 rl."variantKey" AS "variantKey",
                 SUM(rl."qty")::int AS "quantityReturned",
                 SUM(rl."lineTotalKgs") AS "returnedRevenueKgs"
          FROM "SaleReturnLine" rl
          JOIN "SaleReturn" r ON r.id = rl."saleReturnId"
          ${returnScope}
            AND r."completedAt" >= ${range.fromUtc}
            AND r."completedAt" < ${range.toUtcExclusive}
            AND (rl."productId", rl."variantKey") IN (${Prisma.join(
              productKeys.map((row) => Prisma.sql`(${row.productId}, ${row.variantKey})`),
            )})
          GROUP BY rl."productId", rl."variantKey"
        `),
      )
    : { value: [], ms: 0 };

  const stockRows = productKeys.length
    ? await timed(() =>
        prisma.inventorySnapshot.groupBy({
          by: ["productId", "variantKey"],
          where: {
            OR: productKeys.map((row) => ({ productId: row.productId, variantKey: row.variantKey })),
            ...(input.storeId
              ? { storeId: input.storeId }
              : input.storeIds
                ? { storeId: { in: input.storeIds } }
                : {}),
          },
          _sum: { onHand: true },
        }),
      )
    : { value: [], ms: 0 };

  const returnsMap = new Map(
    returnsRows.value.map((row) => [
      `${row.productId}:${row.variantKey}`,
      {
        quantityReturned: Number(row.quantityReturned ?? 0),
        returnedRevenueKgs: Number(row.returnedRevenueKgs ?? 0),
      },
    ]),
  );
  const stockMap = new Map(
    stockRows.value.map((row) => [`${row.productId}:${row.variantKey}`, row._sum.onHand ?? 0]),
  );

  const items = salesRows.value.map((row) => {
    const key = `${row.productId}:${row.variantKey}`;
    const returned = returnsMap.get(key) ?? { quantityReturned: 0, returnedRevenueKgs: 0 };
    const quantitySold = Number(row.quantitySold ?? 0);
    const grossRevenueKgs = Number(row.grossRevenueKgs ?? 0);
    const netQuantity = quantitySold - returned.quantityReturned;
    const netRevenueKgs = grossRevenueKgs - returned.returnedRevenueKgs;
    return {
      productId: row.productId,
      variantId: row.variantId,
      variantKey: row.variantKey,
      productName: row.productName,
      productSku: row.variantSku ?? row.productSku,
      baseSku: row.productSku,
      variantName: row.variantName,
      barcode: row.barcode,
      category: row.category,
      quantitySold,
      quantityReturned: returned.quantityReturned,
      netQuantity,
      grossRevenueKgs: roundMoney(grossRevenueKgs),
      returnedRevenueKgs: roundMoney(returned.returnedRevenueKgs),
      netRevenueKgs: roundMoney(netRevenueKgs),
      averagePriceKgs: quantitySold ? roundMoney(grossRevenueKgs / quantitySold) : 0,
      stockRemaining: stockMap.get(key) ?? 0,
      receiptCount: Number(row.receiptCount ?? 0),
    };
  });

  return {
    items,
    total: Number(totalRows.value[0]?.total ?? 0),
    page,
    pageSize,
    meta: {
      timingsMs: {
        salesProducts: salesRows.ms,
        productCount: totalRows.ms,
        productReturns: returnsRows.ms,
        stockRemaining: stockRows.ms,
      },
    },
  };
};

const mapReceipt = (item: {
  id: string;
  number: string;
  completedAt: Date | null;
  createdAt: Date;
  totalKgs: Prisma.Decimal | number;
  discountKgs: Prisma.Decimal | number;
  customerName: string | null;
  customerPhone: string | null;
  store: { id: string; name: string; code: string; currencyCode: string; currencyRateKgsPerUnit: Prisma.Decimal };
  register: { id: string; name: string; code: string } | null;
  createdBy: { id: string; name: string | null; email: string } | null;
  payments: Array<{ method: PosPaymentMethod; amountKgs: Prisma.Decimal | number; isRefund: boolean }>;
}) => {
  const paymentBreakdown = emptyPaymentBreakdown();
  for (const payment of item.payments) {
    if (!payment.isRefund) {
      paymentBreakdown[payment.method] = roundMoney(
        paymentBreakdown[payment.method] + Number(payment.amountKgs ?? 0),
      );
    }
  }
  return {
    id: item.id,
    number: item.number,
    completedAt: item.completedAt,
    createdAt: item.createdAt,
    totalKgs: Number(item.totalKgs ?? 0),
    discountKgs: Number(item.discountKgs ?? 0),
    customerName: item.customerName,
    customerPhone: item.customerPhone,
    store: item.store,
    register: item.register,
    cashier: item.createdBy,
    paymentBreakdown,
  };
};

export const listSalesAnalyticsReceipts = async (
  input: SalesAnalyticsScope &
    SalesAnalyticsDateInput & {
      productId?: string;
      variantKey?: string;
      page?: number;
      pageSize?: number;
    },
) => {
  if (noRows(input)) {
    return { items: [], total: 0, page: input.page ?? 1, pageSize: input.pageSize ?? 25 };
  }
  const range = resolveSalesAnalyticsDateRange(input);
  const page = input.page ?? 1;
  const pageSize = Math.min(Math.max(input.pageSize ?? 25, 1), 100);
  const where: Prisma.CustomerOrderWhereInput = {
    organizationId: input.organizationId,
    isPosSale: true,
    isHeld: false,
    status: CustomerOrderStatus.COMPLETED,
    completedAt: { gte: range.fromUtc, lt: range.toUtcExclusive },
    ...(input.storeId ? { storeId: input.storeId } : input.storeIds ? { storeId: { in: input.storeIds } } : {}),
    ...(input.registerId ? { registerId: input.registerId } : {}),
    ...(input.cashierId ? { createdById: input.cashierId } : {}),
    ...(input.productId
      ? {
          lines: {
            some: {
              productId: input.productId,
              ...(input.variantKey ? { variantKey: input.variantKey } : {}),
            },
          },
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.customerOrder.count({ where }),
    prisma.customerOrder.findMany({
      where,
      select: {
        id: true,
        number: true,
        completedAt: true,
        createdAt: true,
        totalKgs: true,
        discountKgs: true,
        customerName: true,
        customerPhone: true,
        store: {
          select: {
            id: true,
            name: true,
            code: true,
            currencyCode: true,
            currencyRateKgsPerUnit: true,
          },
        },
        register: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        payments: {
          select: { method: true, amountKgs: true, isRefund: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { completedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items: items.map(mapReceipt),
    total,
    page,
    pageSize,
  };
};

export const getSalesAnalyticsDayDetail = async (
  input: SalesAnalyticsScope & {
    date: string;
  },
) => {
  const products = await getSoldProductsAnalytics({
    ...input,
    dateFrom: input.date,
    dateTo: input.date,
    page: 1,
    pageSize: 100,
  });
  const receipts = await listSalesAnalyticsReceipts({
    ...input,
    dateFrom: input.date,
    dateTo: input.date,
    page: 1,
    pageSize: 100,
  });
  const overview = await getSalesAnalyticsOverview({
    ...input,
    dateFrom: input.date,
    dateTo: input.date,
  });
  return {
    date: input.date,
    summary: overview.series[0] ?? null,
    products: products.items,
    receipts: receipts.items,
    meta: {
      timingsMs: {
        overview: Object.values(overview.meta.timingsMs).reduce((sum, value) => sum + value, 0),
        products: Object.values(products.meta.timingsMs).reduce((sum, value) => sum + value, 0),
      },
    },
  };
};
