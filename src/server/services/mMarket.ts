import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

import {
  MMarketEnvironment,
  MMarketExportJobStatus,
  MMarketIntegrationStatus,
  MMarketLastSyncStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { getRedisPublisher } from "@/server/redis";
import { registerJob, runJob, type JobPayload } from "@/server/jobs";
import { toJson } from "@/server/services/json";
import { writeAuditLog } from "@/server/services/audit";
import { normalizeProductImageUrl } from "@/server/services/productImageStorage";
import { bulkGenerateProductDescriptions, bulkUpdateProductCategory } from "@/server/services/products";
import { suggestProductSpecsFromImages } from "@/server/services/productSpecSuggestions";
import { setCategoryTemplate } from "@/server/services/categoryTemplates";

export const MMARKET_IMPORT_ENDPOINTS: Record<MMarketEnvironment, string> = {
  DEV: "https://dev.m-market.kg/api/crm/products/import_products/",
  PROD: "https://market.mbank.kg/api/crm/products/import_products/",
};

const MMARKET_SPECS_ENDPOINTS: Partial<Record<MMarketEnvironment, string>> = {
  DEV: process.env.MMARKET_SPECS_KEYS_ENDPOINT_DEV?.trim() || "",
  PROD: process.env.MMARKET_SPECS_KEYS_ENDPOINT_PROD?.trim() || "",
};

const MMARKET_EXPORT_LOCK_PREFIX = "mmarket:export:";
const MMARKET_EXPORT_COOLDOWN_MS = 15 * 60 * 1000;
const MMARKET_EXPORT_JOB_NAME = "mmarket-export";
const MMARKET_REQUEST_TIMEOUT_MS = 90_000;
const MMARKET_SPEC_REQUEST_TIMEOUT_MS = 5_000;

const MMARKET_MIN_NAME_LEN = 7;
const MMARKET_MAX_NAME_LEN = 250;
const MMARKET_MIN_DESCRIPTION_LEN = 150;
const MMARKET_MIN_IMAGES = 3;
const DEFAULT_MMARTKET_PLACEHOLDER_IMAGE_URL =
  "https://pub-75076a8067634fa3a91a6df2248d729c.r2.dev/bazaar-placeholder.png";
const MMARKET_PRODUCT_SELECTION_AUDIT_ACTION = "MMARKET_PRODUCT_SELECTION_UPDATED";

const IMAGE_EXTENSION_PATTERN = /\.(jpg|png|webp)$/i;

const memoryCooldownStore = new Map<string, number>();

export type MMarketOverviewStatus = "NOT_CONFIGURED" | "READY" | "ERROR";
export type MMarketProductSelectionFilter = "all" | "included" | "excluded";
export type MMarketProductExportStatus = "EXCLUDED" | "INCLUDED" | "EXPORTED";

export type MMarketPayloadProduct = {
  sku: string;
  name: string;
  price: number;
  category: string;
  description: string;
  images: string[];
  stock: Array<{ quantity: number; branch_id: string }>;
  specs: Record<string, string>;
  discount?: number | null;
  similar_products_sku?: string[] | null;
};

export type MMarketPayload = {
  products: Array<{
    sku: string;
    name: string;
    price: number;
    category: string;
    description: string;
    images: string[];
    stock: Array<{ quantity: number; branch_id: string }>;
    specs: Record<string, string>;
    discount?: number;
    similar_products_sku?: string[];
  }>;
};

export type MMarketPreflightIssueCode =
  | "NO_PRODUCTS_SELECTED"
  | "MISSING_SKU"
  | "DUPLICATE_SKU"
  | "INVALID_NAME_LENGTH"
  | "MISSING_PRICE"
  | "MISSING_CATEGORY"
  | "SHORT_DESCRIPTION"
  | "INVALID_IMAGES_COUNT"
  | "NON_DIRECT_IMAGE_URL"
  | "MISSING_STOCK_MAPPING"
  | "MISSING_SPECS";

export type MMarketPreflightWarningCode =
  | "SPECS_VALIDATION_SKIPPED"
  | "SPECS_MULTIPLE_VALUES"
  | "SPECS_KEY_UNRECOGNIZED";

export type MMarketPreflightResult = {
  generatedAt: Date;
  canExport: boolean;
  summary: {
    mode: "IN_STOCK_ONLY";
    storesTotal: number;
    storesMapped: number;
    productsConsidered: number;
    productsReady: number;
    productsFailed: number;
  };
  blockers: {
    total: number;
    byCode: Partial<Record<MMarketPreflightIssueCode, number>>;
    missingStoreMappings: Array<{ storeId: string; storeName: string }>;
  };
  warnings: {
    total: number;
    byCode: Partial<Record<MMarketPreflightWarningCode, number>>;
    global: MMarketPreflightWarningCode[];
  };
  failedProducts: Array<{
    productId: string;
    sku: string;
    name: string;
    issues: MMarketPreflightIssueCode[];
    warnings: MMarketPreflightWarningCode[];
  }>;
  cooldown: {
    active: boolean;
    remainingSeconds: number;
    nextAllowedAt: Date | null;
  };
  specValidationMode: "REMOTE" | "SEND_AS_IS";
};

type MMarketExportPlan = {
  preflight: MMarketPreflightResult;
  payload: MMarketPayload;
  exportedProductIds: string[];
  payloadStats: Record<string, unknown>;
  errorReport: Record<string, unknown>;
};

type MMarketRemoteErrorResponse = {
  httpStatus: number;
  body: unknown;
};

type MMarketNetworkErrorDiagnostic = {
  name: string | null;
  message: string | null;
  code: string | null;
};

type MMarketNetworkErrorDetails = {
  error: MMarketNetworkErrorDiagnostic;
  cause: MMarketNetworkErrorDiagnostic | null;
  nested: MMarketNetworkErrorDiagnostic[];
};

type RemoteSpecCatalog = {
  mode: "REMOTE" | "SEND_AS_IS";
  globalWarnings: MMarketPreflightWarningCode[];
  allowedByCategory: Map<string, Set<string>>;
};

type RemoteApiResult = {
  status: number;
  body: unknown;
};

type MMarketBulkDescriptionLogger = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

type MMarketBulkSpecsLogger = MMarketBulkDescriptionLogger;

type MMarketBaseTemplateLogger = MMarketBulkDescriptionLogger;

type AutofillSpecKind = "manufacturer" | "model" | "type" | "color";

type AutofillTemplateSpec = {
  attributeKey: string;
  labelRu: string;
  type: "TEXT" | "NUMBER" | "SELECT" | "MULTI_SELECT";
  optionsRu: string[];
  autofillKind: AutofillSpecKind | null;
};

type BulkAutofillSkipReasonCounts = {
  noCategory: number;
  noTemplate: number;
  noSupportedFields: number;
  noResolvedValues: number;
};

const MMARKET_DEFAULT_MANUFACTURER = process.env.MMARKET_SPECS_DEFAULT_MANUFACTURER?.trim() ?? "";
const MMARKET_DEFAULT_MODEL = process.env.MMARKET_SPECS_DEFAULT_MODEL?.trim() ?? "";
const MMARKET_DEFAULT_UNCATEGORIZED_NAME = "Без категории";
const normalizeSearch = (value?: string | null) => value?.trim() ?? "";
const nonDataImagePattern = /^data:image\//i;
type MMarketDbClient = Prisma.TransactionClient | PrismaClient;

const mMarketListableImageWhere: Prisma.ProductWhereInput = {
  OR: [
    {
      AND: [
        { photoUrl: { not: null } },
        { NOT: { photoUrl: "" } },
        { NOT: { photoUrl: { startsWith: "data:image/" } } },
      ],
    },
    {
      images: {
        some: {
          AND: [{ url: { not: "" } }, { NOT: { url: { startsWith: "data:image/" } } }],
        },
      },
    },
  ],
};

const resolveMMarketListImageUrl = (product: {
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

const resolveMMarketProductExportStatus = (input: {
  included: boolean;
  lastExportedAt: Date | null;
}): MMarketProductExportStatus => {
  if (!input.included) {
    return "EXCLUDED";
  }
  return input.lastExportedAt ? "EXPORTED" : "INCLUDED";
};

const hasExplicitMMarketProductSelection = async (
  db: MMarketDbClient,
  organizationId: string,
) => {
  const auditLog = await db.auditLog.findFirst({
    where: {
      organizationId,
      action: MMARKET_PRODUCT_SELECTION_AUDIT_ACTION,
    },
    select: { id: true },
  });

  return Boolean(auditLog);
};

const MMARKET_BASE_TEMPLATE_DEFINITIONS = [
  {
    key: "mmarket_type",
    labelRu: "Тип",
    labelKg: "Түрү",
    type: "TEXT" as const,
  },
  {
    key: "mmarket_color",
    labelRu: "Цвет",
    labelKg: "Түсү",
    type: "TEXT" as const,
  },
  {
    key: "mmarket_manufacturer",
    labelRu: "Производители",
    labelKg: "Өндүрүүчү",
    type: "TEXT" as const,
  },
  {
    key: "mmarket_model",
    labelRu: "Модель",
    labelKg: "Модели",
    type: "TEXT" as const,
  },
] as const;

class MMarketRemoteError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super("mMarketRemoteRequestFailed");
    this.status = status;
    this.body = body;
  }
}

const lockKeyByOrg = (orgId: string) => `${MMARKET_EXPORT_LOCK_PREFIX}${orgId}`;

const normalizeBranchId = (value?: string | null) => value?.trim() ?? "";

const hasAllowedImageExtension = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return IMAGE_EXTENSION_PATTERN.test(parsed.pathname);
  } catch {
    return /\.(jpg|png|webp)(?:$|[?#])/i.test(trimmed);
  }
};

const resolveMMarketPlaceholderImageUrl = () => {
  const value =
    process.env.MMARKET_PLACEHOLDER_IMAGE_URL?.trim() || DEFAULT_MMARTKET_PLACEHOLDER_IMAGE_URL;
  return hasAllowedImageExtension(value) ? value : "";
};

const appendPlaceholderVariant = (baseUrl: string, index: number) => {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("slot", String(index));
    return url.toString();
  } catch {
    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}slot=${index}`;
  }
};

const buildMMarketImageUrls = (inputUrls: string[]) => {
  const nonDirectImageUrls = inputUrls.filter((url) => !hasAllowedImageExtension(url));
  const directImageUrls = inputUrls.filter((url) => hasAllowedImageExtension(url));
  const placeholderUrl = resolveMMarketPlaceholderImageUrl();
  const missingCount = Math.max(0, MMARKET_MIN_IMAGES - directImageUrls.length);
  const placeholderImageUrls =
    placeholderUrl && missingCount > 0
      ? Array.from({ length: missingCount }, (_, index) =>
          appendPlaceholderVariant(placeholderUrl, index + 1),
        )
      : [];

  return {
    nonDirectImageUrls,
    directImageUrls,
    placeholderImageUrls,
    exportImageUrls: [...directImageUrls, ...placeholderImageUrls],
  };
};

const normalizeSpecLabel = (value?: string | null) =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, "");

const resolveAutofillKind = (input: {
  labelRu?: string | null;
  attributeKey?: string | null;
}): AutofillSpecKind | null => {
  const values = [normalizeSpecLabel(input.labelRu), normalizeSpecLabel(input.attributeKey)].filter(
    (value) => value.length > 0,
  );

  if (
    values.some(
      (value) =>
        value.includes("производ") ||
        value.includes("бренд") ||
        value.includes("manufacturer") ||
        value.includes("brand") ||
        value.includes("maker"),
    )
  ) {
    return "manufacturer";
  }
  if (values.some((value) => value.includes("модел") || value.includes("model"))) {
    return "model";
  }
  if (
    values.some(
      (value) =>
        value.includes("цвет") ||
        value.includes("расцвет") ||
        value.includes("color") ||
        value.includes("colour"),
    )
  ) {
    return "color";
  }
  if (
    values.some((value) => value.includes("тип") || value.includes("вид") || value.includes("type"))
  ) {
    return "type";
  }
  return null;
};

const parseOptionStrings = (value: Prisma.JsonValue | null) =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0)
    : [];

const toStoredAttributeValue = (type: AutofillTemplateSpec["type"], value: string) => {
  if (type === "MULTI_SELECT") {
    return [value];
  }
  return value;
};

const createBulkAutofillSkipReasonCounts = (): BulkAutofillSkipReasonCounts => ({
  noCategory: 0,
  noTemplate: 0,
  noSupportedFields: 0,
  noResolvedValues: 0,
});

const normalizeNumber = (value: unknown) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
      .map((item) => toSpecString(item))
      .filter((item): item is string => Boolean(item));
    if (!normalized.length) {
      return null;
    }
    return normalized.join(", ");
  }
  return null;
};

const parseJson = (text: string) => {
  try {
    return text.length ? JSON.parse(text) : null;
  } catch {
    return text;
  }
};

const stripSensitiveIntegration = (row: {
  id: string;
  orgId: string;
  status: MMarketIntegrationStatus;
  environment: MMarketEnvironment;
  apiTokenEncrypted: string | null;
  lastSyncAt: Date | null;
  lastSyncStatus: MMarketLastSyncStatus | null;
  lastErrorSummary: string | null;
}) => ({
  id: row.id,
  orgId: row.orgId,
  status: row.status,
  environment: row.environment,
  hasToken: Boolean(row.apiTokenEncrypted),
  lastSyncAt: row.lastSyncAt,
  lastSyncStatus: row.lastSyncStatus,
  lastErrorSummary: row.lastErrorSummary,
});

const toBase64Url = (value: Buffer) => value.toString("base64url");

const fromBase64Url = (value: string) => Buffer.from(value, "base64url");

const resolveTokenSecret = () =>
  process.env.MMARKET_TOKEN_ENCRYPTION_KEY?.trim() || process.env.NEXTAUTH_SECRET?.trim() || "";

const tokenCipherKey = () => {
  const secret = resolveTokenSecret();
  if (!secret) {
    throw new AppError("mMarketTokenSecretMissing", "INTERNAL_SERVER_ERROR", 500);
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
    throw new AppError("mMarketTokenDecryptFailed", "INTERNAL_SERVER_ERROR", 500);
  }
  const decipher = createDecipheriv("aes-256-gcm", tokenCipherKey(), fromBase64Url(ivPart));
  decipher.setAuthTag(fromBase64Url(tagPart));
  const decrypted = Buffer.concat([decipher.update(fromBase64Url(dataPart)), decipher.final()]);
  return decrypted.toString("utf8");
};

const collectImageUrls = (product: {
  photoUrl: string | null;
  images: Array<{ url: string; position: number }>;
}) => {
  const ordered = [...product.images]
    .sort((a, b) => a.position - b.position)
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

const resolveStoredIntegrationStatus = (input: {
  hasToken: boolean;
  mappingsComplete: boolean;
}) => {
  if (!input.hasToken || !input.mappingsComplete) {
    return MMarketIntegrationStatus.DISABLED;
  }
  return MMarketIntegrationStatus.READY;
};

const resolveOverviewStatus = (input: {
  integration:
    | {
        status: MMarketIntegrationStatus;
        apiTokenEncrypted: string | null;
      }
    | null
    | undefined;
  mappingsComplete: boolean;
}) => {
  const hasToken = Boolean(input.integration?.apiTokenEncrypted);
  if (!hasToken || !input.mappingsComplete) {
    return "NOT_CONFIGURED" as const;
  }
  if (input.integration?.status === MMarketIntegrationStatus.ERROR) {
    return "ERROR" as const;
  }
  return "READY" as const;
};

const addIssue = (issues: MMarketPreflightIssueCode[], issue: MMarketPreflightIssueCode) => {
  if (!issues.includes(issue)) {
    issues.push(issue);
  }
};

const addWarning = (
  warnings: MMarketPreflightWarningCode[],
  warning: MMarketPreflightWarningCode,
) => {
  if (!warnings.includes(warning)) {
    warnings.push(warning);
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

const normalizeCooldownSeconds = (ttlMs: number) => {
  if (ttlMs <= 0) {
    return 0;
  }
  return Math.ceil(ttlMs / 1000);
};

const getMemoryCooldownSeconds = (orgId: string) => {
  const expiresAt = memoryCooldownStore.get(orgId) ?? 0;
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) {
    memoryCooldownStore.delete(orgId);
    return 0;
  }
  return normalizeCooldownSeconds(remainingMs);
};

const getCooldownSeconds = async (orgId: string) => {
  const redis = getRedisPublisher();
  if (redis) {
    try {
      const ttlMs = await redis.pttl(lockKeyByOrg(orgId));
      if (ttlMs > 0) {
        return normalizeCooldownSeconds(ttlMs);
      }
      if (ttlMs === -2) {
        return 0;
      }
    } catch {
      // Fallback to memory cooldown in non-redis environments.
    }
  }
  return getMemoryCooldownSeconds(orgId);
};

const acquireCooldownLock = async (orgId: string) => {
  const redis = getRedisPublisher();
  if (redis) {
    try {
      const result = await redis.set(
        lockKeyByOrg(orgId),
        String(Date.now() + MMARKET_EXPORT_COOLDOWN_MS),
        "PX",
        MMARKET_EXPORT_COOLDOWN_MS,
        "NX",
      );
      if (result === "OK") {
        return {
          acquired: true as const,
          remainingSeconds: normalizeCooldownSeconds(MMARKET_EXPORT_COOLDOWN_MS),
        };
      }
      const remainingSeconds = await getCooldownSeconds(orgId);
      return { acquired: false as const, remainingSeconds };
    } catch {
      // Fallback to memory lock in non-redis environments.
    }
  }

  const remainingSeconds = getMemoryCooldownSeconds(orgId);
  if (remainingSeconds > 0) {
    return { acquired: false as const, remainingSeconds };
  }

  memoryCooldownStore.set(orgId, Date.now() + MMARKET_EXPORT_COOLDOWN_MS);
  return {
    acquired: true as const,
    remainingSeconds: normalizeCooldownSeconds(MMARKET_EXPORT_COOLDOWN_MS),
  };
};

const parseSpecCatalogResponse = (payload: unknown) => {
  const values: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && "results" in payload
      ? Array.isArray((payload as { results?: unknown[] }).results)
        ? ((payload as { results?: unknown[] }).results ?? [])
        : []
      : [];

  const keys = new Set<string>();
  for (const item of values) {
    if (typeof item === "string") {
      const normalized = item.trim();
      if (normalized) {
        keys.add(normalized);
      }
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item as { name?: unknown; key?: unknown; label?: unknown };
    const raw =
      (typeof candidate.key === "string" ? candidate.key : undefined) ??
      (typeof candidate.name === "string" ? candidate.name : undefined) ??
      (typeof candidate.label === "string" ? candidate.label : undefined);
    const normalized = raw?.trim() ?? "";
    if (normalized) {
      keys.add(normalized);
    }
  }

  return keys;
};

const loadRemoteSpecCatalog = async (input: {
  environment: MMarketEnvironment;
  token: string | null;
  categories: string[];
}): Promise<RemoteSpecCatalog> => {
  const endpoint = MMARKET_SPECS_ENDPOINTS[input.environment]?.trim() ?? "";
  if (!endpoint || !input.token || !input.categories.length) {
    return {
      mode: "SEND_AS_IS",
      globalWarnings: ["SPECS_VALIDATION_SKIPPED"],
      allowedByCategory: new Map(),
    };
  }

  const allowedByCategory = new Map<string, Set<string>>();
  for (const category of input.categories) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MMARKET_SPEC_REQUEST_TIMEOUT_MS);
    try {
      const url = new URL(endpoint);
      url.searchParams.set("name", category);
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Token ${input.token}`,
        },
        signal: controller.signal,
      });
      const raw = await response.text();
      const body = parseJson(raw);
      if (!response.ok) {
        return {
          mode: "SEND_AS_IS",
          globalWarnings: ["SPECS_VALIDATION_SKIPPED"],
          allowedByCategory: new Map(),
        };
      }
      allowedByCategory.set(category, parseSpecCatalogResponse(body));
    } catch {
      return {
        mode: "SEND_AS_IS",
        globalWarnings: ["SPECS_VALIDATION_SKIPPED"],
        allowedByCategory: new Map(),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    mode: "REMOTE",
    globalWarnings: [],
    allowedByCategory,
  };
};

export const buildMMarketPayload = (products: MMarketPayloadProduct[]): MMarketPayload => ({
  products: [...products]
    .sort((a, b) => a.sku.localeCompare(b.sku, "en"))
    .map((product) => {
      const payloadProduct: MMarketPayload["products"][number] = {
        sku: product.sku,
        name: product.name,
        price: product.price,
        category: product.category,
        description: product.description,
        images: [...product.images],
        stock: product.stock.map((entry) => ({
          quantity: Math.max(0, Math.trunc(entry.quantity)),
          branch_id: entry.branch_id,
        })),
        specs: { ...product.specs },
      };

      const discount = normalizeNumber(product.discount);
      if (discount !== null) {
        payloadProduct.discount = discount;
      }

      const similarSkus = Array.isArray(product.similar_products_sku)
        ? product.similar_products_sku.map((value) => value.trim()).filter(Boolean)
        : [];
      if (similarSkus.length) {
        payloadProduct.similar_products_sku = similarSkus;
      }

      return payloadProduct;
    }),
});

const getPayloadBytes = (payload: MMarketPayload) => Buffer.byteLength(JSON.stringify(payload), "utf8");

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const toNullableString = (value: unknown) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const toNetworkDiagnostic = (value: unknown): MMarketNetworkErrorDiagnostic | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const name = toNullableString(record.name);
  const message = toNullableString(record.message);
  const code = toNullableString(record.code);

  if (!name && !message && !code) {
    return null;
  }

  return {
    name,
    message,
    code,
  };
};

const toNestedDiagnostics = (value: unknown): MMarketNetworkErrorDiagnostic[] => {
  if (value instanceof AggregateError) {
    return Array.from(value.errors).map(toNetworkDiagnostic).filter(Boolean) as MMarketNetworkErrorDiagnostic[];
  }

  const record = asRecord(value);
  if (!record || !Array.isArray(record.errors)) {
    return [];
  }

  return record.errors.map(toNetworkDiagnostic).filter(Boolean) as MMarketNetworkErrorDiagnostic[];
};

const isAbortError = (error: unknown): error is Error =>
  error instanceof Error && error.name === "AbortError";

const resolveMMarketNetworkError = (error: unknown): MMarketNetworkErrorDetails | null => {
  if (
    !(error instanceof Error) ||
    error instanceof AppError ||
    error instanceof MMarketRemoteError ||
    isAbortError(error)
  ) {
    return null;
  }

  const baseError = error as Error & { cause?: unknown };
  const isFetchFailure = baseError.name === "TypeError" && baseError.message === "fetch failed";
  if (!isFetchFailure) {
    return null;
  }

  const errorDiagnostic = toNetworkDiagnostic(baseError);
  const causeValue = baseError.cause;
  const causeDiagnostic = toNetworkDiagnostic(causeValue);
  const nestedDiagnostics = toNestedDiagnostics(causeValue);

  return {
    error: errorDiagnostic ?? {
      name: baseError.name,
      message: baseError.message,
      code: null,
    },
    cause: causeDiagnostic,
    nested: nestedDiagnostics,
  };
};

const formatMMarketNetworkFailureReason = (details: MMarketNetworkErrorDetails) => {
  const preferred = details.cause ?? details.nested[0] ?? details.error;
  const parts = [preferred.code, preferred.message].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  if (!parts.length) {
    return "MMarket request failed before receiving a response";
  }

  return `MMarket request failed: ${parts.join(" ")}`;
};

const resolveMMarketExportFailureReason = (
  error: unknown,
  networkError: MMarketNetworkErrorDetails | null = resolveMMarketNetworkError(error),
) => {
  if (error instanceof AppError) {
    return error.message;
  }
  if (isAbortError(error)) {
    return `MMarket request timed out after ${Math.round(MMARKET_REQUEST_TIMEOUT_MS / 1_000)}s`;
  }
  if (networkError) {
    return formatMMarketNetworkFailureReason(networkError);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "mMarketExportFailed";
};

const buildMMarketErrorReport = (input: {
  environment: MMarketEnvironment;
  requestIdempotencyKey?: string;
  preflight: MMarketPreflightResult;
  payload: MMarketPayload;
  payloadBytes: number;
  payloadStats: Record<string, unknown>;
  reason?: string;
  remoteResponse?: MMarketRemoteErrorResponse | null;
  networkError?: MMarketNetworkErrorDetails | null;
}) => ({
  generatedAt: input.preflight.generatedAt.toISOString(),
  environment: input.environment,
  endpoint: MMARKET_IMPORT_ENDPOINTS[input.environment],
  requestIdempotencyKey: input.requestIdempotencyKey,
  reason: input.reason,
  payloadBytes: input.payloadBytes,
  summary: input.preflight.summary,
  blockers: input.preflight.blockers,
  warnings: input.preflight.warnings,
  failedProducts: input.preflight.failedProducts,
  payloadStats: input.payloadStats,
  payload: input.payload,
  specValidationMode: input.preflight.specValidationMode,
  remoteResponse: input.remoteResponse ?? null,
  networkError: input.networkError ?? null,
});

const buildMMarketExportPlan = async (input: {
  organizationId: string;
  environment: MMarketEnvironment;
  token: string | null;
}): Promise<MMarketExportPlan> => {
  const [stores, mappings, hasExplicitSelection, rawIncludedCount] = await Promise.all([
    prisma.store.findMany({
      where: { organizationId: input.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.mMarketBranchMapping.findMany({
      where: { orgId: input.organizationId },
      select: { storeId: true, mmarketBranchId: true },
    }),
    hasExplicitMMarketProductSelection(prisma, input.organizationId),
    prisma.product.count({
      where: {
        organizationId: input.organizationId,
        isDeleted: false,
        mMarketInclusions: {
          some: { orgId: input.organizationId },
        },
      },
    }),
  ]);
  const activeIncludedCount = hasExplicitSelection ? rawIncludedCount : 0;

  const storeIdList = stores.map((store) => store.id);
  const positiveSnapshots = storeIdList.length && hasExplicitSelection
    ? await prisma.inventorySnapshot.findMany({
        where: {
          storeId: { in: storeIdList },
          variantKey: "BASE",
          onHand: { gt: 0 },
          product: {
            organizationId: input.organizationId,
            isDeleted: false,
            mMarketInclusions: {
              some: { orgId: input.organizationId },
            },
          },
        },
        select: { storeId: true, productId: true, onHand: true },
      })
    : [];
  const mappingByStoreId = new Map(
    mappings.map((mapping) => [mapping.storeId, normalizeBranchId(mapping.mmarketBranchId)]),
  );
  const mappedStores = stores
    .map((store) => ({ store, branchId: mappingByStoreId.get(store.id) ?? "" }))
    .filter((item) => item.branchId.length > 0);
  const missingStoreMappings = stores
    .filter((store) => !(mappingByStoreId.get(store.id) ?? "").length)
    .map((store) => ({ storeId: store.id, storeName: store.name }));

  const inStockProductIdSet = new Set(positiveSnapshots.map((snapshot) => snapshot.productId));
  const inStockProductIds = Array.from(inStockProductIdSet);

  const [products, stockRows] = await Promise.all([
    inStockProductIds.length && hasExplicitSelection
      ? prisma.product.findMany({
          where: {
            organizationId: input.organizationId,
            isDeleted: false,
            id: { in: inStockProductIds },
            mMarketInclusions: {
              some: { orgId: input.organizationId },
            },
          },
          select: {
            id: true,
            sku: true,
            name: true,
            category: true,
            basePriceKgs: true,
            description: true,
            photoUrl: true,
            images: {
              select: { url: true, position: true },
              orderBy: { position: "asc" },
            },
          },
          orderBy: { sku: "asc" },
        })
      : Promise.resolve([]),
    inStockProductIds.length && hasExplicitSelection
      ? prisma.inventorySnapshot.findMany({
          where: {
            storeId: { in: storeIdList },
            productId: { in: inStockProductIds },
            variantKey: "BASE",
          },
          select: { storeId: true, productId: true, onHand: true },
        })
      : Promise.resolve([]),
  ]);

  const categories = Array.from(
    new Set(
      products
        .map((product) => product.category?.trim() ?? "")
        .filter((category) => category.length > 0),
    ),
  );

  const [categoryTemplates, variantValues, remoteSpecCatalog] = await Promise.all([
    categories.length
      ? prisma.categoryAttributeTemplate.findMany({
          where: {
            organizationId: input.organizationId,
            category: { in: categories },
          },
          select: {
            category: true,
            attributeKey: true,
            order: true,
            definition: {
              select: {
                labelRu: true,
              },
            },
          },
          orderBy: [{ category: "asc" }, { order: "asc" }],
        })
      : Promise.resolve([]),
    inStockProductIds.length
      ? prisma.variantAttributeValue.findMany({
          where: {
            organizationId: input.organizationId,
            productId: { in: inStockProductIds },
          },
          select: {
            productId: true,
            key: true,
            value: true,
          },
        })
      : Promise.resolve([]),
    loadRemoteSpecCatalog({
      environment: input.environment,
      token: input.token,
      categories,
    }),
  ]);

  const templateSpecsByCategory = new Map<
    string,
    Array<{ attributeKey: string; specKey: string }>
  >();
  for (const template of categoryTemplates) {
    const specKey = template.definition?.labelRu?.trim() || template.attributeKey;
    if (!specKey) {
      continue;
    }
    const list = templateSpecsByCategory.get(template.category) ?? [];
    if (!list.some((item) => item.attributeKey === template.attributeKey)) {
      list.push({
        attributeKey: template.attributeKey,
        specKey,
      });
      templateSpecsByCategory.set(template.category, list);
    }
  }

  const stockByProductStore = new Map<string, Map<string, number>>();
  for (const row of stockRows) {
    const byStore = stockByProductStore.get(row.productId) ?? new Map<string, number>();
    byStore.set(row.storeId, row.onHand);
    stockByProductStore.set(row.productId, byStore);
  }

  const specValuesByProduct = new Map<string, Map<string, string[]>>();
  for (const valueRow of variantValues) {
    const value = toSpecString(valueRow.value);
    if (!value) {
      continue;
    }
    const byKey = specValuesByProduct.get(valueRow.productId) ?? new Map<string, string[]>();
    const existing = byKey.get(valueRow.key) ?? [];
    if (!existing.includes(value)) {
      existing.push(value);
      byKey.set(valueRow.key, existing);
      specValuesByProduct.set(valueRow.productId, byKey);
    }
  }

  const seenSkus = new Set<string>();
  const readyProducts: MMarketPayloadProduct[] = [];
  const exportedProductIds: string[] = [];
  const failedProducts: MMarketPreflightResult["failedProducts"] = [];

  for (const product of products) {
    const sku = product.sku?.trim() ?? "";
    const name = product.name?.trim() ?? "";
    const category = product.category?.trim() ?? "";
    const description = product.description?.trim() ?? "";
    const price = product.basePriceKgs === null ? null : Number(product.basePriceKgs);

    const issues: MMarketPreflightIssueCode[] = [];
    const warnings: MMarketPreflightWarningCode[] = [];

    if (!sku) {
      addIssue(issues, "MISSING_SKU");
    } else {
      const normalizedSku = sku.toUpperCase();
      if (seenSkus.has(normalizedSku)) {
        addIssue(issues, "DUPLICATE_SKU");
      }
      seenSkus.add(normalizedSku);
    }

    if (name.length < MMARKET_MIN_NAME_LEN || name.length > MMARKET_MAX_NAME_LEN) {
      addIssue(issues, "INVALID_NAME_LENGTH");
    }

    if (price === null || !Number.isFinite(price) || price < 0) {
      addIssue(issues, "MISSING_PRICE");
    }

    if (!category) {
      addIssue(issues, "MISSING_CATEGORY");
    }

    if (description.length < MMARKET_MIN_DESCRIPTION_LEN) {
      addIssue(issues, "SHORT_DESCRIPTION");
    }

    const imageUrls = collectImageUrls(product);
    const { nonDirectImageUrls, exportImageUrls } = buildMMarketImageUrls(imageUrls);
    if (nonDirectImageUrls.length > 0) {
      addIssue(issues, "NON_DIRECT_IMAGE_URL");
    }
    if (exportImageUrls.length < MMARKET_MIN_IMAGES) {
      addIssue(issues, "INVALID_IMAGES_COUNT");
    }

    if (!mappedStores.length || missingStoreMappings.length > 0) {
      addIssue(issues, "MISSING_STOCK_MAPPING");
    }

    const stockRowsForProduct = stockByProductStore.get(product.id) ?? new Map<string, number>();
    const stockPayload = mappedStores.map(({ store, branchId }) => ({
      quantity: Math.max(0, Math.trunc(stockRowsForProduct.get(store.id) ?? 0)),
      branch_id: branchId,
    }));

    const categoryTemplateSpecs = category ? (templateSpecsByCategory.get(category) ?? []) : [];
    const valueMap = specValuesByProduct.get(product.id) ?? new Map<string, string[]>();
    const specs: Record<string, string> = {};

    if (!categoryTemplateSpecs.length) {
      addIssue(issues, "MISSING_SPECS");
    } else {
      let hasMissingSpecValue = false;
      for (const templateSpec of categoryTemplateSpecs) {
        const values = valueMap.get(templateSpec.attributeKey) ?? [];
        if (!values.length) {
          hasMissingSpecValue = true;
          continue;
        }
        if (!(templateSpec.specKey in specs)) {
          specs[templateSpec.specKey] = values[0] ?? "";
        }
        if (values.length > 1) {
          addWarning(warnings, "SPECS_MULTIPLE_VALUES");
        }
      }
      if (hasMissingSpecValue || !Object.keys(specs).length) {
        addIssue(issues, "MISSING_SPECS");
      }
    }

    if (category && Object.keys(specs).length && remoteSpecCatalog.mode === "REMOTE") {
      const allowedKeys = remoteSpecCatalog.allowedByCategory.get(category);
      if (allowedKeys && allowedKeys.size > 0) {
        const hasUnknownKey = Object.keys(specs).some((key) => !allowedKeys.has(key));
        if (hasUnknownKey) {
          addWarning(warnings, "SPECS_KEY_UNRECOGNIZED");
        }
      }
    }

    if (issues.length > 0) {
      failedProducts.push({
        productId: product.id,
        sku,
        name,
        issues,
        warnings,
      });
      continue;
    }

    readyProducts.push({
      sku,
      name,
      price: price ?? 0,
      category,
      description,
      images: exportImageUrls,
      stock: stockPayload,
      specs,
    });
    exportedProductIds.push(product.id);
  }

  const payload = buildMMarketPayload(readyProducts);
  const blockerCounts = countByCode(failedProducts.map((item) => ({ codes: item.issues })));
  if (activeIncludedCount === 0) {
    blockerCounts.NO_PRODUCTS_SELECTED = 1;
  }
  const warningCounts = countByCode(failedProducts.map((item) => ({ codes: item.warnings })));
  for (const globalWarning of remoteSpecCatalog.globalWarnings) {
    warningCounts[globalWarning] = (warningCounts[globalWarning] ?? 0) + 1;
  }

  const cooldownSeconds = await getCooldownSeconds(input.organizationId);
  const nextAllowedAt = cooldownSeconds ? new Date(Date.now() + cooldownSeconds * 1_000) : null;

  const preflight: MMarketPreflightResult = {
    generatedAt: new Date(),
    canExport: failedProducts.length === 0 && activeIncludedCount > 0,
    summary: {
      mode: "IN_STOCK_ONLY",
      storesTotal: stores.length,
      storesMapped: mappedStores.length,
      productsConsidered: products.length,
      productsReady: readyProducts.length,
      productsFailed: failedProducts.length,
    },
    blockers: {
      total: failedProducts.length + (activeIncludedCount === 0 ? 1 : 0),
      byCode: blockerCounts,
      missingStoreMappings,
    },
    warnings: {
      total: Object.values(warningCounts).reduce((sum, value) => sum + (value ?? 0), 0),
      byCode: warningCounts,
      global: remoteSpecCatalog.globalWarnings,
    },
    failedProducts,
    cooldown: {
      active: cooldownSeconds > 0,
      remainingSeconds: cooldownSeconds,
      nextAllowedAt,
    },
    specValidationMode: remoteSpecCatalog.mode,
  };

  const payloadBytes = getPayloadBytes(payload);
  const payloadStats = {
    productCount: payload.products.length,
    selectedProducts: activeIncludedCount,
    storesTotal: stores.length,
    storesMapped: mappedStores.length,
    failedProducts: failedProducts.length,
    warningCount: preflight.warnings.total,
    consideredProducts: products.length,
    payloadBytes,
  };

  return {
    preflight,
    payload,
    exportedProductIds,
    payloadStats,
    errorReport: buildMMarketErrorReport({
      environment: input.environment,
      preflight,
      payload,
      payloadBytes,
      payloadStats,
    }),
  };
};

const ensureStoreOwnership = async (organizationId: string, storeIds: string[]) => {
  if (!storeIds.length) {
    return;
  }
  const stores = await prisma.store.findMany({
    where: {
      organizationId,
      id: { in: storeIds },
    },
    select: { id: true },
  });
  if (stores.length !== new Set(storeIds).size) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }
};

const ensureProductOwnership = async (organizationId: string, productIds: string[]) => {
  const uniqueIds = Array.from(new Set(productIds.map((id) => id.trim()).filter(Boolean)));
  if (!uniqueIds.length) {
    return [];
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

const sendMMarketPayload = async (input: {
  environment: MMarketEnvironment;
  token: string;
  payload: MMarketPayload;
}): Promise<RemoteApiResult> => {
  const endpoint = MMARKET_IMPORT_ENDPOINTS[input.environment];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MMARKET_REQUEST_TIMEOUT_MS);

  try {
    const payloadJson = JSON.stringify(input.payload);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Token ${input.token}`,
        "Content-Type": "application/json",
      },
      body: payloadJson,
      signal: controller.signal,
    });
    const raw = await response.text();
    const body = parseJson(raw);
    if (!response.ok) {
      throw new MMarketRemoteError(response.status, body);
    }
    return {
      status: response.status,
      body,
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const getMMarketOverview = async (organizationId: string) => {
  const [integration, stores, mappings] = await Promise.all([
    prisma.mMarketIntegration.findUnique({
      where: { orgId: organizationId },
      select: {
        id: true,
        status: true,
        environment: true,
        apiTokenEncrypted: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastErrorSummary: true,
      },
    }),
    prisma.store.count({ where: { organizationId } }),
    prisma.mMarketBranchMapping.count({
      where: {
        orgId: organizationId,
        mmarketBranchId: { not: "" },
      },
    }),
  ]);

  const mappingsComplete = stores > 0 && mappings === stores;
  const status = resolveOverviewStatus({ integration, mappingsComplete });

  return {
    configured: Boolean(integration?.apiTokenEncrypted) && mappingsComplete,
    status,
    environment: integration?.environment ?? MMarketEnvironment.DEV,
    lastSyncAt: integration?.lastSyncAt ?? null,
    lastSyncStatus: integration?.lastSyncStatus ?? null,
    lastErrorSummary: integration?.lastErrorSummary ?? null,
  };
};

export const getMMarketSettings = async (organizationId: string) => {
  const [integration, stores, mappings, cooldownSeconds] = await Promise.all([
    prisma.mMarketIntegration.findUnique({
      where: { orgId: organizationId },
      select: {
        id: true,
        orgId: true,
        status: true,
        environment: true,
        apiTokenEncrypted: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastErrorSummary: true,
      },
    }),
    prisma.store.findMany({
      where: { organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.mMarketBranchMapping.findMany({
      where: { orgId: organizationId },
      select: { storeId: true, mmarketBranchId: true },
    }),
    getCooldownSeconds(organizationId),
  ]);

  const mappingByStoreId = new Map(
    mappings.map((mapping) => [mapping.storeId, normalizeBranchId(mapping.mmarketBranchId)]),
  );
  const mappedCount = stores.filter(
    (store) => (mappingByStoreId.get(store.id) ?? "").length > 0,
  ).length;
  const mappingsComplete = stores.length > 0 && mappedCount === stores.length;
  const status = resolveOverviewStatus({ integration, mappingsComplete });

  return {
    integration: integration
      ? {
          id: integration.id,
          status,
          rawStatus: integration.status,
          environment: integration.environment,
          hasToken: Boolean(integration.apiTokenEncrypted),
          lastSyncAt: integration.lastSyncAt,
          lastSyncStatus: integration.lastSyncStatus,
          lastErrorSummary: integration.lastErrorSummary,
          configured: Boolean(integration.apiTokenEncrypted) && mappingsComplete,
        }
      : {
          id: null,
          status: "NOT_CONFIGURED" as const,
          rawStatus: MMarketIntegrationStatus.DISABLED,
          environment: MMarketEnvironment.DEV,
          hasToken: false,
          lastSyncAt: null,
          lastSyncStatus: null,
          lastErrorSummary: null,
          configured: false,
        },
    stores: stores.map((store) => ({
      storeId: store.id,
      storeName: store.name,
      mmarketBranchId: mappingByStoreId.get(store.id) ?? "",
    })),
    cooldown: {
      active: cooldownSeconds > 0,
      remainingSeconds: cooldownSeconds,
      nextAllowedAt: cooldownSeconds ? new Date(Date.now() + cooldownSeconds * 1_000) : null,
    },
    endpoints: MMARKET_IMPORT_ENDPOINTS,
  };
};

export const getMMarketSavedToken = async (organizationId: string) => {
  const integration = await prisma.mMarketIntegration.findUnique({
    where: { orgId: organizationId },
    select: { apiTokenEncrypted: true },
  });

  if (!integration?.apiTokenEncrypted) {
    return { apiToken: "" };
  }

  return {
    apiToken: decryptToken(integration.apiTokenEncrypted),
  };
};

export const listMMarketProducts = async (input: {
  organizationId: string;
  search?: string;
  selection?: MMarketProductSelectionFilter;
  page?: number;
  pageSize?: number;
}) => {
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(10, Math.max(1, Math.trunc(input.pageSize ?? 10)));
  const search = normalizeSearch(input.search);
  const selection = input.selection ?? "all";
  const hasExplicitSelection = await hasExplicitMMarketProductSelection(
    prisma,
    input.organizationId,
  );

  const baseWhere: Prisma.ProductWhereInput = {
    organizationId: input.organizationId,
    isDeleted: false,
    ...mMarketListableImageWhere,
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
    selection === "excluded"
      ? hasExplicitSelection
        ? {
            mMarketInclusions: {
              none: { orgId: input.organizationId },
            },
          }
        : {}
      : selection === "included"
        ? hasExplicitSelection
          ? {
              mMarketInclusions: {
                some: { orgId: input.organizationId },
              },
            }
          : { id: { in: [] } }
        : {};

  const where: Prisma.ProductWhereInput = {
    ...baseWhere,
    ...searchWhere,
    ...selectionWhere,
  };

  const [totalProducts, includedProducts, total, products] = await Promise.all([
    prisma.product.count({ where: baseWhere }),
    hasExplicitSelection
      ? prisma.product.count({
          where: {
            ...baseWhere,
            mMarketInclusions: {
              some: { orgId: input.organizationId },
            },
          },
        })
      : Promise.resolve(0),
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: {
        id: true,
        sku: true,
        name: true,
        category: true,
        photoUrl: true,
        images: {
          where: {
            AND: [{ url: { not: "" } }, { NOT: { url: { startsWith: "data:image/" } } }],
          },
          select: { url: true },
          orderBy: { position: "asc" },
          take: 1,
        },
        mMarketInclusions: {
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
      const included = hasExplicitSelection && product.mMarketInclusions.length > 0;
      const lastExportedAt = product.mMarketInclusions[0]?.lastExportedAt ?? null;

      return {
        id: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category?.trim() || null,
        imageUrl: resolveMMarketListImageUrl(product),
        onHandQty: onHandByProductId.get(product.id) ?? 0,
        included,
        lastExportedAt,
        exportStatus: resolveMMarketProductExportStatus({
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

export const updateMMarketProductSelection = async (input: {
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
    const hasExplicitSelection = await hasExplicitMMarketProductSelection(
      tx,
      input.organizationId,
    );

    if (!hasExplicitSelection) {
      // Drop legacy backfilled rows before the first explicit opt-in update.
      await tx.mMarketIncludedProduct.deleteMany({
        where: { orgId: input.organizationId },
      });
    }

    if (input.included) {
      await tx.mMarketIncludedProduct.createMany({
        data: productIds.map((productId) => ({
          orgId: input.organizationId,
          productId,
        })),
        skipDuplicates: true,
      });
    } else {
      await tx.mMarketIncludedProduct.deleteMany({
        where: {
          orgId: input.organizationId,
          productId: { in: productIds },
        },
      });
    }

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: MMARKET_PRODUCT_SELECTION_AUDIT_ACTION,
      entity: "MMarketIntegration",
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

export const updateMMarketConnection = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  environment: MMarketEnvironment;
  apiToken?: string | null;
  clearToken?: boolean;
}) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.mMarketIntegration.findUnique({
      where: { orgId: input.organizationId },
      select: {
        id: true,
        orgId: true,
        status: true,
        environment: true,
        apiTokenEncrypted: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastErrorSummary: true,
      },
    });

    const tokenInput = input.apiToken?.trim() ?? "";
    const nextTokenEncrypted = input.clearToken
      ? null
      : tokenInput.length > 0
        ? encryptToken(tokenInput)
        : (existing?.apiTokenEncrypted ?? null);

    const [storesCount, mappedCount] = await Promise.all([
      tx.store.count({ where: { organizationId: input.organizationId } }),
      tx.mMarketBranchMapping.count({
        where: {
          orgId: input.organizationId,
          mmarketBranchId: { not: "" },
        },
      }),
    ]);

    const mappingsComplete = storesCount > 0 && mappedCount === storesCount;
    const nextStatus = resolveStoredIntegrationStatus({
      hasToken: Boolean(nextTokenEncrypted),
      mappingsComplete,
    });

    const saved = await tx.mMarketIntegration.upsert({
      where: { orgId: input.organizationId },
      update: {
        environment: input.environment,
        apiTokenEncrypted: nextTokenEncrypted,
        status: nextStatus,
        lastErrorSummary: null,
      },
      create: {
        orgId: input.organizationId,
        environment: input.environment,
        apiTokenEncrypted: nextTokenEncrypted,
        status: nextStatus,
      },
      select: {
        id: true,
        orgId: true,
        status: true,
        environment: true,
        apiTokenEncrypted: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastErrorSummary: true,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "MMARKET_CONFIG_UPDATED",
      entity: "MMarketIntegration",
      entityId: saved.id,
      before: existing ? toJson(stripSensitiveIntegration(existing)) : null,
      after: toJson(stripSensitiveIntegration(saved)),
      requestId: input.requestId,
    });

    return saved;
  });
};

export const updateMMarketBranchMappings = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  mappings: Array<{
    storeId: string;
    mmarketBranchId: string;
  }>;
}) => {
  const mappingByStoreId = new Map<string, string>();
  for (const mapping of input.mappings) {
    mappingByStoreId.set(mapping.storeId, normalizeBranchId(mapping.mmarketBranchId));
  }

  await ensureStoreOwnership(input.organizationId, Array.from(mappingByStoreId.keys()));

  return prisma.$transaction(async (tx) => {
    const stores = await tx.store.findMany({
      where: { organizationId: input.organizationId },
      select: { id: true },
    });

    for (const store of stores) {
      const branchId = mappingByStoreId.get(store.id) ?? "";
      if (branchId) {
        await tx.mMarketBranchMapping.upsert({
          where: {
            orgId_storeId: {
              orgId: input.organizationId,
              storeId: store.id,
            },
          },
          update: {
            mmarketBranchId: branchId,
          },
          create: {
            orgId: input.organizationId,
            storeId: store.id,
            mmarketBranchId: branchId,
          },
        });
      } else {
        await tx.mMarketBranchMapping.deleteMany({
          where: {
            orgId: input.organizationId,
            storeId: store.id,
          },
        });
      }
    }

    const [integrationBefore, mappedCount] = await Promise.all([
      tx.mMarketIntegration.findUnique({
        where: { orgId: input.organizationId },
        select: {
          id: true,
          orgId: true,
          status: true,
          environment: true,
          apiTokenEncrypted: true,
          lastSyncAt: true,
          lastSyncStatus: true,
          lastErrorSummary: true,
        },
      }),
      tx.mMarketBranchMapping.count({
        where: {
          orgId: input.organizationId,
          mmarketBranchId: { not: "" },
        },
      }),
    ]);

    const mappingsComplete = stores.length > 0 && mappedCount === stores.length;
    const nextStatus = resolveStoredIntegrationStatus({
      hasToken: Boolean(integrationBefore?.apiTokenEncrypted),
      mappingsComplete,
    });

    const integrationAfter = await tx.mMarketIntegration.upsert({
      where: { orgId: input.organizationId },
      update: {
        status: nextStatus,
        lastErrorSummary: null,
      },
      create: {
        orgId: input.organizationId,
        status: nextStatus,
        environment: MMarketEnvironment.DEV,
      },
      select: {
        id: true,
        orgId: true,
        status: true,
        environment: true,
        apiTokenEncrypted: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastErrorSummary: true,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "MMARKET_CONFIG_UPDATED",
      entity: "MMarketIntegration",
      entityId: integrationAfter.id,
      before: integrationBefore ? toJson(stripSensitiveIntegration(integrationBefore)) : null,
      after: toJson({
        ...stripSensitiveIntegration(integrationAfter),
        mappedStores: mappedCount,
        totalStores: stores.length,
      }),
      requestId: input.requestId,
    });

    return {
      mappedStores: mappedCount,
      totalStores: stores.length,
      status: integrationAfter.status,
    };
  });
};

export const validateMMarketLocally = async (organizationId: string) => {
  const settings = await getMMarketSettings(organizationId);
  const ready = settings.integration.configured;

  return {
    ready,
    environment: settings.integration.environment,
    endpoint: MMARKET_IMPORT_ENDPOINTS[settings.integration.environment],
    hasToken: settings.integration.hasToken,
    mappedStores: settings.stores.filter((store) => store.mmarketBranchId.trim().length > 0).length,
    totalStores: settings.stores.length,
  };
};

export const runMMarketPreflight = async (organizationId: string) => {
  const integration = await prisma.mMarketIntegration.findUnique({
    where: { orgId: organizationId },
    select: {
      environment: true,
      apiTokenEncrypted: true,
    },
  });

  const token = integration?.apiTokenEncrypted ? decryptToken(integration.apiTokenEncrypted) : null;
  const plan = await buildMMarketExportPlan({
    organizationId,
    environment: integration?.environment ?? MMarketEnvironment.DEV,
    token,
  });

  return plan.preflight;
};

export const bulkGenerateMMarketShortDescriptions = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  locale?: string | null;
  logger?: MMarketBulkDescriptionLogger;
}) => {
  const preflight = await runMMarketPreflight(input.organizationId);
  const productIds = Array.from(
    new Set(
      preflight.failedProducts
        .filter((product) => product.issues.includes("SHORT_DESCRIPTION"))
        .map((product) => product.productId),
    ),
  );

  if (!productIds.length) {
    return {
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      deferredCount: 0,
      rateLimited: false,
      updatedProductIds: [] as string[],
      targetedCount: 0,
    };
  }

  const result = await bulkGenerateProductDescriptions({
    organizationId: input.organizationId,
    actorId: input.actorId,
    requestId: input.requestId,
    productIds,
    locale: input.locale,
    logger: input.logger,
    maxProducts: productIds.length,
  });

  return {
    ...result,
    targetedCount: productIds.length,
  };
};

export const bulkCreateMMarketBaseTemplates = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  logger?: MMarketBaseTemplateLogger;
}) => {
  const preflight = await runMMarketPreflight(input.organizationId);
  const productIds = Array.from(
    new Set(
      preflight.failedProducts
        .filter((product) => product.issues.includes("MISSING_SPECS"))
        .map((product) => product.productId),
    ),
  );

  if (!productIds.length) {
    return {
      targetedCount: 0,
      createdCategoryCount: 0,
      createdAttributeCount: 0,
      reactivatedAttributeCount: 0,
      categories: [] as string[],
      attributeKeys: [] as string[],
    };
  }

  const products = await prisma.product.findMany({
    where: {
      organizationId: input.organizationId,
      id: { in: productIds },
      isDeleted: false,
      category: { not: null },
    },
    select: {
      category: true,
    },
  });

  const categories = Array.from(
    new Set(products.map((product) => product.category?.trim() ?? "").filter(Boolean)),
  );
  if (!categories.length) {
    return {
      targetedCount: 0,
      createdCategoryCount: 0,
      createdAttributeCount: 0,
      reactivatedAttributeCount: 0,
      categories: [] as string[],
      attributeKeys: [] as string[],
    };
  }

  const existingTemplates = await prisma.categoryAttributeTemplate.findMany({
    where: {
      organizationId: input.organizationId,
      category: { in: categories },
    },
    select: {
      category: true,
    },
    distinct: ["category"],
  });

  const templateCategories = new Set(existingTemplates.map((row) => row.category.trim()));
  const missingTemplateCategories = categories.filter(
    (category) => !templateCategories.has(category),
  );

  if (!missingTemplateCategories.length) {
    return {
      targetedCount: 0,
      createdCategoryCount: 0,
      createdAttributeCount: 0,
      reactivatedAttributeCount: 0,
      categories: [] as string[],
      attributeKeys: [] as string[],
    };
  }

  const labelSet = new Set(MMARKET_BASE_TEMPLATE_DEFINITIONS.map((item) => item.labelRu));
  const keySet = new Set(MMARKET_BASE_TEMPLATE_DEFINITIONS.map((item) => item.key));
  const existingDefinitions = await prisma.attributeDefinition.findMany({
    where: {
      organizationId: input.organizationId,
      OR: [{ key: { in: Array.from(keySet) } }, { labelRu: { in: Array.from(labelSet) } }],
    },
    orderBy: { key: "asc" },
  });

  let createdAttributeCount = 0;
  let reactivatedAttributeCount = 0;
  const resolvedAttributeKeys: string[] = [];

  for (const baseDefinition of MMARKET_BASE_TEMPLATE_DEFINITIONS) {
    const existing =
      existingDefinitions.find((definition) => definition.key === baseDefinition.key) ??
      existingDefinitions.find(
        (definition) => definition.labelRu.trim() === baseDefinition.labelRu,
      );

    if (existing) {
      if (!existing.isActive) {
        await prisma.attributeDefinition.update({
          where: { id: existing.id },
          data: {
            isActive: true,
            labelKg: existing.labelKg?.trim() || baseDefinition.labelKg,
          },
        });
        reactivatedAttributeCount += 1;
      }
      resolvedAttributeKeys.push(existing.key);
      continue;
    }

    const created = await prisma.attributeDefinition.create({
      data: {
        organizationId: input.organizationId,
        key: baseDefinition.key,
        labelRu: baseDefinition.labelRu,
        labelKg: baseDefinition.labelKg,
        type: baseDefinition.type,
        required: false,
        isActive: true,
      },
    });
    createdAttributeCount += 1;
    resolvedAttributeKeys.push(created.key);

    await writeAuditLog(prisma, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "ATTRIBUTE_CREATE",
      entity: "AttributeDefinition",
      entityId: created.id,
      before: null,
      after: toJson(created),
      requestId: input.requestId,
    });
  }

  for (const category of missingTemplateCategories) {
    await setCategoryTemplate({
      organizationId: input.organizationId,
      actorId: input.actorId,
      requestId: input.requestId,
      category,
      attributeKeys: resolvedAttributeKeys,
    });
  }

  input.logger?.info(
    {
      phase: "create-base-templates",
      categories: missingTemplateCategories,
      createdCategoryCount: missingTemplateCategories.length,
      createdAttributeCount,
      reactivatedAttributeCount,
      attributeKeys: resolvedAttributeKeys,
    },
    "created base MMarket category templates",
  );

  return {
    targetedCount: missingTemplateCategories.length,
    createdCategoryCount: missingTemplateCategories.length,
    createdAttributeCount,
    reactivatedAttributeCount,
    categories: missingTemplateCategories,
    attributeKeys: resolvedAttributeKeys,
  };
};

export const assignDefaultCategoryToMMarketProducts = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  logger?: MMarketBaseTemplateLogger;
}) => {
  const preflight = await runMMarketPreflight(input.organizationId);
  const productIds = Array.from(
    new Set(
      preflight.failedProducts
        .filter((product) => product.issues.includes("MISSING_CATEGORY"))
        .map((product) => product.productId),
    ),
  );

  if (!productIds.length) {
    return {
      targetedCount: 0,
      updatedCount: 0,
      updatedProductIds: [] as string[],
      category: MMARKET_DEFAULT_UNCATEGORIZED_NAME,
    };
  }

  const result = await bulkUpdateProductCategory({
    organizationId: input.organizationId,
    actorId: input.actorId,
    requestId: input.requestId,
    productIds,
    category: MMARKET_DEFAULT_UNCATEGORIZED_NAME,
  });

  input.logger?.info(
    {
      phase: "assign-default-category",
      targetedCount: productIds.length,
      updatedCount: result.updated,
      category: MMARKET_DEFAULT_UNCATEGORIZED_NAME,
    },
    "assigned default MMarket category to exported products without category",
  );

  return {
    targetedCount: productIds.length,
    updatedCount: result.updated,
    updatedProductIds: productIds,
    category: MMARKET_DEFAULT_UNCATEGORIZED_NAME,
  };
};

export const bulkAutofillMMarketSpecs = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  logger?: MMarketBulkSpecsLogger;
}) => {
  const preflight = await runMMarketPreflight(input.organizationId);
  const productIds = Array.from(
    new Set(
      preflight.failedProducts
        .filter((product) => product.issues.includes("MISSING_SPECS"))
        .map((product) => product.productId),
    ),
  );

  if (!productIds.length) {
    return {
      updatedCount: 0,
      filledValueCount: 0,
      skippedCount: 0,
      failedCount: 0,
      deferredCount: 0,
      rateLimited: false,
      updatedProductIds: [] as string[],
      targetedCount: 0,
      skipReasonCounts: createBulkAutofillSkipReasonCounts(),
    };
  }

  const products = await prisma.product.findMany({
    where: {
      organizationId: input.organizationId,
      id: { in: productIds },
      isDeleted: false,
    },
    select: {
      id: true,
      sku: true,
      name: true,
      category: true,
      photoUrl: true,
      supplier: {
        select: { name: true },
      },
      images: {
        where: {
          url: {
            not: { startsWith: "data:image/" },
          },
        },
        select: { url: true },
        orderBy: { position: "asc" },
        take: 3,
      },
      variants: {
        where: { isActive: true },
        select: { id: true, attributes: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const categories = Array.from(
    new Set(
      products
        .map((product) => product.category?.trim() ?? "")
        .filter((category) => category.length > 0),
    ),
  );

  const [categoryTemplates, variantValues] = await Promise.all([
    categories.length
      ? prisma.categoryAttributeTemplate.findMany({
          where: {
            organizationId: input.organizationId,
            category: { in: categories },
          },
          select: {
            category: true,
            attributeKey: true,
            order: true,
            definition: {
              select: {
                labelRu: true,
                type: true,
                optionsRu: true,
              },
            },
          },
          orderBy: [{ category: "asc" }, { order: "asc" }],
        })
      : Promise.resolve([]),
    productIds.length
      ? prisma.variantAttributeValue.findMany({
          where: {
            organizationId: input.organizationId,
            productId: { in: productIds },
          },
          select: {
            productId: true,
            key: true,
            value: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const templatesByCategory = new Map<string, AutofillTemplateSpec[]>();
  for (const template of categoryTemplates) {
    if (!template.definition?.labelRu?.trim()) {
      continue;
    }
    const list = templatesByCategory.get(template.category) ?? [];
    list.push({
      attributeKey: template.attributeKey,
      labelRu: template.definition.labelRu.trim(),
      type: template.definition.type,
      optionsRu: parseOptionStrings(template.definition.optionsRu),
      autofillKind: resolveAutofillKind({
        labelRu: template.definition.labelRu,
        attributeKey: template.attributeKey,
      }),
    });
    templatesByCategory.set(template.category, list);
  }

  const currentValuesByProduct = new Map<string, Map<string, string[]>>();
  for (const valueRow of variantValues) {
    const value = toSpecString(valueRow.value);
    if (!value) {
      continue;
    }
    const byKey = currentValuesByProduct.get(valueRow.productId) ?? new Map<string, string[]>();
    const existing = byKey.get(valueRow.key) ?? [];
    if (!existing.includes(value)) {
      existing.push(value);
      byKey.set(valueRow.key, existing);
      currentValuesByProduct.set(valueRow.productId, byKey);
    }
  }

  const productById = new Map(products.map((product) => [product.id, product]));
  let updatedCount = 0;
  let filledValueCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let rateLimited = false;
  const updatedProductIds: string[] = [];
  const skipReasonCounts = createBulkAutofillSkipReasonCounts();

  for (const productId of productIds) {
    const product = productById.get(productId);
    if (!product || !product.category?.trim()) {
      skippedCount += 1;
      skipReasonCounts.noCategory += 1;
      continue;
    }

    const templateSpecs = templatesByCategory.get(product.category.trim()) ?? [];
    if (!templateSpecs.length) {
      skippedCount += 1;
      skipReasonCounts.noTemplate += 1;
      continue;
    }

    const currentValues = currentValuesByProduct.get(product.id) ?? new Map<string, string[]>();
    const nextValues = new Map<string, unknown>();
    let stopAfterCurrentProduct = false;
    let supportedFieldCount = 0;
    const aiRequests: Array<{
      attributeKey: string;
      type: AutofillTemplateSpec["type"];
      kind: "type" | "color";
      labelRu: string;
      options?: string[];
    }> = [];

    for (const templateSpec of templateSpecs) {
      const hasValue = (currentValues.get(templateSpec.attributeKey) ?? []).length > 0;
      if (hasValue || !templateSpec.autofillKind) {
        continue;
      }
      supportedFieldCount += 1;

      if (templateSpec.autofillKind === "manufacturer") {
        const manufacturerValue = product.supplier?.name?.trim() || MMARKET_DEFAULT_MANUFACTURER;
        if (manufacturerValue) {
          nextValues.set(
            templateSpec.attributeKey,
            toStoredAttributeValue(templateSpec.type, manufacturerValue),
          );
        }
        continue;
      }

      if (templateSpec.autofillKind === "model") {
        const modelValue = MMARKET_DEFAULT_MODEL || product.sku.trim();
        if (modelValue) {
          nextValues.set(
            templateSpec.attributeKey,
            toStoredAttributeValue(templateSpec.type, modelValue),
          );
        }
        continue;
      }

      if (
        (templateSpec.autofillKind === "type" || templateSpec.autofillKind === "color") &&
        !aiRequests.some((entry) => entry.attributeKey === templateSpec.attributeKey)
      ) {
        aiRequests.push({
          attributeKey: templateSpec.attributeKey,
          type: templateSpec.type,
          kind: templateSpec.autofillKind,
          labelRu: templateSpec.labelRu,
          options: templateSpec.optionsRu,
        });
      }
    }

    if (aiRequests.length > 0) {
      const imageUrls = Array.from(
        new Set(
          [product.photoUrl, ...product.images.map((image) => image.url)]
            .map((value) => normalizeProductImageUrl(value ?? null))
            .filter((value): value is string => Boolean(value)),
        ),
      ).slice(0, 3);

      if (imageUrls.length > 0) {
        try {
          const aiResult = await suggestProductSpecsFromImages({
            imageUrls,
            requestedSpecs: aiRequests.map((entry) => ({
              kind: entry.kind,
              labelRu: entry.labelRu,
              options: entry.options,
            })),
            logger: input.logger,
          });

          for (const request of aiRequests) {
            const suggestedValue = aiResult.suggestions[request.kind];
            if (!suggestedValue) {
              continue;
            }
            nextValues.set(
              request.attributeKey,
              toStoredAttributeValue(request.type, suggestedValue),
            );
          }
        } catch (error) {
          if (error instanceof Error && error.message === "rateLimited") {
            rateLimited = true;
            stopAfterCurrentProduct = true;
          }
          if (error instanceof Error && error.message === "aiSpecNoUsableImages") {
            // Keep rule-based values if any; otherwise this product will be skipped below.
          } else if (!(error instanceof Error && error.message === "rateLimited")) {
            throw error;
          }
        }
      }
    }

    if (!nextValues.size) {
      skippedCount += 1;
      if (supportedFieldCount === 0) {
        skipReasonCounts.noSupportedFields += 1;
      } else {
        skipReasonCounts.noResolvedValues += 1;
      }
      continue;
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        let targetVariant = product.variants[0];
        if (!targetVariant) {
          targetVariant = await tx.productVariant.create({
            data: {
              productId: product.id,
              attributes: toJson({}),
            },
            select: { id: true, attributes: true },
          });
        }

        const currentAttributes =
          targetVariant.attributes &&
          typeof targetVariant.attributes === "object" &&
          !Array.isArray(targetVariant.attributes)
            ? { ...(targetVariant.attributes as Record<string, unknown>) }
            : {};

        const beforeValues = Array.from(nextValues.keys()).reduce<Record<string, string | null>>(
          (accumulator, key) => {
            accumulator[key] = currentValues.get(key)?.[0] ?? null;
            return accumulator;
          },
          {},
        );

        for (const [key, value] of nextValues.entries()) {
          currentAttributes[key] = value;
        }

        await tx.productVariant.update({
          where: { id: targetVariant.id },
          data: {
            attributes: toJson(currentAttributes),
          },
        });

        for (const [key, value] of nextValues.entries()) {
          await tx.variantAttributeValue.upsert({
            where: {
              variantId_key: {
                variantId: targetVariant.id,
                key,
              },
            },
            update: {
              value: toJson(value),
            },
            create: {
              organizationId: input.organizationId,
              productId: product.id,
              variantId: targetVariant.id,
              key,
              value: toJson(value),
            },
          });
        }

        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "PRODUCT_UPDATE",
          entity: "Product",
          entityId: product.id,
          before: toJson({ specsAutofill: beforeValues }),
          after: toJson({
            specsAutofill: Array.from(nextValues.entries()).reduce<Record<string, unknown>>(
              (accumulator, [key, value]) => {
                accumulator[key] = value;
                return accumulator;
              },
              {},
            ),
            generated: true,
          }),
          requestId: input.requestId,
        });

        return nextValues.size;
      });

      updatedCount += 1;
      filledValueCount += updated;
      updatedProductIds.push(product.id);
    } catch (error) {
      failedCount += 1;
      input.logger?.warn(
        {
          phase: "bulk-specs-item",
          productId: product.id,
          error: error instanceof Error ? { message: error.message, name: error.name } : error,
        },
        "bulk MMarket specs autofill failed for item",
      );
    }

    if (stopAfterCurrentProduct) {
      break;
    }
  }

  const processedCount = updatedCount + skippedCount + failedCount;
  const deferredCount = rateLimited ? Math.max(0, productIds.length - processedCount) : 0;

  return {
    updatedCount,
    filledValueCount,
    skippedCount,
    failedCount,
    deferredCount,
    rateLimited,
    updatedProductIds,
    targetedCount: productIds.length,
    skipReasonCounts,
  };
};

export const listMMarketExportJobs = async (organizationId: string, limit = 50) => {
  const take = Math.max(1, Math.min(200, Math.trunc(limit)));
  return prisma.mMarketExportJob.findMany({
    where: { orgId: organizationId },
    orderBy: { createdAt: "desc" },
    take,
  });
};

export const getMMarketExportJob = async (organizationId: string, jobId: string) => {
  return prisma.mMarketExportJob.findFirst({
    where: {
      id: jobId,
      orgId: organizationId,
    },
  });
};

export const requestMMarketExport = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
}) => {
  const integration = await prisma.mMarketIntegration.findUnique({
    where: { orgId: input.organizationId },
    select: {
      id: true,
      orgId: true,
      status: true,
      environment: true,
      apiTokenEncrypted: true,
      lastSyncAt: true,
      lastSyncStatus: true,
      lastErrorSummary: true,
    },
  });

  if (!integration?.apiTokenEncrypted) {
    throw new AppError("mMarketNotConfigured", "CONFLICT", 409);
  }

  const token = decryptToken(integration.apiTokenEncrypted);
  const plan = await buildMMarketExportPlan({
    organizationId: input.organizationId,
    environment: integration.environment,
    token,
  });

  if (!plan.preflight.canExport) {
    throw new AppError("mMarketPreflightFailed", "CONFLICT", 409);
  }

  const requestIdempotencyKey = randomUUID();
  const cooldown = await acquireCooldownLock(input.organizationId);

  if (!cooldown.acquired) {
    const rateLimitedJob = await prisma.mMarketExportJob.create({
      data: {
        orgId: input.organizationId,
        environment: integration.environment,
        status: MMarketExportJobStatus.RATE_LIMITED,
        requestedById: input.actorId,
        finishedAt: new Date(),
        requestIdempotencyKey,
        payloadStatsJson: toJson({
          ...plan.payloadStats,
          rateLimited: true,
          remainingSeconds: cooldown.remainingSeconds,
        }),
        errorReportJson: toJson({
          reason: "rateLimited",
          remainingSeconds: cooldown.remainingSeconds,
        }),
      },
    });

    return {
      job: rateLimitedJob,
      remainingSeconds: cooldown.remainingSeconds,
    };
  }

  const queuedJob = await prisma.mMarketExportJob.create({
    data: {
      orgId: input.organizationId,
      environment: integration.environment,
      status: MMarketExportJobStatus.QUEUED,
      requestedById: input.actorId,
      requestIdempotencyKey,
      payloadStatsJson: toJson(plan.payloadStats),
    },
  });

  await writeAuditLog(prisma, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: "MMARKET_EXPORT_STARTED",
    entity: "MMarketExportJob",
    entityId: queuedJob.id,
    before: null,
    after: toJson({
      id: queuedJob.id,
      status: queuedJob.status,
      environment: queuedJob.environment,
      createdAt: queuedJob.createdAt,
      payloadStats: plan.payloadStats,
    }),
    requestId: input.requestId,
  });

  if (process.env.NODE_ENV !== "test") {
    void runJob(MMARKET_EXPORT_JOB_NAME, {
      jobId: queuedJob.id,
      organizationId: input.organizationId,
      requestId: input.requestId,
    }).catch(() => null);
  }

  return {
    job: queuedJob,
    remainingSeconds: 0,
  };
};

const runMMarketExportJob = async (
  payload?: JobPayload,
): Promise<{ job: string; status: "ok" | "skipped"; details?: Record<string, unknown> }> => {
  const requestPayload =
    payload && typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  const jobId = typeof requestPayload.jobId === "string" ? requestPayload.jobId : "";

  const job = jobId
    ? await prisma.mMarketExportJob.findFirst({
        where: { id: jobId, status: MMarketExportJobStatus.QUEUED },
      })
    : await prisma.mMarketExportJob.findFirst({
        where: { status: MMarketExportJobStatus.QUEUED },
        orderBy: { createdAt: "asc" },
      });

  if (!job) {
    return { job: MMARKET_EXPORT_JOB_NAME, status: "skipped", details: { reason: "empty" } };
  }

  const running = await prisma.mMarketExportJob.update({
    where: { id: job.id },
    data: {
      status: MMarketExportJobStatus.RUNNING,
      startedAt: new Date(),
      finishedAt: null,
      errorReportJson: Prisma.DbNull,
      responseJson: Prisma.DbNull,
    },
  });

  let plan: MMarketExportPlan | null = null;

  try {
    const integration = await prisma.mMarketIntegration.findUnique({
      where: { orgId: job.orgId },
      select: {
        id: true,
        orgId: true,
        status: true,
        environment: true,
        apiTokenEncrypted: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastErrorSummary: true,
      },
    });

    if (!integration?.apiTokenEncrypted) {
      throw new AppError("mMarketNotConfigured", "CONFLICT", 409);
    }

    const token = decryptToken(integration.apiTokenEncrypted);
    plan = await buildMMarketExportPlan({
      organizationId: job.orgId,
      environment: job.environment,
      token,
    });

    if (!plan.preflight.canExport) {
      throw new AppError("mMarketPreflightFailed", "CONFLICT", 409);
    }

    const remoteResult = await sendMMarketPayload({
      environment: job.environment,
      token,
      payload: plan.payload,
    });

    const exportedAt = new Date();
    const finished = await prisma.mMarketExportJob.update({
      where: { id: job.id },
      data: {
        status: MMarketExportJobStatus.DONE,
        finishedAt: exportedAt,
        payloadStatsJson: toJson({
          ...plan.payloadStats,
          httpStatus: remoteResult.status,
        }),
        errorReportJson: Prisma.DbNull,
        responseJson: toJson({
          httpStatus: remoteResult.status,
          body: remoteResult.body,
        }),
      },
    });

    if (plan.exportedProductIds.length > 0) {
      await prisma.mMarketIncludedProduct.updateMany({
        where: {
          orgId: job.orgId,
          productId: { in: plan.exportedProductIds },
        },
        data: {
          lastExportedAt: exportedAt,
        },
      });
    }

    await prisma.mMarketIntegration.updateMany({
      where: { orgId: job.orgId },
      data: {
        status: MMarketIntegrationStatus.READY,
        lastSyncAt: exportedAt,
        lastSyncStatus: MMarketLastSyncStatus.SUCCESS,
        lastErrorSummary: null,
      },
    });

    await writeAuditLog(prisma, {
      organizationId: job.orgId,
      actorId: job.requestedById,
      action: "MMARKET_EXPORT_FINISHED",
      entity: "MMarketExportJob",
      entityId: finished.id,
      before: toJson(running),
      after: toJson(finished),
      requestId:
        typeof requestPayload.requestId === "string" ? requestPayload.requestId : randomUUID(),
    });

    return {
      job: MMARKET_EXPORT_JOB_NAME,
      status: "ok",
      details: { jobId: finished.id, exportedProducts: plan.payload.products.length },
    };
  } catch (error) {
    const networkError = resolveMMarketNetworkError(error);
    const message = resolveMMarketExportFailureReason(error, networkError);

    const remoteResponse: MMarketRemoteErrorResponse | null =
      error instanceof MMarketRemoteError
        ? {
            httpStatus: error.status,
            body: error.body,
          }
        : null;

    const errorReport = toJson(
      plan
        ? buildMMarketErrorReport({
            environment: job.environment,
            requestIdempotencyKey: job.requestIdempotencyKey,
            preflight: plan.preflight,
            payload: plan.payload,
            payloadBytes: getPayloadBytes(plan.payload),
            payloadStats: plan.payloadStats,
            reason: message,
            remoteResponse,
            networkError,
          })
        : {
            environment: job.environment,
            endpoint: MMARKET_IMPORT_ENDPOINTS[job.environment],
            requestIdempotencyKey: job.requestIdempotencyKey,
            reason: message,
            remoteResponse: remoteResponse ?? null,
            networkError: networkError ?? null,
          },
    );

    const failed = await prisma.mMarketExportJob.update({
      where: { id: job.id },
      data: {
        status: MMarketExportJobStatus.FAILED,
        finishedAt: new Date(),
        errorReportJson: errorReport,
        responseJson: remoteResponse ? toJson(remoteResponse) : Prisma.DbNull,
      },
    });

    await prisma.mMarketIntegration.updateMany({
      where: { orgId: job.orgId },
      data: {
        status: MMarketIntegrationStatus.ERROR,
        lastSyncAt: new Date(),
        lastSyncStatus: MMarketLastSyncStatus.FAILED,
        lastErrorSummary: message,
      },
    });

    await writeAuditLog(prisma, {
      organizationId: job.orgId,
      actorId: job.requestedById,
      action: "MMARKET_EXPORT_FAILED",
      entity: "MMarketExportJob",
      entityId: failed.id,
      before: toJson(running),
      after: toJson({ ...failed, errorReport }),
      requestId:
        typeof requestPayload.requestId === "string" ? requestPayload.requestId : randomUUID(),
    });

    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("mMarketExportFailed", "INTERNAL_SERVER_ERROR", 500);
  }
};

registerJob(MMARKET_EXPORT_JOB_NAME, {
  handler: runMMarketExportJob,
  maxAttempts: 1,
  baseDelayMs: 1,
});

export const __resetMMarketCooldownForTests = () => {
  if (process.env.NODE_ENV !== "test") {
    return;
  }
  memoryCooldownStore.clear();
};

export const __buildMMarketExportPlanForTests = async (organizationId: string) => {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("testOnly");
  }
  const integration = await prisma.mMarketIntegration.findUnique({
    where: { orgId: organizationId },
    select: {
      environment: true,
      apiTokenEncrypted: true,
    },
  });
  const token = integration?.apiTokenEncrypted ? decryptToken(integration.apiTokenEncrypted) : null;
  return buildMMarketExportPlan({
    organizationId,
    environment: integration?.environment ?? MMarketEnvironment.DEV,
    token,
  });
};

export const __resolveMMarketExportFailureReasonForTests = (error: unknown) => {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("testOnly");
  }
  return resolveMMarketExportFailureReason(error);
};
