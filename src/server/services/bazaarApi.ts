import { createHash, randomBytes } from "node:crypto";
import { CustomerOrderSource, CustomerOrderStatus, type Prisma } from "@prisma/client";

import { convertFromKgs, normalizeCurrencyCode, normalizeCurrencyRateKgsPerUnit } from "@/lib/currency";
import { prisma } from "@/server/db/prisma";
import { eventBus } from "@/server/events/eventBus";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";

const API_TOKEN_PREFIX = "bz_live_";

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const toMoney = (value: Prisma.Decimal | number | null | undefined) =>
  value === null || value === undefined ? 0 : Number(value);
const normalizeOptionalText = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};
const variantKeyFrom = (variantId?: string | null) => variantId ?? "BASE";

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const createRawToken = () => `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;

const nextSalesOrderNumber = async (tx: Prisma.TransactionClient, organizationId: string) => {
  const counter = await tx.organizationCounter.upsert({
    where: { organizationId },
    update: { salesOrderNumber: { increment: 1 } },
    create: { organizationId, salesOrderNumber: 1 },
    select: { salesOrderNumber: true },
  });
  return `SO-${String(counter.salesOrderNumber).padStart(6, "0")}`;
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
  const name = input.name.trim() || "Bazaar API";
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
  return prisma.$transaction(async (tx) => {
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
    return updated;
  });
};

export const authenticateBazaarApiRequest = async (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  const token = match?.[1]?.trim();
  if (!token) {
    throw new AppError("apiUnauthorized", "UNAUTHORIZED", 401);
  }

  const apiKey = await prisma.bazaarApiKey.findUnique({
    where: { tokenHash: tokenHash(token) },
    select: {
      id: true,
      organizationId: true,
      storeId: true,
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

  await prisma.bazaarApiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return {
    apiKeyId: apiKey.id,
    organizationId: apiKey.organizationId,
    storeId: apiKey.storeId,
    store: apiKey.store,
  };
};

export const listBazaarApiProducts = async (input: {
  organizationId: string;
  storeId: string;
  search?: string | null;
  page?: number;
  pageSize?: number;
}) => {
  const store = await ensureStoreAccess(input.organizationId, input.storeId);
  const currencyCode = normalizeCurrencyCode(store.currencyCode);
  const currencyRateKgsPerUnit = normalizeCurrencyRateKgsPerUnit(
    Number(store.currencyRateKgsPerUnit),
    currencyCode,
  );
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(input.pageSize ?? 50)));
  const search = normalizeOptionalText(input.search);
  const where: Prisma.ProductWhereInput = {
    organizationId: input.organizationId,
    isDeleted: false,
    hiddenInBazaarCatalogs: {
      none: { storeId: input.storeId },
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
        basePriceKgs: true,
        photoUrl: true,
        images: {
          where: { AND: [{ url: { not: "" } }, { NOT: { url: { startsWith: "data:image/" } } }] },
          select: { url: true, position: true },
          orderBy: { position: "asc" },
        },
        variants: {
          where: { isActive: true },
          select: { id: true, name: true, sku: true, attributes: true },
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

  return {
    store: { id: store.id, name: store.name },
    currencyCode,
    page,
    pageSize,
    total,
    items: products.map((product) => {
      const basePriceKgs =
        priceByProductVariant.get(`${product.id}:BASE`) ?? toMoney(product.basePriceKgs);
      return {
        id: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        categories: product.categories,
        description: product.description,
        price: roundMoney(convertFromKgs(basePriceKgs, currencyRateKgsPerUnit, currencyCode)),
        priceKgs: roundMoney(basePriceKgs),
        stockQty: stockByProductVariant.get(`${product.id}:BASE`) ?? 0,
        images: [product.photoUrl, ...product.images.map((image) => image.url)]
          .filter((url): url is string => Boolean(url?.trim()))
          .filter((url, index, urls) => urls.indexOf(url) === index),
        variants: product.variants.map((variant) => {
          const variantKey = variantKeyFrom(variant.id);
          const variantPriceKgs =
            priceByProductVariant.get(`${product.id}:${variantKey}`) ?? basePriceKgs;
          return {
            id: variant.id,
            sku: variant.sku,
            name: variant.name,
            attributes: variant.attributes,
            price: roundMoney(
              convertFromKgs(variantPriceKgs, currencyRateKgsPerUnit, currencyCode),
            ),
            priceKgs: roundMoney(variantPriceKgs),
            stockQty: stockByProductVariant.get(`${product.id}:${variantKey}`) ?? 0,
          };
        }),
      };
    }),
  };
};

export const createBazaarApiOrder = async (input: {
  organizationId: string;
  storeId: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  comment?: string | null;
  externalId?: string | null;
  lines: Array<{ productId: string; variantId?: string | null; qty: number }>;
}) => {
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

  const result = await prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({
      where: { id: input.storeId },
      select: { id: true, organizationId: true },
    });
    if (!store || store.organizationId !== input.organizationId) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
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
    const notes = [normalizeOptionalText(input.comment), normalizeOptionalText(input.externalId)]
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
        notes: notes || null,
        subtotalKgs: subtotal,
        totalKgs: subtotal,
        lines: { create: lines },
      },
      select: { id: true, number: true, storeId: true, status: true, totalKgs: true },
    });
    return order;
  });

  eventBus.publish({
    type: "customerOrder.created",
    payload: {
      customerOrderId: result.id,
      storeId: result.storeId,
      source: CustomerOrderSource.API,
    },
  });

  return {
    id: result.id,
    number: result.number,
    status: result.status,
    totalKgs: Number(result.totalKgs),
  };
};
