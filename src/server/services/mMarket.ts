import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";

import {
  MMarketEnvironment,
  MMarketExportJobStatus,
  MMarketIntegrationStatus,
  MMarketLastSyncStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { getRedisPublisher } from "@/server/redis";
import { registerJob, runJob, type JobPayload } from "@/server/jobs";
import { toJson } from "@/server/services/json";
import { writeAuditLog } from "@/server/services/audit";

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
const MMARKET_REQUEST_TIMEOUT_MS = 30_000;
const MMARKET_SPEC_REQUEST_TIMEOUT_MS = 5_000;

const MMARKET_MIN_NAME_LEN = 7;
const MMARKET_MAX_NAME_LEN = 250;
const MMARKET_MIN_DESCRIPTION_LEN = 50;
const MMARKET_MIN_IMAGES = 3;

const IMAGE_EXTENSION_PATTERN = /\.(jpg|png|webp)$/i;

const memoryCooldownStore = new Map<string, number>();

export type MMarketOverviewStatus = "NOT_CONFIGURED" | "READY" | "ERROR";

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
  payloadStats: Record<string, unknown>;
  errorReport: Record<string, unknown>;
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
        return { acquired: true as const, remainingSeconds: normalizeCooldownSeconds(MMARKET_EXPORT_COOLDOWN_MS) };
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
  return { acquired: true as const, remainingSeconds: normalizeCooldownSeconds(MMARKET_EXPORT_COOLDOWN_MS) };
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

const buildMMarketExportPlan = async (input: {
  organizationId: string;
  environment: MMarketEnvironment;
  token: string | null;
}): Promise<MMarketExportPlan> => {
  const [stores, mappings] = await Promise.all([
    prisma.store.findMany({
      where: { organizationId: input.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.mMarketBranchMapping.findMany({
      where: { orgId: input.organizationId },
      select: { storeId: true, mmarketBranchId: true },
    }),
  ]);

  const storeIdList = stores.map((store) => store.id);
  const positiveSnapshots = storeIdList.length
    ? await prisma.inventorySnapshot.findMany({
        where: {
          storeId: { in: storeIdList },
          variantKey: "BASE",
          onHand: { gt: 0 },
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
    inStockProductIds.length
      ? prisma.product.findMany({
          where: {
            organizationId: input.organizationId,
            isDeleted: false,
            id: { in: inStockProductIds },
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
    inStockProductIds.length
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

  const templateSpecsByCategory = new Map<string, Array<{ attributeKey: string; specKey: string }>>();
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
    const nonDirectImageUrls = imageUrls.filter((url) => !hasAllowedImageExtension(url));
    const directImageUrls = imageUrls.filter((url) => hasAllowedImageExtension(url));
    if (nonDirectImageUrls.length > 0) {
      addIssue(issues, "NON_DIRECT_IMAGE_URL");
    }
    if (directImageUrls.length < MMARKET_MIN_IMAGES) {
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

    const categoryTemplateSpecs = category ? templateSpecsByCategory.get(category) ?? [] : [];
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
      images: directImageUrls,
      stock: stockPayload,
      specs,
    });
  }

  const payload = buildMMarketPayload(readyProducts);
  const blockerCounts = countByCode(
    failedProducts.map((item) => ({ codes: item.issues })),
  );
  const warningCounts = countByCode(
    failedProducts.map((item) => ({ codes: item.warnings })),
  );
  for (const globalWarning of remoteSpecCatalog.globalWarnings) {
    warningCounts[globalWarning] = (warningCounts[globalWarning] ?? 0) + 1;
  }

  const cooldownSeconds = await getCooldownSeconds(input.organizationId);
  const nextAllowedAt = cooldownSeconds
    ? new Date(Date.now() + cooldownSeconds * 1_000)
    : null;

  const preflight: MMarketPreflightResult = {
    generatedAt: new Date(),
    canExport: failedProducts.length === 0,
    summary: {
      mode: "IN_STOCK_ONLY",
      storesTotal: stores.length,
      storesMapped: mappedStores.length,
      productsConsidered: products.length,
      productsReady: readyProducts.length,
      productsFailed: failedProducts.length,
    },
    blockers: {
      total: failedProducts.length,
      byCode: blockerCounts,
      missingStoreMappings,
    },
    warnings: {
      total:
        Object.values(warningCounts).reduce((sum, value) => sum + (value ?? 0), 0),
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

  return {
    preflight,
    payload,
    payloadStats: {
      productCount: payload.products.length,
      storesTotal: stores.length,
      storesMapped: mappedStores.length,
      failedProducts: failedProducts.length,
      warningCount: preflight.warnings.total,
      consideredProducts: products.length,
    },
    errorReport: {
      generatedAt: preflight.generatedAt.toISOString(),
      summary: preflight.summary,
      blockers: preflight.blockers,
      warnings: preflight.warnings,
      failedProducts: preflight.failedProducts,
    },
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

const sendMMarketPayload = async (input: {
  environment: MMarketEnvironment;
  token: string;
  payload: MMarketPayload;
}): Promise<RemoteApiResult> => {
  const endpoint = MMARKET_IMPORT_ENDPOINTS[input.environment];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MMARKET_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Token ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.payload),
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
  const mappedCount = stores.filter((store) => (mappingByStoreId.get(store.id) ?? "").length > 0)
    .length;
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
        : existing?.apiTokenEncrypted ?? null;

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

    const finished = await prisma.mMarketExportJob.update({
      where: { id: job.id },
      data: {
        status: MMarketExportJobStatus.DONE,
        finishedAt: new Date(),
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

    await prisma.mMarketIntegration.updateMany({
      where: { orgId: job.orgId },
      data: {
        status: MMarketIntegrationStatus.READY,
        lastSyncAt: new Date(),
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
    const message =
      error instanceof AppError
        ? error.message
        : error instanceof Error
          ? error.message
          : "mMarketExportFailed";

    const remoteResponse =
      error instanceof MMarketRemoteError
        ? {
            httpStatus: error.status,
            body: error.body,
          }
        : null;

    const errorReport = toJson(
      plan?.errorReport ?? {
        reason: message,
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
