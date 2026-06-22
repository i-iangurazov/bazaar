import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";

import {
  OMarketExportJobStatus,
  OMarketIntegrationStatus,
  OMarketJobType,
  OMarketLastSyncStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { registerJob, runJob, type JobPayload } from "@/server/jobs";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";
import { normalizeProductImageUrl } from "@/server/services/productImageStorage";
import {
  createOrUpdateOMarketProducts,
  fullSyncOMarketProducts,
  getOMarketImportStatus,
  listOMarketRemoteProducts,
  normalizeOMarketBaseUrl,
  O_MARKET_DEFAULT_BASE_URL,
  O_MARKET_MAX_PRODUCTS_PER_REQUEST,
  O_MARKET_REQUEST_TIMEOUT_MS,
  updateOMarketStockPrice,
  type OMarketApiAttribute,
  type OMarketApiPayload,
  type OMarketApiProduct,
  type OMarketImportStatusRow,
} from "@/server/services/oMarketApiClient";

const O_MARKET_EXPORT_JOB_NAME = "o-market-export";
const O_MARKET_PRODUCT_SELECTION_AUDIT_ACTION = "O_MARKET_PRODUCT_SELECTION_UPDATED";
const O_MARKET_STATUS_POLL_ATTEMPTS = 3;
const O_MARKET_STATUS_POLL_DELAY_MS = 500;
const O_MARKET_SKU_MAX_LENGTH = 50;

const parsePositiveIntEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const O_MARKET_EXPORT_JOB_TIMEOUT_MS = parsePositiveIntEnv(
  process.env.O_MARKET_EXPORT_JOB_TIMEOUT_MS,
  60 * 60 * 1000,
);

export type OMarketOverviewStatus = "NOT_CONFIGURED" | "DRAFT" | "READY" | "ERROR";
export type OMarketProductSelectionFilter = "all" | "included" | "excluded";
export type OMarketProductExportStatus = "EXCLUDED" | "INCLUDED" | "EXPORTED";
export type OMarketExportMode = "ALL_SELECTED" | "READY_ONLY";
export type OMarketPerProductStatus =
  | "pending"
  | "processing"
  | "exported"
  | "updated"
  | "skipped"
  | "failed";

export type OMarketPreflightIssueCode =
  | "NO_PRODUCTS_SELECTED"
  | "MISSING_API_TOKEN"
  | "MISSING_STORE_MAPPING"
  | "INVALID_LOCATION_ID"
  | "MISSING_SKU"
  | "DUPLICATE_SKU"
  | "INVALID_SKU"
  | "MISSING_TITLE"
  | "MISSING_DESCRIPTION"
  | "MISSING_PRICE"
  | "INVALID_PRICE"
  | "MISSING_STOCK"
  | "INVALID_STOCK"
  | "MISSING_CATEGORY"
  | "MISSING_CATEGORY_MAPPING"
  | "MISSING_IMAGE"
  | "INVALID_IMAGE_URL"
  | "MISSING_SPECS"
  | "INVALID_DISCOUNT"
  | "TOO_MANY_PRODUCTS_IN_SINGLE_BATCH"
  | "API_AUTH_FAILED"
  | "OMARKET_VALIDATION_ERROR"
  | "NETWORK_API_ERROR";

export type OMarketPreflightWarningCode = "FULL_SYNC_DEACTIVATES_MISSING_PRODUCTS";

export type OMarketPreflightResult = {
  generatedAt: Date;
  jobType: OMarketJobType;
  canExport: boolean;
  store: {
    storeId: string;
    storeName: string;
    locationId: string | null;
  } | null;
  summary: {
    productsConsidered: number;
    productsReady: number;
    productsFailed: number;
    warnings: number;
  };
  blockers: {
    total: number;
    byCode: Partial<Record<OMarketPreflightIssueCode, number>>;
  };
  warnings: {
    total: number;
    byCode: Partial<Record<OMarketPreflightWarningCode, number>>;
    global: OMarketPreflightWarningCode[];
  };
  failedProducts: Array<{
    productId: string;
    sku: string;
    name: string;
    issues: OMarketPreflightIssueCode[];
  }>;
  readyProductIds: string[];
  validationResults: Array<{
    productId: string;
    status: "valid" | "warning" | "invalid";
    errors: OMarketPreflightIssueCode[];
    warnings: OMarketPreflightWarningCode[];
    canExport: boolean;
  }>;
  actionability: {
    canRunAll: boolean;
    canRunReadyOnly: boolean;
  };
};

export type OMarketProductResult = {
  productId: string | null;
  sku: string;
  name: string | null;
  status: OMarketPerProductStatus;
  reason: string | null;
  oMarketProductId?: number | null;
};

type OMarketExportPlan = {
  mode: OMarketExportMode;
  jobType: OMarketJobType;
  preflight: OMarketPreflightResult;
  payload: OMarketApiPayload;
  payloadByProductId: Map<string, OMarketApiProduct>;
  productMetaBySku: Map<string, { productId: string; sku: string; name: string }>;
  readyProductIds: string[];
  selectedProductIds: string[];
  payloadStats: Record<string, unknown>;
  errorReport: Record<string, unknown>;
};

type OMarketCategoryAttributes = {
  attributes: OMarketApiAttribute[];
  raw: unknown;
};

type OMarketDbClient = Prisma.TransactionClient | PrismaClient;

const nonDataImagePattern = /^data:image\//i;

const normalizeSearch = (value?: string | null) => value?.trim() ?? "";
const normalizeStoreId = (value?: string | null) => value?.trim() ?? "";
const normalizeSku = (value: string) => value.trim().toUpperCase();

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const toBase64Url = (value: Buffer) => value.toString("base64url");
const fromBase64Url = (value: string) => Buffer.from(value, "base64url");

const resolveTokenSecret = () =>
  process.env.O_MARKET_TOKEN_ENCRYPTION_KEY?.trim() ||
  process.env.NEXTAUTH_SECRET?.trim() ||
  "";

const tokenCipherKey = () => {
  const secret = resolveTokenSecret();
  if (!secret) {
    throw new AppError("oMarketTokenSecretMissing", "INTERNAL_SERVER_ERROR", 500);
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
    throw new AppError("oMarketTokenDecryptFailed", "INTERNAL_SERVER_ERROR", 500);
  }
  const decipher = createDecipheriv("aes-256-gcm", tokenCipherKey(), fromBase64Url(ivPart));
  decipher.setAuthTag(fromBase64Url(tagPart));
  const decrypted = Buffer.concat([decipher.update(fromBase64Url(dataPart)), decipher.final()]);
  return decrypted.toString("utf8");
};

const redactSensitiveText = (value: string, token?: string | null) => {
  let next = value;
  if (token?.trim()) {
    next = next.split(token.trim()).join("[REDACTED]");
  }
  return next.replace(/X-Access-Token\s*:\s*[^\s"]+/gi, "X-Access-Token: [REDACTED]");
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
        /(token|authorization|credential|secret)/i.test(key)
          ? "[REDACTED]"
          : sanitizeUnknown(nested, token),
      ]),
    );
  }
  return value;
};

const toErrorMessage = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.message;
  }
  return "oMarketApiRequestFailed";
};

export const normalizeOMarketApiError = (input: {
  status: number | null;
  body: unknown;
  error?: unknown;
  token?: string | null;
}) => {
  const status = input.status ?? 0;
  const code: OMarketPreflightIssueCode =
    status === 401 || status === 403
      ? "API_AUTH_FAILED"
      : status >= 400 && status < 500
        ? "OMARKET_VALIDATION_ERROR"
        : "NETWORK_API_ERROR";
  return {
    code,
    status: input.status,
    retryable: status === 408 || status === 429 || status >= 500,
    body: sanitizeUnknown(input.body, input.token),
    message: redactSensitiveText(toErrorMessage(input.error ?? input.body), input.token),
  };
};

const buildStoreProductWhere = (storeId: string): Prisma.ProductWhereInput => ({
  storeProducts: {
    some: {
      storeId,
      isActive: true,
    },
  },
});

const normalizeOMarketExportMode = (value?: unknown): OMarketExportMode =>
  value === "READY_ONLY" ? "READY_ONLY" : "ALL_SELECTED";

const resolveStoredIntegrationStatus = (input: {
  hasToken: boolean;
  hasStoreMapping: boolean;
  previousStatus?: OMarketIntegrationStatus | null;
}) => {
  if (input.previousStatus === OMarketIntegrationStatus.ERROR) {
    return OMarketIntegrationStatus.ERROR;
  }
  if (input.hasToken && input.hasStoreMapping) {
    return OMarketIntegrationStatus.READY;
  }
  if (input.hasToken || input.hasStoreMapping) {
    return OMarketIntegrationStatus.DRAFT;
  }
  return OMarketIntegrationStatus.DISABLED;
};

const resolveOverviewStatus = (integration: {
  status: OMarketIntegrationStatus;
  apiTokenEncrypted: string | null;
  hasStoreMapping: boolean;
} | null): OMarketOverviewStatus => {
  if (!integration) {
    return "NOT_CONFIGURED";
  }
  if (integration.status === OMarketIntegrationStatus.ERROR) {
    return "ERROR";
  }
  if (integration.apiTokenEncrypted && integration.hasStoreMapping) {
    return "READY";
  }
  if (integration.apiTokenEncrypted || integration.hasStoreMapping) {
    return "DRAFT";
  }
  return "NOT_CONFIGURED";
};

const parseLocationId = (value?: string | null) => {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return null;
  }
  if (!/^\d+$/.test(raw)) {
    return Number.NaN;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
};

const addIssue = (issues: OMarketPreflightIssueCode[], issue: OMarketPreflightIssueCode) => {
  if (!issues.includes(issue)) {
    issues.push(issue);
  }
};

const countByCode = <TCode extends string>(rows: Array<{ codes: TCode[] }>) =>
  rows.reduce<Partial<Record<TCode, number>>>((accumulator, row) => {
    for (const code of row.codes) {
      accumulator[code] = (accumulator[code] ?? 0) + 1;
    }
    return accumulator;
  }, {});

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

export const computeOMarketPayloadChecksum = (value: unknown) =>
  createHash("sha256").update(stableJson(value)).digest("hex");

export const chunkOMarketItems = <TItem>(items: TItem[], size: number) => {
  const result: TItem[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
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

export const validateOMarketImages = (imageUrls: string[]) => {
  const normalized: string[] = [];
  const issues: OMarketPreflightIssueCode[] = [];
  for (const value of imageUrls) {
    const imageUrl = normalizeProductImageUrl(value);
    if (!imageUrl || nonDataImagePattern.test(imageUrl)) {
      addIssue(issues, "INVALID_IMAGE_URL");
      continue;
    }
    normalized.push(imageUrl);
  }
  if (!normalized.length) {
    addIssue(issues, "MISSING_IMAGE");
  }
  return { normalized, issues };
};

const normalizeCategoryAttributes = (value: unknown): OMarketCategoryAttributes => {
  if (!Array.isArray(value)) {
    return { attributes: [], raw: value ?? null };
  }
  const attributes: OMarketApiAttribute[] = [];
  for (const entry of value) {
    const row = asRecord(entry);
    const attributeId = Number(row?.attribute_id ?? row?.attributeId);
    const valueId = Number(row?.value_id ?? row?.valueId);
    if (
      Number.isInteger(attributeId) &&
      attributeId > 0 &&
      Number.isInteger(valueId) &&
      valueId > 0
    ) {
      attributes.push({ attribute_id: attributeId, value_id: valueId });
    }
  }
  return { attributes, raw: value };
};

const parseCategoryAttributesInput = (value?: string | null) => {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("oMarketInvalidAttributesJson", "BAD_REQUEST", 400);
  }
  const normalized = normalizeCategoryAttributes(parsed);
  if (!Array.isArray(parsed) || normalized.attributes.length !== parsed.length) {
    throw new AppError("oMarketInvalidAttributesJson", "BAD_REQUEST", 400);
  }
  return parsed;
};

const buildVariantValuesByProduct = (
  values: Array<{ productId: string; key: string; value: Prisma.JsonValue }>,
) => {
  const result = new Map<string, Map<string, string[]>>();
  for (const row of values) {
    const byKey = result.get(row.productId) ?? new Map<string, string[]>();
    const rawValues = Array.isArray(row.value) ? row.value : [row.value];
    const normalized = rawValues
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    if (normalized.length) {
      byKey.set(row.key, normalized);
    }
    result.set(row.productId, byKey);
  }
  return result;
};

const resolveOMarketListImageUrl = (product: {
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

const resolveOMarketProductExportStatus = (input: {
  included: boolean;
  lastExportedAt: Date | null;
}): OMarketProductExportStatus => {
  if (!input.included) {
    return "EXCLUDED";
  }
  return input.lastExportedAt ? "EXPORTED" : "INCLUDED";
};

const resolveIntegrationStoreContext = async (input: {
  organizationId: string;
  storeId?: string | null;
}) => {
  const requestedStoreId = normalizeStoreId(input.storeId);
  if (requestedStoreId) {
    const store = await prisma.store.findFirst({
      where: { id: requestedStoreId, organizationId: input.organizationId },
      select: { id: true, name: true },
    });
    if (!store) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }
    return { storeId: store.id, storeName: store.name };
  }
  const stores = await prisma.store.findMany({
    where: { organizationId: input.organizationId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 1,
  });
  if (!stores[0]) {
    throw new AppError("integrationStoreRequired", "BAD_REQUEST", 400);
  }
  return { storeId: stores[0].id, storeName: stores[0].name };
};

const ensureStoreOwnership = async (organizationId: string, storeIds: string[]) => {
  const uniqueIds = Array.from(new Set(storeIds.map((value) => value.trim()).filter(Boolean)));
  if (!uniqueIds.length) {
    return;
  }
  const stores = await prisma.store.findMany({
    where: { organizationId, id: { in: uniqueIds } },
    select: { id: true },
  });
  if (stores.length !== uniqueIds.length) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }
};

const ensureProductOwnership = async (
  organizationId: string,
  productIds: string[],
  storeId: string,
) => {
  const uniqueIds = Array.from(new Set(productIds.map((value) => value.trim()).filter(Boolean)));
  if (!uniqueIds.length) {
    return [];
  }
  const products = await prisma.product.findMany({
    where: {
      id: { in: uniqueIds },
      organizationId,
      isDeleted: false,
      ...buildStoreProductWhere(storeId),
    },
    select: { id: true },
  });
  if (products.length !== uniqueIds.length) {
    throw new AppError("productNotFound", "NOT_FOUND", 404);
  }
  return products.map((product) => product.id);
};

const upsertIntegrationStatus = async (
  tx: OMarketDbClient,
  organizationId: string,
  status: OMarketIntegrationStatus,
) => {
  return tx.oMarketIntegration.upsert({
    where: { orgId: organizationId },
    update: { status, lastErrorSummary: null },
    create: { orgId: organizationId, status },
    select: { id: true, status: true },
  });
};

export const mapBazaarProductToOMarketProduct = (input: {
  jobType: OMarketJobType;
  selection: {
    productId: string;
    discountType: string | null;
    discountValue: Prisma.Decimal | number | string | null;
    product: {
      id: string;
      sku: string;
      name: string;
      category: string | null;
      description: string | null;
      basePriceKgs: Prisma.Decimal | number | string | null;
      storePrices: Array<{ priceKgs: Prisma.Decimal | number | string | null }>;
      photoUrl: string | null;
      images: Array<{ url: string; position?: number }>;
    };
  };
  locationId: number | null;
  categoryMapping?: {
    oMarketCategoryId: number;
    attributesJson: unknown;
  } | null;
  snapshotOnHand: number | null;
  hasLocalSpecs: boolean;
}) => {
  const issues: OMarketPreflightIssueCode[] = [];
  const normalizedSku = normalizeSku(input.selection.product.sku ?? "");
  if (!normalizedSku) {
    addIssue(issues, "MISSING_SKU");
  }
  if (normalizedSku.length > O_MARKET_SKU_MAX_LENGTH) {
    addIssue(issues, "INVALID_SKU");
  }

  const rawPrice = input.selection.product.storePrices[0]?.priceKgs ?? input.selection.product.basePriceKgs;
  const price = rawPrice === null || rawPrice === undefined ? null : Number(rawPrice);
  if (price === null) {
    addIssue(issues, "MISSING_PRICE");
  } else if (!Number.isFinite(price) || price <= 0) {
    addIssue(issues, "INVALID_PRICE");
  }

  const quantity = input.snapshotOnHand;
  if (quantity === null || quantity === undefined) {
    addIssue(issues, "MISSING_STOCK");
  } else if (!Number.isFinite(quantity) || quantity < 0) {
    addIssue(issues, "INVALID_STOCK");
  }

  const discountType = input.selection.discountType?.trim() || null;
  const discountValue =
    input.selection.discountValue === null || input.selection.discountValue === undefined
      ? null
      : Number(input.selection.discountValue);
  if (
    (discountType && !["PERCENTAGE", "PRICE"].includes(discountType)) ||
    (discountValue !== null && (!Number.isFinite(discountValue) || discountValue < 0))
  ) {
    addIssue(issues, "INVALID_DISCOUNT");
  }

  const stockPricePayload: OMarketApiProduct = {
    sku: normalizedSku,
    price: price ?? 0,
    quantity: quantity ?? 0,
    ...(discountType && discountValue !== null
      ? {
          discount_type: discountType as "PERCENTAGE" | "PRICE",
          discount_value: discountValue,
        }
      : {}),
  };

  if (input.jobType === OMarketJobType.STOCK_PRICE_SYNC) {
    return {
      payload: issues.length ? null : stockPricePayload,
      issues,
    };
  }

  const title = input.selection.product.name.trim();
  if (!title) {
    addIssue(issues, "MISSING_TITLE");
  }
  const description = input.selection.product.description?.trim() ?? "";
  if (!description) {
    addIssue(issues, "MISSING_DESCRIPTION");
  }

  const category = input.selection.product.category?.trim() ?? "";
  if (!category) {
    addIssue(issues, "MISSING_CATEGORY");
  }
  if (!input.categoryMapping) {
    addIssue(issues, "MISSING_CATEGORY_MAPPING");
  }

  const imageValidation = validateOMarketImages(collectImageUrls(input.selection.product));
  for (const issue of imageValidation.issues) {
    addIssue(issues, issue);
  }

  const attributes = normalizeCategoryAttributes(input.categoryMapping?.attributesJson).attributes;
  if (input.hasLocalSpecs && attributes.length === 0) {
    addIssue(issues, "MISSING_SPECS");
  }

  const payload: OMarketApiProduct = {
    ...stockPricePayload,
    title,
    description,
    category_id: input.categoryMapping?.oMarketCategoryId ?? 0,
    images: imageValidation.normalized.map((image, index) => ({
      type: "url",
      image,
      ...(index === 0 ? { is_primary_image: true } : {}),
    })),
    currency: "som",
    location_id: input.locationId,
    is_delivery_enabled: true,
    ...(attributes.length ? { attributes } : {}),
  };

  return {
    payload: issues.length ? null : payload,
    issues,
  };
};

const buildOMarketProductListWhere = async (input: {
  organizationId: string;
  storeId: string;
  search?: string;
  selection?: OMarketProductSelectionFilter;
}) => {
  const search = normalizeSearch(input.search);
  const baseWhere: Prisma.ProductWhereInput = {
    organizationId: input.organizationId,
    isDeleted: false,
    ...buildStoreProductWhere(input.storeId),
  };
  const where: Prisma.ProductWhereInput = {
    ...baseWhere,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { sku: { contains: search, mode: "insensitive" } },
            { category: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  if (input.selection === "included") {
    where.oMarketInclusions = {
      some: { orgId: input.organizationId, storeId: input.storeId },
    };
  }
  if (input.selection === "excluded") {
    where.oMarketInclusions = {
      none: { orgId: input.organizationId, storeId: input.storeId },
    };
  }
  return { baseWhere, where };
};

const buildOMarketExportPlan = async (input: {
  organizationId: string;
  storeId?: string | null;
  jobType?: OMarketJobType;
  mode?: OMarketExportMode;
}): Promise<OMarketExportPlan> => {
  const jobType = input.jobType ?? OMarketJobType.PRODUCT_EXPORT;
  const mode = normalizeOMarketExportMode(input.mode);
  const storeContext = await resolveIntegrationStoreContext({
    organizationId: input.organizationId,
    storeId: input.storeId,
  });

  const [integration, storeMapping, selectedProducts] = await Promise.all([
    prisma.oMarketIntegration.findUnique({
      where: { orgId: input.organizationId },
      select: { apiTokenEncrypted: true, baseUrl: true },
    }),
    prisma.oMarketStoreMapping.findUnique({
      where: {
        orgId_storeId: {
          orgId: input.organizationId,
          storeId: storeContext.storeId,
        },
      },
      select: { oMarketLocationId: true },
    }),
    prisma.oMarketIncludedProduct.findMany({
      where: {
        orgId: input.organizationId,
        storeId: storeContext.storeId,
        product: {
          organizationId: input.organizationId,
          isDeleted: false,
          ...buildStoreProductWhere(storeContext.storeId),
        },
      },
      select: {
        productId: true,
        discountType: true,
        discountValue: true,
        lastExportedAt: true,
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            category: true,
            description: true,
            basePriceKgs: true,
            storePrices: {
              where: {
                organizationId: input.organizationId,
                storeId: storeContext.storeId,
                variantKey: "BASE",
              },
              select: { priceKgs: true },
              take: 1,
            },
            photoUrl: true,
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
  ]);

  const selectedProductIds = selectedProducts.map((row) => row.productId);
  const productCategories = Array.from(
    new Set(
      selectedProducts
        .map((row) => row.product.category?.trim() ?? "")
        .filter((value) => value.length > 0),
    ),
  );

  const [snapshots, categoryMappings, categoryTemplates, variantValues] = await Promise.all([
    selectedProductIds.length
      ? prisma.inventorySnapshot.findMany({
          where: {
            productId: { in: selectedProductIds },
            storeId: storeContext.storeId,
            variantKey: "BASE",
          },
          select: { productId: true, onHand: true },
        })
      : Promise.resolve([]),
    productCategories.length
      ? prisma.oMarketCategoryMapping.findMany({
          where: {
            orgId: input.organizationId,
            bazaarCategory: { in: productCategories },
          },
          select: {
            bazaarCategory: true,
            oMarketCategoryId: true,
            attributesJson: true,
          },
        })
      : Promise.resolve([]),
    productCategories.length
      ? prisma.categoryAttributeTemplate.findMany({
          where: {
            organizationId: input.organizationId,
            category: { in: productCategories },
          },
          select: {
            category: true,
            attributeKey: true,
          },
        })
      : Promise.resolve([]),
    selectedProductIds.length
      ? prisma.variantAttributeValue.findMany({
          where: {
            organizationId: input.organizationId,
            productId: { in: selectedProductIds },
          },
          select: { productId: true, key: true, value: true },
        })
      : Promise.resolve([]),
  ]);

  const categoryMappingByName = new Map(
    categoryMappings.map((mapping) => [mapping.bazaarCategory, mapping]),
  );
  const templateKeysByCategory = new Map<string, Set<string>>();
  for (const template of categoryTemplates) {
    const keys = templateKeysByCategory.get(template.category) ?? new Set<string>();
    keys.add(template.attributeKey);
    templateKeysByCategory.set(template.category, keys);
  }
  const valuesByProduct = buildVariantValuesByProduct(variantValues);
  const stockByProductId = new Map<string, number>();
  for (const snapshot of snapshots) {
    stockByProductId.set(snapshot.productId, snapshot.onHand);
  }

  const locationId = parseLocationId(storeMapping?.oMarketLocationId);
  const globalIssues: OMarketPreflightIssueCode[] = [];
  if (!integration?.apiTokenEncrypted) {
    addIssue(globalIssues, "MISSING_API_TOKEN");
  }
  if (!storeMapping?.oMarketLocationId) {
    addIssue(globalIssues, "MISSING_STORE_MAPPING");
  } else if (Number.isNaN(locationId)) {
    addIssue(globalIssues, "INVALID_LOCATION_ID");
  }

  const failedProducts: OMarketPreflightResult["failedProducts"] = [];
  const readyProductIds: string[] = [];
  const validationResults: OMarketPreflightResult["validationResults"] = [];
  const payloadProducts: OMarketApiProduct[] = [];
  const payloadByProductId = new Map<string, OMarketApiProduct>();
  const productMetaBySku = new Map<string, { productId: string; sku: string; name: string }>();
  const seenSkus = new Set<string>();

  for (const selection of selectedProducts) {
    const issues: OMarketPreflightIssueCode[] = [];
    const normalizedSku = normalizeSku(selection.product.sku ?? "");
    if (normalizedSku && seenSkus.has(normalizedSku)) {
      addIssue(issues, "DUPLICATE_SKU");
    }
    if (normalizedSku) {
      seenSkus.add(normalizedSku);
    }
    for (const issue of globalIssues.filter((issue) => issue !== "MISSING_API_TOKEN")) {
      addIssue(issues, issue);
    }

    const category = selection.product.category?.trim() ?? "";
    const localTemplateKeys = category ? templateKeysByCategory.get(category) : null;
    const productValues = valuesByProduct.get(selection.productId);
    const hasLocalSpecs = Boolean(
      localTemplateKeys &&
        productValues &&
        Array.from(localTemplateKeys).some((key) => (productValues.get(key)?.length ?? 0) > 0),
    );
    const mapped = mapBazaarProductToOMarketProduct({
      jobType,
      selection,
      locationId: Number.isNaN(locationId) ? null : locationId,
      categoryMapping: category ? categoryMappingByName.get(category) : null,
      snapshotOnHand: stockByProductId.get(selection.productId) ?? null,
      hasLocalSpecs,
    });
    for (const issue of mapped.issues) {
      addIssue(issues, issue);
    }

    if (issues.length || !mapped.payload) {
      failedProducts.push({
        productId: selection.productId,
        sku: selection.product.sku ?? "",
        name: selection.product.name ?? "",
        issues,
      });
      validationResults.push({
        productId: selection.productId,
        status: "invalid",
        errors: issues,
        warnings: [],
        canExport: false,
      });
      continue;
    }

    readyProductIds.push(selection.productId);
    validationResults.push({
      productId: selection.productId,
      status: "valid",
      errors: [],
      warnings: [],
      canExport: true,
    });
    payloadProducts.push(mapped.payload);
    payloadByProductId.set(selection.productId, mapped.payload);
    productMetaBySku.set(normalizeSku(mapped.payload.sku), {
      productId: selection.productId,
      sku: mapped.payload.sku,
      name: selection.product.name,
    });
  }

  const warnings: OMarketPreflightWarningCode[] =
    jobType === OMarketJobType.FULL_SYNC ? ["FULL_SYNC_DEACTIVATES_MISSING_PRODUCTS"] : [];

  const blockerCounts = countByCode(failedProducts.map((row) => ({ codes: row.issues })));
  for (const issue of globalIssues) {
    blockerCounts[issue] = (blockerCounts[issue] ?? 0) + 1;
  }
  if (selectedProducts.length === 0) {
    blockerCounts.NO_PRODUCTS_SELECTED = 1;
  }
  if (payloadProducts.length > O_MARKET_MAX_PRODUCTS_PER_REQUEST) {
    blockerCounts.TOO_MANY_PRODUCTS_IN_SINGLE_BATCH = 1;
  }

  const canRunReadyOnly =
    readyProductIds.length > 0 &&
    Boolean(integration?.apiTokenEncrypted) &&
    Boolean(storeMapping?.oMarketLocationId) &&
    !Number.isNaN(locationId) &&
    payloadProducts.length <= O_MARKET_MAX_PRODUCTS_PER_REQUEST;
  const canRunAll =
    canRunReadyOnly &&
    selectedProducts.length > 0 &&
    failedProducts.length === 0 &&
    globalIssues.length === 0;

  const preflight: OMarketPreflightResult = {
    generatedAt: new Date(),
    jobType,
    canExport: canRunAll,
    store: {
      storeId: storeContext.storeId,
      storeName: storeContext.storeName,
      locationId: storeMapping?.oMarketLocationId ?? null,
    },
    summary: {
      productsConsidered: selectedProducts.length,
      productsReady: readyProductIds.length,
      productsFailed: failedProducts.length,
      warnings: warnings.length,
    },
    blockers: {
      total:
        failedProducts.length +
        globalIssues.length +
        (selectedProducts.length === 0 ? 1 : 0) +
        (payloadProducts.length > O_MARKET_MAX_PRODUCTS_PER_REQUEST ? 1 : 0),
      byCode: blockerCounts,
    },
    warnings: {
      total: warnings.length,
      byCode: warnings.reduce<Partial<Record<OMarketPreflightWarningCode, number>>>(
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
    validationResults,
    actionability: {
      canRunAll,
      canRunReadyOnly,
    },
  };

  const payload = { products: payloadProducts } satisfies OMarketApiPayload;
  const payloadStats = {
    jobType,
    exportMode: mode,
    storeId: storeContext.storeId,
    storeName: storeContext.storeName,
    locationId: storeMapping?.oMarketLocationId ?? null,
    productCount: payload.products.length,
    selectedProducts: selectedProducts.length,
    readyProducts: readyProductIds.length,
    failedProducts: failedProducts.length,
    fullSyncRisk: warnings.includes("FULL_SYNC_DEACTIVATES_MISSING_PRODUCTS"),
    baseUrl: normalizeOMarketBaseUrl(integration?.baseUrl),
    mockMode: process.env.O_MARKET_MOCK_API === "1",
  };

  return {
    mode,
    jobType,
    preflight,
    payload,
    payloadByProductId,
    productMetaBySku,
    readyProductIds,
    selectedProductIds,
    payloadStats,
    errorReport: {
      generatedAt: preflight.generatedAt.toISOString(),
      mode,
      jobType,
      summary: preflight.summary,
      blockers: preflight.blockers,
      warnings: preflight.warnings,
      failedProducts: preflight.failedProducts,
      payloadStats,
    },
  };
};

export const runOMarketPreflight = async (
  organizationId: string,
  storeId?: string | null,
  jobType?: OMarketJobType,
) => {
  const plan = await buildOMarketExportPlan({ organizationId, storeId, jobType });
  return plan.preflight;
};

export const getOMarketOverview = async (organizationId: string) => {
  const [integration, mappingCount] = await Promise.all([
    prisma.oMarketIntegration.findUnique({
      where: { orgId: organizationId },
      select: {
        status: true,
        apiTokenEncrypted: true,
        baseUrl: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastConnectionCheckAt: true,
        lastConnectionCheckSummary: true,
        lastErrorSummary: true,
      },
    }),
    prisma.oMarketStoreMapping.count({
      where: { orgId: organizationId, oMarketLocationId: { not: "" } },
    }),
  ]);
  const status = resolveOverviewStatus(
    integration
      ? {
          status: integration.status,
          apiTokenEncrypted: integration.apiTokenEncrypted,
          hasStoreMapping: mappingCount > 0,
        }
      : null,
  );
  return {
    configured: Boolean(integration?.apiTokenEncrypted) && mappingCount > 0,
    status,
    baseUrl: integration?.baseUrl ?? O_MARKET_DEFAULT_BASE_URL,
    hasToken: Boolean(integration?.apiTokenEncrypted),
    mappedStores: mappingCount,
    lastSyncAt: integration?.lastSyncAt ?? null,
    lastSyncStatus: integration?.lastSyncStatus ?? null,
    lastConnectionCheckAt: integration?.lastConnectionCheckAt ?? null,
    lastConnectionCheckSummary: integration?.lastConnectionCheckSummary ?? null,
    lastErrorSummary: integration?.lastErrorSummary ?? null,
  };
};

export const getOMarketSettings = async (organizationId: string) => {
  const [integration, stores, storeMappings, categoryMappings, categories] = await Promise.all([
    prisma.oMarketIntegration.findUnique({
      where: { orgId: organizationId },
      select: {
        id: true,
        status: true,
        baseUrl: true,
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
    prisma.oMarketStoreMapping.findMany({
      where: { orgId: organizationId },
      select: { storeId: true, oMarketLocationId: true },
    }),
    prisma.oMarketCategoryMapping.findMany({
      where: { orgId: organizationId },
      select: {
        bazaarCategory: true,
        oMarketCategoryId: true,
        oMarketCategoryName: true,
        attributesJson: true,
      },
      orderBy: { bazaarCategory: "asc" },
    }),
    prisma.product.findMany({
      where: {
        organizationId,
        isDeleted: false,
        category: { not: null },
      },
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    }),
  ]);
  const mappedStoreCount = storeMappings.filter((mapping) => mapping.oMarketLocationId.trim()).length;
  const status = resolveOverviewStatus(
    integration
      ? {
          status: integration.status,
          apiTokenEncrypted: integration.apiTokenEncrypted,
          hasStoreMapping: mappedStoreCount > 0,
        }
      : null,
  );
  const mappingByStoreId = new Map(
    storeMappings.map((mapping) => [mapping.storeId, mapping.oMarketLocationId]),
  );
  const categoryMappingByName = new Map(
    categoryMappings.map((mapping) => [mapping.bazaarCategory, mapping]),
  );
  return {
    integration: {
      id: integration?.id ?? null,
      status,
      rawStatus: integration?.status ?? OMarketIntegrationStatus.DISABLED,
      baseUrl: integration?.baseUrl ?? O_MARKET_DEFAULT_BASE_URL,
      hasToken: Boolean(integration?.apiTokenEncrypted),
      configured: Boolean(integration?.apiTokenEncrypted) && mappedStoreCount > 0,
      lastSyncAt: integration?.lastSyncAt ?? null,
      lastSyncStatus: integration?.lastSyncStatus ?? null,
      lastConnectionCheckAt: integration?.lastConnectionCheckAt ?? null,
      lastConnectionCheckSummary: integration?.lastConnectionCheckSummary ?? null,
      lastErrorSummary: integration?.lastErrorSummary ?? null,
      mockMode: process.env.O_MARKET_MOCK_API === "1",
    },
    stores: stores.map((store) => ({
      storeId: store.id,
      storeName: store.name,
      locationId: mappingByStoreId.get(store.id) ?? "",
    })),
    categoryMappings: categories
      .map((row) => row.category?.trim() ?? "")
      .filter(Boolean)
      .map((category) => {
        const mapping = categoryMappingByName.get(category);
        return {
          bazaarCategory: category,
          oMarketCategoryId: mapping?.oMarketCategoryId?.toString() ?? "",
          oMarketCategoryName: mapping?.oMarketCategoryName ?? "",
          attributesJson: mapping?.attributesJson
            ? JSON.stringify(mapping.attributesJson, null, 2)
            : "",
        };
      }),
  };
};

export const getOMarketSavedToken = async (organizationId: string) => {
  const integration = await prisma.oMarketIntegration.findUnique({
    where: { orgId: organizationId },
    select: { apiTokenEncrypted: true },
  });
  if (!integration?.apiTokenEncrypted) {
    return { apiToken: "" };
  }
  return { apiToken: decryptToken(integration.apiTokenEncrypted) };
};

export const updateOMarketSettings = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  baseUrl?: string | null;
  apiToken?: string | null;
  clearToken?: boolean;
}) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.oMarketIntegration.findUnique({
      where: { orgId: input.organizationId },
      select: {
        id: true,
        orgId: true,
        status: true,
        baseUrl: true,
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
    const mappedStoreCount = await tx.oMarketStoreMapping.count({
      where: { orgId: input.organizationId, oMarketLocationId: { not: "" } },
    });
    const nextStatus = resolveStoredIntegrationStatus({
      hasToken: Boolean(nextTokenEncrypted),
      hasStoreMapping: mappedStoreCount > 0,
    });
    const saved = await tx.oMarketIntegration.upsert({
      where: { orgId: input.organizationId },
      update: {
        baseUrl: normalizeOMarketBaseUrl(input.baseUrl ?? existing?.baseUrl),
        apiTokenEncrypted: nextTokenEncrypted,
        status: nextStatus,
        lastErrorSummary: null,
      },
      create: {
        orgId: input.organizationId,
        baseUrl: normalizeOMarketBaseUrl(input.baseUrl),
        apiTokenEncrypted: nextTokenEncrypted,
        status: nextStatus,
      },
      select: {
        id: true,
        orgId: true,
        status: true,
        baseUrl: true,
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
      action: "O_MARKET_CONFIG_UPDATED",
      entity: "OMarketIntegration",
      entityId: saved.id,
      before: existing ? toJson({ ...existing, apiTokenEncrypted: Boolean(existing.apiTokenEncrypted) }) : null,
      after: toJson({ ...saved, apiTokenEncrypted: Boolean(saved.apiTokenEncrypted) }),
      requestId: input.requestId,
    });
    return {
      status: resolveOverviewStatus({
        status: saved.status,
        apiTokenEncrypted: saved.apiTokenEncrypted,
        hasStoreMapping: mappedStoreCount > 0,
      }),
      baseUrl: saved.baseUrl,
      hasToken: Boolean(saved.apiTokenEncrypted),
    };
  });
};

export const updateOMarketStoreMappings = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  mappings: Array<{ storeId: string; locationId: string }>;
}) => {
  const normalizedMappings = input.mappings.map((mapping) => ({
    storeId: mapping.storeId.trim(),
    locationId: mapping.locationId.trim(),
  }));
  const storeIds = normalizedMappings.map((mapping) => mapping.storeId).filter(Boolean);
  await ensureStoreOwnership(input.organizationId, storeIds);
  if (new Set(storeIds).size !== storeIds.length) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  const locationIds = normalizedMappings.map((mapping) => mapping.locationId).filter(Boolean);
  if (locationIds.some((value) => Number.isNaN(parseLocationId(value)))) {
    throw new AppError("oMarketInvalidLocationId", "BAD_REQUEST", 400);
  }
  return prisma.$transaction(async (tx) => {
    const existingMappings = await tx.oMarketStoreMapping.findMany({
      where: { orgId: input.organizationId },
      select: { storeId: true, oMarketLocationId: true },
    });
    const integrationBefore = await tx.oMarketIntegration.findUnique({
      where: { orgId: input.organizationId },
      select: { id: true, status: true, baseUrl: true, apiTokenEncrypted: true },
    });
    await tx.oMarketStoreMapping.deleteMany({ where: { orgId: input.organizationId } });
    if (normalizedMappings.some((mapping) => mapping.locationId)) {
      await tx.oMarketStoreMapping.createMany({
        data: normalizedMappings
          .filter((mapping) => mapping.locationId)
          .map((mapping) => ({
            orgId: input.organizationId,
            storeId: mapping.storeId,
            oMarketLocationId: mapping.locationId,
          })),
      });
    }
    const nextStatus = resolveStoredIntegrationStatus({
      hasToken: Boolean(integrationBefore?.apiTokenEncrypted),
      hasStoreMapping: normalizedMappings.some((mapping) => mapping.locationId),
    });
    const integrationAfter = await upsertIntegrationStatus(tx, input.organizationId, nextStatus);
    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "O_MARKET_STORE_MAPPINGS_UPDATED",
      entity: "OMarketIntegration",
      entityId: integrationAfter.id,
      before: toJson({ integration: integrationBefore, mappings: existingMappings }),
      after: toJson({ integration: integrationAfter, mappings: normalizedMappings }),
      requestId: input.requestId,
    });
    return {
      mappedCount: normalizedMappings.filter((mapping) => mapping.locationId).length,
      status: resolveOverviewStatus({
        status: integrationAfter.status,
        apiTokenEncrypted: integrationBefore?.apiTokenEncrypted ?? null,
        hasStoreMapping: normalizedMappings.some((mapping) => mapping.locationId),
      }),
    };
  });
};

export const updateOMarketCategoryMappings = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  mappings: Array<{
    bazaarCategory: string;
    oMarketCategoryId: string;
    oMarketCategoryName?: string | null;
    attributesJson?: string | null;
  }>;
}) => {
  const normalizedMappings = input.mappings
    .map((mapping) => ({
      bazaarCategory: mapping.bazaarCategory.trim(),
      oMarketCategoryId: mapping.oMarketCategoryId.trim(),
      oMarketCategoryName: mapping.oMarketCategoryName?.trim() ?? "",
      attributesJson: parseCategoryAttributesInput(mapping.attributesJson),
    }))
    .filter((mapping) => mapping.bazaarCategory);
  if (
    new Set(normalizedMappings.map((mapping) => mapping.bazaarCategory)).size !==
    normalizedMappings.length
  ) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  const nonEmpty = normalizedMappings.filter((mapping) => mapping.oMarketCategoryId);
  if (!nonEmpty.every((mapping) => /^\d+$/.test(mapping.oMarketCategoryId))) {
    throw new AppError("oMarketInvalidCategoryId", "BAD_REQUEST", 400);
  }
  return prisma.$transaction(async (tx) => {
    const existingMappings = await tx.oMarketCategoryMapping.findMany({
      where: { orgId: input.organizationId },
      select: {
        bazaarCategory: true,
        oMarketCategoryId: true,
        oMarketCategoryName: true,
        attributesJson: true,
      },
    });
    await tx.oMarketCategoryMapping.deleteMany({ where: { orgId: input.organizationId } });
    if (nonEmpty.length) {
      await tx.oMarketCategoryMapping.createMany({
        data: nonEmpty.map((mapping) => ({
          orgId: input.organizationId,
          bazaarCategory: mapping.bazaarCategory,
          oMarketCategoryId: Number(mapping.oMarketCategoryId),
          oMarketCategoryName: mapping.oMarketCategoryName || null,
          attributesJson: mapping.attributesJson ? toJson(mapping.attributesJson) : Prisma.JsonNull,
        })),
      });
    }
    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "O_MARKET_CATEGORY_MAPPINGS_UPDATED",
      entity: "OMarketIntegration",
      entityId: input.organizationId,
      before: toJson(existingMappings),
      after: toJson(nonEmpty),
      requestId: input.requestId,
    });
    return { mappedCount: nonEmpty.length };
  });
};

export const listOMarketProducts = async (input: {
  organizationId: string;
  storeId?: string | null;
  search?: string;
  selection?: OMarketProductSelectionFilter;
  page?: number;
  pageSize?: number;
}) => {
  const storeContext = await resolveIntegrationStoreContext({
    organizationId: input.organizationId,
    storeId: input.storeId,
  });
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(10, Math.max(1, Math.trunc(input.pageSize ?? 10)));
  const { baseWhere, where } = await buildOMarketProductListWhere({
    ...input,
    storeId: storeContext.storeId,
  });
  const [totalProducts, includedProducts, total, products] = await Promise.all([
    prisma.product.count({ where: baseWhere }),
    prisma.product.count({
      where: {
        ...baseWhere,
        oMarketInclusions: {
          some: { orgId: input.organizationId, storeId: storeContext.storeId },
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
        storePrices: {
          where: {
            organizationId: input.organizationId,
            storeId: storeContext.storeId,
            variantKey: "BASE",
          },
          select: { priceKgs: true },
          take: 1,
        },
        photoUrl: true,
        images: {
          where: {
            AND: [{ url: { not: "" } }, { NOT: { url: { startsWith: "data:image/" } } }],
          },
          select: { url: true },
          orderBy: { position: "asc" },
          take: 1,
        },
        oMarketInclusions: {
          where: { orgId: input.organizationId, storeId: storeContext.storeId },
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
          storeId: storeContext.storeId,
        },
        select: { productId: true, onHand: true },
      })
    : [];
  const onHandByProductId = new Map(snapshots.map((snapshot) => [snapshot.productId, snapshot.onHand]));
  return {
    items: products.map((product) => {
      const included = product.oMarketInclusions.length > 0;
      const lastExportedAt = product.oMarketInclusions[0]?.lastExportedAt ?? null;
      const priceKgs = product.storePrices[0]?.priceKgs ?? product.basePriceKgs;
      return {
        id: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category?.trim() || null,
        priceKgs: priceKgs === null ? null : Number(priceKgs),
        imageUrl: resolveOMarketListImageUrl(product),
        onHandQty: onHandByProductId.get(product.id) ?? 0,
        included,
        lastExportedAt,
        exportStatus: resolveOMarketProductExportStatus({ included, lastExportedAt }),
      };
    }),
    total,
    page,
    pageSize,
    summary: {
      storeId: storeContext.storeId,
      storeName: storeContext.storeName,
      totalProducts,
      includedProducts,
      excludedProducts: Math.max(0, totalProducts - includedProducts),
    },
  };
};

export const listOMarketProductIds = async (input: {
  organizationId: string;
  storeId?: string | null;
  search?: string;
  selection?: OMarketProductSelectionFilter;
}) => {
  const storeContext = await resolveIntegrationStoreContext({
    organizationId: input.organizationId,
    storeId: input.storeId,
  });
  const { where } = await buildOMarketProductListWhere({
    ...input,
    storeId: storeContext.storeId,
  });
  const products = await prisma.product.findMany({
    where,
    select: { id: true },
    orderBy: [{ name: "asc" }, { sku: "asc" }, { id: "asc" }],
  });
  return products.map((product) => product.id);
};

export const updateOMarketProductSelection = async (input: {
  organizationId: string;
  storeId?: string | null;
  actorId: string;
  requestId: string;
  productIds: string[];
  included: boolean;
}) => {
  const storeContext = await resolveIntegrationStoreContext({
    organizationId: input.organizationId,
    storeId: input.storeId,
  });
  const productIds = await ensureProductOwnership(
    input.organizationId,
    input.productIds,
    storeContext.storeId,
  );
  if (!productIds.length) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  await prisma.$transaction(async (tx) => {
    if (input.included) {
      await tx.oMarketIncludedProduct.createMany({
        data: productIds.map((productId) => ({
          orgId: input.organizationId,
          storeId: storeContext.storeId,
          productId,
        })),
        skipDuplicates: true,
      });
    } else {
      await tx.oMarketIncludedProduct.deleteMany({
        where: {
          orgId: input.organizationId,
          storeId: storeContext.storeId,
          productId: { in: productIds },
        },
      });
    }
    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: O_MARKET_PRODUCT_SELECTION_AUDIT_ACTION,
      entity: "OMarketIntegration",
      entityId: input.organizationId,
      before: null,
      after: toJson({
        included: input.included,
        storeId: storeContext.storeId,
        storeName: storeContext.storeName,
        productIds,
      }),
      requestId: input.requestId,
    });
  });
  return { updatedCount: productIds.length };
};

export const testOMarketConnection = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
}) => {
  const integration = await prisma.oMarketIntegration.findUnique({
    where: { orgId: input.organizationId },
    select: { id: true, apiTokenEncrypted: true, baseUrl: true },
  });
  if (!integration?.apiTokenEncrypted) {
    throw new AppError("oMarketApiTokenMissing", "CONFLICT", 409);
  }
  const token = decryptToken(integration.apiTokenEncrypted);
  const checkedAt = new Date();
  try {
    const response =
      process.env.O_MARKET_MOCK_API === "1"
        ? { ok: true, status: 200, body: { products: [], page: 1, count: 0 } }
        : await listOMarketRemoteProducts({
            token,
            baseUrl: integration.baseUrl,
            page: 1,
            limit: 1,
            signal: AbortSignal.timeout(O_MARKET_REQUEST_TIMEOUT_MS),
          });
    if (!response.ok) {
      const normalized = normalizeOMarketApiError({
        status: response.status,
        body: response.body,
        token,
      });
      throw new AppError(normalized.code, "INTERNAL_SERVER_ERROR", 502);
    }
    const mappedStoreCount = await prisma.oMarketStoreMapping.count({
      where: { orgId: input.organizationId, oMarketLocationId: { not: "" } },
    });
    const nextStatus = resolveStoredIntegrationStatus({
      hasToken: true,
      hasStoreMapping: mappedStoreCount > 0,
    });
    const summary = `HTTP ${response.status} ${normalizeOMarketBaseUrl(integration.baseUrl)}/api/mia/v1/product/list`;
    await prisma.oMarketIntegration.update({
      where: { orgId: input.organizationId },
      data: {
        status: nextStatus,
        lastConnectionCheckAt: checkedAt,
        lastConnectionCheckSummary: summary,
        lastErrorSummary: null,
      },
    });
    await writeAuditLog(prisma, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "O_MARKET_CONNECTION_TESTED",
      entity: "OMarketIntegration",
      entityId: integration.id,
      before: null,
      after: toJson({ status: response.status, baseUrl: integration.baseUrl }),
      requestId: input.requestId,
    });
    return { ok: true, checkedAt, status: response.status, summary };
  } catch (error) {
    const summary = redactSensitiveText(toErrorMessage(error), token);
    await prisma.oMarketIntegration.update({
      where: { orgId: input.organizationId },
      data: {
        status: OMarketIntegrationStatus.ERROR,
        lastConnectionCheckAt: checkedAt,
        lastConnectionCheckSummary: summary,
        lastErrorSummary: "CONNECTION_TEST_FAILED",
      },
    });
    throw new AppError("oMarketConnectionTestFailed", "INTERNAL_SERVER_ERROR", 502);
  }
};

export const listOMarketJobs = async (organizationId: string, limit = 50) => {
  const take = Math.max(1, Math.min(200, Math.trunc(limit)));
  return prisma.oMarketExportJob.findMany({
    where: { orgId: organizationId },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      requestedBy: { select: { id: true, name: true } },
    },
  });
};

export const getOMarketJob = async (organizationId: string, jobId: string) => {
  return prisma.oMarketExportJob.findFirst({
    where: { id: jobId, orgId: organizationId },
    include: {
      requestedBy: { select: { id: true, name: true } },
    },
  });
};

export const requestOMarketExport = async (input: {
  organizationId: string;
  storeId?: string | null;
  actorId: string;
  requestId: string;
  jobType?: OMarketJobType;
  mode?: OMarketExportMode;
}) => {
  await timeoutAbandonedOMarketExportJobs(input.organizationId);

  const integration = await prisma.oMarketIntegration.findUnique({
    where: { orgId: input.organizationId },
    select: { id: true, apiTokenEncrypted: true },
  });
  if (!integration?.apiTokenEncrypted) {
    throw new AppError("oMarketApiTokenMissing", "CONFLICT", 409);
  }
  const activeJob = await prisma.oMarketExportJob.findFirst({
    where: {
      orgId: input.organizationId,
      status: { in: [OMarketExportJobStatus.QUEUED, OMarketExportJobStatus.RUNNING] },
    },
    select: { id: true },
  });
  if (activeJob) {
    throw new AppError("requestInProgress", "CONFLICT", 409);
  }
  const plan = await buildOMarketExportPlan({
    organizationId: input.organizationId,
    storeId: input.storeId,
    jobType: input.jobType,
    mode: input.mode,
  });
  if (plan.mode === "READY_ONLY") {
    if (!plan.preflight.actionability.canRunReadyOnly) {
      throw new AppError("oMarketReadyOnlyUnsafe", "CONFLICT", 409);
    }
  } else if (!plan.preflight.actionability.canRunAll) {
    throw new AppError("oMarketPreflightFailed", "CONFLICT", 409);
  }
  const requestIdempotencyKey = randomUUID();
  const storeId = String(plan.payloadStats.storeId);
  const queuedJob = await prisma.oMarketExportJob.create({
    data: {
      orgId: input.organizationId,
      storeId,
      jobType: plan.jobType,
      status: OMarketExportJobStatus.QUEUED,
      requestedById: input.actorId,
      requestIdempotencyKey,
      payloadStatsJson: toJson(plan.payloadStats),
      attemptedCount: plan.payload.products.length,
      succeededCount: 0,
      failedCount: 0,
      skippedCount: plan.mode === "READY_ONLY" ? plan.preflight.failedProducts.length : 0,
    },
  });
  await writeAuditLog(prisma, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: "O_MARKET_EXPORT_STARTED",
    entity: "OMarketExportJob",
    entityId: queuedJob.id,
    before: null,
    after: toJson({
      id: queuedJob.id,
      status: queuedJob.status,
      jobType: queuedJob.jobType,
      payloadStats: plan.payloadStats,
    }),
    requestId: input.requestId,
  });
  if (process.env.NODE_ENV !== "test") {
    void runJob(O_MARKET_EXPORT_JOB_NAME, {
      jobId: queuedJob.id,
      organizationId: input.organizationId,
      requestId: input.requestId,
      storeId,
      mode: plan.mode,
      jobType: plan.jobType,
    }).catch(() => null);
  }
  return { job: queuedJob };
};

const timeoutAbandonedOMarketExportJobs = async (organizationId?: string) => {
  const timeoutBefore = new Date(Date.now() - O_MARKET_EXPORT_JOB_TIMEOUT_MS);
  const jobs = await prisma.oMarketExportJob.findMany({
    where: {
      ...(organizationId ? { orgId: organizationId } : {}),
      status: OMarketExportJobStatus.RUNNING,
      startedAt: { lt: timeoutBefore },
      finishedAt: null,
    },
    select: {
      id: true,
      orgId: true,
      storeId: true,
      jobType: true,
      requestIdempotencyKey: true,
      startedAt: true,
      attemptedCount: true,
      succeededCount: true,
      failedCount: true,
      skippedCount: true,
      payloadStatsJson: true,
      errorReportJson: true,
    },
  });

  if (!jobs.length) {
    return [];
  }

  const finishedAt = new Date();
  for (const job of jobs) {
    const attemptedCount = job.attemptedCount ?? Number(asRecord(job.payloadStatsJson)?.productCount ?? 0);
    const succeededCount = job.succeededCount ?? 0;
    const skippedCount = job.skippedCount ?? 0;
    await prisma.oMarketExportJob.update({
      where: { id: job.id },
      data: {
        status: OMarketExportJobStatus.FAILED,
        finishedAt,
        attemptedCount,
        succeededCount,
        skippedCount,
        failedCount: Math.max(0, attemptedCount - succeededCount - skippedCount),
        errorReportJson: toJson({
          ...(asRecord(job.errorReportJson) ?? {}),
          reason: "oMarketExportJobTimedOut",
          timeout: true,
          timeoutMs: O_MARKET_EXPORT_JOB_TIMEOUT_MS,
          jobId: job.id,
          jobType: job.jobType,
          storeId: job.storeId,
          startedAt: job.startedAt?.toISOString() ?? null,
          finishedAt: finishedAt.toISOString(),
          requestIdempotencyKey: job.requestIdempotencyKey,
          payloadStats: asRecord(job.payloadStatsJson),
        }),
      },
    });
    await prisma.oMarketIntegration.updateMany({
      where: { orgId: job.orgId },
      data: {
        status: OMarketIntegrationStatus.ERROR,
        lastSyncAt: finishedAt,
        lastSyncStatus: OMarketLastSyncStatus.FAILED,
        lastErrorSummary: "oMarketExportJobTimedOut",
      },
    });
  }

  return jobs.map((job) => job.id);
};

const formatOMarketErrorData = (errorData: Array<Record<string, unknown>>) => {
  if (!errorData.length) {
    return "O! Market validation error";
  }
  return errorData
    .flatMap((entry) =>
      Object.entries(entry).map(([field, message]) => `${field}: ${String(message)}`),
    )
    .join("; ");
};

const buildPerProductResults = (input: {
  plan: OMarketExportPlan;
  rows: OMarketImportStatusRow[];
}) => {
  const rowsBySku = new Map(input.rows.map((row) => [normalizeSku(row.sku), row]));
  const results: OMarketProductResult[] = [];
  if (input.plan.mode === "READY_ONLY") {
    for (const product of input.plan.preflight.failedProducts) {
      results.push({
        productId: product.productId,
        sku: product.sku,
        name: product.name,
        status: "skipped",
        reason: product.issues.join(", "),
      });
    }
  }
  for (const product of input.plan.payload.products) {
    const meta = input.plan.productMetaBySku.get(normalizeSku(product.sku));
    const row = rowsBySku.get(normalizeSku(product.sku));
    if (!row) {
      results.push({
        productId: meta?.productId ?? null,
        sku: product.sku,
        name: meta?.name ?? null,
        status: "processing",
        reason: "O! Market task status was not returned yet",
      });
      continue;
    }
    if (row.status === "success") {
      results.push({
        productId: meta?.productId ?? null,
        sku: product.sku,
        name: meta?.name ?? null,
        status: input.plan.jobType === OMarketJobType.STOCK_PRICE_SYNC ? "updated" : "exported",
        reason: null,
        oMarketProductId: row.product_id,
      });
      continue;
    }
    if (row.status === "in_progress") {
      results.push({
        productId: meta?.productId ?? null,
        sku: product.sku,
        name: meta?.name ?? null,
        status: "processing",
        reason: "O! Market task is still processing",
      });
      continue;
    }
    results.push({
      productId: meta?.productId ?? null,
      sku: product.sku,
      name: meta?.name ?? null,
      status: "failed",
      reason: formatOMarketErrorData(row.error_data ?? []),
      oMarketProductId: row.product_id,
    });
  }
  return results;
};

const pollImportStatus = async (input: {
  token: string;
  baseUrl: string;
  taskId: number;
}) => {
  let rows: OMarketImportStatusRow[] = [];
  for (let attempt = 0; attempt < O_MARKET_STATUS_POLL_ATTEMPTS; attempt += 1) {
    const response = await getOMarketImportStatus({
      token: input.token,
      baseUrl: input.baseUrl,
      taskId: input.taskId,
      signal: AbortSignal.timeout(O_MARKET_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok || !Array.isArray(response.body)) {
      return rows;
    }
    rows = response.body;
    if (rows.length && rows.every((row) => row.status !== "in_progress")) {
      return rows;
    }
    await sleep(O_MARKET_STATUS_POLL_DELAY_MS);
  }
  return rows;
};

const runOMarketExportJob = async (
  payload?: JobPayload,
): Promise<{ job: string; status: "ok" | "skipped"; details?: Record<string, unknown> }> => {
  await timeoutAbandonedOMarketExportJobs();

  const requestPayload =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const jobId = typeof requestPayload.jobId === "string" ? requestPayload.jobId : "";
  const job = jobId
    ? await prisma.oMarketExportJob.findFirst({
        where: { id: jobId, status: OMarketExportJobStatus.QUEUED },
      })
    : await prisma.oMarketExportJob.findFirst({
        where: { status: OMarketExportJobStatus.QUEUED },
        orderBy: { createdAt: "asc" },
      });
  if (!job) {
    return { job: O_MARKET_EXPORT_JOB_NAME, status: "skipped", details: { reason: "empty" } };
  }
  const running = await prisma.oMarketExportJob.update({
    where: { id: job.id },
    data: {
      status: OMarketExportJobStatus.RUNNING,
      startedAt: new Date(),
      finishedAt: null,
      responseJson: Prisma.DbNull,
      errorReportJson: Prisma.DbNull,
    },
  });
  let plan: OMarketExportPlan | null = null;
  let token: string | null = null;
  try {
    const integration = await prisma.oMarketIntegration.findUnique({
      where: { orgId: job.orgId },
      select: { apiTokenEncrypted: true, baseUrl: true },
    });
    if (!integration?.apiTokenEncrypted) {
      throw new AppError("oMarketApiTokenMissing", "CONFLICT", 409);
    }
    token = decryptToken(integration.apiTokenEncrypted);
    const baseUrl = normalizeOMarketBaseUrl(integration.baseUrl);
    plan = await buildOMarketExportPlan({
      organizationId: job.orgId,
      storeId: job.storeId,
      jobType: job.jobType,
      mode: normalizeOMarketExportMode(asRecord(job.payloadStatsJson)?.exportMode),
    });
    if (plan.mode === "READY_ONLY") {
      if (!plan.preflight.actionability.canRunReadyOnly) {
        throw new AppError("oMarketReadyOnlyUnsafe", "CONFLICT", 409);
      }
    } else if (!plan.preflight.actionability.canRunAll) {
      throw new AppError("oMarketPreflightFailed", "CONFLICT", 409);
    }

    let taskId = 0;
    let taskRows: OMarketImportStatusRow[] = [];
    if (process.env.O_MARKET_MOCK_API === "1") {
      taskId = 1;
      taskRows = plan.payload.products.map((product, index) => ({
        id: index + 1,
        sku: product.sku,
        error_data: [],
        status: "success",
        import_task_id: taskId,
        product_id: index + 1000,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
    } else {
      const response =
        job.jobType === OMarketJobType.STOCK_PRICE_SYNC
          ? await updateOMarketStockPrice({
              token,
              baseUrl,
              payload: plan.payload,
              signal: AbortSignal.timeout(O_MARKET_REQUEST_TIMEOUT_MS),
            })
          : job.jobType === OMarketJobType.FULL_SYNC
            ? await fullSyncOMarketProducts({
                token,
                baseUrl,
                payload: plan.payload,
                signal: AbortSignal.timeout(O_MARKET_REQUEST_TIMEOUT_MS),
              })
            : await createOrUpdateOMarketProducts({
                token,
                baseUrl,
                payload: plan.payload,
                signal: AbortSignal.timeout(O_MARKET_REQUEST_TIMEOUT_MS),
              });
      if (!response.ok) {
        const normalized = normalizeOMarketApiError({
          status: response.status,
          body: response.body,
          token,
        });
        throw new AppError(normalized.code, "INTERNAL_SERVER_ERROR", 502);
      }
      taskId = Number(asRecord(response.body)?.result && asRecord(asRecord(response.body)?.result)?.task_id);
      if (!Number.isInteger(taskId) || taskId <= 0) {
        throw new AppError("oMarketTaskIdMissing", "INTERNAL_SERVER_ERROR", 502);
      }
      taskRows = await pollImportStatus({ token, baseUrl, taskId });
    }

    const productResults = buildPerProductResults({ plan, rows: taskRows });
    const successfulProductIds = productResults
      .filter((result) => result.status === "exported" || result.status === "updated")
      .map((result) => result.productId)
      .filter((value): value is string => Boolean(value));
    const failedProductResults = productResults.filter(
      (result) => result.status === "failed" || result.status === "processing",
    );
    const skippedCount = productResults.filter((result) => result.status === "skipped").length;
    const finishedAt = new Date();

    if (successfulProductIds.length) {
      await prisma.oMarketIncludedProduct.updateMany({
        where: {
          orgId: job.orgId,
          storeId: job.storeId ?? String(plan.payloadStats.storeId),
          productId: { in: successfulProductIds },
        },
        data: { lastExportedAt: finishedAt },
      });
    }

    for (const result of productResults) {
      if (!result.productId || result.status === "skipped") {
        continue;
      }
      const payloadProduct = plan.payloadByProductId.get(result.productId);
      await prisma.oMarketProductSyncState.upsert({
        where: {
          orgId_storeId_productId: {
            orgId: job.orgId,
            storeId: job.storeId ?? String(plan.payloadStats.storeId),
            productId: result.productId,
          },
        },
        update: {
          oMarketProductId: result.oMarketProductId ? String(result.oMarketProductId) : undefined,
          lastSyncedAt:
            result.status === "exported" || result.status === "updated" ? finishedAt : undefined,
          lastSyncStatus:
            result.status === "exported" || result.status === "updated"
              ? OMarketLastSyncStatus.SUCCESS
              : OMarketLastSyncStatus.FAILED,
          lastPayloadChecksum: payloadProduct ? computeOMarketPayloadChecksum(payloadProduct) : null,
          lastErrorSummary: result.reason,
        },
        create: {
          orgId: job.orgId,
          storeId: job.storeId ?? String(plan.payloadStats.storeId),
          productId: result.productId,
          oMarketProductId: result.oMarketProductId ? String(result.oMarketProductId) : null,
          lastSyncedAt:
            result.status === "exported" || result.status === "updated" ? finishedAt : null,
          lastSyncStatus:
            result.status === "exported" || result.status === "updated"
              ? OMarketLastSyncStatus.SUCCESS
              : OMarketLastSyncStatus.FAILED,
          lastPayloadChecksum: payloadProduct ? computeOMarketPayloadChecksum(payloadProduct) : null,
          lastErrorSummary: result.reason,
        },
      });
    }

    const failedCount = failedProductResults.length;
    const succeededCount = successfulProductIds.length;
    const finished = await prisma.oMarketExportJob.update({
      where: { id: job.id },
      data: {
        status: failedCount > 0 ? OMarketExportJobStatus.FAILED : OMarketExportJobStatus.DONE,
        finishedAt,
        attemptedCount: plan.payload.products.length,
        succeededCount,
        failedCount,
        skippedCount,
        payloadStatsJson: toJson({ ...plan.payloadStats, taskId }),
        responseJson: toJson({
          taskId,
          productResults,
          mockMode: process.env.O_MARKET_MOCK_API === "1",
        }),
        errorReportJson:
          failedCount > 0 || skippedCount > 0
            ? toJson({ ...plan.errorReport, productResults })
            : Prisma.DbNull,
      },
    });
    await prisma.oMarketIntegration.updateMany({
      where: { orgId: job.orgId },
      data: {
        status: failedCount > 0 ? OMarketIntegrationStatus.ERROR : OMarketIntegrationStatus.READY,
        lastSyncAt: finishedAt,
        lastSyncStatus:
          failedCount > 0 ? OMarketLastSyncStatus.FAILED : OMarketLastSyncStatus.SUCCESS,
        lastErrorSummary: failedCount > 0 ? "OMARKET_PRODUCT_ERRORS" : null,
      },
    });
    await writeAuditLog(prisma, {
      organizationId: job.orgId,
      actorId: job.requestedById,
      action: failedCount > 0 ? "O_MARKET_EXPORT_FAILED" : "O_MARKET_EXPORT_FINISHED",
      entity: "OMarketExportJob",
      entityId: finished.id,
      before: toJson(running),
      after: toJson({ ...finished, productResults }),
      requestId:
        typeof requestPayload.requestId === "string" ? requestPayload.requestId : randomUUID(),
    });
    return {
      job: O_MARKET_EXPORT_JOB_NAME,
      status: "ok",
      details: {
        jobId: finished.id,
        attempted: plan.payload.products.length,
        succeeded: succeededCount,
        failed: failedCount,
        skipped: skippedCount,
      },
    };
  } catch (error) {
    const normalized = normalizeOMarketApiError({ status: null, body: null, error, token });
    const failed = await prisma.oMarketExportJob.update({
      where: { id: job.id },
      data: {
        status: OMarketExportJobStatus.FAILED,
        finishedAt: new Date(),
        attemptedCount: plan?.payload.products.length ?? 0,
        succeededCount: 0,
        failedCount: plan?.payload.products.length ?? 0,
        skippedCount: plan?.mode === "READY_ONLY" ? plan.preflight.failedProducts.length : 0,
        errorReportJson: toJson({ ...(plan?.errorReport ?? {}), error: normalized }),
      },
    });
    await prisma.oMarketIntegration.updateMany({
      where: { orgId: job.orgId },
      data: {
        status: OMarketIntegrationStatus.ERROR,
        lastSyncStatus: OMarketLastSyncStatus.FAILED,
        lastErrorSummary: normalized.code,
      },
    });
    await writeAuditLog(prisma, {
      organizationId: job.orgId,
      actorId: job.requestedById,
      action: "O_MARKET_EXPORT_FAILED",
      entity: "OMarketExportJob",
      entityId: failed.id,
      before: toJson(running),
      after: toJson({ ...failed, error: normalized }),
      requestId:
        typeof requestPayload.requestId === "string" ? requestPayload.requestId : randomUUID(),
    });
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("oMarketExportFailed", "INTERNAL_SERVER_ERROR", 500);
  }
};

registerJob(O_MARKET_EXPORT_JOB_NAME, {
  handler: runOMarketExportJob,
  maxAttempts: 1,
  baseDelayMs: 1,
});

export const __buildOMarketExportPlanForTests = async (
  organizationId: string,
  jobType: OMarketJobType = OMarketJobType.PRODUCT_EXPORT,
  mode: OMarketExportMode = "ALL_SELECTED",
  storeId?: string | null,
) => {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("testOnly");
  }
  return buildOMarketExportPlan({ organizationId, storeId, jobType, mode });
};
