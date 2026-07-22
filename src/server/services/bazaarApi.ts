import { createHash, randomBytes } from "node:crypto";
import {
  CustomerOrderSource,
  CustomerOrderStatus,
  CustomerSource,
  OperationRequestPrincipalType,
  StockMovementType,
  type Prisma,
} from "@prisma/client";

import {
  convertFromKgs,
  normalizeCurrencyCode,
  normalizeCurrencyRateKgsPerUnit,
  type SupportedCurrencyCode,
} from "@/lib/currency";
import { resolveCurrencySnapshot } from "@/lib/currencyDisplay";
import { prisma } from "@/server/db/prisma";
import { eventBus } from "@/server/events/eventBus";
import { getLogger } from "@/server/logging";
import { getRedisPublisher } from "@/server/redis";
import { writeAuditLog } from "@/server/services/audit";
import {
  formatBazaarExternalOrderIdNote,
  normalizeBazaarExternalOrderId,
  parseLegacyBazaarExternalIdNotes,
} from "@/server/services/bazaarExternalIdentity";
import {
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  upsertCustomerFromOrderTx,
} from "@/server/services/customers";
import { AppError } from "@/server/services/errors";
import { applyStockMovement } from "@/server/services/inventory";
import { toJson } from "@/server/services/json";
import {
  OPERATION_BAZAAR_API_RETENTION_MS,
  OPERATION_FAILURE_AMBIGUOUS,
  OPERATION_FAILURE_SAFE_BEFORE_EFFECTS,
  runOperationRequest,
  type OperationFailureDecision,
} from "@/server/services/operationRequests";
import { sendOrderConfirmationEmail } from "@/server/services/orderEmails";

const API_TOKEN_PREFIX = "bz_live_";
const API_KEY_LAST_USED_UPDATE_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_API_PRODUCTS_CACHE_TTL_SECONDS = 30 * 60;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const globalForBazaarApiCache = globalThis as typeof globalThis & {
  __bazaarApiMemoryCache?: Map<string, CacheEntry<unknown>>;
};

const memoryCache = (globalForBazaarApiCache.__bazaarApiMemoryCache ??= new Map());

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const toMoney = (value: Prisma.Decimal | number | null | undefined) =>
  value === null || value === undefined ? 0 : Number(value);
const normalizeOptionalText = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};
const customerEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const variantKeyFrom = (variantId?: string | null) => variantId ?? "BASE";
// Staged compatibility defaults on until the clean backfill and Preview gate approve removal.
const shouldWriteLegacyBazaarApiExternalIdMarker = () => {
  const configured = process.env.BAZAAR_API_WRITE_LEGACY_EXTERNAL_ID_MARKER?.trim().toLowerCase();
  return configured !== "0" && configured !== "false";
};
const bazaarApiStockImpactingStatuses = new Set<CustomerOrderStatus>([
  CustomerOrderStatus.CONFIRMED,
  CustomerOrderStatus.READY,
  CustomerOrderStatus.COMPLETED,
]);

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const createRawToken = () => `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
const cacheDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const positiveIntFromEnv = (name: string, fallback: number) => {
  const raw = process.env[name];
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

const apiProductsCacheTtlSeconds = () =>
  positiveIntFromEnv("BAZAAR_API_PRODUCTS_CACHE_TTL_SECONDS", DEFAULT_API_PRODUCTS_CACHE_TTL_SECONDS);

export type BazaarApiPublicOrderStatus =
  | "NEW"
  | "CONFIRMED"
  | "READY_FOR_PICKUP"
  | "COMPLETED"
  | "CANCELLED";

const publicStatusByInternalStatus = {
  [CustomerOrderStatus.DRAFT]: "NEW",
  [CustomerOrderStatus.CONFIRMED]: "CONFIRMED",
  [CustomerOrderStatus.READY]: "READY_FOR_PICKUP",
  [CustomerOrderStatus.COMPLETED]: "COMPLETED",
  [CustomerOrderStatus.CANCELED]: "CANCELLED",
} satisfies Record<CustomerOrderStatus, BazaarApiPublicOrderStatus>;

const internalStatusByPublicStatus = new Map<string, CustomerOrderStatus>(
  Object.entries(publicStatusByInternalStatus).map(([internalStatus, publicStatus]) => [
    publicStatus,
    internalStatus as CustomerOrderStatus,
  ]),
);

const publicOrderStatusLabels = {
  NEW: "Новый",
  CONFIRMED: "Подтвержден",
  READY_FOR_PICKUP: "Готов к выдаче",
  COMPLETED: "Завершен",
  CANCELLED: "Отменен",
} satisfies Record<BazaarApiPublicOrderStatus, string>;

export const mapBazaarApiOrderStatus = (status: CustomerOrderStatus) => {
  const publicStatus = publicStatusByInternalStatus[status];
  return {
    status: publicStatus,
    statusLabel: publicOrderStatusLabels[publicStatus],
    internalStatus: status,
  };
};

export const bazaarApiPublicOrderStatuses = Object.values(publicStatusByInternalStatus);

const normalizeBazaarApiOrderStatusFilter = (status?: string | null) => {
  const normalized = normalizeOptionalText(status)?.toUpperCase();
  if (!normalized) {
    return null;
  }
  const publicStatus = internalStatusByPublicStatus.get(normalized);
  if (publicStatus) {
    return publicStatus;
  }
  if (normalized === "CANCELED") {
    return CustomerOrderStatus.CANCELED;
  }
  if (Object.values(CustomerOrderStatus).includes(normalized as CustomerOrderStatus)) {
    return normalized as CustomerOrderStatus;
  }
  throw new AppError("invalidInput", "BAD_REQUEST", 400);
};

const resolveBazaarApiExternalId = (order: {
  externalOrderId: string | null;
  notes: string | null;
}) => {
  if (order.externalOrderId !== null) {
    return order.externalOrderId;
  }
  const legacyIdentity = parseLegacyBazaarExternalIdNotes(order.notes);
  return legacyIdentity.kind === "value" ? legacyIdentity.value : null;
};

const strictLegacyMarkerWhere = (externalOrderId: string): Prisma.CustomerOrderWhereInput => {
  const marker = formatBazaarExternalOrderIdNote(externalOrderId);
  return {
    OR: [
      { notes: { equals: marker } },
      { notes: { startsWith: `${marker}\n` } },
      { notes: { startsWith: `${marker}\r` } },
      { notes: { endsWith: `\n${marker}` } },
      { notes: { endsWith: `\r${marker}` } },
      { notes: { contains: `\n${marker}\n` } },
      { notes: { contains: `\n${marker}\r` } },
      { notes: { contains: `\r${marker}\n` } },
      { notes: { contains: `\r${marker}\r` } },
    ],
  };
};

type BazaarApiOrderIdentityClient = Pick<Prisma.TransactionClient, "customerOrder">;

const findBazaarApiOrderIdByExternalIdentity = async (
  client: BazaarApiOrderIdentityClient,
  input: {
    organizationId: string;
    storeId: string;
    externalOrderId: string;
  },
) => {
  const scope = {
    organizationId: input.organizationId,
    storeId: input.storeId,
    source: CustomerOrderSource.API,
  } as const;
  const exactMatches = await client.customerOrder.findMany({
    where: { ...scope, externalOrderId: input.externalOrderId },
    select: { id: true },
    orderBy: { id: "asc" },
    take: 2,
  });
  if (exactMatches.length > 1) {
    throw new AppError("externalOrderIdConflict", "CONFLICT", 409);
  }
  if (exactMatches[0]) {
    return exactMatches[0].id;
  }

  const legacyCandidates = await client.customerOrder.findMany({
    where: {
      ...scope,
      externalOrderId: null,
      ...strictLegacyMarkerWhere(input.externalOrderId),
    },
    select: { id: true, notes: true },
    orderBy: { id: "asc" },
    take: 2,
  });
  if (legacyCandidates.length > 1) {
    throw new AppError("externalOrderIdConflict", "CONFLICT", 409);
  }
  const legacyCandidate = legacyCandidates[0];
  if (!legacyCandidate) return null;
  const parsed = parseLegacyBazaarExternalIdNotes(legacyCandidate.notes);
  return parsed.kind === "value" && parsed.value === input.externalOrderId
    ? legacyCandidate.id
    : null;
};

const readCache = async <T>(key: string): Promise<T | null> => {
  const memoryEntry = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (memoryEntry) {
    if (memoryEntry.expiresAt > Date.now()) {
      return memoryEntry.value;
    }
    memoryCache.delete(key);
  }

  try {
    const redis = getRedisPublisher();
    if (!redis) return null;
    const raw = await redis.get(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (entry.expiresAt <= Date.now()) {
      void redis.del(key).catch(() => undefined);
      return null;
    }
    memoryCache.set(key, entry as CacheEntry<unknown>);
    return entry.value;
  } catch {
    return null;
  }
};

const writeCache = async <T>(key: string, value: T, ttlSeconds: number): Promise<void> => {
  const entry: CacheEntry<T> = {
    expiresAt: Date.now() + ttlSeconds * 1000,
    value,
  };
  memoryCache.set(key, entry as CacheEntry<unknown>);

  try {
    const redis = getRedisPublisher();
    if (!redis) return;
    await redis.set(key, JSON.stringify(entry), "EX", ttlSeconds);
  } catch {
    // Cache writes are best-effort; API correctness must not depend on Redis.
  }
};

const deleteCache = async (key: string): Promise<void> => {
  memoryCache.delete(key);
  try {
    const redis = getRedisPublisher();
    if (!redis) return;
    await redis.del(key);
  } catch {
    // Authentication always revalidates against the database, so stale cache cleanup is best-effort.
  }
};

const nextSalesOrderNumber = async (tx: Prisma.TransactionClient, organizationId: string) => {
  const counter = await tx.organizationCounter.upsert({
    where: { organizationId },
    update: { salesOrderNumber: { increment: 1 } },
    create: { organizationId, salesOrderNumber: 1 },
    select: { salesOrderNumber: true },
  });
  return `SO-${String(counter.salesOrderNumber).padStart(6, "0")}`;
};

type BazaarApiAuthContext = {
  apiKeyId: string;
  organizationId: string;
  storeId: string;
  store: {
    id: string;
    name: string;
    currencyCode: string | null;
    currencyRateKgsPerUnit: Prisma.Decimal | number | string | null;
  };
};

type BazaarApiProductsResult = {
  store: { id: string; name: string };
  currencyCode: string;
  currencyRateKgsPerUnit: number;
  page: number;
  pageSize: number;
  total: number;
  items: Array<{
    id: string;
    sku: string | null;
    name: string;
    category: string | null;
    categories: string[];
    description: string | null;
    unit: string | null;
    baseUnit: { id: string; code: string; labelRu: string | null; labelKg: string | null } | null;
    supplier: { id: string; name: string } | null;
    isBundle: boolean;
    barcodes: string[];
    packs: Array<{
      id: string;
      packName: string;
      packBarcode: string | null;
      multiplierToBase: number;
      allowInPurchasing: boolean;
      allowInReceiving: boolean;
    }>;
    createdAt: string;
    updatedAt: string;
    price: number;
    priceKgs: number;
    stockQty: number;
    pcs: number;
    stockByVariant: Array<{ variantKey: string; stockQty: number; pcs: number }>;
    images: string[];
    imageObjects: Array<{
      id: string | null;
      url: string;
      position: number;
      isPrimary: boolean;
      isAiGenerated: boolean;
    }>;
    variants: Array<{
      id: string;
      sku: string | null;
      name: string | null;
      attributes: Prisma.JsonValue;
      attributeValues: Array<{ key: string; value: Prisma.JsonValue }>;
      createdAt: string;
      updatedAt: string;
      price: number;
      priceKgs: number;
      stockQty: number;
      pcs: number;
    }>;
  }>;
};

type BazaarApiOrderStockLine = {
  productId: string;
  variantId: string | null;
  qty: number;
  unitCostKgs: Prisma.Decimal | number | null;
  lineTotalKgs: Prisma.Decimal | number;
};

type BazaarApiOrderForStock = {
  id: string;
  number: string;
  storeId: string;
  lines: BazaarApiOrderStockLine[];
};

const bazaarApiOrderSelect = {
  id: true,
  number: true,
  status: true,
  source: true,
  storeId: true,
  customerName: true,
  customerEmail: true,
  customerPhone: true,
  customerAddress: true,
  trackingNumber: true,
  trackingCarrier: true,
  trackingUrl: true,
  trackingStatus: true,
  subtotalKgs: true,
  discountKgs: true,
  totalKgs: true,
  currencyCode: true,
  currencyRateKgsPerUnit: true,
  notes: true,
  externalOrderId: true,
  confirmedAt: true,
  readyAt: true,
  completedAt: true,
  canceledAt: true,
  createdAt: true,
  updatedAt: true,
  store: {
    select: {
      id: true,
      name: true,
    },
  },
  lines: {
    select: {
      productId: true,
      variantId: true,
      qty: true,
      unitPriceKgs: true,
      lineTotalKgs: true,
      product: {
        select: {
          name: true,
          sku: true,
        },
      },
      variant: {
        select: {
          name: true,
          sku: true,
        },
      },
    },
    orderBy: { id: "asc" },
  },
  payments: {
    select: {
      method: true,
      amountKgs: true,
      isRefund: true,
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.CustomerOrderSelect;

type BazaarApiOrderRecord = Prisma.CustomerOrderGetPayload<{
  select: typeof bazaarApiOrderSelect;
}>;

const convertOrderMoney = (
  valueKgs: Prisma.Decimal | number | null | undefined,
  currencyRateKgsPerUnit: number,
  currencyCode: SupportedCurrencyCode,
) => roundMoney(convertFromKgs(toMoney(valueKgs), currencyRateKgsPerUnit, currencyCode));

const resolveBazaarApiOrderPayment = (order: BazaarApiOrderRecord) => {
  const paidKgs = roundMoney(
    order.payments.reduce((sum, payment) => {
      const amount = toMoney(payment.amountKgs);
      return payment.isRefund ? sum - amount : sum + amount;
    }, 0),
  );
  const totalKgs = roundMoney(toMoney(order.totalKgs));
  const methods = Array.from(
    new Set(order.payments.filter((payment) => !payment.isRefund).map((payment) => payment.method)),
  );
  const status =
    paidKgs <= 0
      ? "UNPAID"
      : paidKgs + 0.01 < totalKgs
        ? "PARTIALLY_PAID"
        : "PAID";

  return {
    status,
    method: methods.length === 1 ? methods[0] : methods.length > 1 ? "MIXED" : null,
    methods,
    paidKgs,
  };
};

const resolveBazaarApiFulfillmentStatus = (order: BazaarApiOrderRecord) => {
  const trackingStatus = normalizeOptionalText(order.trackingStatus);
  if (trackingStatus) {
    return trackingStatus;
  }
  if (order.status === CustomerOrderStatus.CANCELED) {
    return "CANCELLED";
  }
  if (order.status === CustomerOrderStatus.COMPLETED) {
    return "COMPLETED";
  }
  if (order.status === CustomerOrderStatus.READY) {
    return "READY_FOR_PICKUP";
  }
  return "PENDING";
};

const serializeBazaarApiOrder = (order: BazaarApiOrderRecord) => {
  const currencyCode = normalizeCurrencyCode(order.currencyCode);
  const currencyRateKgsPerUnit = normalizeCurrencyRateKgsPerUnit(
    Number(order.currencyRateKgsPerUnit),
    currencyCode,
  );
  const status = mapBazaarApiOrderStatus(order.status);
  return {
    id: order.id,
    orderNumber: order.number,
    externalOrderId: resolveBazaarApiExternalId(order),
    ...status,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    confirmedAt: order.confirmedAt?.toISOString() ?? null,
    readyAt: order.readyAt?.toISOString() ?? null,
    cancelledAt: order.canceledAt?.toISOString() ?? null,
    canceledAt: order.canceledAt?.toISOString() ?? null,
    completedAt: order.completedAt?.toISOString() ?? null,
    customer: {
      name: order.customerName,
      phone: order.customerPhone,
      email: order.customerEmail,
      address: order.customerAddress,
    },
    store: {
      id: order.store.id,
      name: order.store.name,
    },
    items: order.lines.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      name: line.variant?.name ?? line.product.name,
      sku: line.variant?.sku ?? line.product.sku,
      quantity: line.qty,
      price: convertOrderMoney(line.unitPriceKgs, currencyRateKgsPerUnit, currencyCode),
      priceKgs: roundMoney(toMoney(line.unitPriceKgs)),
      total: convertOrderMoney(line.lineTotalKgs, currencyRateKgsPerUnit, currencyCode),
      totalKgs: roundMoney(toMoney(line.lineTotalKgs)),
    })),
    totals: {
      subtotal: convertOrderMoney(order.subtotalKgs, currencyRateKgsPerUnit, currencyCode),
      subtotalKgs: roundMoney(toMoney(order.subtotalKgs)),
      discount: convertOrderMoney(order.discountKgs, currencyRateKgsPerUnit, currencyCode),
      discountKgs: roundMoney(toMoney(order.discountKgs)),
      shipping: 0,
      shippingKgs: 0,
      total: convertOrderMoney(order.totalKgs, currencyRateKgsPerUnit, currencyCode),
      totalKgs: roundMoney(toMoney(order.totalKgs)),
      currencyCode,
      currencyRateKgsPerUnit,
    },
    payment: resolveBazaarApiOrderPayment(order),
    fulfillment: {
      status: resolveBazaarApiFulfillmentStatus(order),
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
      carrier: order.trackingCarrier,
    },
  };
};

const serializeBazaarApiOrderSummary = (order: BazaarApiOrderRecord) => {
  const currencyCode = normalizeCurrencyCode(order.currencyCode);
  const currencyRateKgsPerUnit = normalizeCurrencyRateKgsPerUnit(
    Number(order.currencyRateKgsPerUnit),
    currencyCode,
  );
  return {
    id: order.id,
    orderNumber: order.number,
    externalOrderId: resolveBazaarApiExternalId(order),
    ...mapBazaarApiOrderStatus(order.status),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    total: convertOrderMoney(order.totalKgs, currencyRateKgsPerUnit, currencyCode),
    totalKgs: roundMoney(toMoney(order.totalKgs)),
    currencyCode,
  };
};

const applyBazaarApiOrderStockDeduction = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    order: BazaarApiOrderForStock;
  },
) => {
  const existingSaleMovement = await tx.stockMovement.findFirst({
    where: {
      referenceType: "CustomerOrder",
      referenceId: input.order.id,
      type: StockMovementType.SALE,
    },
    select: { id: true },
  });
  if (existingSaleMovement) {
    return;
  }

  for (const [index, line] of input.order.lines.entries()) {
    await applyStockMovement(tx, {
      storeId: input.order.storeId,
      productId: line.productId,
      variantId: line.variantId,
      qtyDelta: -line.qty,
      type: StockMovementType.SALE,
      referenceType: "CustomerOrder",
      referenceId: input.order.id,
      linePosition: index,
      unitCostKgs: line.unitCostKgs === null ? null : toMoney(line.unitCostKgs),
      lineTotalKgs: toMoney(line.lineTotalKgs),
      note: `Bazaar API order ${input.order.number}`,
      organizationId: input.organizationId,
      allowNegativeStock: true,
    });
  }
};

const ensureStoreAccess = async (organizationId: string, storeId: string) => {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      id: true,
      organizationId: true,
      name: true,
      currencyCode: true,
      currencyRateKgsPerUnit: true,
    },
  });
  if (!store || store.organizationId !== organizationId) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }
  return store;
};

export const listBazaarApiKeys = async (input: { organizationId: string; storeId: string }) => {
  await ensureStoreAccess(input.organizationId, input.storeId);
  return prisma.bazaarApiKey.findMany({
    where: {
      organizationId: input.organizationId,
      storeId: input.storeId,
    },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
      createdBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });
};

export const createBazaarApiKey = async (input: {
  organizationId: string;
  storeId: string;
  actorId: string;
  requestId: string;
  name: string;
}) => {
  await ensureStoreAccess(input.organizationId, input.storeId);
  const name = input.name.trim() || "bazaar API";
  const token = createRawToken();
  const created = await prisma.$transaction(async (tx) => {
    const apiKey = await tx.bazaarApiKey.create({
      data: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        name,
        tokenPrefix: token.slice(0, 18),
        tokenHash: tokenHash(token),
        createdById: input.actorId,
      },
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "BAZAAR_API_KEY_CREATE",
      entity: "BazaarApiKey",
      entityId: apiKey.id,
      before: null,
      after: toJson({ ...apiKey, tokenHash: "[redacted]" }),
      requestId: input.requestId,
    });
    return apiKey;
  });

  return { apiKey: created, token };
};

export const revokeBazaarApiKey = async (input: {
  organizationId: string;
  storeId: string;
  actorId: string;
  requestId: string;
  apiKeyId: string;
}) => {
  await ensureStoreAccess(input.organizationId, input.storeId);
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.bazaarApiKey.findFirst({
      where: {
        id: input.apiKeyId,
        organizationId: input.organizationId,
        storeId: input.storeId,
      },
    });
    if (!existing) {
      throw new AppError("apiKeyNotFound", "NOT_FOUND", 404);
    }
    const updated = await tx.bazaarApiKey.update({
      where: { id: existing.id },
      data: { revokedAt: existing.revokedAt ?? new Date() },
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "BAZAAR_API_KEY_REVOKE",
      entity: "BazaarApiKey",
      entityId: existing.id,
      before: toJson({ ...existing, tokenHash: "[redacted]" }),
      after: toJson(updated),
      requestId: input.requestId,
    });
    return { updated, tokenHash: existing.tokenHash };
  });
  await deleteCache(`bazaar-api:auth:v1:${result.tokenHash}`);
  return result.updated;
};

export const authenticateBazaarApiRequest = async (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  const token = match?.[1]?.trim();
  if (!token) {
    throw new AppError("apiUnauthorized", "UNAUTHORIZED", 401);
  }
  const hashedToken = tokenHash(token);

  const apiKey = await prisma.bazaarApiKey.findUnique({
    where: { tokenHash: hashedToken },
    select: {
      id: true,
      organizationId: true,
      storeId: true,
      lastUsedAt: true,
      revokedAt: true,
      store: {
        select: {
          id: true,
          name: true,
          currencyCode: true,
          currencyRateKgsPerUnit: true,
        },
      },
    },
  });
  if (!apiKey || apiKey.revokedAt) {
    throw new AppError("apiUnauthorized", "UNAUTHORIZED", 401);
  }

  const now = new Date();
  const staleBefore = new Date(now.getTime() - API_KEY_LAST_USED_UPDATE_INTERVAL_MS);
  if (!apiKey.lastUsedAt || apiKey.lastUsedAt <= staleBefore) {
    await prisma.bazaarApiKey
      .updateMany({
        where: {
          id: apiKey.id,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: staleBefore } }],
        },
        data: { lastUsedAt: now },
      })
      .catch(() => undefined);
  }

  return {
    apiKeyId: apiKey.id,
    organizationId: apiKey.organizationId,
    storeId: apiKey.storeId,
    store: apiKey.store,
  } satisfies BazaarApiAuthContext;
};

export const listBazaarApiProducts = async (input: {
  organizationId: string;
  storeId: string;
  search?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<BazaarApiProductsResult> => {
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(input.pageSize ?? 50)));
  const search = normalizeOptionalText(input.search);
  const productsCacheKey = `bazaar-api:products:v1:${cacheDigest({
    organizationId: input.organizationId,
    storeId: input.storeId,
    search,
    page,
    pageSize,
  })}`;
  const cached = await readCache<BazaarApiProductsResult>(productsCacheKey);
  if (cached) {
    return cached;
  }

  const store = await ensureStoreAccess(input.organizationId, input.storeId);
  const currencyCode = normalizeCurrencyCode(store.currencyCode);
  const currencyRateKgsPerUnit = normalizeCurrencyRateKgsPerUnit(
    Number(store.currencyRateKgsPerUnit),
    currencyCode,
  );
  const where: Prisma.ProductWhereInput = {
    organizationId: input.organizationId,
    isDeleted: false,
    hiddenInBazaarCatalogs: {
      none: { storeId: input.storeId },
    },
    storeProducts: {
      some: { storeId: input.storeId, isActive: true },
    },
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { sku: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: {
        id: true,
        sku: true,
        name: true,
        category: true,
        categories: true,
        description: true,
        unit: true,
        isBundle: true,
        createdAt: true,
        updatedAt: true,
        basePriceKgs: true,
        photoUrl: true,
        supplier: {
          select: {
            id: true,
            name: true,
          },
        },
        baseUnit: {
          select: {
            id: true,
            code: true,
            labelRu: true,
            labelKg: true,
          },
        },
        barcodes: {
          select: { value: true },
          orderBy: { createdAt: "asc" },
        },
        packs: {
          select: {
            id: true,
            packName: true,
            packBarcode: true,
            multiplierToBase: true,
            allowInPurchasing: true,
            allowInReceiving: true,
          },
          orderBy: { createdAt: "asc" },
        },
        images: {
          where: { AND: [{ url: { not: "" } }, { NOT: { url: { startsWith: "data:image/" } } }] },
          select: { id: true, url: true, position: true, isAiGenerated: true },
          orderBy: { position: "asc" },
        },
        variants: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            sku: true,
            attributes: true,
            createdAt: true,
            updatedAt: true,
            attributeValues: {
              select: {
                key: true,
                value: true,
              },
              orderBy: { key: "asc" },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: [{ name: "asc" }, { sku: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const productIds = products.map((product) => product.id);
  const [storePrices, snapshots] = await Promise.all([
    productIds.length
      ? prisma.storePrice.findMany({
          where: {
            organizationId: input.organizationId,
            storeId: input.storeId,
            productId: { in: productIds },
          },
          select: { productId: true, variantId: true, variantKey: true, priceKgs: true },
        })
      : Promise.resolve([]),
    productIds.length
      ? prisma.inventorySnapshot.findMany({
          where: { storeId: input.storeId, productId: { in: productIds } },
          select: { productId: true, variantKey: true, onHand: true },
        })
      : Promise.resolve([]),
  ]);

  const priceByProductVariant = new Map(
    storePrices.map((price) => [`${price.productId}:${price.variantKey}`, Number(price.priceKgs)]),
  );
  const stockByProductVariant = new Map<string, number>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.productId}:${snapshot.variantKey}`;
    stockByProductVariant.set(key, (stockByProductVariant.get(key) ?? 0) + snapshot.onHand);
  }

  const result: BazaarApiProductsResult = {
    store: { id: store.id, name: store.name },
    currencyCode,
    currencyRateKgsPerUnit,
    page,
    pageSize,
    total,
    items: products.map((product) => {
      const basePriceKgs =
        priceByProductVariant.get(`${product.id}:BASE`) ?? toMoney(product.basePriceKgs);
      const baseStockQty = stockByProductVariant.get(`${product.id}:BASE`) ?? 0;
      return {
        id: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        categories: product.categories,
        description: product.description,
        unit: product.unit,
        baseUnit: product.baseUnit,
        supplier: product.supplier,
        isBundle: product.isBundle,
        barcodes: product.barcodes.map((barcode) => barcode.value),
        packs: product.packs,
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString(),
        price: roundMoney(convertFromKgs(basePriceKgs, currencyRateKgsPerUnit, currencyCode)),
        priceKgs: roundMoney(basePriceKgs),
        stockQty: baseStockQty,
        pcs: baseStockQty,
        stockByVariant: Array.from(stockByProductVariant.entries())
          .filter(([key]) => key.startsWith(`${product.id}:`))
          .map(([key, onHand]) => ({
            variantKey: key.slice(product.id.length + 1),
            stockQty: onHand,
            pcs: onHand,
          })),
        images: [product.photoUrl, ...product.images.map((image) => image.url)]
          .filter((url): url is string => Boolean(url?.trim()))
          .filter((url, index, urls) => urls.indexOf(url) === index),
        imageObjects: [
          ...(product.photoUrl
            ? [
                {
                  id: null,
                  url: product.photoUrl,
                  position: 0,
                  isPrimary: true,
                  isAiGenerated: false,
                },
              ]
            : []),
          ...product.images.map((image) => ({
            id: image.id,
            url: image.url,
            position: image.position,
            isPrimary: false,
            isAiGenerated: image.isAiGenerated,
          })),
        ].filter(
          (image, index, images) => images.findIndex((item) => item.url === image.url) === index,
        ),
        variants: product.variants.map((variant) => {
          const variantKey = variantKeyFrom(variant.id);
          const variantPriceKgs =
            priceByProductVariant.get(`${product.id}:${variantKey}`) ?? basePriceKgs;
          const variantStockQty = stockByProductVariant.get(`${product.id}:${variantKey}`) ?? 0;
          return {
            id: variant.id,
            sku: variant.sku,
            name: variant.name,
            attributes: variant.attributes,
            attributeValues: variant.attributeValues,
            createdAt: variant.createdAt.toISOString(),
            updatedAt: variant.updatedAt.toISOString(),
            price: roundMoney(
              convertFromKgs(variantPriceKgs, currencyRateKgsPerUnit, currencyCode),
            ),
            priceKgs: roundMoney(variantPriceKgs),
            stockQty: variantStockQty,
            pcs: variantStockQty,
          };
        }),
      };
    }),
  };
  await writeCache(productsCacheKey, result, apiProductsCacheTtlSeconds());
  return result;
};

export const getBazaarApiOrder = async (input: {
  organizationId: string;
  storeId: string;
  identifier: string;
}) => {
  const identifier = normalizeOptionalText(input.identifier);
  if (!identifier) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }

  const directOrder = await prisma.customerOrder.findFirst({
    where: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      source: CustomerOrderSource.API,
      OR: [{ id: identifier }, { number: identifier }],
    },
    select: bazaarApiOrderSelect,
  });
  if (directOrder) {
    return serializeBazaarApiOrder(directOrder);
  }

  const externalOrderId = normalizeBazaarExternalOrderId(identifier);
  if (!externalOrderId) {
    throw new AppError("orderNotFound", "NOT_FOUND", 404);
  }
  const externalOrderMatchId = await findBazaarApiOrderIdByExternalIdentity(prisma, {
    organizationId: input.organizationId,
    storeId: input.storeId,
    externalOrderId,
  });
  const order = externalOrderMatchId
    ? await prisma.customerOrder.findFirst({
        where: {
          id: externalOrderMatchId,
          organizationId: input.organizationId,
          storeId: input.storeId,
          source: CustomerOrderSource.API,
        },
        select: bazaarApiOrderSelect,
      })
    : null;
  if (!order) {
    throw new AppError("orderNotFound", "NOT_FOUND", 404);
  }

  return serializeBazaarApiOrder(order);
};

export const listBazaarApiOrders = async (input: {
  organizationId: string;
  storeId: string;
  status?: string | null;
  orderNumber?: string | null;
  externalOrderId?: string | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  storeIdFilter?: string | null;
  limit?: number | null;
  cursor?: string | null;
}) => {
  const requestedStoreId = normalizeOptionalText(input.storeIdFilter);
  const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 50)));
  const status = normalizeBazaarApiOrderStatusFilter(input.status);
  const orderNumber = normalizeOptionalText(input.orderNumber);
  const externalOrderId = normalizeBazaarExternalOrderId(input.externalOrderId);
  const cursor = normalizeOptionalText(input.cursor);

  if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }

  if (requestedStoreId && requestedStoreId !== input.storeId) {
    return { data: [], pagination: { nextCursor: null } };
  }

  const externalOrderMatchId = externalOrderId
    ? await findBazaarApiOrderIdByExternalIdentity(prisma, {
        organizationId: input.organizationId,
        storeId: input.storeId,
        externalOrderId,
      })
    : null;
  if (externalOrderId && !externalOrderMatchId) {
    return { data: [], pagination: { nextCursor: null } };
  }

  const where: Prisma.CustomerOrderWhereInput = {
    organizationId: input.organizationId,
    storeId: input.storeId,
    source: CustomerOrderSource.API,
    ...(status ? { status } : {}),
    ...(orderNumber ? { number: orderNumber } : {}),
    ...(externalOrderMatchId ? { id: externalOrderMatchId } : {}),
    ...(input.dateFrom || input.dateTo
      ? {
          createdAt: {
            ...(input.dateFrom ? { gte: input.dateFrom } : {}),
            ...(input.dateTo ? { lte: input.dateTo } : {}),
          },
        }
      : {}),
  };

  const orders = await prisma.customerOrder.findMany({
    where,
    select: bazaarApiOrderSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: limit + 1,
  });
  const page = orders.slice(0, limit);
  const hasNextPage = orders.length > limit;

  return {
    data: page.map(serializeBazaarApiOrderSummary),
    pagination: {
      nextCursor: hasNextPage ? (page[page.length - 1]?.id ?? null) : null,
    },
  };
};

const normalizeBazaarApiCustomerInput = (input: {
  name: string;
  email: string;
  phone: string;
  address?: string | null;
}) => {
  const name = normalizeOptionalText(input.name);
  const email = normalizeCustomerEmail(input.email);
  const phone = normalizeCustomerPhone(input.phone);
  const address = normalizeOptionalText(input.address);

  if (!name || !email || !phone || !customerEmailPattern.test(email)) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }

  return { name, email, phone, address };
};

const findBazaarApiCustomer = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    storeId: string;
    email: string;
    phone: string;
  },
) => {
  const byEmail = await tx.customer.findFirst({
    where: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      email: { equals: input.email, mode: "insensitive" },
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" },
  });
  if (byEmail) {
    return byEmail;
  }

  const phoneCandidates = await tx.customer.findMany({
    where: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      phone: { not: null },
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" },
    take: 10_000,
  });
  return (
    phoneCandidates.find((customer) => normalizeCustomerPhone(customer.phone) === input.phone) ??
    null
  );
};

export const createBazaarApiCustomer = async (input: {
  organizationId: string;
  storeId: string;
  apiKeyId: string;
  name: string;
  email: string;
  phone: string;
  address?: string | null;
}) => {
  const normalized = normalizeBazaarApiCustomerInput(input);

  const result = await prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({
      where: { id: input.storeId },
      select: { id: true, organizationId: true },
    });
    if (!store || store.organizationId !== input.organizationId) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }

    const existing = await findBazaarApiCustomer(tx, {
      organizationId: input.organizationId,
      storeId: input.storeId,
      email: normalized.email,
      phone: normalized.phone,
    });

    if (existing) {
      const updated = await tx.customer.update({
        where: { id: existing.id },
        data: {
          name: normalized.name,
          email: normalized.email,
          phone: normalized.phone,
          address: normalized.address ?? existing.address,
          source:
            existing.source === CustomerSource.MANUAL
              ? existing.source
              : CustomerSource.INTEGRATION,
          metadata: {
            ...(existing.metadata &&
            typeof existing.metadata === "object" &&
            !Array.isArray(existing.metadata)
              ? existing.metadata
              : {}),
            bazaarApiKeyId: input.apiKeyId,
          },
        },
      });
      return { customer: updated, action: "updated" as const };
    }

    const customer = await tx.customer.create({
      data: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        source: CustomerSource.INTEGRATION,
        name: normalized.name,
        email: normalized.email,
        phone: normalized.phone,
        address: normalized.address,
        metadata: { bazaarApiKeyId: input.apiKeyId },
      },
    });
    return { customer, action: "created" as const };
  });

  const customer = result.customer;
  return {
    action: result.action,
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      source: customer.source,
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
    },
  };
};

export type CreateBazaarApiOrderInput = {
  organizationId: string;
  storeId: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  comment?: string | null;
  externalId?: string | null;
  lines: Array<{ productId: string; variantId?: string | null; qty: number }>;
};

const createBazaarApiOrderTx = async (
  tx: Prisma.TransactionClient,
  input: CreateBazaarApiOrderInput,
) => {
  const externalId = normalizeBazaarExternalOrderId(input.externalId);
  const externalIdNote =
    externalId && shouldWriteLegacyBazaarApiExternalIdMarker()
      ? formatBazaarExternalOrderIdNote(externalId)
      : null;
  const normalizedLines = Array.from(
    input.lines.reduce((map, line) => {
      const productId = line.productId.trim();
      const variantId = normalizeOptionalText(line.variantId);
      const variantKey = variantKeyFrom(variantId);
      const qty = Math.trunc(line.qty);
      if (!productId || !Number.isFinite(qty) || qty < 1) {
        throw new AppError("invalidQuantity", "BAD_REQUEST", 400);
      }
      const key = `${productId}:${variantKey}`;
      const existing = map.get(key);
      if (existing) {
        existing.qty += qty;
      } else {
        map.set(key, { productId, variantId, variantKey, qty });
      }
      return map;
    }, new Map<string, { productId: string; variantId: string | null; variantKey: string; qty: number }>()),
  ).map((entry) => entry[1]);

  if (!normalizedLines.length) {
    throw new AppError("salesOrderEmpty", "BAD_REQUEST", 400);
  }

  const store = await tx.store.findUnique({
    where: { id: input.storeId },
    select: {
      id: true,
      organizationId: true,
      currencyCode: true,
      currencyRateKgsPerUnit: true,
    },
  });
  if (!store || store.organizationId !== input.organizationId) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }

  if (externalId) {
    const lockKey = `bazaar-api-order:${input.organizationId}:${input.storeId}:${externalId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    const existingOrderId = await findBazaarApiOrderIdByExternalIdentity(tx, {
      organizationId: input.organizationId,
      storeId: input.storeId,
      externalOrderId: externalId,
    });
    const existingOrder = existingOrderId
      ? await tx.customerOrder.findFirst({
          where: {
            id: existingOrderId,
            organizationId: input.organizationId,
            storeId: input.storeId,
            source: CustomerOrderSource.API,
          },
          select: {
            id: true,
            number: true,
            storeId: true,
            status: true,
            totalKgs: true,
            lines: {
              select: {
                productId: true,
                variantId: true,
                qty: true,
                unitCostKgs: true,
                lineTotalKgs: true,
              },
            },
          },
        })
      : null;
    if (existingOrder) {
      if (bazaarApiStockImpactingStatuses.has(existingOrder.status)) {
        await applyBazaarApiOrderStockDeduction(tx, {
          organizationId: input.organizationId,
          order: existingOrder,
        });
      }
      return { order: existingOrder, replayed: true };
    }
  }

  const productIds = Array.from(new Set(normalizedLines.map((line) => line.productId)));
  const variantIds = normalizedLines
    .map((line) => line.variantId)
    .filter((variantId): variantId is string => Boolean(variantId));

  const [products, variants, storePrices, productCosts] = await Promise.all([
    tx.product.findMany({
      where: {
        organizationId: input.organizationId,
        isDeleted: false,
        id: { in: productIds },
        storeProducts: {
          some: { storeId: input.storeId, isActive: true },
        },
        hiddenInBazaarCatalogs: { none: { storeId: input.storeId } },
      },
      select: { id: true, basePriceKgs: true },
    }),
    variantIds.length
      ? tx.productVariant.findMany({
          where: { id: { in: variantIds }, isActive: true },
          select: { id: true, productId: true },
        })
      : Promise.resolve([]),
    tx.storePrice.findMany({
      where: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        productId: { in: productIds },
      },
      select: { productId: true, variantKey: true, priceKgs: true },
    }),
    tx.productCost.findMany({
      where: { organizationId: input.organizationId, productId: { in: productIds } },
      select: { productId: true, variantKey: true, avgCostKgs: true },
    }),
  ]);

  const productsById = new Map(products.map((product) => [product.id, product]));
  if (productsById.size !== productIds.length) {
    throw new AppError("productNotFound", "NOT_FOUND", 404);
  }

  const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
  const priceByProductVariant = new Map(
    storePrices.map((price) => [`${price.productId}:${price.variantKey}`, Number(price.priceKgs)]),
  );
  const costByProductVariant = new Map(
    productCosts.map((cost) => [`${cost.productId}:${cost.variantKey}`, Number(cost.avgCostKgs)]),
  );

  const lines = normalizedLines.map((line) => {
    const product = productsById.get(line.productId);
    if (!product) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }
    if (line.variantId) {
      const variant = variantsById.get(line.variantId);
      if (!variant || variant.productId !== line.productId) {
        throw new AppError("variantNotFound", "NOT_FOUND", 404);
      }
    }
    const basePrice = toMoney(product.basePriceKgs);
    const unitPrice =
      priceByProductVariant.get(`${line.productId}:${line.variantKey}`) ??
      priceByProductVariant.get(`${line.productId}:BASE`) ??
      basePrice;
    const unitCost =
      costByProductVariant.get(`${line.productId}:${line.variantKey}`) ??
      (line.variantKey !== "BASE"
        ? (costByProductVariant.get(`${line.productId}:BASE`) ?? null)
        : null);
    return {
      productId: line.productId,
      variantId: line.variantId,
      variantKey: line.variantKey,
      qty: line.qty,
      unitPriceKgs: roundMoney(unitPrice),
      lineTotalKgs: roundMoney(unitPrice * line.qty),
      unitCostKgs: unitCost,
      lineCostTotalKgs: unitCost === null ? null : roundMoney(unitCost * line.qty),
    };
  });

  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.lineTotalKgs, 0));
  const number = await nextSalesOrderNumber(tx, input.organizationId);
  const notes = [normalizeOptionalText(input.comment), externalIdNote]
    .filter(Boolean)
    .join("\n");
  const order = await tx.customerOrder.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      number,
      status: CustomerOrderStatus.CONFIRMED,
      source: CustomerOrderSource.API,
      confirmedAt: new Date(),
      customerName: normalizeOptionalText(input.customerName),
      customerEmail: normalizeOptionalText(input.customerEmail),
      customerPhone: normalizeOptionalText(input.customerPhone),
      customerAddress: normalizeOptionalText(input.customerAddress),
      notes: notes || null,
      externalOrderId: externalId,
      subtotalKgs: subtotal,
      totalKgs: subtotal,
      ...resolveCurrencySnapshot(store),
      lines: { create: lines },
    },
    select: {
      id: true,
      number: true,
      storeId: true,
      status: true,
      totalKgs: true,
      lines: {
        select: {
          productId: true,
          variantId: true,
          qty: true,
          unitCostKgs: true,
          lineTotalKgs: true,
        },
      },
    },
  });
  await applyBazaarApiOrderStockDeduction(tx, {
    organizationId: input.organizationId,
    order,
  });
  await upsertCustomerFromOrderTx(tx, {
    organizationId: input.organizationId,
    storeId: input.storeId,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    customerAddress: input.customerAddress,
  });
  return { order, replayed: false };
};

type BazaarApiOrderCreateResult = Awaited<ReturnType<typeof createBazaarApiOrderTx>>;

const toBazaarApiOrderCreateResponse = (result: BazaarApiOrderCreateResult) => ({
  id: result.order.id,
  number: result.order.number,
  status: result.order.status,
  totalKgs: Number(result.order.totalKgs),
});

const dispatchBazaarApiOrderCreated = (
  input: CreateBazaarApiOrderInput,
  result: BazaarApiOrderCreateResult,
) => {
  if (!result.replayed) {
    eventBus.publish({
      type: "customerOrder.created",
      payload: {
        customerOrderId: result.order.id,
        storeId: result.order.storeId,
        source: CustomerOrderSource.API,
      },
    });
    void sendOrderConfirmationEmail({
      organizationId: input.organizationId,
      customerOrderId: result.order.id,
      throwOnMissingEmail: false,
    }).catch((error: unknown) => {
      getLogger().error(
        { error, customerOrderId: result.order.id, storeId: result.order.storeId },
        "API order confirmation email send failed",
      );
    });
  }
};

export const createBazaarApiOrder = async (input: CreateBazaarApiOrderInput) => {
  const result = await prisma.$transaction((tx) => createBazaarApiOrderTx(tx, input));
  dispatchBazaarApiOrderCreated(input, result);
  return toBazaarApiOrderCreateResponse(result);
};

type BazaarApiOrderOperationResponse = Prisma.InputJsonObject & {
  order: {
    id: string;
    number: string;
    status: CustomerOrderStatus;
    totalKgs: number;
  };
};

const classifyBazaarApiOrderOperationFailure = (error: unknown): OperationFailureDecision => {
  if (error instanceof AppError) {
    return {
      classification: OPERATION_FAILURE_SAFE_BEFORE_EFFECTS,
      responseCode: error.message,
      responseStatus: error.status,
    };
  }
  return {
    classification: OPERATION_FAILURE_AMBIGUOUS,
    responseCode: "operationRequestFailed",
    responseStatus: 500,
  };
};

export const createBazaarApiOrderOperation = async (
  input: CreateBazaarApiOrderInput & {
    apiKeyId: string;
    idempotencyKey: string;
  },
) => {
  let createdResult: BazaarApiOrderCreateResult | null = null;
  const operation = await runOperationRequest<BazaarApiOrderOperationResponse>(
    {
      organizationId: input.organizationId,
      storeId: input.storeId,
      scope: "bazaar-api.order.create.v1",
      principal: {
        type: OperationRequestPrincipalType.API_KEY,
        id: input.apiKeyId,
      },
      idempotencyKey: input.idempotencyKey,
      payload: {
        version: "v1",
        value: {
          externalId: input.externalId ?? null,
          customerName: input.customerName ?? null,
          customerEmail: input.customerEmail ?? null,
          customerPhone: input.customerPhone ?? null,
          customerAddress: input.customerAddress ?? null,
          comment: input.comment ?? null,
          lines: input.lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId ?? null,
            qty: line.qty,
          })),
        },
      },
      allowedResponsePaths: ["order", "order.id", "order.number", "order.status", "order.totalKgs"],
      expiresAt: new Date(Date.now() + OPERATION_BAZAAR_API_RETENTION_MS),
      classifyFailure: classifyBazaarApiOrderOperationFailure,
    },
    async (tx) => {
      const result = await createBazaarApiOrderTx(tx, input);
      if (!result.replayed) createdResult = result;
      return {
        response: { order: toBazaarApiOrderCreateResponse(result) },
        responseStatus: 201,
        responseCode: "created",
        resource: { type: "CustomerOrder", id: result.order.id },
      };
    },
  );

  if (createdResult) {
    dispatchBazaarApiOrderCreated(input, createdResult);
  }

  return operation;
};
