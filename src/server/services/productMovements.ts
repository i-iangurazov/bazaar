import { Prisma, type PrismaClient } from "@prisma/client";

import { parseWriteOffMovementNote } from "@/lib/inventory/writeOff";
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

const isEditableStockDocumentType = (
  value: string,
): value is "STOCK_RECEIVING" | "TRANSFER" | "WRITE_OFF" =>
  editableStockDocumentTypes.has(value);

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
  documentReferenceType: string;
  documentReferenceId: string;
  linkedCustomerOrderId?: string | null;
}) => {
  switch (input.documentReferenceType) {
    case "CustomerOrder":
      return `/sales/orders/${input.documentReferenceId}`;
    case "SaleReturn":
      return input.linkedCustomerOrderId ? `/sales/orders/${input.linkedCustomerOrderId}` : null;
    case "PURCHASE_ORDER":
      return `/purchase-orders/${input.documentReferenceId}`;
    case "STOCK_COUNT":
      return `/inventory/counts/${input.documentReferenceId}`;
    default:
      return `/inventory/movements/${encodeURIComponent(input.id)}`;
  }
};

const buildProductMovementDocumentLabel = (input: {
  documentType: ProductMovementDocumentType;
  documentNumber?: string | null;
  documentId: string;
}) => {
  const number = input.documentNumber?.trim() || input.documentId;
  return `${documentTypeFallbackLabels[input.documentType] ?? documentTypeFallbackLabels.OTHER} #${number}`;
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

const buildProductMovementJournalCte = (baseWhereSql: Prisma.Sql) => Prisma.sql`
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
    ${baseWhereSql}
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
    FROM movement_base b
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
    FROM movement_base b
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
  movement_grouped AS (
    SELECT
      b."documentType",
      b."documentReferenceType",
      b."documentReferenceId",
      MAX(b."createdAt") AS "documentDate",
      MIN(b."createdAt") AS "firstMovementAt",
      COALESCE((
        SELECT COUNT(*)::int
        FROM movement_line_net ln
        WHERE ln."documentType" = b."documentType"
          AND ln."documentReferenceType" = b."documentReferenceType"
          AND ln."documentReferenceId" = b."documentReferenceId"
          AND ABS(ln."netQty") > 0
      ), 0)::int AS "positionsCount",
      COALESCE((
        SELECT SUM(ABS(ln."netQty"))::int
        FROM movement_line_net ln
        WHERE ln."documentType" = b."documentType"
          AND ln."documentReferenceType" = b."documentReferenceType"
          AND ln."documentReferenceId" = b."documentReferenceId"
      ), 0)::int AS "totalQuantity",
      STRING_AGG(DISTINCT b."storeName", ', ') AS "storeName",
      (ARRAY_AGG(b."organizationName" ORDER BY b."createdAt" DESC) FILTER (WHERE b."organizationName" IS NOT NULL AND BTRIM(b."organizationName") <> ''))[1] AS "organizationName",
      COALESCE(
        (
          SELECT STRING_AGG(DISTINCT ts."storeName", ', ')
          FROM transfer_store_net ts
          WHERE ts."documentType" = b."documentType"
            AND ts."documentReferenceType" = b."documentReferenceType"
            AND ts."documentReferenceId" = b."documentReferenceId"
            AND ts."movementType" = 'TRANSFER_OUT'
            AND ABS(ts."netQty") > 0
        ),
        STRING_AGG(DISTINCT CASE WHEN b."movementType" = 'TRANSFER_OUT' THEN b."storeName" END, ', ')
      ) AS "sourceStoreName",
      COALESCE(
        (
          SELECT STRING_AGG(DISTINCT ts."storeName", ', ')
          FROM transfer_store_net ts
          WHERE ts."documentType" = b."documentType"
            AND ts."documentReferenceType" = b."documentReferenceType"
            AND ts."documentReferenceId" = b."documentReferenceId"
            AND ts."movementType" = 'TRANSFER_IN'
            AND ABS(ts."netQty") > 0
        ),
        STRING_AGG(DISTINCT CASE WHEN b."movementType" = 'TRANSFER_IN' THEN b."storeName" END, ', ')
      ) AS "destinationStoreName",
      STRING_AGG(DISTINCT b."productName", ', ') AS "productPreview",
      SUM(b."lineTotalKgs") AS "movementLineTotalAmount",
      BOOL_OR(b."lineTotalKgs" IS NOT NULL) AS "hasMovementLineTotal",
      (ARRAY_AGG(b."note" ORDER BY b."createdAt" DESC) FILTER (WHERE b."note" IS NOT NULL AND BTRIM(b."note") <> ''))[1] AS "comment",
      (ARRAY_AGG(b."createdById" ORDER BY b."createdAt" DESC) FILTER (WHERE b."createdById" IS NOT NULL))[1] AS "authorId",
      (ARRAY_AGG(b."authorName" ORDER BY b."createdAt" DESC) FILTER (WHERE b."authorName" IS NOT NULL AND BTRIM(b."authorName") <> ''))[1] AS "authorName",
      (ARRAY_AGG(b."authorEmail" ORDER BY b."createdAt" DESC) FILTER (WHERE b."authorEmail" IS NOT NULL AND BTRIM(b."authorEmail") <> ''))[1] AS "authorEmail"
    FROM movement_base b
    GROUP BY b."documentType", b."documentReferenceType", b."documentReferenceId"
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
      g."organizationName" AS "organizationName",
      g."documentDate" AS "createdAt",
      COALESCE(co."completedAt", sr."completedAt", po."receivedAt", sc."appliedAt", g."documentDate") AS "postedAt",
      COALESCE(co."status"::text, sr."status"::text, po."status"::text, sc."status"::text, 'POSTED') AS "status",
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
        WHEN g."documentType" = 'RETURN' THEN COALESCE(co_original."customerName", co_original."debtCustomerName")
        ELSE g."storeName"
      END AS "senderName",
      CASE
        WHEN g."documentType" = 'TRANSFER' THEN NULLIF(g."destinationStoreName", '')
        WHEN g."documentType" = 'SALE' THEN COALESCE(co."customerName", co."debtCustomerName")
        ELSE g."storeName"
      END AS "recipientName",
      g."storeName" AS "storeName",
      g."authorName" AS "authorName",
      g."authorEmail" AS "authorEmail",
      g."positionsCount" AS "positionsCount",
      g."totalQuantity" AS "totalQuantity",
      CASE
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
      NULL AS "detailUrl"
    FROM movement_grouped g
    LEFT JOIN "CustomerOrder" co
      ON g."documentReferenceType" = 'CustomerOrder' AND co."id" = g."documentReferenceId"
    LEFT JOIN "SaleReturn" sr
      ON g."documentReferenceType" = 'SaleReturn' AND sr."id" = g."documentReferenceId"
    LEFT JOIN "CustomerOrder" co_original
      ON sr."originalSaleId" = co_original."id"
    LEFT JOIN "PurchaseOrder" po
      ON g."documentReferenceType" = 'PURCHASE_ORDER' AND po."id" = g."documentReferenceId"
    LEFT JOIN "Supplier" supplier
      ON po."supplierId" = supplier."id"
    LEFT JOIN "StockCount" sc
      ON g."documentReferenceType" = 'STOCK_COUNT' AND sc."id" = g."documentReferenceId"
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(CASE WHEN sp."isRefund" = true THEN -sp."amountKgs" ELSE sp."amountKgs" END), 0)::numeric AS "paidAmount"
      FROM "SalePayment" sp
      WHERE sp."customerOrderId" = co."id"
    ) co_payments ON true
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(CASE WHEN sp."isRefund" = true THEN sp."amountKgs" ELSE -sp."amountKgs" END), 0)::numeric AS "refundedAmount"
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

const buildTextFilterCondition = (column: string, value?: string | null) => {
  const tokens = normalizeSearchTokens(value);
  if (!tokens.length) {
    return [];
  }
  return tokens.map((token) => {
    const pattern = `%${token}%`;
    return Prisma.sql`COALESCE(${Prisma.raw(column)}, '') ILIKE ${pattern}`;
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
    documentNumber: row.documentNumber,
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
      documentReferenceType: row.documentReferenceType,
      documentReferenceId: row.documentReferenceId,
      linkedCustomerOrderId: row.linkedCustomerOrderId,
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
  prisma: PrismaClient,
  user: StoreAccessUser,
  input: Pick<ProductMovementJournalInput, "storeId" | "authorId" | "dateFrom" | "dateTo">,
) => {
  const dateFrom = parseDateBound(input.dateFrom, false);
  const dateTo = parseDateBound(input.dateTo, true);
  const baseConditions: Prisma.Sql[] = [
    Prisma.sql`p."organizationId" = ${user.organizationId}`,
    Prisma.sql`s."organizationId" = ${user.organizationId}`,
  ];

  if (!userHasAllStoreAccess(user)) {
    const accessibleStoreIds = await resolveAccessibleStoreIds(prisma, user);
    if (!accessibleStoreIds.length) {
      return null;
    }
    baseConditions.push(Prisma.sql`m."storeId" IN (${Prisma.join(accessibleStoreIds)})`);
  }

  if (input.storeId?.trim()) {
    baseConditions.push(Prisma.sql`m."storeId" = ${input.storeId.trim()}`);
  }
  if (input.authorId?.trim()) {
    baseConditions.push(Prisma.sql`m."createdById" = ${input.authorId.trim()}`);
  }
  if (dateFrom) {
    baseConditions.push(Prisma.sql`m."createdAt" >= ${dateFrom}`);
  }
  if (dateTo) {
    baseConditions.push(Prisma.sql`m."createdAt" <= ${dateTo}`);
  }

  return baseConditions;
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
  normalizeSearchTokens(input.search).forEach((token) => {
    finalConditions.push(buildSearchCondition(token));
  });
  finalConditions.push(...buildTextFilterCondition('"authorName"', input.authorSearch));
  finalConditions.push(...buildTextFilterCondition('"senderName"', input.senderSearch));
  finalConditions.push(...buildTextFilterCondition('"recipientName"', input.recipientSearch));

  const cte = buildProductMovementJournalCte(buildWhereSql(baseConditions));
  const finalWhereSql = buildWhereSql(finalConditions);
  const orderBySql = getOrderBySql(input.sortBy ?? "date", input.sortDirection ?? "desc");

  const [countRows, rows] = await Promise.all([
    prisma.$queryRaw<Array<{ count: number | bigint }>>(
      Prisma.sql`
        ${cte}
        SELECT COUNT(*)::int AS count
        FROM movement_enriched
        ${finalWhereSql}
      `,
    ),
    prisma.$queryRaw<ProductMovementJournalSqlRow[]>(
      Prisma.sql`
        ${cte}
        SELECT *
        FROM movement_enriched
        ${finalWhereSql}
        ORDER BY ${orderBySql}
        LIMIT ${pageSize}
        OFFSET ${(page - 1) * pageSize}
      `,
    ),
  ]);

  return {
    items: rows.map(normalizeProductMovementJournalRow),
    total: Number(countRows[0]?.count ?? 0),
    page,
    pageSize,
  };
};

export const getProductMovementDocument = async (
  prisma: PrismaClient,
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

  const cte = buildProductMovementJournalCte(buildWhereSql(baseConditions));
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

  const movementTypeSql = buildMovementDocumentTypeSql(
    Prisma.sql`m."referenceType"`,
    Prisma.sql`m."type"::text`,
  );
  const lineConditions = [
    ...baseConditions,
    Prisma.sql`${movementTypeSql} = ${decoded.documentType}`,
    Prisma.sql`COALESCE(m."referenceType", 'StockMovement') = ${decoded.documentReferenceType}`,
    Prisma.sql`COALESCE(m."referenceId", m."id") = ${decoded.documentReferenceId}`,
  ];
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
      ${buildWhereSql(lineConditions)}
      ORDER BY COALESCE(m."linePosition", 2147483647) ASC, m."createdAt" ASC, m."id" ASC
    `,
  );
  const effectiveStockLines = isEditableStockDocumentType(decoded.documentType)
    ? buildEffectiveStockDocumentLines(lines, decoded.documentType)
    : null;
  const normalizedLines = effectiveStockLines ?? lines.map(normalizeProductMovementDocumentLine);
  const sourceStoreId =
    decoded.documentType === "TRANSFER"
      ? getNetStoreIdForMovementType(lines, "TRANSFER_OUT", (quantity) => quantity < 0)
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
