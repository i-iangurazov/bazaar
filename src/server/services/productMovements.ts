import { Prisma, type PrismaClient } from "@prisma/client";

import { parseWriteOffMovementNote } from "@/lib/inventory/writeOff";
import { transferCancellationLinePosition } from "@/lib/inventory/transferCancellation";
import { resolveProductMovementDocumentViewTarget } from "@/lib/productMovementDocumentTarget";
import { buildCustomerListWhere } from "@/server/services/customers";
import { AppError } from "@/server/services/errors";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import {
  resolveAccessibleStoreIds,
  userHasAllStoreAccess,
  type StoreAccessUser,
} from "@/server/services/storeAccess";

export const productMovementDocumentTypes = [
  "SALE",
  "RETURN",
  "STOCK_RECEIVING",
  "PURCHASE_ORDER",
  "STOCK_COUNT",
  "TRANSFER",
  "WRITE_OFF",
  "ADJUSTMENT",
  "RECEIVE",
  "IMPORT",
  "BUNDLE_ASSEMBLY",
  "STORE_CLONE",
  "PRODUCT",
  "OTHER",
] as const;

export const productMovementPaymentStatuses = [
  "PAID",
  "PARTIAL",
  "UNPAID",
  "REFUNDED",
  "NOT_APPLICABLE",
] as const;

export const productMovementArchiveModes = ["ACTIVE", "ARCHIVED", "ALL"] as const;

export const productMovementSortKeys = [
  "date",
  "type",
  "status",
  "amount",
  "positions",
  "author",
  "store",
] as const;

export type ProductMovementDocumentType = (typeof productMovementDocumentTypes)[number];
export type ProductMovementPaymentStatus = (typeof productMovementPaymentStatuses)[number];
export type ProductMovementArchiveMode = (typeof productMovementArchiveModes)[number];
export type ProductMovementSortKey = (typeof productMovementSortKeys)[number];

export type ProductMovementJournalInput = {
  search?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  type?: ProductMovementDocumentType | null;
  status?: string | null;
  paymentStatus?: ProductMovementPaymentStatus | null;
  orderStatus?: string | null;
  storeId?: string | null;
  authorId?: string | null;
  authorSearch?: string | null;
  senderSearch?: string | null;
  recipientSearch?: string | null;
  includePendingSales?: boolean;
  archiveMode?: ProductMovementArchiveMode | null;
  page?: number;
  pageSize?: number;
  sortBy?: ProductMovementSortKey;
  sortDirection?: "asc" | "desc";
};

export type ProductMovementJournalRow = {
  id: string;
  documentId: string;
  documentType: ProductMovementDocumentType;
  documentNumber: string | null;
  isPosSale: boolean | null;
  documentLabel: string;
  organizationName: string | null;
  createdAt: Date;
  postedAt: Date | null;
  status: string;
  paymentStatus: ProductMovementPaymentStatus;
  orderStatus: string | null;
  senderName: string | null;
  recipientName: string | null;
  customerName: string | null;
  storeName: string | null;
  authorName: string | null;
  authorEmail: string | null;
  positionsCount: number;
  totalQuantity: number;
  totalAmount: number | null;
  paidAmount: number | null;
  reason: string | null;
  comment: string | null;
  description: string | null;
  detailUrl: string | null;
};

export type ProductMovementDocumentLine = {
  id: string;
  productId: string;
  variantId: string | null;
  storeId: string;
  productDetailUrl: string;
  storeName: string;
  productName: string;
  sku: string | null;
  barcode: string | null;
  unit: string | null;
  variantName: string | null;
  movementType: string;
  qtyDelta: number;
  linePosition: number | null;
  unitCostKgs: number | null;
  lineTotalKgs: number | null;
  note: string | null;
  createdAt: Date;
  authorName: string | null;
  authorEmail: string | null;
};

export type ProductMovementDocumentDetail = ProductMovementJournalRow & {
  sourceStoreId: string | null;
  destinationStoreId: string | null;
  lines: ProductMovementDocumentLine[];
  movementHistory?: ProductMovementDocumentLine[];
};

export type ProductMovementJournalResult = {
  items: ProductMovementJournalRow[];
  total: number;
  page: number;
  pageSize: number;
};

type ProductMovementJournalSqlRow = {
  id: string;
  documentId: string;
  documentType: ProductMovementDocumentType;
  documentReferenceType: string;
  documentReferenceId: string;
  documentNumber: string | null;
  isPosSale: boolean | null;
  linkedCustomerOrderId: string | null;
  linkedCustomerOrderIsPosSale: boolean | null;
  sourceExists: boolean;
  organizationName: string | null;
  createdAt: Date;
  postedAt: Date | null;
  status: string;
  paymentStatus: ProductMovementPaymentStatus;
  orderStatus: string | null;
  senderName: string | null;
  recipientName: string | null;
  storeName: string | null;
  authorName: string | null;
  authorEmail: string | null;
  positionsCount: number | bigint;
  totalQuantity: number | bigint;
  totalAmount: Prisma.Decimal | number | string | null;
  paidAmount: Prisma.Decimal | number | string | null;
  comment: string | null;
  description: string | null;
  detailUrl: string | null;
  isArchived?: boolean;
  groupedTotalCount?: number | bigint | null;
  totalCount?: number | bigint;
};

type ProductMovementDocumentLineSqlRow = {
  id: string;
  productId: string;
  variantId: string | null;
  storeId: string;
  storeName: string;
  productName: string;
  sku: string | null;
  barcode: string | null;
  unit: string | null;
  variantName: string | null;
  movementType: string;
  qtyDelta: number | bigint;
  linePosition: number | null;
  unitCostKgs: Prisma.Decimal | number | string | null;
  lineTotalKgs: Prisma.Decimal | number | string | null;
  note: string | null;
  createdAt: Date;
  authorName: string | null;
  authorEmail: string | null;
};

const documentTypeFallbackLabels: Record<ProductMovementDocumentType, string> = {
  SALE: "Sale",
  RETURN: "Return",
  STOCK_RECEIVING: "Stock receiving",
  PURCHASE_ORDER: "Purchase order",
  STOCK_COUNT: "Inventory count",
  TRANSFER: "Transfer",
  WRITE_OFF: "Write-off",
  ADJUSTMENT: "Adjustment",
  RECEIVE: "Receiving",
  IMPORT: "Import",
  BUNDLE_ASSEMBLY: "Bundle assembly",
  STORE_CLONE: "Store clone",
  PRODUCT: "Product stock",
  OTHER: "Document",
};

const normalizeSearchTokens = (value?: string | null) =>
  Array.from(
    new Set(
      (value ?? "")
        .trim()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  ).slice(0, 8);

const escapeLikeText = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const parseDateBound = (value: string | null | undefined, endOfDay: boolean) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    date.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  }
  return date;
};

const toNumberOrNull = (value: Prisma.Decimal | number | string | null) => {
  if (value === null) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

const editableStockDocumentTypes = new Set(["STOCK_RECEIVING", "TRANSFER", "WRITE_OFF"]);
const stockDocumentArchiveReferenceType = "STOCK_DOCUMENT_ARCHIVE";
const stockReceivingArchiveReferenceType = "STOCK_RECEIVING_ARCHIVE";

const isEditableStockDocumentType = (
  value: string,
): value is "STOCK_RECEIVING" | "TRANSFER" | "WRITE_OFF" => editableStockDocumentTypes.has(value);

const getEffectiveMovementType = (documentType: "STOCK_RECEIVING" | "TRANSFER" | "WRITE_OFF") => {
  switch (documentType) {
    case "STOCK_RECEIVING":
      return "RECEIVE";
    case "TRANSFER":
      return "TRANSFER_OUT";
    case "WRITE_OFF":
      return "WRITE_OFF";
  }
};

export const encodeProductMovementDocumentKey = (input: {
  documentType: ProductMovementDocumentType | string;
  documentReferenceType: string;
  documentReferenceId: string;
}) => `${input.documentType}:${input.documentReferenceType}:${input.documentReferenceId}`;

export const decodeProductMovementDocumentKey = (key: string) => {
  const [documentType, documentReferenceType, ...referenceParts] = key.split(":");
  const documentReferenceId = referenceParts.join(":");
  if (!documentType || !documentReferenceType || !documentReferenceId) {
    return null;
  }
  return {
    documentType,
    documentReferenceType,
    documentReferenceId,
  };
};

export const getProductMovementDetailUrl = (input: {
  id: string;
  documentType: ProductMovementDocumentType | string;
  documentReferenceType: string;
  documentReferenceId: string;
  isPosSale?: boolean | null;
  sourceExists?: boolean;
  linkedCustomerOrderId?: string | null;
  linkedCustomerOrderIsPosSale?: boolean | null;
}) => resolveProductMovementDocumentViewTarget(input).href;

const buildProductMovementDocumentLabel = (input: {
  documentType: ProductMovementDocumentType;
  documentNumber?: string | null;
  documentId: string;
}) => {
  const number =
    normalizeProductMovementDocumentNumber(input.documentNumber, input.documentId) ??
    buildShortProductMovementDocumentReference(input.documentId);
  return `${documentTypeFallbackLabels[input.documentType] ?? documentTypeFallbackLabels.OTHER} #${number}`;
};

const uuidLikePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const buildShortProductMovementDocumentReference = (documentId: string) =>
  documentId
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toUpperCase() || documentId.slice(0, 8);

const normalizeProductMovementDocumentNumber = (
  documentNumber: string | null | undefined,
  documentId: string,
) => {
  const trimmed = documentNumber?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === documentId && uuidLikePattern.test(documentId)) {
    return null;
  }
  return trimmed;
};

const buildMovementDocumentTypeSql = (referenceTypeSql: Prisma.Sql, movementTypeSql: Prisma.Sql) =>
  Prisma.sql`
    CASE
      WHEN ${referenceTypeSql} = 'CustomerOrder' THEN 'SALE'
      WHEN ${referenceTypeSql} = 'SaleReturn' THEN 'RETURN'
      WHEN ${referenceTypeSql} = 'STOCK_RECEIVING' THEN 'STOCK_RECEIVING'
      WHEN ${referenceTypeSql} = 'PURCHASE_ORDER' THEN 'PURCHASE_ORDER'
      WHEN ${referenceTypeSql} = 'STOCK_COUNT' THEN 'STOCK_COUNT'
      WHEN ${referenceTypeSql} = 'TRANSFER' THEN 'TRANSFER'
      WHEN ${referenceTypeSql} = 'WRITE_OFF' THEN 'WRITE_OFF'
      WHEN ${referenceTypeSql} IN ('IMPORT', 'IMPORT_ROLLBACK') THEN 'IMPORT'
      WHEN ${referenceTypeSql} = 'BUNDLE_ASSEMBLY' THEN 'BUNDLE_ASSEMBLY'
      WHEN ${referenceTypeSql} = 'STORE_CLONE' THEN 'STORE_CLONE'
      WHEN ${referenceTypeSql} IN ('Product', 'ProductVariant') THEN 'PRODUCT'
      WHEN ${movementTypeSql} IN ('TRANSFER_IN', 'TRANSFER_OUT') THEN 'TRANSFER'
      WHEN ${movementTypeSql} IN ('RECEIVE', 'SALE', 'RETURN', 'ADJUSTMENT', 'WRITE_OFF') THEN ${movementTypeSql}
      ELSE 'OTHER'
    END
  `;

const customerSnapshotNameSql = (order: Prisma.Sql) => Prisma.sql`COALESCE(
  NULLIF(BTRIM(${order}."customerName"), ''), NULLIF(BTRIM(${order}."debtCustomerName"), '')
)`;

const buildProductMovementJournalCte = (input: {
  baseWhereSql: Prisma.Sql;
  organizationId: string;
  documentPageSql?: Prisma.Sql;
  archiveReferenceScopeSql?: Prisma.Sql;
  pendingSalesWhereSql?: Prisma.Sql;
}) => Prisma.sql`
  WITH movement_base AS (
    SELECT
      m."id",
      m."storeId",
      m."productId",
      m."variantId",
      m."type"::text AS "movementType",
      m."qtyDelta",
      m."linePosition",
      m."unitCostKgs",
      m."lineTotalKgs",
      m."referenceType",
      m."referenceId",
      m."note",
      m."createdAt",
      m."createdById",
      s."name" AS "storeName",
      o."name" AS "organizationName",
      p."name" AS "productName",
      u."name" AS "authorName",
      u."email" AS "authorEmail",
      ${buildMovementDocumentTypeSql(
        Prisma.sql`m."referenceType"`,
        Prisma.sql`m."type"::text`,
      )} AS "documentType",
      COALESCE(m."referenceType", 'StockMovement') AS "documentReferenceType",
      COALESCE(m."referenceId", m."id") AS "documentReferenceId"
    FROM "StockMovement" m
    INNER JOIN "Store" s ON s."id" = m."storeId"
    INNER JOIN "Product" p ON p."id" = m."productId"
    INNER JOIN "Organization" o ON o."id" = s."organizationId"
    LEFT JOIN "User" u ON u."id" = m."createdById"
    ${input.baseWhereSql}
  ),
  ${input.pendingSalesWhereSql ? Prisma.sql`
  pending_sales AS MATERIALIZED (
    SELECT pending."id", pending."storeId", pending."createdAt", pending."createdById", pending."archivedAt"
    FROM "CustomerOrder" pending
    INNER JOIN "Store" pending_store
      ON pending_store."id" = pending."storeId"
     AND pending_store."organizationId" = pending."organizationId"
    ${input.pendingSalesWhereSql}
  ),
  ` : Prisma.empty}
  archive_references AS MATERIALIZED (
    SELECT
      m."referenceType",
      m."referenceId"
    FROM "StockMovement" m
    INNER JOIN "Store" s ON s."id" = m."storeId"
    WHERE s."organizationId" = ${input.organizationId}
      AND m."referenceId" IS NOT NULL
      AND m."referenceType" IN (${stockDocumentArchiveReferenceType}, ${stockReceivingArchiveReferenceType})
      ${input.archiveReferenceScopeSql ?? Prisma.empty}
    GROUP BY m."referenceType", m."referenceId"
  ),
  document_index_base AS (
    SELECT
      b."documentType",
      b."documentReferenceType",
      b."documentReferenceId",
      MAX(b."createdAt") AS "documentDate"
    FROM movement_base b
    GROUP BY b."documentType", b."documentReferenceType", b."documentReferenceId"
  ),
  document_index AS (
    SELECT
      d.*,
      (
        archived_document."referenceId" IS NOT NULL
        OR archived_receiving."referenceId" IS NOT NULL
      ) AS "isArchived",
      CASE
        WHEN d."documentType" = 'TRANSFER' AND d."documentReferenceType" = 'TRANSFER'
        THEN EXISTS (
          SELECT 1
          FROM "StockMovement" canceled_m
          INNER JOIN "Store" canceled_s ON canceled_s."id" = canceled_m."storeId"
          WHERE canceled_m."referenceType" = 'TRANSFER'
            AND canceled_m."referenceId" = d."documentReferenceId"
            AND canceled_m."linePosition" = ${transferCancellationLinePosition}
            AND canceled_m."type" IN ('TRANSFER_OUT', 'TRANSFER_IN')
            AND canceled_s."organizationId" = ${input.organizationId}
        )
        ELSE FALSE
      END AS "isCanceled"
    FROM document_index_base d
    LEFT JOIN archive_references archived_document
      ON archived_document."referenceType" = ${stockDocumentArchiveReferenceType}
     AND archived_document."referenceId" = CONCAT(
       d."documentType", ':', d."documentReferenceType", ':', d."documentReferenceId"
     )
    LEFT JOIN archive_references archived_receiving
      ON d."documentType" = 'STOCK_RECEIVING'
     AND archived_receiving."referenceType" = ${stockReceivingArchiveReferenceType}
     AND archived_receiving."referenceId" = d."documentReferenceId"
    ${input.pendingSalesWhereSql ? Prisma.sql`
    UNION ALL
    SELECT 'SALE', 'CustomerOrder', pending."id", pending."createdAt",
      pending."archivedAt" IS NOT NULL, FALSE
    FROM pending_sales pending
    ` : Prisma.empty}
  ),
  document_page AS (
    ${
      input.documentPageSql ??
      Prisma.sql`
        SELECT
          d.*,
          NULL::int AS "groupedTotalCount"
        FROM document_index d
      `
    }
  ),
  movement_scope AS (
    SELECT
      b.*,
      d."isArchived",
      d."isCanceled",
      d."groupedTotalCount"
    FROM movement_base b
    INNER JOIN document_page d
      ON d."documentType" = b."documentType"
     AND d."documentReferenceType" = b."documentReferenceType"
     AND d."documentReferenceId" = b."documentReferenceId"
  ),
  movement_line_net AS (
    SELECT
      b."documentType",
      b."documentReferenceType",
      b."documentReferenceId",
      b."productId",
      COALESCE(b."variantId", 'BASE') AS "variantKey",
      CASE
        WHEN b."documentType" = 'TRANSFER'
        THEN COALESCE(SUM(b."qtyDelta") FILTER (WHERE b."movementType" = 'TRANSFER_OUT'), 0)
        ELSE COALESCE(SUM(b."qtyDelta"), 0)
      END AS "netQty"
    FROM movement_scope b
    GROUP BY
      b."documentType",
      b."documentReferenceType",
      b."documentReferenceId",
      b."productId",
      COALESCE(b."variantId", 'BASE')
  ),
  transfer_store_net AS (
    SELECT
      b."documentType",
      b."documentReferenceType",
      b."documentReferenceId",
      b."storeId",
      b."storeName",
      b."movementType",
      COALESCE(SUM(b."qtyDelta"), 0) AS "netQty"
    FROM movement_scope b
    WHERE b."documentType" = 'TRANSFER'
      AND b."movementType" IN ('TRANSFER_OUT', 'TRANSFER_IN')
    GROUP BY
      b."documentType",
      b."documentReferenceType",
      b."documentReferenceId",
      b."storeId",
      b."storeName",
      b."movementType"
  ),
  stock_document_store_net AS (
    SELECT
      b."documentType",
      b."documentReferenceType",
      b."documentReferenceId",
      b."storeId",
      b."storeName",
      COALESCE(SUM(b."qtyDelta"), 0) AS "netQty"
    FROM movement_scope b
    WHERE (b."documentType" = 'STOCK_RECEIVING' AND b."movementType" = 'RECEIVE')
       OR (b."documentType" = 'WRITE_OFF' AND b."movementType" = 'WRITE_OFF')
    GROUP BY
      b."documentType",
      b."documentReferenceType",
      b."documentReferenceId",
      b."storeId",
      b."storeName"
  ),
  movement_line_totals AS (
    SELECT
      ln."documentType",
      ln."documentReferenceType",
      ln."documentReferenceId",
      COUNT(*) FILTER (WHERE ABS(ln."netQty") > 0)::int AS "positionsCount",
      COALESCE(SUM(ABS(ln."netQty")), 0)::double precision AS "totalQuantity"
    FROM movement_line_net ln
    GROUP BY
      ln."documentType",
      ln."documentReferenceType",
      ln."documentReferenceId"
  ),
  transfer_document_stores AS (
    SELECT
      ts."documentType",
      ts."documentReferenceType",
      ts."documentReferenceId",
      STRING_AGG(DISTINCT ts."storeName", ', ') FILTER (
        WHERE ts."movementType" = 'TRANSFER_OUT' AND ABS(ts."netQty") > 0
      ) AS "sourceStoreName",
      STRING_AGG(DISTINCT ts."storeName", ', ') FILTER (
        WHERE ts."movementType" = 'TRANSFER_IN' AND ABS(ts."netQty") > 0
      ) AS "destinationStoreName"
    FROM transfer_store_net ts
    GROUP BY
      ts."documentType",
      ts."documentReferenceType",
      ts."documentReferenceId"
  ),
  stock_document_stores AS (
    SELECT
      ss."documentType",
      ss."documentReferenceType",
      ss."documentReferenceId",
      STRING_AGG(DISTINCT ss."storeName", ', ') FILTER (
        WHERE (ss."documentType" = 'STOCK_RECEIVING' AND ss."netQty" > 0)
           OR (ss."documentType" = 'WRITE_OFF' AND ss."netQty" < 0)
      ) AS "effectiveStoreName"
    FROM stock_document_store_net ss
    GROUP BY
      ss."documentType",
      ss."documentReferenceType",
      ss."documentReferenceId"
  ),
  movement_grouped_base AS (
    SELECT
      b."documentType",
      b."documentReferenceType",
      b."documentReferenceId",
      MAX(b."createdAt") AS "documentDate",
      MIN(b."createdAt") AS "firstMovementAt",
      STRING_AGG(DISTINCT b."storeName", ', ') AS "storeName",
      (ARRAY_AGG(b."organizationName" ORDER BY b."createdAt" DESC) FILTER (WHERE b."organizationName" IS NOT NULL AND BTRIM(b."organizationName") <> ''))[1] AS "organizationName",
      STRING_AGG(DISTINCT CASE WHEN b."movementType" = 'TRANSFER_OUT' THEN b."storeName" END, ', ') AS "sourceStoreName",
      STRING_AGG(DISTINCT CASE WHEN b."movementType" = 'TRANSFER_IN' THEN b."storeName" END, ', ') AS "destinationStoreName",
      STRING_AGG(DISTINCT b."storeName", ', ') FILTER (
        WHERE b."isCanceled" AND b."linePosition" = ${transferCancellationLinePosition}
          AND b."movementType" = 'TRANSFER_OUT'
      ) AS "canceledSourceStoreName",
      STRING_AGG(DISTINCT b."storeName", ', ') FILTER (
        WHERE b."isCanceled" AND b."linePosition" = ${transferCancellationLinePosition}
          AND b."movementType" = 'TRANSFER_IN'
      ) AS "canceledDestinationStoreName",
      STRING_AGG(DISTINCT b."productName", ', ') AS "productPreview",
      SUM(b."lineTotalKgs") AS "movementLineTotalAmount",
      BOOL_OR(b."lineTotalKgs" IS NOT NULL) AS "hasMovementLineTotal",
      (ARRAY_AGG(b."note" ORDER BY b."createdAt" DESC) FILTER (WHERE b."note" IS NOT NULL AND BTRIM(b."note") <> ''))[1] AS "comment",
      (ARRAY_AGG(b."createdById" ORDER BY b."createdAt" DESC) FILTER (WHERE b."createdById" IS NOT NULL))[1] AS "authorId",
      (ARRAY_AGG(b."authorName" ORDER BY b."createdAt" DESC) FILTER (WHERE b."authorName" IS NOT NULL AND BTRIM(b."authorName") <> ''))[1] AS "authorName",
      (ARRAY_AGG(b."authorEmail" ORDER BY b."createdAt" DESC) FILTER (WHERE b."authorEmail" IS NOT NULL AND BTRIM(b."authorEmail") <> ''))[1] AS "authorEmail",
      BOOL_OR(b."isArchived") AS "isArchived",
      BOOL_OR(b."isCanceled") AS "isCanceled",
      (ARRAY_AGG(b."groupedTotalCount") FILTER (WHERE b."groupedTotalCount" IS NOT NULL))[1] AS "groupedTotalCount"
    FROM movement_scope b
    GROUP BY b."documentType", b."documentReferenceType", b."documentReferenceId"
  ),
  movement_grouped AS (
    SELECT
      g."documentType",
      g."documentReferenceType",
      g."documentReferenceId",
      g."documentDate",
      g."firstMovementAt",
      CASE WHEN g."isCanceled" THEN 0 ELSE COALESCE(lt."positionsCount", 0) END::int AS "positionsCount",
      CASE WHEN g."isCanceled" THEN 0 ELSE COALESCE(lt."totalQuantity", 0) END::double precision AS "totalQuantity",
      CASE
        WHEN g."documentType" IN ('STOCK_RECEIVING', 'WRITE_OFF')
        THEN COALESCE(sd."effectiveStoreName", g."storeName")
        ELSE g."storeName"
      END AS "storeName",
      g."organizationName",
      CASE
        WHEN g."isCanceled" THEN COALESCE(g."canceledSourceStoreName", g."sourceStoreName")
        ELSE COALESCE(td."sourceStoreName", g."sourceStoreName")
      END AS "sourceStoreName",
      CASE
        WHEN g."isCanceled" THEN COALESCE(g."canceledDestinationStoreName", g."destinationStoreName")
        ELSE COALESCE(td."destinationStoreName", g."destinationStoreName")
      END AS "destinationStoreName",
      g."productPreview",
      g."movementLineTotalAmount",
      g."hasMovementLineTotal",
      g."comment",
      g."authorId",
      g."authorName",
      g."authorEmail",
      g."isArchived",
      g."isCanceled",
      g."groupedTotalCount"
    FROM movement_grouped_base g
    LEFT JOIN movement_line_totals lt
      ON lt."documentType" = g."documentType"
     AND lt."documentReferenceType" = g."documentReferenceType"
     AND lt."documentReferenceId" = g."documentReferenceId"
    LEFT JOIN transfer_document_stores td
      ON td."documentType" = g."documentType"
     AND td."documentReferenceType" = g."documentReferenceType"
     AND td."documentReferenceId" = g."documentReferenceId"
    LEFT JOIN stock_document_stores sd
      ON sd."documentType" = g."documentType"
     AND sd."documentReferenceType" = g."documentReferenceType"
     AND sd."documentReferenceId" = g."documentReferenceId"
    ${input.pendingSalesWhereSql ? Prisma.sql`
    UNION ALL
    SELECT
      d."documentType",
      d."documentReferenceType",
      d."documentReferenceId",
      d."documentDate",
      NULL::timestamp AS "firstMovementAt",
      order_lines."positionsCount",
      order_lines."totalQuantity",
      s."name" AS "storeName",
      o."name" AS "organizationName",
      NULL AS "sourceStoreName",
      NULL AS "destinationStoreName",
      order_lines."productPreview",
      NULL::numeric AS "movementLineTotalAmount",
      FALSE AS "hasMovementLineTotal",
      NULL AS "comment",
      pending."createdById" AS "authorId",
      u."name" AS "authorName",
      u."email" AS "authorEmail",
      d."isArchived",
      d."isCanceled",
      d."groupedTotalCount"
    FROM document_page d
    INNER JOIN pending_sales pending
      ON d."documentType" = 'SALE'
     AND d."documentReferenceType" = 'CustomerOrder'
     AND d."documentReferenceId" = pending."id"
    INNER JOIN "Store" s ON s."id" = pending."storeId"
    INNER JOIN "Organization" o ON o."id" = s."organizationId"
    LEFT JOIN "User" u ON u."id" = pending."createdById"
    CROSS JOIN LATERAL (
      SELECT
        COUNT(*)::int AS "positionsCount",
        COALESCE(SUM(ABS(l."qty")), 0)::double precision AS "totalQuantity",
        STRING_AGG(DISTINCT p."name", ', ' ORDER BY p."name") AS "productPreview"
      FROM "CustomerOrderLine" l
      INNER JOIN "Product" p ON p."id" = l."productId" AND p."organizationId" = o."id"
      WHERE l."customerOrderId" = pending."id"
    ) order_lines
    ` : Prisma.empty}
  ),
  movement_enriched AS (
    SELECT
      CONCAT(g."documentType", ':', g."documentReferenceType", ':', g."documentReferenceId") AS "id",
      g."documentReferenceId" AS "documentId",
      g."documentType" AS "documentType",
      g."documentReferenceType" AS "documentReferenceType",
      g."documentReferenceId" AS "documentReferenceId",
      COALESCE(co."number", sr."number", sc."code", g."documentReferenceId") AS "documentNumber",
      co."isPosSale" AS "isPosSale",
      co_original."id" AS "linkedCustomerOrderId",
      co_original."isPosSale" AS "linkedCustomerOrderIsPosSale",
      CASE
        WHEN g."documentReferenceType" = 'CustomerOrder' THEN co."id" IS NOT NULL
        WHEN g."documentReferenceType" = 'SaleReturn' THEN sr."id" IS NOT NULL
        WHEN g."documentReferenceType" = 'PURCHASE_ORDER' THEN po."id" IS NOT NULL
        WHEN g."documentReferenceType" = 'STOCK_COUNT' THEN sc."id" IS NOT NULL
        ELSE TRUE
      END AS "sourceExists",
      g."organizationName" AS "organizationName",
      g."documentDate" AS "createdAt",
      CASE WHEN g."firstMovementAt" IS NOT NULL
        THEN COALESCE(co."completedAt", sr."completedAt", po."receivedAt", sc."appliedAt", g."documentDate")
        ELSE NULL
      END AS "postedAt",
      CASE
        WHEN g."isCanceled" THEN 'CANCELED'
        ELSE COALESCE(co."status"::text, sr."status"::text, po."status"::text, sc."status"::text, 'POSTED')
      END AS "status",
      co."status"::text AS "orderStatus",
      CASE
        WHEN co."id" IS NOT NULL THEN
          CASE
            WHEN COALESCE(co."totalKgs", 0) <= 0 OR COALESCE(co_payments."paidAmount", 0) >= COALESCE(co."totalKgs", 0) THEN 'PAID'
            WHEN COALESCE(co_payments."paidAmount", 0) > 0 THEN 'PARTIAL'
            ELSE 'UNPAID'
          END
        WHEN sr."id" IS NOT NULL THEN
          CASE
            WHEN COALESCE(sr."totalKgs", 0) <= 0 OR COALESCE(sr_payments."refundedAmount", 0) >= COALESCE(sr."totalKgs", 0) THEN 'REFUNDED'
            WHEN COALESCE(sr_payments."refundedAmount", 0) > 0 THEN 'PARTIAL'
            ELSE 'UNPAID'
          END
        ELSE 'NOT_APPLICABLE'
      END AS "paymentStatus",
      CASE
        WHEN g."documentType" = 'TRANSFER' THEN NULLIF(g."sourceStoreName", '')
        WHEN g."documentType" IN ('STOCK_RECEIVING', 'PURCHASE_ORDER') THEN supplier."name"
        WHEN g."documentType" = 'RETURN' THEN ${customerSnapshotNameSql(Prisma.sql`co_original`)}
        ELSE g."storeName"
      END AS "senderName",
      CASE
        WHEN g."documentType" = 'TRANSFER' THEN NULLIF(g."destinationStoreName", '')
        WHEN g."documentType" = 'SALE' THEN ${customerSnapshotNameSql(Prisma.sql`co`)}
        ELSE g."storeName"
      END AS "recipientName",
      g."storeName" AS "storeName",
      g."authorName" AS "authorName",
      g."authorEmail" AS "authorEmail",
      g."positionsCount" AS "positionsCount",
      g."totalQuantity" AS "totalQuantity",
      CASE
        WHEN g."isCanceled" THEN 0
        WHEN co."id" IS NOT NULL THEN co."totalKgs"
        WHEN sr."id" IS NOT NULL THEN sr."totalKgs"
        WHEN po."id" IS NOT NULL AND po_totals."hasCost" THEN po_totals."totalAmount"
        WHEN g."documentType" IN ('STOCK_RECEIVING', 'TRANSFER', 'WRITE_OFF') AND g."hasMovementLineTotal" THEN g."movementLineTotalAmount"
        ELSE NULL
      END AS "totalAmount",
      CASE
        WHEN co."id" IS NOT NULL THEN co_payments."paidAmount"
        WHEN sr."id" IS NOT NULL THEN sr_payments."refundedAmount"
        ELSE NULL
      END AS "paidAmount",
      COALESCE(co."notes", sr."notes", sc."notes", g."comment") AS "comment",
      COALESCE(g."comment", g."productPreview") AS "description",
      NULL AS "detailUrl",
      g."isArchived" AS "isArchived",
      g."groupedTotalCount" AS "groupedTotalCount"
    FROM movement_grouped g
    LEFT JOIN "CustomerOrder" co
      ON g."documentReferenceType" = 'CustomerOrder' AND co."id" = g."documentReferenceId"
     AND co."organizationId" = ${input.organizationId}
    LEFT JOIN "SaleReturn" sr
      ON g."documentReferenceType" = 'SaleReturn' AND sr."id" = g."documentReferenceId"
     AND sr."organizationId" = ${input.organizationId}
    LEFT JOIN "CustomerOrder" co_original
      ON sr."originalSaleId" = co_original."id"
     AND co_original."organizationId" = ${input.organizationId}
    LEFT JOIN "PurchaseOrder" po
      ON g."documentReferenceType" = 'PURCHASE_ORDER' AND po."id" = g."documentReferenceId"
    LEFT JOIN "Supplier" supplier
      ON po."supplierId" = supplier."id"
    LEFT JOIN "StockCount" sc
      ON g."documentReferenceType" = 'STOCK_COUNT' AND sc."id" = g."documentReferenceId"
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(CASE
          WHEN sp."isRefund" = false AND sp."settlementStatus" IN ('ACTUAL', 'OFFSET') THEN sp."amountKgs"
          WHEN sp."isRefund" = true AND sp."settlementStatus" = 'ACTUAL' THEN -sp."amountKgs"
          ELSE 0
        END), 0)::numeric AS "paidAmount"
      FROM "SalePayment" sp
      WHERE sp."customerOrderId" = co."id"
    ) co_payments ON true
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(CASE
          WHEN sp."isRefund" = true AND sp."settlementStatus" = 'ACTUAL' THEN sp."amountKgs"
          ELSE 0
        END), 0)::numeric AS "refundedAmount"
      FROM "SalePayment" sp
      WHERE sp."saleReturnId" = sr."id"
    ) sr_payments ON true
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(COALESCE(pol."unitCost", 0) * pol."qtyOrdered"), 0)::numeric AS "totalAmount",
        BOOL_OR(pol."unitCost" IS NOT NULL) AS "hasCost"
      FROM "PurchaseOrderLine" pol
      WHERE pol."purchaseOrderId" = po."id"
    ) po_totals ON true
  )
`;

const buildWhereSql = (conditions: Prisma.Sql[]) =>
  conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

const buildSearchCondition = (token: string) => {
  const pattern = `%${token}%`;
  return Prisma.sql`
    (
      COALESCE("documentNumber", '') ILIKE ${pattern}
      OR COALESCE("documentId", '') ILIKE ${pattern}
      OR COALESCE("comment", '') ILIKE ${pattern}
      OR COALESCE("description", '') ILIKE ${pattern}
      OR COALESCE("senderName", '') ILIKE ${pattern}
      OR COALESCE("recipientName", '') ILIKE ${pattern}
      OR COALESCE("storeName", '') ILIKE ${pattern}
      OR COALESCE("authorName", '') ILIKE ${pattern}
      OR COALESCE("authorEmail", '') ILIKE ${pattern}
    )
  `;
};

const buildTextFilterCondition = (column: Prisma.Sql, value?: string | null) => {
  const tokens = normalizeSearchTokens(value);
  if (!tokens.length) {
    return [];
  }
  return tokens.map((token) => {
    const pattern = `%${token}%`;
    return Prisma.sql`COALESCE(${column}, '') ILIKE ${pattern}`;
  });
};

const getOrderBySql = (sortBy: ProductMovementSortKey, sortDirection: "asc" | "desc") => {
  const direction = sortDirection === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  switch (sortBy) {
    case "type":
      return Prisma.sql`"documentType" ${direction}, "createdAt" DESC, "id" DESC`;
    case "status":
      return Prisma.sql`"status" ${direction}, "createdAt" DESC, "id" DESC`;
    case "amount":
      return Prisma.sql`"totalAmount" ${direction} NULLS LAST, "createdAt" DESC, "id" DESC`;
    case "positions":
      return Prisma.sql`"positionsCount" ${direction}, "createdAt" DESC, "id" DESC`;
    case "author":
      return Prisma.sql`"authorName" ${direction} NULLS LAST, "createdAt" DESC, "id" DESC`;
    case "store":
      return Prisma.sql`"storeName" ${direction} NULLS LAST, "createdAt" DESC, "id" DESC`;
    case "date":
    default:
      return Prisma.sql`"createdAt" ${direction}, "id" DESC`;
  }
};

const normalizeProductMovementJournalRow = (
  row: ProductMovementJournalSqlRow,
): ProductMovementJournalRow => {
  const writeOffNote =
    row.documentType === "WRITE_OFF" ? parseWriteOffMovementNote(row.comment) : null;
  const comment = writeOffNote ? writeOffNote.comment : row.comment;
  const description = writeOffNote?.reason ?? row.description;
  const id = encodeProductMovementDocumentKey({
    documentType: row.documentType,
    documentReferenceType: row.documentReferenceType,
    documentReferenceId: row.documentReferenceId,
  });
  return {
    id,
    documentId: row.documentId,
    documentType: row.documentType,
    documentNumber: normalizeProductMovementDocumentNumber(row.documentNumber, row.documentId),
    isPosSale: row.isPosSale,
    documentLabel: buildProductMovementDocumentLabel({
      documentType: row.documentType,
      documentNumber: row.documentNumber,
      documentId: row.documentId,
    }),
    organizationName: row.organizationName,
    createdAt: row.createdAt,
    postedAt: row.postedAt,
    status: row.status,
    paymentStatus: row.paymentStatus,
    orderStatus: row.orderStatus,
    senderName: row.senderName,
    recipientName: row.recipientName,
    customerName: row.documentType === "SALE" ? row.recipientName : row.documentType === "RETURN" ? row.senderName : null,
    storeName: row.storeName,
    authorName: row.authorName,
    authorEmail: row.authorEmail,
    positionsCount: Number(row.positionsCount),
    totalQuantity: Number(row.totalQuantity),
    totalAmount: toNumberOrNull(row.totalAmount),
    paidAmount: toNumberOrNull(row.paidAmount),
    reason: writeOffNote?.reason ?? null,
    comment,
    description,
    detailUrl: getProductMovementDetailUrl({
      id,
      documentType: row.documentType,
      documentReferenceType: row.documentReferenceType,
      documentReferenceId: row.documentReferenceId,
      isPosSale: row.isPosSale,
      sourceExists: row.sourceExists,
      linkedCustomerOrderId: row.linkedCustomerOrderId,
      linkedCustomerOrderIsPosSale: row.linkedCustomerOrderIsPosSale,
    }),
  };
};

const normalizeProductMovementDocumentLine = (
  line: ProductMovementDocumentLineSqlRow,
): ProductMovementDocumentLine => ({
  id: line.id,
  productId: line.productId,
  variantId: line.variantId,
  storeId: line.storeId,
  productDetailUrl: `/products/${line.productId}?storeId=${encodeURIComponent(line.storeId)}`,
  storeName: line.storeName,
  productName: line.productName,
  sku: line.sku,
  barcode: line.barcode,
  unit: line.unit,
  variantName: line.variantName,
  movementType: line.movementType,
  qtyDelta: Number(line.qtyDelta),
  linePosition: line.linePosition,
  unitCostKgs: toNumberOrNull(line.unitCostKgs),
  lineTotalKgs: toNumberOrNull(line.lineTotalKgs),
  note: line.note,
  createdAt: line.createdAt,
  authorName: line.authorName,
  authorEmail: line.authorEmail,
});

const buildEffectiveStockDocumentLines = (
  lines: ProductMovementDocumentLineSqlRow[],
  documentType: "STOCK_RECEIVING" | "TRANSFER" | "WRITE_OFF",
) => {
  const effectiveMovementType = getEffectiveMovementType(documentType);
  const aggregates = new Map<
    string,
    {
      firstIndex: number;
      productId: string;
      variantId: string | null;
      storeId: string;
      movementType: string;
      qtyDelta: number;
      lineTotalKgs: number;
      hasLineTotal: boolean;
      latestUnitCostKgs: number | null;
      latestLine: ProductMovementDocumentLineSqlRow;
      linePosition: number | null;
    }
  >();

  lines.forEach((line, index) => {
    if (line.movementType !== effectiveMovementType) {
      return;
    }
    const key = `${line.productId}:${line.variantId ?? "BASE"}`;
    const unitCostKgs = toNumberOrNull(line.unitCostKgs);
    const lineTotalKgs = toNumberOrNull(line.lineTotalKgs);
    const existing = aggregates.get(key);
    if (existing) {
      existing.qtyDelta += Number(line.qtyDelta);
      if (lineTotalKgs !== null) {
        existing.lineTotalKgs += lineTotalKgs;
        existing.hasLineTotal = true;
      }
      if (unitCostKgs !== null && line.createdAt >= existing.latestLine.createdAt) {
        existing.latestUnitCostKgs = unitCostKgs;
      }
      if (
        line.linePosition !== null &&
        (existing.linePosition === null || line.linePosition < existing.linePosition)
      ) {
        existing.linePosition = line.linePosition;
      }
      if (line.createdAt >= existing.latestLine.createdAt) {
        existing.latestLine = line;
        existing.storeId = line.storeId;
      }
      return;
    }
    aggregates.set(key, {
      firstIndex: index,
      productId: line.productId,
      variantId: line.variantId,
      storeId: line.storeId,
      movementType: line.movementType,
      qtyDelta: Number(line.qtyDelta),
      lineTotalKgs: lineTotalKgs ?? 0,
      hasLineTotal: lineTotalKgs !== null,
      latestUnitCostKgs: unitCostKgs,
      latestLine: line,
      linePosition: line.linePosition,
    });
  });

  return Array.from(aggregates.values())
    .map((aggregate) => {
      const quantity =
        documentType === "STOCK_RECEIVING" ? aggregate.qtyDelta : Math.abs(aggregate.qtyDelta);
      if (quantity <= 0) {
        return null;
      }
      const latestLine = aggregate.latestLine;
      const lineTotalKgs = aggregate.hasLineTotal ? roundMoney(aggregate.lineTotalKgs) : null;
      const unitCostKgs =
        lineTotalKgs !== null && quantity > 0
          ? roundMoney(lineTotalKgs / quantity)
          : aggregate.latestUnitCostKgs;
      return {
        firstIndex: aggregate.firstIndex,
        line: {
          id: `effective:${documentType}:${aggregate.movementType}:${aggregate.storeId}:${aggregate.productId}:${aggregate.variantId ?? "BASE"}`,
          productId: aggregate.productId,
          variantId: aggregate.variantId,
          storeId: aggregate.storeId,
          productDetailUrl: `/products/${aggregate.productId}?storeId=${encodeURIComponent(
            aggregate.storeId,
          )}`,
          storeName: latestLine.storeName,
          productName: latestLine.productName,
          sku: latestLine.sku,
          barcode: latestLine.barcode,
          unit: latestLine.unit,
          variantName: latestLine.variantName,
          movementType: aggregate.movementType,
          qtyDelta: aggregate.qtyDelta,
          linePosition: aggregate.linePosition,
          unitCostKgs,
          lineTotalKgs,
          note: latestLine.note,
          createdAt: latestLine.createdAt,
          authorName: latestLine.authorName,
          authorEmail: latestLine.authorEmail,
        } satisfies ProductMovementDocumentLine,
      };
    })
    .filter((item): item is { firstIndex: number; line: ProductMovementDocumentLine } =>
      Boolean(item),
    )
    .sort((a, b) => {
      const linePositionA = a.line.linePosition ?? Number.MAX_SAFE_INTEGER;
      const linePositionB = b.line.linePosition ?? Number.MAX_SAFE_INTEGER;
      if (linePositionA !== linePositionB) {
        return linePositionA - linePositionB;
      }
      return a.firstIndex - b.firstIndex;
    })
    .map((item) => item.line);
};

const getNetStoreIdForMovementType = (
  lines: ProductMovementDocumentLineSqlRow[],
  movementType: string,
  isActiveTotal: (quantity: number) => boolean,
) => {
  const totals = new Map<string, { quantity: number; firstIndex: number }>();
  lines.forEach((line, index) => {
    if (line.movementType !== movementType) {
      return;
    }
    const existing = totals.get(line.storeId);
    if (existing) {
      existing.quantity += Number(line.qtyDelta);
      return;
    }
    totals.set(line.storeId, { quantity: Number(line.qtyDelta), firstIndex: index });
  });

  const active = Array.from(totals.entries())
    .filter(([, total]) => isActiveTotal(total.quantity))
    .sort(([, a], [, b]) => a.firstIndex - b.firstIndex)[0];
  if (active) {
    return active[0];
  }
  return lines.find((line) => line.movementType === movementType)?.storeId ?? null;
};

const buildBaseConditions = async (
  prisma: Prisma.TransactionClient,
  user: StoreAccessUser,
  input: Pick<ProductMovementJournalInput, "storeId" | "authorId" | "dateFrom" | "dateTo">,
) => {
  const accessibleStoreIds = userHasAllStoreAccess(user)
    ? null
    : await resolveAccessibleStoreIds(prisma, user);
  if (accessibleStoreIds?.length === 0) {
    return null;
  }

  const dateFrom = parseDateBound(input.dateFrom, false);
  const dateTo = parseDateBound(input.dateTo, true);
  const scopedConditions = (row: Prisma.Sql) => [
    ...(accessibleStoreIds ? [
      Prisma.sql`${row}."storeId" IN (${Prisma.join(accessibleStoreIds)})`,
    ] : []),
    ...(input.storeId?.trim() ? [Prisma.sql`${row}."storeId" = ${input.storeId.trim()}`] : []),
    ...(input.authorId?.trim() ? [Prisma.sql`${row}."createdById" = ${input.authorId.trim()}`] : []),
    ...(dateFrom ? [Prisma.sql`${row}."createdAt" >= ${dateFrom}`] : []),
    ...(dateTo ? [Prisma.sql`${row}."createdAt" <= ${dateTo}`] : []),
  ];
  return {
    scopedConditions,
    movement: [
      Prisma.sql`p."organizationId" = ${user.organizationId}`,
      Prisma.sql`s."organizationId" = ${user.organizationId}`,
      Prisma.sql`COALESCE(m."referenceType", '') <> ${stockDocumentArchiveReferenceType}`,
      Prisma.sql`COALESCE(m."referenceType", '') <> ${stockReceivingArchiveReferenceType}`,
      ...scopedConditions(Prisma.sql`m`),
    ],
  };
};

export const listProductMovementRecipientOptions = async (
  prisma: PrismaClient,
  user: StoreAccessUser,
  input: { storeId?: string; search: string },
): Promise<string[]> => {
  const accessibleStoreIds = await resolveAccessibleStoreIds(prisma, user);
  const storeIds = input.storeId
    ? accessibleStoreIds.filter((id) => id === input.storeId)
    : accessibleStoreIds;
  if (!storeIds.length) {
    return [];
  }
  const matches = await prisma.customer.groupBy({
    by: ["name"],
    where: {
      ...buildCustomerListWhere({ organizationId: user.organizationId, storeIds }),
      store: { organizationId: user.organizationId },
      name: { contains: escapeLikeText(input.search), mode: "insensitive" },
    },
    orderBy: { name: "asc" },
    take: 12,
  });
  return matches.map(({ name }) => name);
};

const hasPendingSalesAccess = async (organizationId: string) => {
  try {
    await assertFeatureEnabled({ organizationId, feature: "customerOrders" });
    return true;
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") {
      return false;
    }
    throw error;
  }
};

export const listProductMovementJournal = async (
  prisma: PrismaClient,
  user: StoreAccessUser,
  input: ProductMovementJournalInput,
): Promise<ProductMovementJournalResult> => {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(Math.max(input.pageSize ?? 25, 10), 100);
  const baseConditions = await buildBaseConditions(prisma, user, input);

  if (!baseConditions) {
    return { items: [], total: 0, page, pageSize };
  }

  // A customer's order can be opened from the journal before stock is posted.
  // After posting, the ledger remains the journal's source for that order.
  const pendingSalesWhereSql =
    input.includePendingSales &&
    (!input.type || input.type === "SALE") &&
    (await hasPendingSalesAccess(user.organizationId))
      ? buildWhereSql([
          Prisma.sql`pending."organizationId" = ${user.organizationId}`,
          Prisma.sql`pending."isPosSale" = false AND pending."isHeld" = false`,
          Prisma.sql`pending."status" IN ('DRAFT', 'CONFIRMED', 'READY', 'CANCELED')`,
          Prisma.sql`NOT EXISTS (
            SELECT 1
            FROM "StockMovement" posted
            INNER JOIN "Store" posted_store ON posted_store."id" = posted."storeId"
            WHERE posted."referenceType" = 'CustomerOrder'
              AND posted."referenceId" = pending."id"
              AND posted_store."organizationId" = pending."organizationId"
          )`,
          ...baseConditions.scopedConditions(Prisma.sql`pending`),
        ])
      : undefined;

  const finalConditions: Prisma.Sql[] = [];
  if (input.type) {
    finalConditions.push(Prisma.sql`"documentType" = ${input.type}`);
  }
  if (input.status?.trim()) {
    finalConditions.push(Prisma.sql`"status" = ${input.status.trim()}`);
  }
  if (input.paymentStatus) {
    finalConditions.push(Prisma.sql`"paymentStatus" = ${input.paymentStatus}`);
  }
  if (input.orderStatus?.trim()) {
    finalConditions.push(Prisma.sql`"orderStatus" = ${input.orderStatus.trim()}`);
  }
  const searchTokens = normalizeSearchTokens(input.search);
  searchTokens.forEach((token) => {
    finalConditions.push(buildSearchCondition(token));
  });
  finalConditions.push(...buildTextFilterCondition(Prisma.sql`"authorName"`, input.authorSearch));
  finalConditions.push(...buildTextFilterCondition(Prisma.sql`"senderName"`, input.senderSearch));
  finalConditions.push(...buildTextFilterCondition(Prisma.sql`"recipientName"`, input.recipientSearch));
  const recipientTokens = normalizeSearchTokens(input.recipientSearch);
  const archiveMode = input.archiveMode ?? "ACTIVE";
  if (archiveMode === "ACTIVE") {
    finalConditions.push(Prisma.sql`"isArchived" = false`);
  } else if (archiveMode === "ARCHIVED") {
    finalConditions.push(Prisma.sql`"isArchived" = true`);
  }

  const finalWhereSql = buildWhereSql(finalConditions);
  const sortBy = input.sortBy ?? "date";
  const sortDirection = input.sortDirection ?? "desc";
  const orderBySql = getOrderBySql(sortBy, sortDirection);
  const canPageBeforeEnrichment =
    !input.status?.trim() &&
    !input.paymentStatus &&
    !input.orderStatus?.trim() &&
    searchTokens.length === 0 &&
    normalizeSearchTokens(input.authorSearch).length === 0 &&
    normalizeSearchTokens(input.senderSearch).length === 0 &&
    recipientTokens.length === 0 &&
    sortBy === "date";
  const documentPageConditions: Prisma.Sql[] = [];
  if (input.type) {
    documentPageConditions.push(Prisma.sql`d."documentType" = ${input.type}`);
  }
  if (archiveMode === "ACTIVE") {
    documentPageConditions.push(Prisma.sql`d."isArchived" = false`);
  } else if (archiveMode === "ARCHIVED") {
    documentPageConditions.push(Prisma.sql`d."isArchived" = true`);
  }
  // Customer-order recipients are known before movement lines and payments
  // are grouped. Keep the full predicate for other document types.
  if (recipientTokens.some((token) => !/^%+$/.test(token))) {
    const saleRecipientConditions = buildTextFilterCondition(
      customerSnapshotNameSql(Prisma.sql`sale`),
      input.recipientSearch,
    );
    documentPageConditions.push(Prisma.sql`(
      d."documentReferenceType" <> 'CustomerOrder'
      OR d."documentReferenceId" IN (
        SELECT sale."id"
        FROM "CustomerOrder" sale
        WHERE sale."organizationId" = ${user.organizationId}
          AND ${Prisma.join(saleRecipientConditions, " AND ")}
      )
    )`);
  }
  const documentPageWhereSql = buildWhereSql(documentPageConditions);
  const groupedDateDirection = sortDirection === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const documentPageSql = canPageBeforeEnrichment
    ? Prisma.sql`
        SELECT
          d.*,
          (COUNT(*) OVER())::int AS "groupedTotalCount"
        FROM document_index d
        ${documentPageWhereSql}
        ORDER BY
          d."documentDate" ${groupedDateDirection},
          CONCAT(d."documentType", ':', d."documentReferenceType", ':', d."documentReferenceId") DESC
        LIMIT ${pageSize}
        OFFSET ${(page - 1) * pageSize}
      `
    : Prisma.sql`
        SELECT d.*, NULL::int AS "groupedTotalCount"
        FROM document_index d
        ${documentPageWhereSql}
      `;
  const cte = buildProductMovementJournalCte({
    baseWhereSql: buildWhereSql(baseConditions.movement),
    organizationId: user.organizationId,
    documentPageSql,
    pendingSalesWhereSql,
  });

  const rows = canPageBeforeEnrichment
    ? await prisma.$queryRaw<ProductMovementJournalSqlRow[]>(
        Prisma.sql`
          ${cte}
          SELECT *
          FROM movement_enriched
          ORDER BY ${orderBySql}
        `,
      )
    : await prisma.$queryRaw<ProductMovementJournalSqlRow[]>(
        Prisma.sql`
          ${cte}
          SELECT
            movement_enriched.*,
            (COUNT(*) OVER())::int AS "totalCount"
          FROM movement_enriched
          ${finalWhereSql}
          ORDER BY ${orderBySql}
          LIMIT ${pageSize}
          OFFSET ${(page - 1) * pageSize}
        `,
      );

  let total = Number(
    canPageBeforeEnrichment ? (rows[0]?.groupedTotalCount ?? 0) : (rows[0]?.totalCount ?? 0),
  );
  if (!rows.length && page > 1) {
    const countCte = canPageBeforeEnrichment
      ? buildProductMovementJournalCte({
          baseWhereSql: buildWhereSql(baseConditions.movement),
          organizationId: user.organizationId,
          pendingSalesWhereSql,
        })
      : cte;
    const countRows = await prisma.$queryRaw<Array<{ count: number | bigint }>>(
      Prisma.sql`
        ${countCte}
        SELECT COUNT(*)::int AS count
        FROM movement_enriched
        ${finalWhereSql}
      `,
    );
    total = Number(countRows[0]?.count ?? 0);
  }

  return {
    items: rows.map(normalizeProductMovementJournalRow),
    total,
    page,
    pageSize,
  };
};

export const getProductMovementDocument = async (
  prisma: Prisma.TransactionClient,
  user: StoreAccessUser,
  documentKey: string,
): Promise<ProductMovementDocumentDetail | null> => {
  const decoded = decodeProductMovementDocumentKey(documentKey);
  if (!decoded) {
    return null;
  }

  const baseConditions = await buildBaseConditions(prisma, user, {});
  if (!baseConditions) {
    return null;
  }

  const movementTypeSql = buildMovementDocumentTypeSql(
    Prisma.sql`m."referenceType"`,
    Prisma.sql`m."type"::text`,
  );
  const referenceType = Prisma.sql`m."referenceType" = ${decoded.documentReferenceType}`;
  const matchingReferenceType = decoded.documentReferenceType === "StockMovement"
    ? Prisma.sql`(${referenceType} OR m."referenceType" IS NULL)`
    : referenceType;
  // Filter the ledger before the CTE is materialized, using the reference
  // index for posted documents and the movement ID for rows without a reference ID.
  const documentConditions = [
    ...baseConditions.movement,
    Prisma.sql`${movementTypeSql} = ${decoded.documentType}`,
    Prisma.sql`(
      (${matchingReferenceType} AND m."referenceId" = ${decoded.documentReferenceId})
      OR (${matchingReferenceType} AND m."referenceId" IS NULL AND m."id" = ${decoded.documentReferenceId})
    )`,
  ];
  const archiveReferences = [
    Prisma.sql`(m."referenceType" = ${stockDocumentArchiveReferenceType} AND m."referenceId" = ${documentKey})`,
  ];
  if (decoded.documentType === "STOCK_RECEIVING") {
    archiveReferences.push(
      Prisma.sql`(m."referenceType" = ${stockReceivingArchiveReferenceType} AND m."referenceId" = ${decoded.documentReferenceId})`,
    );
  }
  const cte = buildProductMovementJournalCte({
    baseWhereSql: buildWhereSql(documentConditions),
    organizationId: user.organizationId,
    archiveReferenceScopeSql: Prisma.sql`AND (${Prisma.join(archiveReferences, " OR ")})`,
  });
  const [row] = await prisma.$queryRaw<ProductMovementJournalSqlRow[]>(
    Prisma.sql`
      ${cte}
      SELECT *
      FROM movement_enriched
      WHERE "id" = ${documentKey}
      LIMIT 1
    `,
  );

  if (!row) {
    return null;
  }

  const lines = await prisma.$queryRaw<ProductMovementDocumentLineSqlRow[]>(
    Prisma.sql`
      SELECT
        m."id",
        m."productId",
        m."variantId",
        m."storeId",
        s."name" AS "storeName",
        p."name" AS "productName",
        p."sku",
        p."unit",
        pb."value" AS "barcode",
        v."name" AS "variantName",
        m."type"::text AS "movementType",
        m."qtyDelta",
        m."linePosition",
        m."unitCostKgs",
        m."lineTotalKgs",
        m."note",
        m."createdAt",
        u."name" AS "authorName",
        u."email" AS "authorEmail"
      FROM "StockMovement" m
      INNER JOIN "Store" s ON s."id" = m."storeId"
      INNER JOIN "Product" p ON p."id" = m."productId"
      LEFT JOIN "ProductVariant" v ON v."id" = m."variantId"
      LEFT JOIN "User" u ON u."id" = m."createdById"
      LEFT JOIN LATERAL (
        SELECT b."value"
        FROM "ProductBarcode" b
        WHERE b."productId" = p."id"
        ORDER BY b."createdAt" ASC, b."id" ASC
        LIMIT 1
      ) pb ON true
      ${buildWhereSql(documentConditions)}
      ORDER BY COALESCE(m."linePosition", 2147483647) ASC, m."createdAt" ASC, m."id" ASC
    `,
  );
  const canceledTransfer = decoded.documentType === "TRANSFER" && row.status === "CANCELED";
  if (canceledTransfer) {
    const corrections = lines.filter((line) => line.linePosition === transferCancellationLinePosition);
    return {
      ...normalizeProductMovementJournalRow(row),
      sourceStoreId: corrections.find((line) => line.movementType === "TRANSFER_OUT")?.storeId ?? null,
      destinationStoreId: corrections.find((line) => line.movementType === "TRANSFER_IN")?.storeId ?? null,
      lines: [],
      movementHistory: lines.map(normalizeProductMovementDocumentLine)
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()),
    };
  }

  const effectiveStockLines = isEditableStockDocumentType(decoded.documentType)
    ? buildEffectiveStockDocumentLines(lines, decoded.documentType)
    : null;
  const normalizedLines = effectiveStockLines ?? lines.map(normalizeProductMovementDocumentLine);
  const sourceStoreId = isEditableStockDocumentType(decoded.documentType)
    ? getNetStoreIdForMovementType(
        lines,
        getEffectiveMovementType(decoded.documentType),
        decoded.documentType === "STOCK_RECEIVING"
          ? (quantity) => quantity > 0
          : (quantity) => quantity < 0,
      )
    : (normalizedLines[0]?.storeId ?? lines[0]?.storeId ?? null);
  const destinationStoreId =
    decoded.documentType === "TRANSFER"
      ? getNetStoreIdForMovementType(lines, "TRANSFER_IN", (quantity) => quantity > 0)
      : null;

  return {
    ...normalizeProductMovementJournalRow(row),
    sourceStoreId,
    destinationStoreId,
    lines: normalizedLines,
  };
};
