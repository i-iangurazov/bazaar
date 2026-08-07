import { Prisma, StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";

type ReportRangeInput = {
  organizationId: string;
  storeId?: string;
  storeIds?: string[];
  from: Date;
  to: Date;
  page?: number;
  pageSize?: number;
};

type StockoutRow = {
  storeId: string;
  storeName: string;
  productId: string;
  productName: string;
  productSku: string;
  variantId: string | null;
  variantName: string | null;
  count: number;
  lastAt: Date | null;
  onHand: number;
};

type SlowMoverRow = {
  storeId: string;
  storeName: string;
  productId: string;
  productName: string;
  productSku: string;
  variantId: string | null;
  variantName: string | null;
  lastMovementAt: Date | null;
  onHand: number;
};

type ShrinkageRow = {
  storeId: string;
  storeName: string;
  productId: string;
  productName: string;
  productSku: string;
  variantId: string | null;
  variantName: string | null;
  userId: string | null;
  userName: string | null;
  totalQty: number;
  movementCount: number;
};

type ReportPage<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

type CountedRow = { totalCount: number; pageRowPresent: boolean };

const normalizePagination = (input: ReportRangeInput) => ({
  page: Math.max(1, Math.trunc(input.page ?? 1)),
  pageSize: Math.min(100, Math.max(10, Math.trunc(input.pageSize ?? 25))),
});

const buildStoreScope = (input: ReportRangeInput) => {
  if (input.storeId) {
    return Prisma.sql`AND s.id = ${input.storeId}`;
  }
  if (input.storeIds) {
    return input.storeIds.length ? Prisma.sql`AND s.id IN (${Prisma.join(input.storeIds)})` : null;
  }
  return Prisma.empty;
};

const toPage = <T extends CountedRow>(
  rows: T[],
  page: number,
  pageSize: number,
): ReportPage<Omit<T, keyof CountedRow>> => ({
  items: rows.flatMap(({ totalCount: _totalCount, pageRowPresent, ...row }) =>
    pageRowPresent ? [row] : [],
  ),
  total: rows[0]?.totalCount ?? 0,
  page,
  pageSize,
});

const emptyPage = <T>(page: number, pageSize: number): ReportPage<T> => ({
  items: [],
  total: 0,
  page,
  pageSize,
});

export const getStockoutsReport = async (
  input: ReportRangeInput,
): Promise<ReportPage<StockoutRow>> => {
  const { page, pageSize } = normalizePagination(input);
  const storeScope = buildStoreScope(input);
  if (storeScope === null) {
    return emptyPage(page, pageSize);
  }
  const offset = (page - 1) * pageSize;
  const rows = await prisma.$queryRaw<Array<StockoutRow & CountedRow>>(Prisma.sql`
    WITH scoped_movements AS (
      SELECT
        m.id,
        m."storeId",
        m."productId",
        m."variantId",
        m."qtyDelta",
        m."createdAt",
        COALESCE(snapshot."onHand", 0)::int AS "currentOnHand",
        SUM(m."qtyDelta") OVER (
          PARTITION BY m."storeId", m."productId", m."variantId"
        )::int AS "rangeDelta",
        SUM(m."qtyDelta") OVER (
          PARTITION BY m."storeId", m."productId", m."variantId"
          ORDER BY m."createdAt" ASC, m.id ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )::int AS "cumulativeDelta"
      FROM "StockMovement" m
      INNER JOIN "Store" s ON s.id = m."storeId"
      LEFT JOIN "InventorySnapshot" snapshot
        ON snapshot."storeId" = m."storeId"
        AND snapshot."productId" = m."productId"
        AND snapshot."variantId" IS NOT DISTINCT FROM m."variantId"
      WHERE s."organizationId" = ${input.organizationId}
        ${storeScope}
        AND m."createdAt" >= ${input.from}
        AND m."createdAt" <= ${input.to}
    ), crossings AS (
      SELECT
        *,
        "currentOnHand" - "rangeDelta" + "cumulativeDelta" - "qtyDelta" AS "beforeOnHand",
        "currentOnHand" - "rangeDelta" + "cumulativeDelta" AS "afterOnHand"
      FROM scoped_movements
    ), grouped AS (
      SELECT
        "storeId",
        "productId",
        "variantId",
        COUNT(*)::int AS count,
        MAX("createdAt") AS "lastAt",
        MAX("currentOnHand")::int AS "onHand"
      FROM crossings
      WHERE "beforeOnHand" > 0 AND "afterOnHand" <= 0
      GROUP BY "storeId", "productId", "variantId"
    ), totals AS (
      SELECT COUNT(*)::int AS "totalCount" FROM grouped
    )
    SELECT
      page_rows.*,
      totals."totalCount",
      (page_rows."productId" IS NOT NULL) AS "pageRowPresent"
    FROM totals
    LEFT JOIN LATERAL (
      SELECT
        grouped."storeId",
        s.name AS "storeName",
        grouped."productId",
        p.name AS "productName",
        p.sku AS "productSku",
        grouped."variantId",
        v.name AS "variantName",
        grouped.count,
        grouped."lastAt",
        grouped."onHand"
      FROM grouped
      INNER JOIN "Store" s ON s.id = grouped."storeId"
      INNER JOIN "Product" p ON p.id = grouped."productId"
      LEFT JOIN "ProductVariant" v ON v.id = grouped."variantId"
      ORDER BY grouped."lastAt" DESC NULLS LAST,
        grouped."storeId" ASC,
        grouped."productId" ASC,
        grouped."variantId" ASC NULLS FIRST
      LIMIT ${pageSize}
      OFFSET ${offset}
    ) page_rows ON true
    ORDER BY page_rows."lastAt" DESC NULLS LAST,
      page_rows."storeId" ASC,
      page_rows."productId" ASC,
      page_rows."variantId" ASC NULLS FIRST
  `);
  return toPage(rows, page, pageSize);
};

export const getSlowMoversReport = async (
  input: ReportRangeInput,
): Promise<ReportPage<SlowMoverRow>> => {
  const { page, pageSize } = normalizePagination(input);
  const storeScope = buildStoreScope(input);
  if (storeScope === null) {
    return emptyPage(page, pageSize);
  }
  const offset = (page - 1) * pageSize;
  const rows = await prisma.$queryRaw<Array<SlowMoverRow & CountedRow>>(Prisma.sql`
    WITH last_movements AS (
      SELECT
        m."storeId",
        m."productId",
        m."variantId",
        MAX(m."createdAt") AS "lastMovementAt"
      FROM "StockMovement" m
      INNER JOIN "Store" s ON s.id = m."storeId"
      WHERE s."organizationId" = ${input.organizationId}
        ${storeScope}
        AND m."createdAt" <= ${input.to}
      GROUP BY m."storeId", m."productId", m."variantId"
    ), candidates AS (
      SELECT
        snapshot."storeId",
        snapshot."productId",
        snapshot."variantId",
        snapshot."onHand"::int AS "onHand",
        last_movements."lastMovementAt"
      FROM "InventorySnapshot" snapshot
      INNER JOIN "Store" s ON s.id = snapshot."storeId"
      LEFT JOIN last_movements
        ON last_movements."storeId" = snapshot."storeId"
        AND last_movements."productId" = snapshot."productId"
        AND last_movements."variantId" IS NOT DISTINCT FROM snapshot."variantId"
      WHERE s."organizationId" = ${input.organizationId}
        ${storeScope}
        AND (
          last_movements."lastMovementAt" IS NULL
          OR last_movements."lastMovementAt" < ${input.from}
        )
    ), totals AS (
      SELECT COUNT(*)::int AS "totalCount" FROM candidates
    )
    SELECT
      page_rows.*,
      totals."totalCount",
      (page_rows."productId" IS NOT NULL) AS "pageRowPresent"
    FROM totals
    LEFT JOIN LATERAL (
      SELECT
        candidates."storeId",
        s.name AS "storeName",
        candidates."productId",
        p.name AS "productName",
        p.sku AS "productSku",
        candidates."variantId",
        v.name AS "variantName",
        candidates."lastMovementAt",
        candidates."onHand"
      FROM candidates
      INNER JOIN "Store" s ON s.id = candidates."storeId"
      INNER JOIN "Product" p ON p.id = candidates."productId"
      LEFT JOIN "ProductVariant" v ON v.id = candidates."variantId"
      ORDER BY candidates."lastMovementAt" ASC NULLS FIRST,
        candidates."storeId" ASC,
        candidates."productId" ASC,
        candidates."variantId" ASC NULLS FIRST
      LIMIT ${pageSize}
      OFFSET ${offset}
    ) page_rows ON true
    ORDER BY page_rows."lastMovementAt" ASC NULLS FIRST,
      page_rows."storeId" ASC,
      page_rows."productId" ASC,
      page_rows."variantId" ASC NULLS FIRST
  `);
  return toPage(rows, page, pageSize);
};

export const getShrinkageReport = async (
  input: ReportRangeInput,
): Promise<ReportPage<ShrinkageRow>> => {
  const { page, pageSize } = normalizePagination(input);
  const storeScope = buildStoreScope(input);
  if (storeScope === null) {
    return emptyPage(page, pageSize);
  }
  const offset = (page - 1) * pageSize;
  const rows = await prisma.$queryRaw<Array<ShrinkageRow & CountedRow>>(Prisma.sql`
    WITH grouped AS (
      SELECT
        m."storeId",
        m."productId",
        m."variantId",
        m."createdById" AS "userId",
        ABS(SUM(m."qtyDelta"))::int AS "totalQty",
        COUNT(*)::int AS "movementCount"
      FROM "StockMovement" m
      INNER JOIN "Store" s ON s.id = m."storeId"
      WHERE s."organizationId" = ${input.organizationId}
        ${storeScope}
        AND m.type = ${StockMovementType.ADJUSTMENT}::"StockMovementType"
        AND m."qtyDelta" < 0
        AND m."createdAt" >= ${input.from}
        AND m."createdAt" <= ${input.to}
      GROUP BY m."storeId", m."productId", m."variantId", m."createdById"
    ), totals AS (
      SELECT COUNT(*)::int AS "totalCount" FROM grouped
    )
    SELECT
      page_rows.*,
      totals."totalCount",
      (page_rows."productId" IS NOT NULL) AS "pageRowPresent"
    FROM totals
    LEFT JOIN LATERAL (
      SELECT
        grouped."storeId",
        s.name AS "storeName",
        grouped."productId",
        p.name AS "productName",
        p.sku AS "productSku",
        grouped."variantId",
        v.name AS "variantName",
        grouped."userId",
        COALESCE(u.name, u.email) AS "userName",
        grouped."totalQty",
        grouped."movementCount"
      FROM grouped
      INNER JOIN "Store" s ON s.id = grouped."storeId"
      INNER JOIN "Product" p ON p.id = grouped."productId"
      LEFT JOIN "ProductVariant" v ON v.id = grouped."variantId"
      LEFT JOIN "User" u ON u.id = grouped."userId"
      ORDER BY grouped."totalQty" DESC,
        grouped."storeId" ASC,
        grouped."productId" ASC,
        grouped."variantId" ASC NULLS FIRST,
        grouped."userId" ASC NULLS FIRST
      LIMIT ${pageSize}
      OFFSET ${offset}
    ) page_rows ON true
    ORDER BY page_rows."totalQty" DESC NULLS LAST,
      page_rows."storeId" ASC,
      page_rows."productId" ASC,
      page_rows."variantId" ASC NULLS FIRST,
      page_rows."userId" ASC NULLS FIRST
  `);
  return toPage(rows, page, pageSize);
};
