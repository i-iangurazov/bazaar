import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, extname, join } from "node:path";

import {
  BakaiStoreConnectionMode,
  BakaiStoreExportJobStatus,
  BakaiStoreIntegrationStatus,
  BakaiStoreJobType,
  BakaiStoreLastSyncStatus,
  Prisma,
} from "@prisma/client";
import * as XLSX from "xlsx";

import { prisma } from "@/server/db/prisma";
import { registerJob, runJob, type JobPayload } from "@/server/jobs";
import { writeAuditLog } from "@/server/services/audit";
import {
  BAKAI_STORE_MAX_PRODUCTS_PER_REQUEST,
  BAKAI_STORE_REQUEST_TIMEOUT_MS,
  getBakaiStoreImportEndpoint,
  probeBakaiStoreConnection,
  sendBakaiStoreProducts,
  type BakaiStoreApiPayload,
  type BakaiStoreApiProduct,
} from "@/server/services/bakaiStoreApiClient";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";
import { normalizeProductImageUrl } from "@/server/services/productImageStorage";

const BAKAI_STORE_EXPORT_JOB_NAME = "bakai-store-export";
const BAKAI_STORE_API_SYNC_JOB_NAME = "bakai-store-api-sync";
const BAKAI_STORE_STORAGE_ROOT = join(process.cwd(), "uploads", "bakai-store");
const BAKAI_TEMPLATE_MAX_BYTES = 10 * 1024 * 1024;
const BAKAI_PRODUCT_SELECTION_AUDIT_ACTION = "BAKAI_STORE_PRODUCT_SELECTION_UPDATED";
const BAKAI_STORE_MIN_NAME_LEN = 7;
const BAKAI_STORE_MAX_NAME_LEN = 250;
const BAKAI_STORE_MIN_DESCRIPTION_LEN = 50;
const BAKAI_STORE_MIN_IMAGES = 3;
const BAKAI_IMAGE_EXTENSION_PATTERN = /\.(jpg|png|webp)(?:\?.*)?$/i;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const BAKAI_STOCK_COLUMN_PATTERN = /^pp\d+$/i;

export type BakaiStoreOverviewStatus = "NOT_CONFIGURED" | "DRAFT" | "READY" | "ERROR";
export type BakaiStoreProductSelectionFilter = "all" | "included" | "excluded";
export type BakaiStoreProductExportStatus = "EXCLUDED" | "INCLUDED" | "EXPORTED";
export type BakaiStoreExportMode = "ALL_SELECTED" | "READY_ONLY";
export type BakaiStorePreflightMode = "TEMPLATE" | "API";

export type BakaiStorePreflightIssueCode =
  | "NO_PRODUCTS_SELECTED"
  | "MISSING_API_TOKEN"
  | "CONNECTION_TEST_FAILED"
  | "TOO_MANY_PRODUCTS_IN_SINGLE_BATCH"
  | "MISSING_SKU"
  | "DUPLICATE_SKU"
  | "INVALID_SKU"
  | "MISSING_NAME"
  | "INVALID_NAME"
  | "INVALID_NAME_LENGTH"
  | "MISSING_PRICE"
  | "INVALID_PRICE"
  | "MISSING_CATEGORY"
  | "MISSING_DESCRIPTION"
  | "DESCRIPTION_TOO_SHORT"
  | "MISSING_IMAGES"
  | "NOT_ENOUGH_IMAGES"
  | "INVALID_IMAGE_URL"
  | "MISSING_STOCK"
  | "MISSING_BRANCH_ID"
  | "MULTIPLE_BRANCH_MAPPINGS_UNSUPPORTED"
  | "INVALID_BRANCH_ID"
  | "INVALID_QUANTITY"
  | "DISCOUNT_CONFLICT"
  | "INVALID_DISCOUNT_PERCENT"
  | "INVALID_DISCOUNT_AMOUNT"
  | "INVALID_SIMILAR_PRODUCTS"
  | "MISSING_SPECS"
  | "INVALID_SPECS"
  | "MISSING_STOCK_MAPPING"
  | "INVALID_STOCK_VALUE"
  | "TEMPLATE_RENDER_ERROR"
  | "API_PAYLOAD_INVALID"
  | "API_REQUEST_FAILED"
  | "RATE_LIMITED";

export type BakaiStorePreflightWarningCode = "FULL_UPLOAD_RISK_WARNING";

export type BakaiStorePreflightResult = {
  mode: BakaiStorePreflightMode;
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
    missingStoreMappings: Array<{ columnKey?: string; storeId?: string; storeName?: string }>;
  };
  warnings: {
    total: number;
    byCode: Partial<Record<BakaiStorePreflightWarningCode, number>>;
    global: BakaiStorePreflightWarningCode[];
  };
  failedProducts: Array<{
    productId: string;
    sku: string;
    name: string;
    issues: BakaiStorePreflightIssueCode[];
  }>;
  readyProductIds: string[];
  actionability: {
    canRunAll: boolean;
    canRunReadyOnly: boolean;
  };
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

export type BakaiStoreApiStockRow = {
  branch_id: number | null;
  quantity: number | null;
};

export type BakaiStoreApiProductPayload = BakaiStoreApiProduct;

type BakaiStoreApiPreflightPlan = {
  mode: BakaiStoreExportMode;
  preflight: BakaiStorePreflightResult;
  payload: BakaiStoreApiPayload;
  payloadByProductId: Map<string, BakaiStoreApiProductPayload>;
  selectedProductIds: string[];
  readyProductIds: string[];
  payloadStats: Record<string, unknown>;
  errorReport: Record<string, unknown>;
};

const normalizeSearch = (value?: string | null) => value?.trim() ?? "";

const nonDataImagePattern = /^data:image\//i;

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const toBase64Url = (value: Buffer) => value.toString("base64url");

const fromBase64Url = (value: string) => Buffer.from(value, "base64url");

const resolveTokenSecret = () =>
  process.env.BAKAI_STORE_TOKEN_ENCRYPTION_KEY?.trim() ||
  process.env.NEXTAUTH_SECRET?.trim() ||
  "";

const tokenCipherKey = () => {
  const secret = resolveTokenSecret();
  if (!secret) {
    throw new AppError("bakaiStoreTokenSecretMissing", "INTERNAL_SERVER_ERROR", 500);
  }
  return createHash("sha256").update(secret).digest();
};

const encryptToken = (raw: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenCipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${toBase64Url(iv)}.${toBase64Url(tag)}.${toBase64Url(encrypted)}`;
};

const decryptToken = (encrypted: string) => {
  const [version, ivPart, tagPart, dataPart] = encrypted.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !dataPart) {
    throw new AppError("bakaiStoreTokenDecryptFailed", "INTERNAL_SERVER_ERROR", 500);
  }
  const decipher = createDecipheriv("aes-256-gcm", tokenCipherKey(), fromBase64Url(ivPart));
  decipher.setAuthTag(fromBase64Url(tagPart));
  const decrypted = Buffer.concat([decipher.update(fromBase64Url(dataPart)), decipher.final()]);
  return decrypted.toString("utf8");
};

const normalizeColumnKey = (value: string) => value.trim().toLowerCase();

const normalizeStockColumnKey = (value: string) => normalizeColumnKey(value);

const isBakaiStockColumnKey = (value: string) => BAKAI_STOCK_COLUMN_PATTERN.test(value.trim());

const normalizeSku = (value: string) => value.trim().toUpperCase();

const parseBranchId = (value: string) => {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const redactSensitiveText = (value: string, token?: string | null) => {
  let next = value;
  if (token?.trim()) {
    next = next.split(token.trim()).join("[REDACTED]");
  }
  return next.replace(
    /Authorization\s*:\s*(?:Token|Bearer)\s+[^\s"]+/gi,
    "Authorization: Bearer [REDACTED]",
  );
};

const toErrorMessage = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.message;
  }
  return "bakaiStoreApiRequestFailed";
};

const sanitizeUnknown = (value: unknown, token?: string | null): unknown => {
  if (typeof value === "string") {
    return redactSensitiveText(value, token);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeUnknown(entry, token));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        key.toLowerCase().includes("token") ? "[REDACTED]" : sanitizeUnknown(nested, token),
      ]),
    );
  }
  return value;
};

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

const collectImageUrls = (product: {
  photoUrl: string | null;
  images: Array<{ url: string; position?: number }>;
}) => {
  const ordered = [...product.images]
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
    .map((item) => item.url?.trim() ?? "")
    .filter(Boolean);
  const source = [product.photoUrl?.trim() ?? "", ...ordered].filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of source) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
};

export const chunkBakaiStoreItems = <TItem>(items: TItem[], size: number) => {
  const result: TItem[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

const resolveConnectionMode = (value: unknown): BakaiStoreConnectionMode =>
  value === BakaiStoreConnectionMode.API
    ? BakaiStoreConnectionMode.API
    : BakaiStoreConnectionMode.TEMPLATE;

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const computeBakaiPayloadChecksum = (value: unknown) =>
  createHash("sha256").update(stableJson(value)).digest("hex");

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
  connectionMode: BakaiStoreConnectionMode;
  hasTemplate: boolean;
  hasTemplateError: boolean;
  stockColumns: string[];
  mappedColumnKeys: Set<string>;
  hasApiToken: boolean;
  hasApiBranchMappings: boolean;
}) => {
  if (input.connectionMode === BakaiStoreConnectionMode.API) {
    if (!input.hasApiToken) {
      return BakaiStoreIntegrationStatus.DISABLED;
    }
    return input.hasApiBranchMappings
      ? BakaiStoreIntegrationStatus.READY
      : BakaiStoreIntegrationStatus.DRAFT;
  }

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
    connectionMode: BakaiStoreConnectionMode;
    templateStoragePath: string | null;
    templateSchemaJson: Prisma.JsonValue | null;
    apiTokenEncrypted?: string | null;
    hasApiBranchMappings?: boolean;
  } | null;
}) => {
  if (!input.integration) {
    return "NOT_CONFIGURED" as const;
  }
  if (input.integration.connectionMode === BakaiStoreConnectionMode.API) {
    if (!input.integration.apiTokenEncrypted) {
      return "NOT_CONFIGURED" as const;
    }
    if (input.integration.status === BakaiStoreIntegrationStatus.ERROR) {
      return "ERROR" as const;
    }
    if (input.integration.hasApiBranchMappings) {
      return "READY" as const;
    }
    return "DRAFT" as const;
  }
  if (!input.integration.templateStoragePath) {
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

const toSpecString = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const normalized = value
      .map((entry) => toSpecString(entry))
      .filter((entry): entry is string => Boolean(entry));
    return normalized.length ? normalized.join(", ") : null;
  }
  return null;
};

export const pruneOptionalBakaiFields = <TValue>(value: TValue): TValue => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => pruneOptionalBakaiFields(entry))
      .filter((entry) => {
        if (entry === null || entry === undefined) {
          return false;
        }
        if (Array.isArray(entry)) {
          return entry.length > 0;
        }
        if (typeof entry === "object") {
          return Object.keys(entry as Record<string, unknown>).length > 0;
        }
        return true;
      }) as TValue;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, entry]) => [key, pruneOptionalBakaiFields(entry)])
        .filter(([, entry]) => {
          if (entry === null || entry === undefined) {
            return false;
          }
          if (Array.isArray(entry)) {
            return entry.length > 0;
          }
          if (typeof entry === "object") {
            return Object.keys(entry as Record<string, unknown>).length > 0;
          }
          return true;
        }),
    ) as TValue;
  }
  return value;
};

export const validateBakaiImages = (imageUrls: string[]) => {
  const normalized = imageUrls
    .map((value) => normalizeProductImageUrl(value))
    .filter((value): value is string => Boolean(value))
    .filter((value) => !nonDataImagePattern.test(value));

  const issues: BakaiStorePreflightIssueCode[] = [];
  if (!normalized.length) {
    addIssue(issues, "MISSING_IMAGES");
  } else if (normalized.length < BAKAI_STORE_MIN_IMAGES) {
    addIssue(issues, "NOT_ENOUGH_IMAGES");
  }
  if (normalized.some((value) => !BAKAI_IMAGE_EXTENSION_PATTERN.test(value))) {
    addIssue(issues, "INVALID_IMAGE_URL");
  }
  return {
    normalized,
    issues,
  };
};

type BakaiSpecTemplate = {
  category: string;
  attributeKey: string;
  label: string;
};

type BakaiSelectedApiProduct = {
  productId: string;
  discountPercent: Prisma.Decimal | null;
  discountAmount: Prisma.Decimal | null;
  lastExportedAt: Date | null;
  product: {
    id: string;
    sku: string;
    name: string;
    category: string | null;
    description: string | null;
    basePriceKgs: Prisma.Decimal | null;
    photoUrl: string | null;
    supplier: { name: string } | null;
    images: Array<{ url: string; position: number }>;
  };
};

const buildTemplateSpecsByCategory = (templates: BakaiSpecTemplate[]) => {
  const result = new Map<string, BakaiSpecTemplate[]>();
  for (const template of templates) {
    const current = result.get(template.category) ?? [];
    current.push(template);
    result.set(template.category, current);
  }
  return result;
};

const buildVariantValuesByProduct = (
  rows: Array<{ productId: string; key: string; value: Prisma.JsonValue }>,
) => {
  const result = new Map<string, Map<string, string[]>>();
  for (const row of rows) {
    const normalized = toSpecString(row.value);
    if (!normalized) {
      continue;
    }
    const byKey = result.get(row.productId) ?? new Map<string, string[]>();
    const existing = byKey.get(row.key) ?? [];
    if (!existing.includes(normalized)) {
      existing.push(normalized);
      byKey.set(row.key, existing);
    }
    result.set(row.productId, byKey);
  }
  return result;
};

export const buildBakaiStoreSpecs = (input: {
  productId: string;
  category: string | null;
  templatesByCategory: Map<string, BakaiSpecTemplate[]>;
  valuesByProduct: Map<string, Map<string, string[]>>;
}) => {
  const issues: BakaiStorePreflightIssueCode[] = [];
  const category = input.category?.trim() ?? "";
  if (!category) {
    addIssue(issues, "MISSING_CATEGORY");
    return { specs: {}, attributes: [], issues };
  }

  const templates = input.templatesByCategory.get(category) ?? [];
  if (!templates.length) {
    addIssue(issues, "MISSING_SPECS");
    return { specs: {}, attributes: [], issues };
  }

  const valuesByKey = input.valuesByProduct.get(input.productId) ?? new Map<string, string[]>();
  const specs: Record<string, string> = {};
  for (const template of templates) {
    const values = valuesByKey.get(template.attributeKey) ?? [];
    const first = values[0]?.trim();
    if (!first) {
      addIssue(issues, "MISSING_SPECS");
      continue;
    }
    specs[template.label] = first;
  }

  if (!Object.keys(specs).length) {
    addIssue(issues, "INVALID_SPECS");
  }

  return {
    specs,
    attributes: Object.entries(specs).map(([name, value]) => ({ name, value })),
    issues,
  };
};

export const buildBakaiStoreStock = (input: {
  mappedBranches: Array<{ storeId: string; branchId: string }>;
  snapshotByStore: Map<string, number>;
}) => {
  const issues: BakaiStorePreflightIssueCode[] = [];
  if (!input.mappedBranches.length) {
    addIssue(issues, "MISSING_STOCK");
    addIssue(issues, "MISSING_BRANCH_ID");
    return { branch_id: null, quantity: null, issues };
  }

  if (input.mappedBranches.length > 1) {
    addIssue(issues, "MULTIPLE_BRANCH_MAPPINGS_UNSUPPORTED");
  }

  const primaryMapping = input.mappedBranches[0] ?? null;
  const parsedBranchId = primaryMapping ? parseBranchId(primaryMapping.branchId) : null;
  if (primaryMapping && parsedBranchId === null) {
    addIssue(issues, "INVALID_BRANCH_ID");
  }
  const rawQuantity = primaryMapping ? (input.snapshotByStore.get(primaryMapping.storeId) ?? 0) : 0;
  if (!Number.isInteger(rawQuantity) || rawQuantity < 0) {
    addIssue(issues, "INVALID_QUANTITY");
  }

  return {
    branch_id: parsedBranchId,
    quantity: Number.isInteger(rawQuantity) && rawQuantity >= 0 ? rawQuantity : 0,
    issues,
  };
};

export const mapBazaarProductToBakaiProduct = (input: {
  selection: BakaiSelectedApiProduct;
  mappedBranches: Array<{ storeId: string; branchId: string }>;
  snapshotByStore: Map<string, number>;
  templatesByCategory: Map<string, BakaiSpecTemplate[]>;
  valuesByProduct: Map<string, Map<string, string[]>>;
}) => {
  const issues: BakaiStorePreflightIssueCode[] = [];
  const sku = input.selection.product.sku?.trim() ?? "";
  const name = input.selection.product.name?.trim() ?? "";
  const category = input.selection.product.category?.trim() ?? "";
  const description = input.selection.product.description?.trim() ?? "";
  const price = normalizeBakaiNumericValue(input.selection.product.basePriceKgs);
  const discountPercent = normalizeBakaiNumericValue(input.selection.discountPercent);
  const discountAmount = normalizeBakaiNumericValue(input.selection.discountAmount);

  if (!sku) {
    addIssue(issues, "MISSING_SKU");
  } else if (CONTROL_CHARACTER_PATTERN.test(sku)) {
    addIssue(issues, "INVALID_SKU");
  }

  if (!name) {
    addIssue(issues, "MISSING_NAME");
  } else if (
    name.length < BAKAI_STORE_MIN_NAME_LEN ||
    name.length > BAKAI_STORE_MAX_NAME_LEN ||
    CONTROL_CHARACTER_PATTERN.test(name)
  ) {
    addIssue(issues, "INVALID_NAME_LENGTH");
  }

  if (price === null) {
    addIssue(issues, "MISSING_PRICE");
  } else if (!Number.isFinite(price) || price < 0) {
    addIssue(issues, "INVALID_PRICE");
  }

  if (!category) {
    addIssue(issues, "MISSING_CATEGORY");
  }

  if (!description) {
    addIssue(issues, "MISSING_DESCRIPTION");
  } else if (description.length < BAKAI_STORE_MIN_DESCRIPTION_LEN) {
    addIssue(issues, "DESCRIPTION_TOO_SHORT");
  }

  const imageValidation = validateBakaiImages(
    collectImageUrls({
      photoUrl: input.selection.product.photoUrl,
      images: input.selection.product.images,
    }),
  );
  for (const issue of imageValidation.issues) {
    addIssue(issues, issue);
  }

  if (discountPercent !== null && Number.isFinite(discountPercent)) {
    addIssue(issues, "INVALID_DISCOUNT_PERCENT");
  }
  if (discountAmount !== null && (!Number.isFinite(discountAmount) || discountAmount < 0)) {
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

  const specs = buildBakaiStoreSpecs({
    productId: input.selection.productId,
    category: input.selection.product.category,
    templatesByCategory: input.templatesByCategory,
    valuesByProduct: input.valuesByProduct,
  });
  for (const issue of specs.issues) {
    addIssue(issues, issue);
  }

  const stock = buildBakaiStoreStock({
    mappedBranches: input.mappedBranches,
    snapshotByStore: input.snapshotByStore,
  });
  for (const issue of stock.issues) {
    addIssue(issues, issue);
  }

  if (issues.length > 0) {
    return { payload: null, issues };
  }

  const payload = pruneOptionalBakaiFields({
    name,
    sku,
    price: Number(price ?? 0),
    category_name: category,
    description,
    images: imageValidation.normalized,
    branch_id: stock.branch_id ?? undefined,
    quantity: stock.quantity ?? undefined,
    attributes: specs.attributes,
    brand_name: input.selection.product.supplier?.name?.trim() || undefined,
    discount_amount:
      discountAmount !== null && Number.isFinite(discountAmount) ? Number(discountAmount) : undefined,
    is_active: true,
  }) as BakaiStoreApiProductPayload;

  return { payload, issues };
};

const normalizeBakaiApiIssueCode = (input: {
  status: number | null;
  body: unknown;
  message?: string;
}): BakaiStorePreflightIssueCode => {
  if (input.status === 429) {
    return "RATE_LIMITED";
  }
  const bodyText =
    typeof input.body === "string" ? input.body.toLowerCase() : JSON.stringify(input.body).toLowerCase();
  const message = input.message?.toLowerCase() ?? "";
  if (bodyText.includes("rate") || message.includes("rate")) {
    return "RATE_LIMITED";
  }
  return "API_REQUEST_FAILED";
};

export const normalizeBakaiApiError = (input: {
  status: number | null;
  body: unknown;
  error?: unknown;
  token?: string | null;
}) => {
  const code = normalizeBakaiApiIssueCode({
    status: input.status,
    body: input.body,
    message: toErrorMessage(input.error),
  });

  return {
    code,
    status: input.status,
    retryable: input.status === 429 || (input.status !== null && input.status >= 500),
    body: sanitizeUnknown(input.body, input.token),
    message: redactSensitiveText(toErrorMessage(input.error ?? input.body), input.token),
  };
};

export const buildBakaiStoreApiPayload = async (input: {
  organizationId: string;
  mode?: BakaiStoreExportMode;
}): Promise<BakaiStoreApiPreflightPlan> => {
  const syncMode = normalizeBakaiExportMode(input.mode);
  const [integration, selectedProducts, branchMappings, stores] = await Promise.all([
    prisma.bakaiStoreIntegration.findUnique({
      where: { orgId: input.organizationId },
      select: {
        orgId: true,
        connectionMode: true,
        apiTokenEncrypted: true,
      },
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
            category: true,
            description: true,
            basePriceKgs: true,
            photoUrl: true,
            supplier: { select: { name: true } },
            images: {
              where: {
                AND: [{ url: { not: "" } }, { NOT: { url: { startsWith: "data:image/" } } }],
              },
              select: { url: true, position: true },
              orderBy: { position: "asc" },
            },
          },
        },
      },
      orderBy: [{ product: { name: "asc" } }, { product: { sku: "asc" } }],
    }),
    prisma.bakaiStoreBranchMapping.findMany({
      where: { orgId: input.organizationId },
      select: {
        storeId: true,
        bakaiBranchId: true,
        store: { select: { id: true, name: true } },
      },
      orderBy: { store: { name: "asc" } },
    }),
    prisma.store.findMany({
      where: { organizationId: input.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const selectedProductIds = selectedProducts.map((row) => row.productId);
  const mappedStoreIds = branchMappings.map((mapping) => mapping.storeId);
  const [snapshots, categoryTemplates, variantValues] = await Promise.all([
    selectedProductIds.length && mappedStoreIds.length
      ? prisma.inventorySnapshot.findMany({
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
      : Promise.resolve([]),
    prisma.categoryAttributeTemplate.findMany({
      where: {
        organizationId: input.organizationId,
        category: {
          in: Array.from(
            new Set(
              selectedProducts
                .map((row) => row.product.category?.trim() ?? "")
                .filter((value) => value.length > 0),
            ),
          ),
        },
      },
      select: {
        category: true,
        attributeKey: true,
        definition: { select: { labelRu: true } },
      },
      orderBy: [{ category: "asc" }, { order: "asc" }],
    }),
    selectedProductIds.length
      ? prisma.variantAttributeValue.findMany({
          where: {
            organizationId: input.organizationId,
            productId: { in: selectedProductIds },
          },
          select: {
            productId: true,
            key: true,
            value: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const stockByProductStore = new Map<string, Map<string, number>>();
  for (const snapshot of snapshots) {
    const byStore = stockByProductStore.get(snapshot.productId) ?? new Map<string, number>();
    byStore.set(snapshot.storeId, snapshot.onHand);
    stockByProductStore.set(snapshot.productId, byStore);
  }

  const templatesByCategory = buildTemplateSpecsByCategory(
    categoryTemplates
      .filter((template) => template.definition?.labelRu?.trim())
      .map((template) => ({
        category: template.category,
        attributeKey: template.attributeKey,
        label: template.definition?.labelRu?.trim() ?? template.attributeKey,
      })),
  );
  const valuesByProduct = buildVariantValuesByProduct(variantValues);

  const missingStoreMappings = stores
    .filter((store) => !branchMappings.some((mapping) => mapping.storeId === store.id))
    .map((store) => ({
      storeId: store.id,
      storeName: store.name,
    }));

  const payloadProducts: BakaiStoreApiProductPayload[] = [];
  const payloadByProductId = new Map<string, BakaiStoreApiProductPayload>();
  const readyProductIds: string[] = [];
  const failedProducts: BakaiStorePreflightResult["failedProducts"] = [];
  const seenSkus = new Set<string>();

  for (const selection of selectedProducts) {
    const issues: BakaiStorePreflightIssueCode[] = [];
    const normalizedSku = normalizeSku(selection.product.sku ?? "");
    if (normalizedSku && seenSkus.has(normalizedSku)) {
      addIssue(issues, "DUPLICATE_SKU");
    }
    if (normalizedSku) {
      seenSkus.add(normalizedSku);
    }

    const mapped = mapBazaarProductToBakaiProduct({
      selection,
      mappedBranches: branchMappings.map((mapping) => ({
        storeId: mapping.storeId,
        branchId: mapping.bakaiBranchId,
      })),
      snapshotByStore: stockByProductStore.get(selection.productId) ?? new Map<string, number>(),
      templatesByCategory,
      valuesByProduct,
    });

    for (const issue of mapped.issues) {
      addIssue(issues, issue);
    }

    if (missingStoreMappings.length > 0) {
      addIssue(issues, "MISSING_BRANCH_ID");
    }

    if (issues.length > 0 || !mapped.payload) {
      failedProducts.push({
        productId: selection.productId,
        sku: selection.product.sku ?? "",
        name: selection.product.name ?? "",
        issues,
      });
      continue;
    }

    readyProductIds.push(selection.productId);
    payloadProducts.push(mapped.payload);
    payloadByProductId.set(selection.productId, mapped.payload);
  }

  const endpointConfigured = Boolean(process.env.BAKAI_STORE_IMPORT_ENDPOINT?.trim());
  const warnings: BakaiStorePreflightWarningCode[] = [];
  if (
    selectedProducts.length > 0 &&
    readyProductIds.length > 0 &&
    readyProductIds.length < selectedProducts.length
  ) {
    warnings.push("FULL_UPLOAD_RISK_WARNING");
  }

  const canRunAll =
    selectedProducts.length > 0 &&
    failedProducts.length === 0 &&
    Boolean(integration?.apiTokenEncrypted) &&
    missingStoreMappings.length === 0 &&
    endpointConfigured;
  const canRunReadyOnly =
    readyProductIds.length > 0 &&
    readyProductIds.length === selectedProducts.length &&
    Boolean(integration?.apiTokenEncrypted) &&
    missingStoreMappings.length === 0 &&
    endpointConfigured;

  const blockerCounts = countByCode(failedProducts.map((row) => ({ codes: row.issues })));
  if (selectedProducts.length === 0) {
    blockerCounts.NO_PRODUCTS_SELECTED = 1;
  }
  if (!integration?.apiTokenEncrypted) {
    blockerCounts.MISSING_API_TOKEN = (blockerCounts.MISSING_API_TOKEN ?? 0) + 1;
  }
  if (payloadProducts.length > BAKAI_STORE_MAX_PRODUCTS_PER_REQUEST) {
    blockerCounts.TOO_MANY_PRODUCTS_IN_SINGLE_BATCH = 1;
  }

  const preflight: BakaiStorePreflightResult = {
    mode: "API",
    generatedAt: new Date(),
    canExport: canRunAll,
    summary: {
      productsConsidered: selectedProducts.length,
      productsReady: readyProductIds.length,
      productsFailed: failedProducts.length,
      warnings: warnings.length,
    },
    blockers: {
      total:
        failedProducts.length +
        (selectedProducts.length === 0 ? 1 : 0) +
        (!integration?.apiTokenEncrypted ? 1 : 0),
      byCode: blockerCounts,
      missingStoreMappings,
    },
    warnings: {
      total: warnings.length,
      byCode: warnings.reduce<Partial<Record<BakaiStorePreflightWarningCode, number>>>(
        (accumulator, warning) => {
          accumulator[warning] = (accumulator[warning] ?? 0) + 1;
          return accumulator;
        },
        {},
      ),
      global: warnings,
    },
    failedProducts,
    readyProductIds,
    actionability: {
      canRunAll,
      canRunReadyOnly,
    },
  };

  const payload = {
    products: payloadProducts,
  } satisfies BakaiStoreApiPayload;

  const payloadStats = {
    jobType: BakaiStoreJobType.API_SYNC,
    exportMode: syncMode,
    productCount: payload.products.length,
    selectedProducts: selectedProducts.length,
    readyProducts: readyProductIds.length,
    failedProducts: failedProducts.length,
    batchCount: chunkBakaiStoreItems(payload.products, BAKAI_STORE_MAX_PRODUCTS_PER_REQUEST).length,
    fullUploadRisk: warnings.includes("FULL_UPLOAD_RISK_WARNING"),
    endpointConfigured,
  };

  return {
    mode: syncMode,
    preflight,
    payload,
    payloadByProductId,
    selectedProductIds,
    readyProductIds,
    payloadStats,
    errorReport: {
      generatedAt: preflight.generatedAt.toISOString(),
      mode: syncMode,
      summary: preflight.summary,
      blockers: preflight.blockers,
      warnings: preflight.warnings,
      failedProducts: preflight.failedProducts,
      payloadStats,
    },
  };
};

export const runBakaiStoreApiPreflight = async (organizationId: string) => {
  const plan = await buildBakaiStoreApiPayload({ organizationId });
  return plan.preflight;
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
    mode: "TEMPLATE",
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
    actionability: {
      canRunAll: selectedProducts.length > 0 && failedProducts.length === 0 && !globalTemplateError,
      canRunReadyOnly: readyProductIds.length > 0,
    },
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
  const [integration, mappings, branchMappings] = await Promise.all([
    prisma.bakaiStoreIntegration.findUnique({
      where: { orgId: organizationId },
      select: {
        status: true,
        connectionMode: true,
        templateStoragePath: true,
        templateFileName: true,
        templateSchemaJson: true,
        apiTokenEncrypted: true,
        lastSyncAt: true,
        lastErrorSummary: true,
        lastConnectionCheckAt: true,
        lastConnectionCheckSummary: true,
      },
    }),
    prisma.bakaiStoreStockMapping.findMany({
      where: { orgId: organizationId },
      select: { columnKey: true },
    }),
    prisma.bakaiStoreBranchMapping.findMany({
      where: { orgId: organizationId, bakaiBranchId: { not: "" } },
      select: { storeId: true },
    }),
  ]);

  const storedTemplateSchema = parseStoredTemplateSchema(integration?.templateSchemaJson);
  const mappedColumnKeys = new Set(
    mappings.map((mapping) => normalizeStockColumnKey(mapping.columnKey)),
  );
  const hasApiBranchMappings = branchMappings.length > 0;
  const connectionMode = resolveConnectionMode(integration?.connectionMode);
  const summaryStatus = resolveOverviewStatus({
    integration: integration
      ? {
          status: integration.status,
          connectionMode,
          templateStoragePath: integration.templateStoragePath,
          templateSchemaJson: integration.templateSchemaJson,
          apiTokenEncrypted: integration.apiTokenEncrypted,
          hasApiBranchMappings,
        }
      : null,
  });
  const templateConfigured =
    Boolean(integration?.templateStoragePath) &&
    Boolean(storedTemplateSchema) &&
    (storedTemplateSchema?.stockColumns.every((columnKey) => mappedColumnKeys.has(columnKey)) ??
      false);
  const apiConfigured = Boolean(integration?.apiTokenEncrypted) && hasApiBranchMappings;

  return {
    configured: connectionMode === BakaiStoreConnectionMode.API ? apiConfigured : templateConfigured,
    status: summaryStatus,
    connectionMode,
    hasTemplate: Boolean(integration?.templateStoragePath),
    hasApiToken: Boolean(integration?.apiTokenEncrypted),
    stockColumns: storedTemplateSchema?.stockColumns ?? [],
    mappedColumns: Array.from(mappedColumnKeys),
    lastSyncAt: integration?.lastSyncAt ?? null,
    lastConnectionCheckAt: integration?.lastConnectionCheckAt ?? null,
    lastConnectionCheckSummary: integration?.lastConnectionCheckSummary ?? null,
    lastErrorSummary: integration?.lastErrorSummary ?? null,
  };
};

export const getBakaiStoreSettings = async (organizationId: string) => {
  const [integration, stores, mappings, branchMappings] = await Promise.all([
    prisma.bakaiStoreIntegration.findUnique({
      where: { orgId: organizationId },
      select: {
        id: true,
        status: true,
        connectionMode: true,
        templateFileName: true,
        templateMimeType: true,
        templateFileSize: true,
        templateStoragePath: true,
        templateSchemaJson: true,
        apiTokenEncrypted: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastConnectionCheckAt: true,
        lastConnectionCheckSummary: true,
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
    prisma.bakaiStoreBranchMapping.findMany({
      where: { orgId: organizationId },
      select: { storeId: true, bakaiBranchId: true },
    }),
  ]);

  const storedTemplateSchema = parseStoredTemplateSchema(integration?.templateSchemaJson);
  const mappedColumnKeys = new Set(
    mappings.map((mapping) => normalizeStockColumnKey(mapping.columnKey)),
  );
  const connectionMode = resolveConnectionMode(integration?.connectionMode);
  const hasApiBranchMappings = branchMappings.some((mapping) => mapping.bakaiBranchId.trim());
  const resolvedStatus = resolveOverviewStatus({
    integration: integration
      ? {
        status: integration.status,
        connectionMode,
        templateStoragePath: integration.templateStoragePath,
        templateSchemaJson: integration.templateSchemaJson,
        apiTokenEncrypted: integration.apiTokenEncrypted,
        hasApiBranchMappings,
      }
      : null,
  });
  const stockColumns = storedTemplateSchema?.stockColumns.length
    ? storedTemplateSchema.stockColumns
    : ["pp1"];
  let importEndpoint: string | null = null;
  try {
    importEndpoint = getBakaiStoreImportEndpoint();
  } catch {
    importEndpoint = null;
  }

  return {
    integration: {
      id: integration?.id ?? null,
      status: resolvedStatus,
      rawStatus: integration?.status ?? BakaiStoreIntegrationStatus.DISABLED,
      connectionMode,
      hasTemplate: Boolean(integration?.templateStoragePath),
      hasApiToken: Boolean(integration?.apiTokenEncrypted),
      importEndpoint,
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
        connectionMode === BakaiStoreConnectionMode.API
          ? Boolean(integration?.apiTokenEncrypted) && hasApiBranchMappings
          : Boolean(integration?.templateStoragePath) &&
            Boolean(storedTemplateSchema) &&
            stockColumns.every((columnKey) =>
              mappedColumnKeys.has(normalizeStockColumnKey(columnKey)),
            ),
      lastSyncAt: integration?.lastSyncAt ?? null,
      lastSyncStatus: integration?.lastSyncStatus ?? null,
      lastConnectionCheckAt: integration?.lastConnectionCheckAt ?? null,
      lastConnectionCheckSummary: integration?.lastConnectionCheckSummary ?? null,
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
    branchMappings: stores.map((store) => ({
      storeId: store.id,
      storeName: store.name,
      branchId: branchMappings.find((mapping) => mapping.storeId === store.id)?.bakaiBranchId ?? "",
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
        connectionMode: true,
        templateFileName: true,
        templateMimeType: true,
        templateFileSize: true,
        templateStoragePath: true,
        templateSchemaJson: true,
        apiTokenEncrypted: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastConnectionCheckAt: true,
        lastConnectionCheckSummary: true,
        lastErrorSummary: true,
      },
    });

    const [mappings, branchMappings] = await Promise.all([
      tx.bakaiStoreStockMapping.findMany({
        where: { orgId: input.organizationId },
        select: { columnKey: true },
      }),
      tx.bakaiStoreBranchMapping.findMany({
        where: { orgId: input.organizationId, bakaiBranchId: { not: "" } },
        select: { storeId: true },
      }),
    ]);
    const mappedColumnKeys = new Set(mappings.map((mapping) => normalizeStockColumnKey(mapping.columnKey)));
    const nextStatus = resolveStoredIntegrationStatus({
      connectionMode: resolveConnectionMode(existing?.connectionMode),
      hasTemplate: true,
      hasTemplateError: false,
      stockColumns: templateSchema.stockColumns,
      mappedColumnKeys,
      hasApiToken: Boolean(existing?.apiTokenEncrypted),
      hasApiBranchMappings: branchMappings.length > 0,
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
        connectionMode: true,
        templateFileName: true,
        templateMimeType: true,
        templateFileSize: true,
        templateStoragePath: true,
        templateSchemaJson: true,
        apiTokenEncrypted: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastConnectionCheckAt: true,
        lastConnectionCheckSummary: true,
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
          connectionMode: resolveConnectionMode(saved.connectionMode),
          templateStoragePath: saved.templateStoragePath,
          templateSchemaJson: saved.templateSchemaJson,
          apiTokenEncrypted: saved.apiTokenEncrypted,
          hasApiBranchMappings: branchMappings.length > 0,
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
        connectionMode: true,
        templateStoragePath: true,
        templateSchemaJson: true,
        apiTokenEncrypted: true,
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

    const [storedTemplateSchema, apiBranchMappings] = [
      parseStoredTemplateSchema(integrationBefore?.templateSchemaJson),
      await tx.bakaiStoreBranchMapping.findMany({
        where: { orgId: input.organizationId, bakaiBranchId: { not: "" } },
        select: { storeId: true },
      }),
    ];
    const nextStatus = resolveStoredIntegrationStatus({
      connectionMode: resolveConnectionMode(integrationBefore?.connectionMode),
      hasTemplate: Boolean(integrationBefore?.templateStoragePath),
      hasTemplateError: Boolean(integrationBefore?.templateStoragePath) && !storedTemplateSchema,
      stockColumns: storedTemplateSchema?.stockColumns ?? [],
      mappedColumnKeys: new Set(normalizedMappings.map((mapping) => mapping.columnKey)),
      hasApiToken: Boolean(integrationBefore?.apiTokenEncrypted),
      hasApiBranchMappings: apiBranchMappings.length > 0,
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
        connectionMode: true,
        templateStoragePath: true,
        templateSchemaJson: true,
        apiTokenEncrypted: true,
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
          connectionMode: resolveConnectionMode(integrationAfter.connectionMode),
          templateStoragePath: integrationAfter.templateStoragePath,
          templateSchemaJson: integrationAfter.templateSchemaJson,
          apiTokenEncrypted: integrationAfter.apiTokenEncrypted,
          hasApiBranchMappings: apiBranchMappings.length > 0,
        },
      }),
    };
  });
};

export const getBakaiStoreSavedToken = async (organizationId: string) => {
  const integration = await prisma.bakaiStoreIntegration.findUnique({
    where: { orgId: organizationId },
    select: { apiTokenEncrypted: true },
  });

  if (!integration?.apiTokenEncrypted) {
    return { apiToken: null };
  }

  return {
    apiToken: decryptToken(integration.apiTokenEncrypted),
  };
};

export const updateBakaiStoreSettings = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  connectionMode: BakaiStoreConnectionMode;
  apiToken?: string | null;
  clearToken?: boolean;
}) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.bakaiStoreIntegration.findUnique({
      where: { orgId: input.organizationId },
      select: {
        id: true,
        orgId: true,
        status: true,
        connectionMode: true,
        templateStoragePath: true,
        templateSchemaJson: true,
        apiTokenEncrypted: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastConnectionCheckAt: true,
        lastConnectionCheckSummary: true,
        lastErrorSummary: true,
      },
    });

    const tokenInput = input.apiToken?.trim() ?? "";
    const nextTokenEncrypted = input.clearToken
      ? null
      : tokenInput.length > 0
        ? encryptToken(tokenInput)
        : (existing?.apiTokenEncrypted ?? null);

    const [templateMappings, apiBranchMappings] = await Promise.all([
      tx.bakaiStoreStockMapping.findMany({
        where: { orgId: input.organizationId },
        select: { columnKey: true },
      }),
      tx.bakaiStoreBranchMapping.findMany({
        where: { orgId: input.organizationId, bakaiBranchId: { not: "" } },
        select: { storeId: true },
      }),
    ]);

    const storedTemplateSchema = parseStoredTemplateSchema(existing?.templateSchemaJson);
    const nextStatus = resolveStoredIntegrationStatus({
      connectionMode: input.connectionMode,
      hasTemplate: Boolean(existing?.templateStoragePath),
      hasTemplateError: Boolean(existing?.templateStoragePath) && !storedTemplateSchema,
      stockColumns: storedTemplateSchema?.stockColumns ?? [],
      mappedColumnKeys: new Set(
        templateMappings.map((mapping) => normalizeStockColumnKey(mapping.columnKey)),
      ),
      hasApiToken: Boolean(nextTokenEncrypted),
      hasApiBranchMappings: apiBranchMappings.length > 0,
    });

    const saved = await tx.bakaiStoreIntegration.upsert({
      where: { orgId: input.organizationId },
      update: {
        connectionMode: input.connectionMode,
        apiTokenEncrypted: nextTokenEncrypted,
        status: nextStatus,
        lastErrorSummary: null,
      },
      create: {
        orgId: input.organizationId,
        connectionMode: input.connectionMode,
        apiTokenEncrypted: nextTokenEncrypted,
        status: nextStatus,
      },
      select: {
        id: true,
        orgId: true,
        status: true,
        connectionMode: true,
        templateStoragePath: true,
        templateSchemaJson: true,
        apiTokenEncrypted: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastConnectionCheckAt: true,
        lastConnectionCheckSummary: true,
        lastErrorSummary: true,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "BAKAI_STORE_CONFIG_UPDATED",
      entity: "BakaiStoreIntegration",
      entityId: saved.id,
      before: existing ? toJson({ ...existing, apiTokenEncrypted: Boolean(existing.apiTokenEncrypted) }) : null,
      after: toJson({
        ...saved,
        apiTokenEncrypted: Boolean(saved.apiTokenEncrypted),
      }),
      requestId: input.requestId,
    });

    return {
      connectionMode: saved.connectionMode,
      hasApiToken: Boolean(saved.apiTokenEncrypted),
      status: resolveOverviewStatus({
        integration: {
          status: saved.status,
          connectionMode: resolveConnectionMode(saved.connectionMode),
          templateStoragePath: saved.templateStoragePath,
          templateSchemaJson: saved.templateSchemaJson,
          apiTokenEncrypted: saved.apiTokenEncrypted,
          hasApiBranchMappings: apiBranchMappings.length > 0,
        },
      }),
    };
  });
};

export const updateBakaiStoreBranchMappings = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  mappings: Array<{
    storeId: string;
    branchId: string;
  }>;
}) => {
  const normalizedMappings = input.mappings.map((mapping) => ({
    storeId: mapping.storeId.trim(),
    branchId: mapping.branchId.trim(),
  }));
  const storeIds = normalizedMappings.map((mapping) => mapping.storeId).filter(Boolean);
  await ensureStoreOwnership(input.organizationId, storeIds);

  if (new Set(storeIds).size !== storeIds.length) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }

  const nonEmptyBranchIds = normalizedMappings.map((mapping) => mapping.branchId).filter(Boolean);
  if (new Set(nonEmptyBranchIds).size !== nonEmptyBranchIds.length) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }

  return prisma.$transaction(async (tx) => {
    const existingMappings = await tx.bakaiStoreBranchMapping.findMany({
      where: { orgId: input.organizationId },
      select: { storeId: true, bakaiBranchId: true },
    });
    const integrationBefore = await tx.bakaiStoreIntegration.findUnique({
      where: { orgId: input.organizationId },
      select: {
        id: true,
        status: true,
        connectionMode: true,
        templateStoragePath: true,
        templateSchemaJson: true,
        apiTokenEncrypted: true,
      },
    });

    await tx.bakaiStoreBranchMapping.deleteMany({
      where: { orgId: input.organizationId },
    });

    if (normalizedMappings.some((mapping) => mapping.branchId)) {
      await tx.bakaiStoreBranchMapping.createMany({
        data: normalizedMappings
          .filter((mapping) => mapping.branchId)
          .map((mapping) => ({
            orgId: input.organizationId,
            storeId: mapping.storeId,
            bakaiBranchId: mapping.branchId,
          })),
      });
    }

    const templateSchema = parseStoredTemplateSchema(integrationBefore?.templateSchemaJson);
    const templateMappings = await tx.bakaiStoreStockMapping.findMany({
      where: { orgId: input.organizationId },
      select: { columnKey: true },
    });
    const nextStatus = resolveStoredIntegrationStatus({
      connectionMode: resolveConnectionMode(integrationBefore?.connectionMode),
      hasTemplate: Boolean(integrationBefore?.templateStoragePath),
      hasTemplateError: Boolean(integrationBefore?.templateStoragePath) && !templateSchema,
      stockColumns: templateSchema?.stockColumns ?? [],
      mappedColumnKeys: new Set(
        templateMappings.map((mapping) => normalizeStockColumnKey(mapping.columnKey)),
      ),
      hasApiToken: Boolean(integrationBefore?.apiTokenEncrypted),
      hasApiBranchMappings: normalizedMappings.some((mapping) => mapping.branchId),
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
        connectionMode: true,
        templateStoragePath: true,
        templateSchemaJson: true,
        apiTokenEncrypted: true,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "BAKAI_STORE_BRANCH_MAPPINGS_UPDATED",
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
      mappedCount: normalizedMappings.filter((mapping) => mapping.branchId).length,
      status: resolveOverviewStatus({
        integration: {
          status: integrationAfter.status,
          connectionMode: resolveConnectionMode(integrationAfter.connectionMode),
          templateStoragePath: integrationAfter.templateStoragePath,
          templateSchemaJson: integrationAfter.templateSchemaJson,
          apiTokenEncrypted: integrationAfter.apiTokenEncrypted,
          hasApiBranchMappings: normalizedMappings.some((mapping) => mapping.branchId),
        },
      }),
    };
  });
};

export const testBakaiStoreConnection = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
}) => {
  const integration = await prisma.bakaiStoreIntegration.findUnique({
    where: { orgId: input.organizationId },
    select: {
      id: true,
      status: true,
      connectionMode: true,
      templateStoragePath: true,
      templateSchemaJson: true,
      apiTokenEncrypted: true,
    },
  });

  if (!integration?.apiTokenEncrypted) {
    throw new AppError("bakaiStoreApiTokenMissing", "CONFLICT", 409);
  }

  const token = decryptToken(integration.apiTokenEncrypted);
  const checkedAt = new Date();

  try {
    const endpoint = getBakaiStoreImportEndpoint();
    const probe = await probeBakaiStoreConnection({
      token,
      signal: AbortSignal.timeout(BAKAI_STORE_REQUEST_TIMEOUT_MS),
    });

    const branchMappings = await prisma.bakaiStoreBranchMapping.count({
      where: { orgId: input.organizationId, bakaiBranchId: { not: "" } },
    });
    const summary = `HTTP ${probe.status} ${endpoint} CityId=${probe.cityId}`;
    const nextStatus = resolveStoredIntegrationStatus({
      connectionMode: resolveConnectionMode(integration.connectionMode),
      hasTemplate: Boolean(integration.templateStoragePath),
      hasTemplateError:
        Boolean(integration.templateStoragePath) &&
        !parseStoredTemplateSchema(integration.templateSchemaJson),
      stockColumns: parseStoredTemplateSchema(integration.templateSchemaJson)?.stockColumns ?? [],
      mappedColumnKeys: new Set(
        (
          await prisma.bakaiStoreStockMapping.findMany({
            where: { orgId: input.organizationId },
            select: { columnKey: true },
          })
        ).map((mapping) => normalizeStockColumnKey(mapping.columnKey)),
      ),
      hasApiToken: true,
      hasApiBranchMappings: branchMappings > 0,
    });

    await prisma.bakaiStoreIntegration.update({
      where: { orgId: input.organizationId },
      data: {
        status: resolveConnectionMode(integration.connectionMode) === BakaiStoreConnectionMode.API
          ? nextStatus
          : integration.status,
        lastConnectionCheckAt: checkedAt,
        lastConnectionCheckSummary: summary,
        lastErrorSummary: null,
      },
    });

    await writeAuditLog(prisma, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "BAKAI_STORE_CONNECTION_TESTED",
      entity: "BakaiStoreIntegration",
      entityId: integration.id,
      before: null,
      after: toJson({ status: probe.status, endpoint }),
      requestId: input.requestId,
    });

    return {
      ok: probe.ok,
      checkedAt,
      status: probe.status,
      endpoint,
      summary,
    };
  } catch (error) {
    const summary = redactSensitiveText(toErrorMessage(error), token);
    await prisma.bakaiStoreIntegration.update({
      where: { orgId: input.organizationId },
      data: {
        status:
          resolveConnectionMode(integration.connectionMode) === BakaiStoreConnectionMode.API
            ? BakaiStoreIntegrationStatus.ERROR
            : integration.status,
        lastConnectionCheckAt: checkedAt,
        lastConnectionCheckSummary: summary,
        lastErrorSummary: "CONNECTION_TEST_FAILED",
      },
    });
    throw new AppError("bakaiStoreConnectionTestFailed", "INTERNAL_SERVER_ERROR", 502);
  }
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
  const integration = await prisma.bakaiStoreIntegration.findUnique({
    where: { orgId: organizationId },
    select: { connectionMode: true },
  });
  if (resolveConnectionMode(integration?.connectionMode) === BakaiStoreConnectionMode.API) {
    return runBakaiStoreApiPreflight(organizationId);
  }
  const plan = await buildBakaiStoreExportPlan({ organizationId });
  return plan.preflight;
};

export const listBakaiStoreJobs = async (organizationId: string, limit = 50) => {
  const take = Math.max(1, Math.min(200, Math.trunc(limit)));
  return prisma.bakaiStoreExportJob.findMany({
    where: { orgId: organizationId },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      requestedBy: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
};

export const listBakaiStoreExportJobs = listBakaiStoreJobs;

export const getBakaiStoreJob = async (organizationId: string, jobId: string) => {
  return prisma.bakaiStoreExportJob.findFirst({
    where: {
      id: jobId,
      orgId: organizationId,
    },
    include: {
      requestedBy: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
};

export const getBakaiStoreExportJob = getBakaiStoreJob;

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
      jobType: BakaiStoreJobType.TEMPLATE_EXPORT,
      status: BakaiStoreExportJobStatus.QUEUED,
      requestedById: input.actorId,
      requestIdempotencyKey,
      payloadStatsJson: toJson({
        ...plan.payloadStats,
        jobType: BakaiStoreJobType.TEMPLATE_EXPORT,
      }),
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

export const requestBakaiStoreApiSync = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  mode?: BakaiStoreExportMode;
}) => {
  const integration = await prisma.bakaiStoreIntegration.findUnique({
    where: { orgId: input.organizationId },
    select: {
      id: true,
      apiTokenEncrypted: true,
      connectionMode: true,
    },
  });
  if (!integration?.apiTokenEncrypted) {
    throw new AppError("bakaiStoreApiTokenMissing", "CONFLICT", 409);
  }
  if (!process.env.BAKAI_STORE_IMPORT_ENDPOINT?.trim()) {
    throw new AppError("bakaiStoreImportEndpointMissing", "CONFLICT", 409);
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

  const plan = await buildBakaiStoreApiPayload({
    organizationId: input.organizationId,
    mode: input.mode,
  });
  if (input.mode === "READY_ONLY" && !plan.preflight.actionability.canRunReadyOnly) {
    throw new AppError("bakaiStoreReadyOnlyUnsafe", "CONFLICT", 409);
  }
  if (!plan.preflight.actionability.canRunAll) {
    throw new AppError("bakaiStoreApiPreflightFailed", "CONFLICT", 409);
  }

  const requestIdempotencyKey = randomUUID();
  const queuedJob = await prisma.bakaiStoreExportJob.create({
    data: {
      orgId: input.organizationId,
      jobType: BakaiStoreJobType.API_SYNC,
      status: BakaiStoreExportJobStatus.QUEUED,
      requestedById: input.actorId,
      requestIdempotencyKey,
      payloadStatsJson: toJson(plan.payloadStats),
      attemptedCount: plan.payload.products.length,
      succeededCount: 0,
      failedCount: 0,
      skippedCount: 0,
    },
  });

  await writeAuditLog(prisma, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: "BAKAI_STORE_API_SYNC_STARTED",
    entity: "BakaiStoreExportJob",
    entityId: queuedJob.id,
    before: null,
    after: toJson({
      id: queuedJob.id,
      status: queuedJob.status,
      jobType: queuedJob.jobType,
      createdAt: queuedJob.createdAt,
      payloadStats: plan.payloadStats,
    }),
    requestId: input.requestId,
  });

  if (process.env.NODE_ENV !== "test") {
    void runJob(BAKAI_STORE_API_SYNC_JOB_NAME, {
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
        where: {
          id: jobId,
          jobType: BakaiStoreJobType.TEMPLATE_EXPORT,
          status: BakaiStoreExportJobStatus.QUEUED,
        },
      })
    : await prisma.bakaiStoreExportJob.findFirst({
        where: {
          jobType: BakaiStoreJobType.TEMPLATE_EXPORT,
          status: BakaiStoreExportJobStatus.QUEUED,
        },
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
        lastSyncStatus: BakaiStoreLastSyncStatus.SUCCESS,
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
        lastSyncStatus: BakaiStoreLastSyncStatus.FAILED,
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

const runBakaiStoreApiSyncJob = async (
  payload?: JobPayload,
): Promise<{ job: string; status: "ok" | "skipped"; details?: Record<string, unknown> }> => {
  const requestPayload =
    payload && typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  const jobId = typeof requestPayload.jobId === "string" ? requestPayload.jobId : "";

  const job = jobId
    ? await prisma.bakaiStoreExportJob.findFirst({
        where: {
          id: jobId,
          jobType: BakaiStoreJobType.API_SYNC,
          status: BakaiStoreExportJobStatus.QUEUED,
        },
      })
    : await prisma.bakaiStoreExportJob.findFirst({
        where: {
          jobType: BakaiStoreJobType.API_SYNC,
          status: BakaiStoreExportJobStatus.QUEUED,
        },
        orderBy: { createdAt: "asc" },
      });

  if (!job) {
    return { job: BAKAI_STORE_API_SYNC_JOB_NAME, status: "skipped", details: { reason: "empty" } };
  }

  const running = await prisma.bakaiStoreExportJob.update({
    where: { id: job.id },
    data: {
      status: BakaiStoreExportJobStatus.RUNNING,
      startedAt: new Date(),
      finishedAt: null,
      errorReportJson: Prisma.DbNull,
      responseJson: Prisma.DbNull,
      fileName: null,
      mimeType: null,
      fileSize: null,
      storagePath: null,
    },
  });

  let plan: BakaiStoreApiPreflightPlan | null = null;
  let token: string | null = null;

  try {
    if (!process.env.BAKAI_STORE_IMPORT_ENDPOINT?.trim()) {
      throw new AppError("bakaiStoreImportEndpointMissing", "CONFLICT", 409);
    }

    const integration = await prisma.bakaiStoreIntegration.findUnique({
      where: { orgId: job.orgId },
      select: {
        apiTokenEncrypted: true,
      },
    });
    if (!integration?.apiTokenEncrypted) {
      throw new AppError("bakaiStoreApiTokenMissing", "CONFLICT", 409);
    }
    token = decryptToken(integration.apiTokenEncrypted);

    plan = await buildBakaiStoreApiPayload({
      organizationId: job.orgId,
      mode: normalizeBakaiExportMode(asRecord(job.payloadStatsJson)?.exportMode),
    });

    if (!plan.preflight.actionability.canRunAll) {
      throw new AppError("bakaiStoreApiPreflightFailed", "CONFLICT", 409);
    }

    const batches = chunkBakaiStoreItems(
      plan.payload.products,
      BAKAI_STORE_MAX_PRODUCTS_PER_REQUEST,
    );
    const productIdBySku = new Map(
      Array.from(plan.payloadByProductId.entries()).map(([productId, product]) => [
        normalizeSku(product.sku),
        productId,
      ]),
    );
    const succeededProductIds = new Set<string>();
    const failedProducts: Array<{ sku: string; reason: unknown }> = [];
    const batchResults: Array<Record<string, unknown>> = [];

    for (const [batchIndex, products] of batches.entries()) {
      const response = await sendBakaiStoreProducts({
        token,
        payload: { products },
        signal: AbortSignal.timeout(BAKAI_STORE_REQUEST_TIMEOUT_MS),
      }).catch((error: unknown) => ({
        ok: false,
        status: 0,
        body: null,
        error,
      }));

      if (!response.ok) {
        const normalized = normalizeBakaiApiError({
          status: response.status || null,
          body: response.body,
          error: (response as { error?: unknown }).error,
          token,
        });
        batchResults.push({
          batchIndex: batchIndex + 1,
          status: normalized.status,
          ok: false,
          productCount: products.length,
          error: normalized,
        });
        for (const product of products) {
          failedProducts.push({
            sku: product.sku,
            reason: normalized,
          });
        }
        continue;
      }

      batchResults.push({
        batchIndex: batchIndex + 1,
        status: response.status,
        ok: true,
        productCount: products.length,
      });
      for (const product of products) {
        const productId = productIdBySku.get(normalizeSku(product.sku));
        if (productId) {
          succeededProductIds.add(productId);
        }
      }
    }

    const finishedAt = new Date();
    const failedProductIds = Array.from(
      new Set(
        failedProducts
          .map((product) => productIdBySku.get(normalizeSku(product.sku)) ?? "")
          .filter(Boolean),
      ),
    );

    if (succeededProductIds.size > 0) {
      await prisma.bakaiStoreIncludedProduct.updateMany({
        where: {
          orgId: job.orgId,
          productId: { in: Array.from(succeededProductIds) },
        },
        data: {
          lastExportedAt: finishedAt,
        },
      });
    }

    for (const productId of succeededProductIds) {
      const payloadProduct = plan.payloadByProductId.get(productId);
      await prisma.bakaiStoreProductSyncState.upsert({
        where: {
          orgId_productId: {
            orgId: job.orgId,
            productId,
          },
        },
        update: {
          lastSyncedAt: finishedAt,
          lastSyncStatus: BakaiStoreLastSyncStatus.SUCCESS,
          lastPayloadChecksum: payloadProduct ? computeBakaiPayloadChecksum(payloadProduct) : null,
        },
        create: {
          orgId: job.orgId,
          productId,
          lastSyncedAt: finishedAt,
          lastSyncStatus: BakaiStoreLastSyncStatus.SUCCESS,
          lastPayloadChecksum: payloadProduct ? computeBakaiPayloadChecksum(payloadProduct) : null,
        },
      });
    }

    for (const productId of failedProductIds) {
      const payloadProduct = plan.payloadByProductId.get(productId);
      await prisma.bakaiStoreProductSyncState.upsert({
        where: {
          orgId_productId: {
            orgId: job.orgId,
            productId,
          },
        },
        update: {
          lastSyncStatus: BakaiStoreLastSyncStatus.FAILED,
          lastPayloadChecksum: payloadProduct ? computeBakaiPayloadChecksum(payloadProduct) : null,
        },
        create: {
          orgId: job.orgId,
          productId,
          lastSyncStatus: BakaiStoreLastSyncStatus.FAILED,
          lastPayloadChecksum: payloadProduct ? computeBakaiPayloadChecksum(payloadProduct) : null,
        },
      });
    }

    const failedCount = failedProducts.length;
    const succeededCount = succeededProductIds.size;
    const finished = await prisma.bakaiStoreExportJob.update({
      where: { id: job.id },
      data: {
        status:
          failedCount > 0 ? BakaiStoreExportJobStatus.FAILED : BakaiStoreExportJobStatus.DONE,
        finishedAt,
        attemptedCount: plan.payload.products.length,
        succeededCount,
        failedCount,
        skippedCount: 0,
        responseJson: toJson({
          endpoint: process.env.BAKAI_STORE_IMPORT_ENDPOINT?.trim() ?? null,
          batches: batchResults,
        }),
        errorReportJson:
          failedCount > 0
            ? toJson({
                ...plan.errorReport,
                failedSyncProducts: failedProducts.map((product) => ({
                  sku: product.sku,
                  reason: product.reason,
                })),
              })
            : Prisma.DbNull,
      },
    });

    await prisma.bakaiStoreIntegration.updateMany({
      where: { orgId: job.orgId },
      data: {
        status:
          failedCount > 0 ? BakaiStoreIntegrationStatus.ERROR : BakaiStoreIntegrationStatus.READY,
        lastSyncAt: finishedAt,
        lastSyncStatus:
          failedCount > 0 ? BakaiStoreLastSyncStatus.FAILED : BakaiStoreLastSyncStatus.SUCCESS,
        lastErrorSummary: failedCount > 0 ? "API_REQUEST_FAILED" : null,
      },
    });

    await writeAuditLog(prisma, {
      organizationId: job.orgId,
      actorId: job.requestedById,
      action: failedCount > 0 ? "BAKAI_STORE_API_SYNC_FAILED" : "BAKAI_STORE_API_SYNC_FINISHED",
      entity: "BakaiStoreExportJob",
      entityId: finished.id,
      before: toJson(running),
      after: toJson({
        ...finished,
        responseJson: batchResults,
        failedCount,
        succeededCount,
      }),
      requestId:
        typeof requestPayload.requestId === "string" ? requestPayload.requestId : randomUUID(),
    });

    return {
      job: BAKAI_STORE_API_SYNC_JOB_NAME,
      status: "ok",
      details: {
        jobId: finished.id,
        attempted: plan.payload.products.length,
        succeeded: succeededCount,
        failed: failedCount,
      },
    };
  } catch (error) {
    const normalized = normalizeBakaiApiError({
      status: null,
      body: null,
      error,
      token,
    });
    const failed = await prisma.bakaiStoreExportJob.update({
      where: { id: job.id },
      data: {
        status: BakaiStoreExportJobStatus.FAILED,
        finishedAt: new Date(),
        attemptedCount: plan?.payload.products.length ?? 0,
        succeededCount: 0,
        failedCount: plan?.payload.products.length ?? 0,
        skippedCount: 0,
        errorReportJson: toJson({
          ...(plan?.errorReport ?? {}),
          error: normalized,
        }),
      },
    });

    await prisma.bakaiStoreIntegration.updateMany({
      where: { orgId: job.orgId },
      data: {
        status: BakaiStoreIntegrationStatus.ERROR,
        lastSyncStatus: BakaiStoreLastSyncStatus.FAILED,
        lastErrorSummary: normalized.code,
      },
    });

    await writeAuditLog(prisma, {
      organizationId: job.orgId,
      actorId: job.requestedById,
      action: "BAKAI_STORE_API_SYNC_FAILED",
      entity: "BakaiStoreExportJob",
      entityId: failed.id,
      before: toJson(running),
      after: toJson({
        ...failed,
        error: normalized,
      }),
      requestId:
        typeof requestPayload.requestId === "string" ? requestPayload.requestId : randomUUID(),
    });

    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("bakaiStoreApiSyncFailed", "INTERNAL_SERVER_ERROR", 500);
  }
};

registerJob(BAKAI_STORE_EXPORT_JOB_NAME, {
  handler: runBakaiStoreExportJob,
  maxAttempts: 1,
  baseDelayMs: 1,
});

registerJob(BAKAI_STORE_API_SYNC_JOB_NAME, {
  handler: runBakaiStoreApiSyncJob,
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
