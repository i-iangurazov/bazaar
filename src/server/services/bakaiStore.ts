import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, extname, join } from "node:path";

import { BakaiStoreExportJobStatus, BakaiStoreIntegrationStatus, Prisma } from "@prisma/client";
import * as XLSX from "xlsx";

import { prisma } from "@/server/db/prisma";
import { registerJob, runJob, type JobPayload } from "@/server/jobs";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";
import { normalizeProductImageUrl } from "@/server/services/productImageStorage";

const BAKAI_STORE_EXPORT_JOB_NAME = "bakai-store-export";
const BAKAI_STORE_STORAGE_ROOT = join(process.cwd(), "uploads", "bakai-store");
const BAKAI_TEMPLATE_MAX_BYTES = 10 * 1024 * 1024;
const BAKAI_PRODUCT_SELECTION_AUDIT_ACTION = "BAKAI_STORE_PRODUCT_SELECTION_UPDATED";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const BAKAI_STOCK_COLUMN_PATTERN = /^pp\d+$/i;

export type BakaiStoreOverviewStatus = "NOT_CONFIGURED" | "DRAFT" | "READY" | "ERROR";
export type BakaiStoreProductSelectionFilter = "all" | "included" | "excluded";
export type BakaiStoreProductExportStatus = "EXCLUDED" | "INCLUDED" | "EXPORTED";
export type BakaiStoreExportMode = "ALL_SELECTED" | "READY_ONLY";

export type BakaiStorePreflightIssueCode =
  | "NO_PRODUCTS_SELECTED"
  | "MISSING_SKU"
  | "DUPLICATE_SKU"
  | "MISSING_NAME"
  | "INVALID_NAME"
  | "MISSING_PRICE"
  | "INVALID_PRICE"
  | "DISCOUNT_CONFLICT"
  | "INVALID_DISCOUNT_PERCENT"
  | "INVALID_DISCOUNT_AMOUNT"
  | "MISSING_STOCK_MAPPING"
  | "INVALID_STOCK_VALUE"
  | "TEMPLATE_RENDER_ERROR";

export type BakaiStorePreflightResult = {
  generatedAt: Date;
  canExport: boolean;
  summary: {
    productsConsidered: number;
    productsReady: number;
    productsFailed: number;
    warnings: number;
  };
  blockers: {
    total: number;
    byCode: Partial<Record<BakaiStorePreflightIssueCode, number>>;
    missingStoreMappings: Array<{ columnKey: string }>;
  };
  warnings: {
    total: number;
    byCode: Partial<Record<string, number>>;
    global: string[];
  };
  failedProducts: Array<{
    productId: string;
    sku: string;
    name: string;
    issues: BakaiStorePreflightIssueCode[];
  }>;
  readyProductIds: string[];
};

export type BakaiTemplateSchema = {
  sheetName: string;
  headerRowIndex: number;
  dataStartRowIndex: number;
  columns: Array<{
    key: string;
    header: string;
    columnIndex: number;
    kind: "SKU" | "NAME" | "PRICE" | "DISCOUNT_PERCENT" | "DISCOUNT_AMOUNT" | "STOCK";
  }>;
  stockColumns: string[];
};

export type BakaiStoreExportRow = {
  productId: string;
  sku: string;
  name: string;
  price: number;
  discountPercent: number | null;
  discountAmount: number | null;
  stockByColumn: Record<string, number>;
};

type BakaiTemplateUpload = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
};

type BakaiStoreExportPlan = {
  mode: BakaiStoreExportMode;
  templateSchema: BakaiTemplateSchema | null;
  templatePath: string | null;
  preflight: BakaiStorePreflightResult;
  exportRows: BakaiStoreExportRow[];
  payloadStats: Record<string, unknown>;
  errorReport: Record<string, unknown>;
};

type BakaiStoredTemplateSchema = BakaiTemplateSchema;

const normalizeSearch = (value?: string | null) => value?.trim() ?? "";

const nonDataImagePattern = /^data:image\//i;

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const normalizeColumnKey = (value: string) => value.trim().toLowerCase();

const normalizeStockColumnKey = (value: string) => normalizeColumnKey(value);

const isBakaiStockColumnKey = (value: string) => BAKAI_STOCK_COLUMN_PATTERN.test(value.trim());

const normalizeSku = (value: string) => value.trim().toUpperCase();

const safeFileSegment = (value: string) =>
  value
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "file";

const ensureBakaiStorageDir = async (...parts: string[]) => {
  const directory = join(BAKAI_STORE_STORAGE_ROOT, ...parts);
  await fs.mkdir(directory, { recursive: true });
  return directory;
};

const normalizeBakaiExportMode = (value?: unknown): BakaiStoreExportMode =>
  value === "READY_ONLY" ? "READY_ONLY" : "ALL_SELECTED";

const resolveBakaiListImageUrl = (product: {
  photoUrl: string | null;
  images: Array<{ url: string }>;
}) => {
  for (const candidate of [product.images[0]?.url, product.photoUrl]) {
    const normalized = normalizeProductImageUrl(candidate);
    if (normalized && !nonDataImagePattern.test(normalized)) {
      return normalized;
    }
  }
  return null;
};

const resolveBakaiProductExportStatus = (input: {
  included: boolean;
  lastExportedAt: Date | null;
}): BakaiStoreProductExportStatus => {
  if (!input.included) {
    return "EXCLUDED";
  }
  return input.lastExportedAt ? "EXPORTED" : "INCLUDED";
};

export const normalizeBakaiNumericValue = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : Number.NaN;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  let normalized = raw.replace(/\s+/g, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized =
      normalized.lastIndexOf(",") > normalized.lastIndexOf(".")
        ? normalized.replace(/\./g, "").replace(",", ".")
        : normalized.replace(/,/g, "");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }

  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return Number.NaN;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const parseTemplateHeaderKind = (value: string) => {
  const normalized = normalizeColumnKey(value);
  if (normalized === "sku") {
    return "SKU" as const;
  }
  if (normalized === "name") {
    return "NAME" as const;
  }
  if (normalized === "price") {
    return "PRICE" as const;
  }
  if (normalized === "скидка(%)" || normalized === "скидка( % )" || normalized === "скидка (%)") {
    return "DISCOUNT_PERCENT" as const;
  }
  if (normalized === "суммаскидки" || normalized === "сумма скидки") {
    return "DISCOUNT_AMOUNT" as const;
  }
  if (isBakaiStockColumnKey(normalized)) {
    return "STOCK" as const;
  }
  return null;
};

const stringifySheetCell = (cell: XLSX.CellObject | undefined) => {
  if (!cell) {
    return "";
  }
  if (typeof cell.w === "string" && cell.w.trim()) {
    return cell.w.trim();
  }
  if (cell.v === null || cell.v === undefined) {
    return "";
  }
  return String(cell.v).trim();
};

const cloneCellStyle = (cell: XLSX.CellObject | undefined) => {
  if (!cell) {
    return null;
  }
  return {
    s: cell.s,
    z: cell.z,
  };
};

const buildWorkbookCell = (
  value: string | number,
  prototype: ReturnType<typeof cloneCellStyle>,
): XLSX.CellObject => {
  const base: XLSX.CellObject =
    typeof value === "number" ? { t: "n", v: value } : { t: "s", v: value };
  if (prototype?.s) {
    base.s = prototype.s;
  }
  if (prototype?.z) {
    base.z = prototype.z;
  }
  return base;
};

const addIssue = (issues: BakaiStorePreflightIssueCode[], code: BakaiStorePreflightIssueCode) => {
  if (!issues.includes(code)) {
    issues.push(code);
  }
};

const countByCode = <TCode extends string>(items: Array<{ codes: TCode[] }>) => {
  const counts: Partial<Record<TCode, number>> = {};
  for (const item of items) {
    for (const code of item.codes) {
      counts[code] = (counts[code] ?? 0) + 1;
    }
  }
  return counts;
};

const parseStoredTemplateSchema = (value: Prisma.JsonValue | null | undefined) => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const sheetName = typeof record.sheetName === "string" ? record.sheetName : "";
  const headerRowIndex =
    typeof record.headerRowIndex === "number" && Number.isInteger(record.headerRowIndex)
      ? record.headerRowIndex
      : -1;
  const dataStartRowIndex =
    typeof record.dataStartRowIndex === "number" && Number.isInteger(record.dataStartRowIndex)
      ? record.dataStartRowIndex
      : -1;
  const columnsInput = Array.isArray(record.columns) ? record.columns : [];
  const stockColumnsInput = Array.isArray(record.stockColumns) ? record.stockColumns : [];

  if (!sheetName || headerRowIndex < 0 || dataStartRowIndex < 0) {
    return null;
  }

  const columns = columnsInput
    .map((value) => asRecord(value))
    .filter((value): value is Record<string, unknown> => Boolean(value))
    .map((column) => {
      const key = typeof column.key === "string" ? column.key : "";
      const header = typeof column.header === "string" ? column.header : "";
      const columnIndex =
        typeof column.columnIndex === "number" && Number.isInteger(column.columnIndex)
          ? column.columnIndex
          : -1;
      const kind =
        column.kind === "SKU" ||
        column.kind === "NAME" ||
        column.kind === "PRICE" ||
        column.kind === "DISCOUNT_PERCENT" ||
        column.kind === "DISCOUNT_AMOUNT" ||
        column.kind === "STOCK"
          ? column.kind
          : null;
      if (!key || !header || columnIndex < 0 || !kind) {
        return null;
      }
      return {
        key,
        header,
        columnIndex,
        kind,
      };
    })
    .filter((value): value is BakaiStoredTemplateSchema["columns"][number] => Boolean(value));

  const stockColumns = stockColumnsInput
    .map((value) => (typeof value === "string" ? normalizeStockColumnKey(value) : ""))
    .filter(Boolean);

  if (!columns.length || !stockColumns.length) {
    return null;
  }

  return {
    sheetName,
    headerRowIndex,
    dataStartRowIndex,
    columns,
    stockColumns,
  } satisfies BakaiStoredTemplateSchema;
};

export const detectBakaiTemplateSchema = (workbook: XLSX.WorkBook): BakaiTemplateSchema => {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet?.["!ref"]) {
      continue;
    }
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const lastRow = Math.min(range.e.r, range.s.r + 50);

    for (let rowIndex = range.s.r; rowIndex <= lastRow; rowIndex += 1) {
      const columns: BakaiTemplateSchema["columns"] = [];
      let hasSku = false;
      let hasName = false;
      let hasPrice = false;
      let stockColumns: string[] = [];

      for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
        const cellValue = stringifySheetCell(sheet[address]);
        if (!cellValue) {
          continue;
        }
        const kind = parseTemplateHeaderKind(cellValue);
        if (!kind) {
          continue;
        }
        const key = kind === "STOCK" ? normalizeStockColumnKey(cellValue) : kind;
        columns.push({
          key,
          header: cellValue,
          columnIndex,
          kind,
        });
        if (kind === "SKU") {
          hasSku = true;
        }
        if (kind === "NAME") {
          hasName = true;
        }
        if (kind === "PRICE") {
          hasPrice = true;
        }
        if (kind === "STOCK") {
          stockColumns.push(key);
        }
      }

      stockColumns = Array.from(new Set(stockColumns));

      if (hasSku && hasName && hasPrice && stockColumns.length > 0) {
        return {
          sheetName,
          headerRowIndex: rowIndex,
          dataStartRowIndex: rowIndex + 1,
          columns: columns.sort((left, right) => left.columnIndex - right.columnIndex),
          stockColumns,
        };
      }
    }
  }

  throw new AppError("bakaiStoreTemplateInvalid", "BAD_REQUEST", 400);
};

const readWorkbookFromBuffer = (buffer: Buffer) =>
  XLSX.read(buffer, {
    type: "buffer",
    cellStyles: true,
    cellNF: true,
  });

const resolveStoredIntegrationStatus = (input: {
  hasTemplate: boolean;
  hasTemplateError: boolean;
  stockColumns: string[];
  mappedColumnKeys: Set<string>;
}) => {
  if (!input.hasTemplate) {
    return BakaiStoreIntegrationStatus.DISABLED;
  }
  if (input.hasTemplateError) {
    return BakaiStoreIntegrationStatus.ERROR;
  }
  const mappingsComplete =
    input.stockColumns.length > 0 &&
    input.stockColumns.every((columnKey) =>
      input.mappedColumnKeys.has(normalizeStockColumnKey(columnKey)),
    );
  return mappingsComplete ? BakaiStoreIntegrationStatus.READY : BakaiStoreIntegrationStatus.DRAFT;
};

const resolveOverviewStatus = (input: {
  integration: {
    status: BakaiStoreIntegrationStatus;
    templateStoragePath: string | null;
    templateSchemaJson: Prisma.JsonValue | null;
  } | null;
}) => {
  if (!input.integration?.templateStoragePath) {
    return "NOT_CONFIGURED" as const;
  }
  if (!parseStoredTemplateSchema(input.integration.templateSchemaJson)) {
    return "ERROR" as const;
  }
  if (input.integration.status === BakaiStoreIntegrationStatus.ERROR) {
    return "ERROR" as const;
  }
  if (input.integration.status === BakaiStoreIntegrationStatus.READY) {
    return "READY" as const;
  }
  return "DRAFT" as const;
};

const ensureStoreOwnership = async (organizationId: string, storeIds: string[]) => {
  const uniqueIds = Array.from(new Set(storeIds.map((value) => value.trim()).filter(Boolean)));
  if (!uniqueIds.length) {
    return;
  }
  const stores = await prisma.store.findMany({
    where: {
      organizationId,
      id: { in: uniqueIds },
    },
    select: { id: true },
  });
  if (stores.length !== uniqueIds.length) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }
};

const ensureProductOwnership = async (organizationId: string, productIds: string[]) => {
  const uniqueIds = Array.from(new Set(productIds.map((value) => value.trim()).filter(Boolean)));
  if (!uniqueIds.length) {
    return [] as string[];
  }
  const products = await prisma.product.findMany({
    where: {
      organizationId,
      id: { in: uniqueIds },
    },
    select: { id: true },
  });
  if (products.length !== uniqueIds.length) {
    throw new AppError("productNotFound", "NOT_FOUND", 404);
  }
  return uniqueIds;
};

const buildBakaiProductListWhere = (input: {
  organizationId: string;
  search?: string;
  selection?: BakaiStoreProductSelectionFilter;
}) => {
  const search = normalizeSearch(input.search);
  const selection = input.selection ?? "all";

  const baseWhere: Prisma.ProductWhereInput = {
    organizationId: input.organizationId,
    isDeleted: false,
  };

  const searchWhere: Prisma.ProductWhereInput = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { sku: { contains: search, mode: "insensitive" } },
        ],
      }
    : {};

  const selectionWhere: Prisma.ProductWhereInput =
    selection === "included"
      ? {
          bakaiStoreInclusions: {
            some: { orgId: input.organizationId },
          },
        }
      : selection === "excluded"
        ? {
            bakaiStoreInclusions: {
              none: { orgId: input.organizationId },
            },
          }
        : {};

  return {
    baseWhere,
    where: {
      AND: [baseWhere, searchWhere, selectionWhere],
    } satisfies Prisma.ProductWhereInput,
  };
};

const writePrivateFile = async (input: {
  organizationId: string;
  directory: "templates" | "exports";
  fileName: string;
  buffer: Buffer;
}) => {
  const orgSegment = safeFileSegment(input.organizationId);
  const directory = await ensureBakaiStorageDir(input.directory, orgSegment);
  const storagePath = join(directory, input.fileName);
  await fs.writeFile(storagePath, input.buffer);
  return {
    storagePath,
    fileSize: input.buffer.length,
  };
};

const saveTemplateFile = async (input: {
  organizationId: string;
  fileName: string;
  buffer: Buffer;
}) => {
  const ext = extname(input.fileName) || ".xlsx";
  const hash = createHash("sha256").update(input.buffer).digest("hex").slice(0, 16);
  const storedName = `${Date.now()}-${hash}${ext}`;
  return writePrivateFile({
    organizationId: input.organizationId,
    directory: "templates",
    fileName: storedName,
    buffer: input.buffer,
  });
};

const buildBakaiErrorReport = (input: {
  mode: BakaiStoreExportMode;
  templateSchema: BakaiTemplateSchema | null;
  preflight: BakaiStorePreflightResult;
  payloadStats: Record<string, unknown>;
  rows: BakaiStoreExportRow[];
  reason?: string;
}) => ({
  generatedAt: input.preflight.generatedAt.toISOString(),
  mode: input.mode,
  templateSchema: input.templateSchema,
  summary: input.preflight.summary,
  blockers: input.preflight.blockers,
  warnings: input.preflight.warnings,
  failedProducts: input.preflight.failedProducts,
  readyProductIds: input.preflight.readyProductIds,
  payloadStats: input.payloadStats,
  rows: input.rows.map((row) => ({
    sku: row.sku,
    name: row.name,
    price: row.price,
    discountPercent: row.discountPercent,
    discountAmount: row.discountAmount,
    stockByColumn: row.stockByColumn,
  })),
  reason: input.reason,
});

export const buildBakaiStoreExportRows = (input: {
  products: Array<{
    productId: string;
    sku: string;
    name: string;
    price: number;
    discountPercent?: number | null;
    discountAmount?: number | null;
    stockByColumn: Record<string, number>;
  }>;
  stockColumnKeys: string[];
}) => {
  const normalizedStockColumns = input.stockColumnKeys.map((value) =>
    normalizeStockColumnKey(value),
  );
  return [...input.products]
    .sort((left, right) => {
      const skuCompare = normalizeSku(left.sku).localeCompare(normalizeSku(right.sku));
      if (skuCompare !== 0) {
        return skuCompare;
      }
      return left.productId.localeCompare(right.productId);
    })
    .map((product) => ({
      productId: product.productId,
      sku: product.sku.trim(),
      name: product.name.trim(),
      price: product.price,
      discountPercent: product.discountPercent ?? null,
      discountAmount: product.discountAmount ?? null,
      stockByColumn: normalizedStockColumns.reduce<Record<string, number>>(
        (accumulator, columnKey) => {
          accumulator[columnKey] = product.stockByColumn[columnKey] ?? 0;
          return accumulator;
        },
        {},
      ),
    }));
};

const buildBakaiStoreExportPlan = async (input: {
  organizationId: string;
  mode?: BakaiStoreExportMode;
}): Promise<BakaiStoreExportPlan> => {
  const exportMode = normalizeBakaiExportMode(input.mode);
  const [integration, mappings, selectedProducts, stores] = await Promise.all([
    prisma.bakaiStoreIntegration.findUnique({
      where: { orgId: input.organizationId },
      select: {
        id: true,
        orgId: true,
        status: true,
        templateFileName: true,
        templateMimeType: true,
        templateFileSize: true,
        templateStoragePath: true,
        templateSchemaJson: true,
        lastSyncAt: true,
        lastErrorSummary: true,
      },
    }),
    prisma.bakaiStoreStockMapping.findMany({
      where: { orgId: input.organizationId },
      select: { columnKey: true, storeId: true },
    }),
    prisma.bakaiStoreIncludedProduct.findMany({
      where: {
        orgId: input.organizationId,
        product: {
          organizationId: input.organizationId,
          isDeleted: false,
        },
      },
      select: {
        productId: true,
        discountPercent: true,
        discountAmount: true,
        lastExportedAt: true,
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            basePriceKgs: true,
          },
        },
      },
      orderBy: [{ product: { name: "asc" } }, { product: { sku: "asc" } }],
    }),
    prisma.store.findMany({
      where: { organizationId: input.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const storedTemplateSchema = parseStoredTemplateSchema(integration?.templateSchemaJson);
  const mappedStoreIdByColumn = new Map(
    mappings.map((mapping) => [normalizeStockColumnKey(mapping.columnKey), mapping.storeId]),
  );
  const missingStoreMappings =
    storedTemplateSchema?.stockColumns
      .filter((columnKey) => !mappedStoreIdByColumn.has(normalizeStockColumnKey(columnKey)))
      .map((columnKey) => ({ columnKey })) ?? [];

  const selectedProductIds = selectedProducts.map((row) => row.productId);
  const mappedStoreIds = Array.from(new Set(Array.from(mappedStoreIdByColumn.values())));

  const snapshots =
    selectedProductIds.length > 0 && mappedStoreIds.length > 0
      ? await prisma.inventorySnapshot.findMany({
          where: {
            productId: { in: selectedProductIds },
            storeId: { in: mappedStoreIds },
            variantKey: "BASE",
          },
          select: {
            productId: true,
            storeId: true,
            onHand: true,
          },
        })
      : [];

  const stockByProductStore = new Map<string, Map<string, number>>();
  for (const snapshot of snapshots) {
    const byStore = stockByProductStore.get(snapshot.productId) ?? new Map<string, number>();
    byStore.set(snapshot.storeId, snapshot.onHand);
    stockByProductStore.set(snapshot.productId, byStore);
  }

  const seenSkus = new Set<string>();
  const readyRowsInput: Parameters<typeof buildBakaiStoreExportRows>[0]["products"] = [];
  const readyProductIds: string[] = [];
  const failedProducts: BakaiStorePreflightResult["failedProducts"] = [];

  const globalTemplateError = !integration?.templateStoragePath || !storedTemplateSchema;

  for (const selection of selectedProducts) {
    const issues: BakaiStorePreflightIssueCode[] = [];
    const sku = selection.product.sku?.trim() ?? "";
    const name = selection.product.name?.trim() ?? "";
    const normalizedSku = normalizeSku(sku);
    const price = normalizeBakaiNumericValue(selection.product.basePriceKgs);
    const discountPercent = normalizeBakaiNumericValue(selection.discountPercent);
    const discountAmount = normalizeBakaiNumericValue(selection.discountAmount);

    if (globalTemplateError) {
      addIssue(issues, "TEMPLATE_RENDER_ERROR");
    }

    if (!sku) {
      addIssue(issues, "MISSING_SKU");
    } else if (seenSkus.has(normalizedSku)) {
      addIssue(issues, "DUPLICATE_SKU");
    }
    if (normalizedSku) {
      seenSkus.add(normalizedSku);
    }

    if (!name) {
      addIssue(issues, "MISSING_NAME");
    } else if (name.length > 255 || CONTROL_CHARACTER_PATTERN.test(name)) {
      addIssue(issues, "INVALID_NAME");
    }

    if (price === null) {
      addIssue(issues, "MISSING_PRICE");
    } else if (!Number.isFinite(price) || price < 0) {
      addIssue(issues, "INVALID_PRICE");
    }

    if (discountPercent !== null && !Number.isFinite(discountPercent)) {
      addIssue(issues, "INVALID_DISCOUNT_PERCENT");
    }
    if (discountAmount !== null && !Number.isFinite(discountAmount)) {
      addIssue(issues, "INVALID_DISCOUNT_AMOUNT");
    }
    if (
      discountPercent !== null &&
      Number.isFinite(discountPercent) &&
      (discountPercent < 0 || discountPercent > 100)
    ) {
      addIssue(issues, "INVALID_DISCOUNT_PERCENT");
    }
    if (discountAmount !== null && Number.isFinite(discountAmount) && discountAmount < 0) {
      addIssue(issues, "INVALID_DISCOUNT_AMOUNT");
    }
    if (
      discountPercent !== null &&
      Number.isFinite(discountPercent) &&
      discountAmount !== null &&
      Number.isFinite(discountAmount)
    ) {
      addIssue(issues, "DISCOUNT_CONFLICT");
    }

    if (missingStoreMappings.length > 0) {
      addIssue(issues, "MISSING_STOCK_MAPPING");
    }

    const stockByColumn: Record<string, number> = {};
    if (storedTemplateSchema) {
      const snapshotByStore =
        stockByProductStore.get(selection.productId) ?? new Map<string, number>();
      for (const columnKey of storedTemplateSchema.stockColumns) {
        const normalizedColumnKey = normalizeStockColumnKey(columnKey);
        const mappedStoreId = mappedStoreIdByColumn.get(normalizedColumnKey);
        const quantity = mappedStoreId ? (snapshotByStore.get(mappedStoreId) ?? 0) : 0;
        if (!Number.isInteger(quantity) || quantity < 0) {
          addIssue(issues, "INVALID_STOCK_VALUE");
        }
        stockByColumn[normalizedColumnKey] =
          Number.isInteger(quantity) && quantity >= 0 ? quantity : 0;
      }
    }

    if (issues.length > 0) {
      failedProducts.push({
        productId: selection.productId,
        sku,
        name,
        issues,
      });
      continue;
    }

    readyRowsInput.push({
      productId: selection.productId,
      sku,
      name,
      price: Number(price ?? 0),
      discountPercent:
        discountPercent !== null && Number.isFinite(discountPercent) ? discountPercent : null,
      discountAmount:
        discountAmount !== null && Number.isFinite(discountAmount) ? discountAmount : null,
      stockByColumn,
    });
    readyProductIds.push(selection.productId);
  }

  const exportRows = buildBakaiStoreExportRows({
    products: readyRowsInput,
    stockColumnKeys: storedTemplateSchema?.stockColumns ?? [],
  });

  const blockerCounts = countByCode(failedProducts.map((row) => ({ codes: row.issues })));
  if (selectedProducts.length === 0) {
    blockerCounts.NO_PRODUCTS_SELECTED = 1;
  }
  if (globalTemplateError) {
    blockerCounts.TEMPLATE_RENDER_ERROR = (blockerCounts.TEMPLATE_RENDER_ERROR ?? 0) + 1;
  }

  const preflight: BakaiStorePreflightResult = {
    generatedAt: new Date(),
    canExport:
      exportMode === "READY_ONLY"
        ? readyProductIds.length > 0
        : selectedProducts.length > 0 && failedProducts.length === 0 && !globalTemplateError,
    summary: {
      productsConsidered: selectedProducts.length,
      productsReady: readyProductIds.length,
      productsFailed: failedProducts.length,
      warnings: 0,
    },
    blockers: {
      total:
        failedProducts.length +
        (selectedProducts.length === 0 ? 1 : 0) +
        (globalTemplateError ? 1 : 0),
      byCode: blockerCounts,
      missingStoreMappings,
    },
    warnings: {
      total: 0,
      byCode: {},
      global: [],
    },
    failedProducts,
    readyProductIds,
  };

  const payloadStats = {
    exportMode,
    selectedProducts: selectedProducts.length,
    productCount: exportRows.length,
    failedProducts: failedProducts.length,
    stockColumns: storedTemplateSchema?.stockColumns ?? [],
    mappedColumns: Array.from(mappedStoreIdByColumn.keys()),
    mappedStores: mappings.length,
    totalStores: stores.length,
  };

  return {
    mode: exportMode,
    templateSchema: storedTemplateSchema,
    templatePath: integration?.templateStoragePath ?? null,
    preflight,
    exportRows,
    payloadStats,
    errorReport: buildBakaiErrorReport({
      mode: exportMode,
      templateSchema: storedTemplateSchema,
      preflight,
      payloadStats,
      rows: exportRows,
    }),
  };
};

export const renderBakaiStoreWorkbookFromTemplate = async (input: {
  templateBuffer: Buffer;
  templateSchema: BakaiTemplateSchema;
  rows: BakaiStoreExportRow[];
}) => {
  try {
    const workbook = readWorkbookFromBuffer(input.templateBuffer);
    const sheet = workbook.Sheets[input.templateSchema.sheetName];
    if (!sheet) {
      throw new Error("missingSheet");
    }

    const ref = sheet["!ref"] ?? "A1:A1";
    const range = XLSX.utils.decode_range(ref);
    const usedColumnIndices = input.templateSchema.columns.map((column) => column.columnIndex);
    const prototypes = new Map<number, ReturnType<typeof cloneCellStyle>>();
    for (const column of input.templateSchema.columns) {
      const prototypeAddress = XLSX.utils.encode_cell({
        r: input.templateSchema.dataStartRowIndex,
        c: column.columnIndex,
      });
      prototypes.set(column.columnIndex, cloneCellStyle(sheet[prototypeAddress]));
    }

    for (
      let rowIndex = input.templateSchema.dataStartRowIndex;
      rowIndex <= range.e.r;
      rowIndex += 1
    ) {
      for (const columnIndex of usedColumnIndices) {
        delete sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
      }
    }

    for (const [rowOffset, row] of input.rows.entries()) {
      const sheetRowIndex = input.templateSchema.dataStartRowIndex + rowOffset;
      for (const column of input.templateSchema.columns) {
        let value: string | number | null = null;
        switch (column.kind) {
          case "SKU":
            value = row.sku;
            break;
          case "NAME":
            value = row.name;
            break;
          case "PRICE":
            value = row.price;
            break;
          case "DISCOUNT_PERCENT":
            value = row.discountPercent;
            break;
          case "DISCOUNT_AMOUNT":
            value = row.discountAmount;
            break;
          case "STOCK":
            value = row.stockByColumn[normalizeStockColumnKey(column.key)] ?? 0;
            break;
        }

        if (value === null || value === "") {
          continue;
        }

        const address = XLSX.utils.encode_cell({ r: sheetRowIndex, c: column.columnIndex });
        sheet[address] = buildWorkbookCell(value, prototypes.get(column.columnIndex) ?? null);
      }
    }

    const lastRowIndex = Math.max(
      range.e.r,
      input.rows.length > 0
        ? input.templateSchema.dataStartRowIndex + input.rows.length - 1
        : input.templateSchema.headerRowIndex,
    );
    sheet["!ref"] = XLSX.utils.encode_range({
      s: { r: range.s.r, c: range.s.c },
      e: { r: lastRowIndex, c: range.e.c },
    });

    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  } catch (error) {
    throw new AppError(
      error instanceof AppError ? error.message : "bakaiStoreTemplateInvalid",
      error instanceof AppError ? error.code : "BAD_REQUEST",
      error instanceof AppError ? error.status : 400,
    );
  }
};

export const getBakaiStoreOverview = async (organizationId: string) => {
  const integration = await prisma.bakaiStoreIntegration.findUnique({
    where: { orgId: organizationId },
    select: {
      status: true,
      templateStoragePath: true,
      templateFileName: true,
      templateSchemaJson: true,
      lastSyncAt: true,
      lastErrorSummary: true,
    },
  });

  const storedTemplateSchema = parseStoredTemplateSchema(integration?.templateSchemaJson);
  const mappings = await prisma.bakaiStoreStockMapping.findMany({
    where: { orgId: organizationId },
    select: { columnKey: true },
  });
  const mappedColumnKeys = new Set(
    mappings.map((mapping) => normalizeStockColumnKey(mapping.columnKey)),
  );
  const summaryStatus = resolveOverviewStatus({
    integration: integration
      ? {
          status: integration.status,
          templateStoragePath: integration.templateStoragePath,
          templateSchemaJson: integration.templateSchemaJson,
        }
      : null,
  });

  return {
    configured:
      Boolean(integration?.templateStoragePath) &&
      Boolean(storedTemplateSchema) &&
      (storedTemplateSchema?.stockColumns.every((columnKey) => mappedColumnKeys.has(columnKey)) ??
        false),
    status: summaryStatus,
    hasTemplate: Boolean(integration?.templateStoragePath),
    stockColumns: storedTemplateSchema?.stockColumns ?? [],
    mappedColumns: Array.from(mappedColumnKeys),
    lastSyncAt: integration?.lastSyncAt ?? null,
    lastErrorSummary: integration?.lastErrorSummary ?? null,
  };
};

export const getBakaiStoreSettings = async (organizationId: string) => {
  const [integration, stores, mappings] = await Promise.all([
    prisma.bakaiStoreIntegration.findUnique({
      where: { orgId: organizationId },
      select: {
        id: true,
        status: true,
        templateFileName: true,
        templateMimeType: true,
        templateFileSize: true,
        templateStoragePath: true,
        templateSchemaJson: true,
        lastSyncAt: true,
        lastErrorSummary: true,
      },
    }),
    prisma.store.findMany({
      where: { organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.bakaiStoreStockMapping.findMany({
      where: { orgId: organizationId },
      select: { columnKey: true, storeId: true },
    }),
  ]);

  const storedTemplateSchema = parseStoredTemplateSchema(integration?.templateSchemaJson);
  const mappedColumnKeys = new Set(
    mappings.map((mapping) => normalizeStockColumnKey(mapping.columnKey)),
  );
  const resolvedStatus = resolveOverviewStatus({
    integration: integration
      ? {
          status: integration.status,
          templateStoragePath: integration.templateStoragePath,
          templateSchemaJson: integration.templateSchemaJson,
        }
      : null,
  });
  const stockColumns = storedTemplateSchema?.stockColumns.length
    ? storedTemplateSchema.stockColumns
    : ["pp1"];

  return {
    integration: {
      id: integration?.id ?? null,
      status: resolvedStatus,
      rawStatus: integration?.status ?? BakaiStoreIntegrationStatus.DISABLED,
      hasTemplate: Boolean(integration?.templateStoragePath),
      template: integration?.templateStoragePath
        ? {
            fileName: integration.templateFileName ?? basename(integration.templateStoragePath),
            mimeType:
              integration.templateMimeType ??
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            fileSize: integration.templateFileSize ?? null,
            sheetName: storedTemplateSchema?.sheetName ?? null,
            headerRowIndex: storedTemplateSchema?.headerRowIndex ?? null,
            dataStartRowIndex: storedTemplateSchema?.dataStartRowIndex ?? null,
            stockColumns,
          }
        : null,
      configured:
        Boolean(integration?.templateStoragePath) &&
        Boolean(storedTemplateSchema) &&
        stockColumns.every((columnKey) => mappedColumnKeys.has(normalizeStockColumnKey(columnKey))),
      lastSyncAt: integration?.lastSyncAt ?? null,
      lastErrorSummary: integration?.lastErrorSummary ?? null,
    },
    stores: stores.map((store) => ({
      storeId: store.id,
      storeName: store.name,
    })),
    mappings: stockColumns.map((columnKey) => ({
      columnKey,
      storeId:
        mappings.find(
          (mapping) =>
            normalizeStockColumnKey(mapping.columnKey) === normalizeStockColumnKey(columnKey),
        )?.storeId ?? "",
    })),
  };
};

export const saveBakaiStoreTemplateWorkbook = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  upload: BakaiTemplateUpload;
}) => {
  if (!input.upload.fileName.trim()) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  if (input.upload.buffer.length > BAKAI_TEMPLATE_MAX_BYTES) {
    throw new AppError("bakaiStoreTemplateTooLarge", "BAD_REQUEST", 400);
  }

  const workbook = readWorkbookFromBuffer(input.upload.buffer);
  const templateSchema = detectBakaiTemplateSchema(workbook);
  const savedFile = await saveTemplateFile({
    organizationId: input.organizationId,
    fileName: input.upload.fileName,
    buffer: input.upload.buffer,
  });

  return prisma.$transaction(async (tx) => {
    const existing = await tx.bakaiStoreIntegration.findUnique({
      where: { orgId: input.organizationId },
      select: {
        id: true,
        status: true,
        templateFileName: true,
        templateMimeType: true,
        templateFileSize: true,
        templateStoragePath: true,
        templateSchemaJson: true,
        lastSyncAt: true,
        lastErrorSummary: true,
      },
    });

    const mappings = await tx.bakaiStoreStockMapping.findMany({
      where: { orgId: input.organizationId },
      select: { columnKey: true },
    });
    const mappedColumnKeys = new Set(
      mappings.map((mapping) => normalizeStockColumnKey(mapping.columnKey)),
    );
    const nextStatus = resolveStoredIntegrationStatus({
      hasTemplate: true,
      hasTemplateError: false,
      stockColumns: templateSchema.stockColumns,
      mappedColumnKeys,
    });

    const saved = await tx.bakaiStoreIntegration.upsert({
      where: { orgId: input.organizationId },
      update: {
        status: nextStatus,
        templateFileName: input.upload.fileName,
        templateMimeType: input.upload.mimeType,
        templateFileSize: savedFile.fileSize,
        templateStoragePath: savedFile.storagePath,
        templateSchemaJson: toJson(templateSchema),
        lastErrorSummary: null,
      },
      create: {
        orgId: input.organizationId,
        status: nextStatus,
        templateFileName: input.upload.fileName,
        templateMimeType: input.upload.mimeType,
        templateFileSize: savedFile.fileSize,
        templateStoragePath: savedFile.storagePath,
        templateSchemaJson: toJson(templateSchema),
      },
      select: {
        id: true,
        status: true,
        templateFileName: true,
        templateMimeType: true,
        templateFileSize: true,
        templateStoragePath: true,
        templateSchemaJson: true,
        lastSyncAt: true,
        lastErrorSummary: true,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "BAKAI_STORE_TEMPLATE_UPDATED",
      entity: "BakaiStoreIntegration",
      entityId: saved.id,
      before: existing ? toJson(existing) : null,
      after: toJson({
        ...saved,
        templateSchema,
      }),
      requestId: input.requestId,
    });

    return {
      status: resolveOverviewStatus({
        integration: {
          status: saved.status,
          templateStoragePath: saved.templateStoragePath,
          templateSchemaJson: saved.templateSchemaJson,
        },
      }),
      templateSchema,
      template: {
        fileName: saved.templateFileName ?? input.upload.fileName,
        mimeType:
          saved.templateMimeType ??
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileSize: saved.templateFileSize ?? savedFile.fileSize,
      },
    };
  });
};

export const updateBakaiStoreMappings = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  mappings: Array<{
    columnKey: string;
    storeId: string;
  }>;
}) => {
  const normalizedMappings = input.mappings.map((mapping) => ({
    columnKey: normalizeStockColumnKey(mapping.columnKey),
    storeId: mapping.storeId.trim(),
  }));
  const storeIds = normalizedMappings.map((mapping) => mapping.storeId).filter(Boolean);
  await ensureStoreOwnership(input.organizationId, storeIds);

  if (
    new Set(normalizedMappings.map((mapping) => mapping.columnKey)).size !==
    normalizedMappings.length
  ) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  if (new Set(storeIds).size !== storeIds.length) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }

  return prisma.$transaction(async (tx) => {
    const existingMappings = await tx.bakaiStoreStockMapping.findMany({
      where: { orgId: input.organizationId },
      select: { columnKey: true, storeId: true },
    });
    const integrationBefore = await tx.bakaiStoreIntegration.findUnique({
      where: { orgId: input.organizationId },
      select: {
        id: true,
        status: true,
        templateStoragePath: true,
        templateSchemaJson: true,
        lastErrorSummary: true,
      },
    });

    await tx.bakaiStoreStockMapping.deleteMany({
      where: { orgId: input.organizationId },
    });

    if (normalizedMappings.some((mapping) => mapping.storeId)) {
      await tx.bakaiStoreStockMapping.createMany({
        data: normalizedMappings
          .filter((mapping) => mapping.storeId)
          .map((mapping) => ({
            orgId: input.organizationId,
            storeId: mapping.storeId,
            columnKey: mapping.columnKey,
          })),
      });
    }

    const storedTemplateSchema = parseStoredTemplateSchema(integrationBefore?.templateSchemaJson);
    const nextStatus = resolveStoredIntegrationStatus({
      hasTemplate: Boolean(integrationBefore?.templateStoragePath),
      hasTemplateError: Boolean(integrationBefore?.templateStoragePath) && !storedTemplateSchema,
      stockColumns: storedTemplateSchema?.stockColumns ?? [],
      mappedColumnKeys: new Set(normalizedMappings.map((mapping) => mapping.columnKey)),
    });

    const integrationAfter = await tx.bakaiStoreIntegration.upsert({
      where: { orgId: input.organizationId },
      update: {
        status: nextStatus,
        lastErrorSummary: null,
      },
      create: {
        orgId: input.organizationId,
        status: nextStatus,
      },
      select: {
        id: true,
        status: true,
        templateStoragePath: true,
        templateSchemaJson: true,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "BAKAI_STORE_MAPPINGS_UPDATED",
      entity: "BakaiStoreIntegration",
      entityId: integrationAfter.id,
      before: toJson({
        integration: integrationBefore,
        mappings: existingMappings,
      }),
      after: toJson({
        integration: integrationAfter,
        mappings: normalizedMappings,
      }),
      requestId: input.requestId,
    });

    return {
      mappedCount: normalizedMappings.filter((mapping) => mapping.storeId).length,
      status: resolveOverviewStatus({
        integration: {
          status: integrationAfter.status,
          templateStoragePath: integrationAfter.templateStoragePath,
          templateSchemaJson: integrationAfter.templateSchemaJson,
        },
      }),
    };
  });
};

export const listBakaiStoreProducts = async (input: {
  organizationId: string;
  search?: string;
  selection?: BakaiStoreProductSelectionFilter;
  page?: number;
  pageSize?: number;
}) => {
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(10, Math.max(1, Math.trunc(input.pageSize ?? 10)));
  const { baseWhere, where } = buildBakaiProductListWhere(input);

  const [totalProducts, includedProducts, total, products] = await Promise.all([
    prisma.product.count({ where: baseWhere }),
    prisma.product.count({
      where: {
        ...baseWhere,
        bakaiStoreInclusions: {
          some: { orgId: input.organizationId },
        },
      },
    }),
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: {
        id: true,
        sku: true,
        name: true,
        category: true,
        basePriceKgs: true,
        photoUrl: true,
        images: {
          where: {
            AND: [{ url: { not: "" } }, { NOT: { url: { startsWith: "data:image/" } } }],
          },
          select: { url: true },
          orderBy: { position: "asc" },
          take: 1,
        },
        bakaiStoreInclusions: {
          where: { orgId: input.organizationId },
          select: { id: true, lastExportedAt: true },
          take: 1,
        },
      },
      orderBy: [{ name: "asc" }, { sku: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const productIds = products.map((product) => product.id);
  const snapshots = productIds.length
    ? await prisma.inventorySnapshot.findMany({
        where: {
          productId: { in: productIds },
          variantKey: "BASE",
          store: {
            organizationId: input.organizationId,
          },
        },
        select: {
          productId: true,
          onHand: true,
        },
      })
    : [];

  const onHandByProductId = new Map<string, number>();
  for (const snapshot of snapshots) {
    onHandByProductId.set(
      snapshot.productId,
      (onHandByProductId.get(snapshot.productId) ?? 0) + snapshot.onHand,
    );
  }

  return {
    items: products.map((product) => {
      const included = product.bakaiStoreInclusions.length > 0;
      const lastExportedAt = product.bakaiStoreInclusions[0]?.lastExportedAt ?? null;
      return {
        id: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category?.trim() || null,
        priceKgs: product.basePriceKgs === null ? null : Number(product.basePriceKgs),
        imageUrl: resolveBakaiListImageUrl(product),
        onHandQty: onHandByProductId.get(product.id) ?? 0,
        included,
        lastExportedAt,
        exportStatus: resolveBakaiProductExportStatus({
          included,
          lastExportedAt,
        }),
      };
    }),
    total,
    page,
    pageSize,
    summary: {
      totalProducts,
      includedProducts,
      excludedProducts: Math.max(0, totalProducts - includedProducts),
    },
  };
};

export const listBakaiStoreProductIds = async (input: {
  organizationId: string;
  search?: string;
  selection?: BakaiStoreProductSelectionFilter;
}) => {
  const { where } = buildBakaiProductListWhere(input);
  const products = await prisma.product.findMany({
    where,
    select: { id: true },
    orderBy: [{ name: "asc" }, { sku: "asc" }, { id: "asc" }],
  });
  return products.map((product) => product.id);
};

export const updateBakaiStoreProductSelection = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  productIds: string[];
  included: boolean;
}) => {
  const productIds = await ensureProductOwnership(input.organizationId, input.productIds);
  if (!productIds.length) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }

  await prisma.$transaction(async (tx) => {
    if (input.included) {
      await tx.bakaiStoreIncludedProduct.createMany({
        data: productIds.map((productId) => ({
          orgId: input.organizationId,
          productId,
        })),
        skipDuplicates: true,
      });
    } else {
      await tx.bakaiStoreIncludedProduct.deleteMany({
        where: {
          orgId: input.organizationId,
          productId: { in: productIds },
        },
      });
    }

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: BAKAI_PRODUCT_SELECTION_AUDIT_ACTION,
      entity: "BakaiStoreIntegration",
      entityId: input.organizationId,
      before: null,
      after: toJson({
        included: input.included,
        productIds,
      }),
      requestId: input.requestId,
    });
  });

  return {
    updatedCount: productIds.length,
  };
};

export const runBakaiStorePreflight = async (organizationId: string) => {
  const plan = await buildBakaiStoreExportPlan({ organizationId });
  return plan.preflight;
};

export const listBakaiStoreExportJobs = async (organizationId: string, limit = 50) => {
  const take = Math.max(1, Math.min(200, Math.trunc(limit)));
  return prisma.bakaiStoreExportJob.findMany({
    where: { orgId: organizationId },
    orderBy: { createdAt: "desc" },
    take,
  });
};

export const getBakaiStoreExportJob = async (organizationId: string, jobId: string) => {
  return prisma.bakaiStoreExportJob.findFirst({
    where: {
      id: jobId,
      orgId: organizationId,
    },
  });
};

export const requestBakaiStoreExport = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  mode?: BakaiStoreExportMode;
}) => {
  const integration = await prisma.bakaiStoreIntegration.findUnique({
    where: { orgId: input.organizationId },
    select: {
      id: true,
      templateStoragePath: true,
      templateSchemaJson: true,
    },
  });
  if (
    !integration?.templateStoragePath ||
    !parseStoredTemplateSchema(integration.templateSchemaJson)
  ) {
    throw new AppError("bakaiStoreNotConfigured", "CONFLICT", 409);
  }

  const activeJob = await prisma.bakaiStoreExportJob.findFirst({
    where: {
      orgId: input.organizationId,
      status: {
        in: [BakaiStoreExportJobStatus.QUEUED, BakaiStoreExportJobStatus.RUNNING],
      },
    },
    select: { id: true },
  });
  if (activeJob) {
    throw new AppError("requestInProgress", "CONFLICT", 409);
  }

  const plan = await buildBakaiStoreExportPlan({
    organizationId: input.organizationId,
    mode: input.mode,
  });
  if (!plan.preflight.canExport) {
    throw new AppError("bakaiStorePreflightFailed", "CONFLICT", 409);
  }

  const requestIdempotencyKey = randomUUID();
  const queuedJob = await prisma.bakaiStoreExportJob.create({
    data: {
      orgId: input.organizationId,
      status: BakaiStoreExportJobStatus.QUEUED,
      requestedById: input.actorId,
      requestIdempotencyKey,
      payloadStatsJson: toJson(plan.payloadStats),
    },
  });

  await writeAuditLog(prisma, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: "BAKAI_STORE_EXPORT_STARTED",
    entity: "BakaiStoreExportJob",
    entityId: queuedJob.id,
    before: null,
    after: toJson({
      id: queuedJob.id,
      status: queuedJob.status,
      createdAt: queuedJob.createdAt,
      payloadStats: plan.payloadStats,
    }),
    requestId: input.requestId,
  });

  if (process.env.NODE_ENV !== "test") {
    void runJob(BAKAI_STORE_EXPORT_JOB_NAME, {
      jobId: queuedJob.id,
      organizationId: input.organizationId,
      requestId: input.requestId,
      mode: plan.mode,
    }).catch(() => null);
  }

  return {
    job: queuedJob,
  };
};

const runBakaiStoreExportJob = async (
  payload?: JobPayload,
): Promise<{ job: string; status: "ok" | "skipped"; details?: Record<string, unknown> }> => {
  const requestPayload =
    payload && typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  const jobId = typeof requestPayload.jobId === "string" ? requestPayload.jobId : "";

  const job = jobId
    ? await prisma.bakaiStoreExportJob.findFirst({
        where: { id: jobId, status: BakaiStoreExportJobStatus.QUEUED },
      })
    : await prisma.bakaiStoreExportJob.findFirst({
        where: { status: BakaiStoreExportJobStatus.QUEUED },
        orderBy: { createdAt: "asc" },
      });

  if (!job) {
    return { job: BAKAI_STORE_EXPORT_JOB_NAME, status: "skipped", details: { reason: "empty" } };
  }

  const running = await prisma.bakaiStoreExportJob.update({
    where: { id: job.id },
    data: {
      status: BakaiStoreExportJobStatus.RUNNING,
      startedAt: new Date(),
      finishedAt: null,
      storagePath: null,
      fileName: null,
      mimeType: null,
      fileSize: null,
      errorReportJson: Prisma.DbNull,
    },
  });

  let plan: BakaiStoreExportPlan | null = null;

  try {
    plan = await buildBakaiStoreExportPlan({
      organizationId: job.orgId,
      mode: normalizeBakaiExportMode(asRecord(job.payloadStatsJson)?.exportMode),
    });
    if (!plan.preflight.canExport || !plan.templatePath || !plan.templateSchema) {
      throw new AppError("bakaiStorePreflightFailed", "CONFLICT", 409);
    }

    const templateBuffer = await fs.readFile(plan.templatePath);
    const workbook = await renderBakaiStoreWorkbookFromTemplate({
      templateBuffer,
      templateSchema: plan.templateSchema,
      rows: plan.exportRows,
    });

    const fileName = `bakai-store-export-${job.id}.xlsx`;
    const savedFile = await writePrivateFile({
      organizationId: job.orgId,
      directory: "exports",
      fileName,
      buffer: workbook,
    });

    const finishedAt = new Date();
    const finished = await prisma.bakaiStoreExportJob.update({
      where: { id: job.id },
      data: {
        status: BakaiStoreExportJobStatus.DONE,
        finishedAt,
        fileName,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileSize: savedFile.fileSize,
        storagePath: savedFile.storagePath,
        payloadStatsJson: toJson({
          ...plan.payloadStats,
          workbookBytes: savedFile.fileSize,
        }),
        errorReportJson: Prisma.DbNull,
      },
    });

    if (plan.preflight.readyProductIds.length > 0) {
      await prisma.bakaiStoreIncludedProduct.updateMany({
        where: {
          orgId: job.orgId,
          productId: { in: plan.preflight.readyProductIds },
        },
        data: {
          lastExportedAt: finishedAt,
        },
      });
    }

    await prisma.bakaiStoreIntegration.updateMany({
      where: { orgId: job.orgId },
      data: {
        status: BakaiStoreIntegrationStatus.READY,
        lastSyncAt: finishedAt,
        lastErrorSummary: null,
      },
    });

    await writeAuditLog(prisma, {
      organizationId: job.orgId,
      actorId: job.requestedById,
      action: "BAKAI_STORE_EXPORT_FINISHED",
      entity: "BakaiStoreExportJob",
      entityId: finished.id,
      before: toJson(running),
      after: toJson(finished),
      requestId:
        typeof requestPayload.requestId === "string" ? requestPayload.requestId : randomUUID(),
    });

    return {
      job: BAKAI_STORE_EXPORT_JOB_NAME,
      status: "ok",
      details: {
        jobId: finished.id,
        exportedProducts: plan.exportRows.length,
      },
    };
  } catch (error) {
    const message = error instanceof AppError ? error.message : "bakaiStoreExportFailed";
    const errorReport = toJson(
      plan
        ? buildBakaiErrorReport({
            mode: plan.mode,
            templateSchema: plan.templateSchema,
            preflight: plan.preflight,
            payloadStats: plan.payloadStats,
            rows: plan.exportRows,
            reason: message,
          })
        : {
            reason: message,
          },
    );

    const failed = await prisma.bakaiStoreExportJob.update({
      where: { id: job.id },
      data: {
        status: BakaiStoreExportJobStatus.FAILED,
        finishedAt: new Date(),
        errorReportJson: errorReport,
      },
    });

    await prisma.bakaiStoreIntegration.updateMany({
      where: { orgId: job.orgId },
      data: {
        status: BakaiStoreIntegrationStatus.ERROR,
        lastErrorSummary: message,
      },
    });

    await writeAuditLog(prisma, {
      organizationId: job.orgId,
      actorId: job.requestedById,
      action: "BAKAI_STORE_EXPORT_FAILED",
      entity: "BakaiStoreExportJob",
      entityId: failed.id,
      before: toJson(running),
      after: toJson({ ...failed, errorReport }),
      requestId:
        typeof requestPayload.requestId === "string" ? requestPayload.requestId : randomUUID(),
    });

    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("bakaiStoreExportFailed", "INTERNAL_SERVER_ERROR", 500);
  }
};

registerJob(BAKAI_STORE_EXPORT_JOB_NAME, {
  handler: runBakaiStoreExportJob,
  maxAttempts: 1,
  baseDelayMs: 1,
});

export const __buildBakaiStoreExportPlanForTests = async (
  organizationId: string,
  mode: BakaiStoreExportMode = "ALL_SELECTED",
) => {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("testOnly");
  }
  return buildBakaiStoreExportPlan({
    organizationId,
    mode,
  });
};
