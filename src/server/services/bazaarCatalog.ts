import { randomBytes } from "node:crypto";
import {
  Prisma,
  BazaarCatalogFontFamily,
  BazaarCatalogHeaderStyle,
  BazaarCatalogStatus,
  CustomerOrderSource,
  CustomerOrderStatus,
} from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";
import { getRedisPublisher } from "@/server/redis";
import { eventBus } from "@/server/events/eventBus";
import { normalizeProductImageUrl } from "@/server/services/productImageStorage";

const DEFAULT_ACCENT_COLOR = "#2a6be4";
const DEFAULT_FONT_FAMILY = BazaarCatalogFontFamily.NotoSans;
const DEFAULT_HEADER_STYLE = BazaarCatalogHeaderStyle.STANDARD;
const PUBLIC_CACHE_TTL_SECONDS = 60;
const SLUG_LENGTH = 12;
const slugAlphabet = "abcdefghjkmnpqrstuvwxyz23456789";
const accentColorPattern = /^#[0-9a-fA-F]{6}$/;
const nonDataImagePattern = /^data:image\//i;

const normalizeAccentColor = (value?: string | null) => {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return DEFAULT_ACCENT_COLOR;
  }
  if (!accentColorPattern.test(normalized)) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  return normalized.toLowerCase();
};

const normalizeOptionalText = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const sanitizeImageUrl = (value?: string | null) => {
  if (!value) {
    return null;
  }
  if (nonDataImagePattern.test(value)) {
    return null;
  }
  return value;
};

const resolveProductListImageUrl = (product: {
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

const createSlugCandidate = () => {
  const bytes = randomBytes(SLUG_LENGTH);
  let result = "";
  for (let index = 0; index < SLUG_LENGTH; index += 1) {
    result += slugAlphabet[bytes[index] % slugAlphabet.length];
  }
  return result;
};

const buildPublicPath = (slug: string) => `/c/${slug}`;

const ensureStoreAccess = async (organizationId: string, storeId: string) => {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true, organizationId: true },
  });
  if (!store || store.organizationId !== organizationId) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }
  return store;
};

const generateUniqueSlug = async (tx: Prisma.TransactionClient) => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const slug = createSlugCandidate();
    const existing = await tx.bazaarCatalog.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!existing) {
      return slug;
    }
  }
  throw new AppError("genericMessage", "INTERNAL_SERVER_ERROR", 500);
};

const cacheKeyBySlug = (slug: string) => `bazaar-catalog:public:v2:${slug}`;

const cacheGet = async <T>(key: string): Promise<T | null> => {
  const redis = getRedisPublisher();
  if (!redis) {
    return null;
  }
  const raw = await redis.get(key);
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as T;
};

const cacheSet = async (key: string, value: unknown) => {
  const redis = getRedisPublisher();
  if (!redis) {
    return;
  }
  await redis.set(key, JSON.stringify(value), "EX", PUBLIC_CACHE_TTL_SECONDS);
};

const cacheDel = async (key: string) => {
  const redis = getRedisPublisher();
  if (!redis) {
    return;
  }
  await redis.del(key);
};

const toMoney = (value: Prisma.Decimal | number | null | undefined) =>
  typeof value === "number" ? value : value ? Number(value) : 0;
const roundMoney = (value: number) => Math.round(value * 100) / 100;
const variantKeyFrom = (variantId?: string | null) => variantId ?? "BASE";
const normalizeSearch = (value?: string | null) => value?.trim() ?? "";

export type BazaarCatalogProductVisibilityFilter = "all" | "visible" | "hidden";

const nextSalesOrderNumber = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> => {
  const rows = await tx.$queryRaw<Array<{ salesOrderNumber: number }>>(Prisma.sql`
    INSERT INTO "OrganizationCounter" ("organizationId", "salesOrderNumber", "updatedAt")
    VALUES (${organizationId}, 1, NOW())
    ON CONFLICT ("organizationId")
    DO UPDATE SET
      "salesOrderNumber" = "OrganizationCounter"."salesOrderNumber" + 1,
      "updatedAt" = NOW()
    RETURNING "salesOrderNumber"
  `);
  const sequence = rows[0]?.salesOrderNumber;
  if (!sequence) {
    throw new AppError("salesOrderNumberFailed", "INTERNAL_SERVER_ERROR", 500);
  }
  return `SO-${String(sequence).padStart(6, "0")}`;
};

const resolveCatalogStatus = (status?: BazaarCatalogStatus | null) =>
  status === BazaarCatalogStatus.PUBLISHED
    ? "PUBLISHED"
    : status === BazaarCatalogStatus.DRAFT
      ? "DRAFT"
      : "NOT_CONFIGURED";

type CatalogCardStatus = "NOT_CONFIGURED" | "DRAFT" | "PUBLISHED";

export const listBazaarCatalogStores = async (organizationId: string) => {
  const [stores, catalogs] = await Promise.all([
    prisma.store.findMany({
      where: { organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.bazaarCatalog.findMany({
      where: { organizationId },
      select: {
        id: true,
        storeId: true,
        status: true,
        slug: true,
        publicUrlPath: true,
        publishedAt: true,
        updatedAt: true,
      },
    }),
  ]);

  const byStoreId = new Map(catalogs.map((catalog) => [catalog.storeId, catalog]));

  return stores.map((store) => {
    const catalog = byStoreId.get(store.id);
    return {
      storeId: store.id,
      storeName: store.name,
      status: resolveCatalogStatus(catalog?.status) as CatalogCardStatus,
      slug: catalog?.slug ?? null,
      publicUrlPath: catalog?.publicUrlPath ?? null,
      publishedAt: catalog?.publishedAt ?? null,
      updatedAt: catalog?.updatedAt ?? null,
    };
  });
};

const ensureProductAccess = async (organizationId: string, productIds: string[]) => {
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

const invalidateCatalogCacheForStore = async (organizationId: string, storeId: string) => {
  const catalog = await prisma.bazaarCatalog.findUnique({
    where: {
      organizationId_storeId: {
        organizationId,
        storeId,
      },
    },
    select: { slug: true },
  });

  if (catalog?.slug) {
    await cacheDel(cacheKeyBySlug(catalog.slug));
  }
};

export const getBazaarCatalogSettings = async (input: {
  organizationId: string;
  storeId: string;
}) => {
  const store = await ensureStoreAccess(input.organizationId, input.storeId);
  const catalog = await prisma.bazaarCatalog.findUnique({
    where: {
      organizationId_storeId: {
        organizationId: input.organizationId,
        storeId: input.storeId,
      },
    },
    include: {
      logoImage: {
        select: {
          id: true,
          url: true,
        },
      },
    },
  });

  return {
    store: { id: store.id, name: store.name },
    status: resolveCatalogStatus(catalog?.status) as CatalogCardStatus,
    catalog: catalog
      ? {
          id: catalog.id,
          slug: catalog.slug,
          publicUrlPath: catalog.publicUrlPath,
          status: catalog.status,
          title: catalog.title ?? null,
          accentColor: catalog.accentColor,
          fontFamily: catalog.fontFamily,
          headerStyle: catalog.headerStyle,
          logoImageId: catalog.logoImageId ?? null,
          logoUrl: sanitizeImageUrl(catalog.logoImage?.url),
          publishedAt: catalog.publishedAt,
          updatedAt: catalog.updatedAt,
        }
      : {
          id: null,
          slug: null,
          publicUrlPath: null,
          status: BazaarCatalogStatus.DRAFT,
          title: store.name,
          accentColor: DEFAULT_ACCENT_COLOR,
          fontFamily: DEFAULT_FONT_FAMILY,
          headerStyle: DEFAULT_HEADER_STYLE,
          logoImageId: null,
          logoUrl: null,
          publishedAt: null,
          updatedAt: null,
        },
  };
};

export const listBazaarCatalogProducts = async (input: {
  organizationId: string;
  storeId: string;
  search?: string;
  visibility?: BazaarCatalogProductVisibilityFilter;
  page?: number;
  pageSize?: number;
}) => {
  await ensureStoreAccess(input.organizationId, input.storeId);

  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(10, Math.max(1, Math.trunc(input.pageSize ?? 10)));
  const search = normalizeSearch(input.search);
  const visibility = input.visibility ?? "all";

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

  const visibilityWhere: Prisma.ProductWhereInput =
    visibility === "hidden"
      ? {
          hiddenInBazaarCatalogs: {
            some: { storeId: input.storeId },
          },
        }
      : visibility === "visible"
        ? {
            hiddenInBazaarCatalogs: {
              none: { storeId: input.storeId },
            },
          }
        : {};

  const where: Prisma.ProductWhereInput = {
    ...baseWhere,
    ...searchWhere,
    ...visibilityWhere,
  };

  const [totalProducts, hiddenProducts, total, products] = await Promise.all([
    prisma.product.count({
      where: baseWhere,
    }),
    prisma.product.count({
      where: {
        ...baseWhere,
        hiddenInBazaarCatalogs: {
          some: { storeId: input.storeId },
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
        hiddenInBazaarCatalogs: {
          where: { storeId: input.storeId },
          select: { id: true },
          take: 1,
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
            variantKey: "BASE",
          },
          select: {
            productId: true,
            priceKgs: true,
          },
        })
      : Promise.resolve([]),
    productIds.length
      ? prisma.inventorySnapshot.findMany({
          where: {
            storeId: input.storeId,
            productId: { in: productIds },
            variantKey: "BASE",
          },
          select: {
            productId: true,
            onHand: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const storePriceByProductId = new Map(
    storePrices.map((storePrice) => [storePrice.productId, Number(storePrice.priceKgs)]),
  );
  const onHandByProductId = new Map<string, number>();
  for (const snapshot of snapshots) {
    onHandByProductId.set(
      snapshot.productId,
      (onHandByProductId.get(snapshot.productId) ?? 0) + snapshot.onHand,
    );
  }

  return {
    items: products.map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      category: normalizeOptionalText(product.category),
      priceKgs: roundMoney(
        storePriceByProductId.get(product.id) ?? toMoney(product.basePriceKgs),
      ),
      imageUrl: resolveProductListImageUrl(product),
      onHandQty: onHandByProductId.get(product.id) ?? 0,
      hidden: product.hiddenInBazaarCatalogs.length > 0,
    })),
    total,
    page,
    pageSize,
    summary: {
      totalProducts,
      hiddenProducts,
      visibleProducts: Math.max(0, totalProducts - hiddenProducts),
    },
  };
};

export const updateBazaarCatalogProductVisibility = async (input: {
  organizationId: string;
  storeId: string;
  actorId: string;
  requestId: string;
  productIds: string[];
  hidden: boolean;
}) => {
  await ensureStoreAccess(input.organizationId, input.storeId);
  const productIds = await ensureProductAccess(input.organizationId, input.productIds);
  if (!productIds.length) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }

  await prisma.$transaction(async (tx) => {
    if (input.hidden) {
      await tx.bazaarCatalogHiddenProduct.createMany({
        data: productIds.map((productId) => ({
          organizationId: input.organizationId,
          storeId: input.storeId,
          productId,
        })),
        skipDuplicates: true,
      });
    } else {
      await tx.bazaarCatalogHiddenProduct.deleteMany({
        where: {
          storeId: input.storeId,
          productId: { in: productIds },
        },
      });
    }

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "BAZAAR_CATALOG_PRODUCT_VISIBILITY_UPDATED",
      entity: "BazaarCatalog",
      entityId: input.storeId,
      before: null,
      after: toJson({
        storeId: input.storeId,
        hidden: input.hidden,
        productIds,
      }),
      requestId: input.requestId,
    });
  });

  await invalidateCatalogCacheForStore(input.organizationId, input.storeId);

  return {
    updatedCount: productIds.length,
  };
};

export const upsertBazaarCatalogSettings = async (input: {
  organizationId: string;
  storeId: string;
  actorId: string;
  title?: string | null;
  accentColor?: string | null;
  fontFamily?: BazaarCatalogFontFamily;
  headerStyle?: BazaarCatalogHeaderStyle;
  logoImageId?: string | null;
  status?: BazaarCatalogStatus;
}) =>
  prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({
      where: { id: input.storeId },
      select: { id: true, name: true, organizationId: true },
    });
    if (!store || store.organizationId !== input.organizationId) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }

    const nextLogoImageId = normalizeOptionalText(input.logoImageId);
    if (nextLogoImageId) {
      const image = await tx.bazaarCatalogImage.findUnique({
        where: { id: nextLogoImageId },
        select: { id: true, organizationId: true },
      });
      if (!image || image.organizationId !== input.organizationId) {
        throw new AppError("invalidInput", "BAD_REQUEST", 400);
      }
    }

    const nextStatus = input.status ?? BazaarCatalogStatus.DRAFT;
    const nextPublishedAt = nextStatus === BazaarCatalogStatus.PUBLISHED ? new Date() : null;

    const existing = await tx.bazaarCatalog.findUnique({
      where: {
        organizationId_storeId: {
          organizationId: input.organizationId,
          storeId: input.storeId,
        },
      },
      select: {
        id: true,
        slug: true,
        publishedAt: true,
      },
    });

    const baseData = {
      title: normalizeOptionalText(input.title),
      logoImageId: nextLogoImageId,
      accentColor: normalizeAccentColor(input.accentColor),
      fontFamily: input.fontFamily ?? DEFAULT_FONT_FAMILY,
      headerStyle: input.headerStyle ?? DEFAULT_HEADER_STYLE,
      status: nextStatus,
      updatedById: input.actorId,
    };

    const catalog = existing
      ? await tx.bazaarCatalog.update({
          where: { id: existing.id },
          data: {
            ...baseData,
            publishedAt:
              nextStatus === BazaarCatalogStatus.PUBLISHED
                ? (existing.publishedAt ?? nextPublishedAt)
                : null,
          },
          include: { logoImage: { select: { id: true, url: true } } },
        })
      : await (async () => {
          const slug = await generateUniqueSlug(tx);
          return tx.bazaarCatalog.create({
            data: {
              ...baseData,
              organizationId: input.organizationId,
              storeId: input.storeId,
              slug,
              publicUrlPath: buildPublicPath(slug),
              publishedAt: nextStatus === BazaarCatalogStatus.PUBLISHED ? nextPublishedAt : null,
            },
            include: { logoImage: { select: { id: true, url: true } } },
          });
        })();

    await cacheDel(cacheKeyBySlug(catalog.slug));

    return {
      store: {
        id: store.id,
        name: store.name,
      },
      catalog: {
        id: catalog.id,
        slug: catalog.slug,
        publicUrlPath: catalog.publicUrlPath,
        status: catalog.status,
        title: catalog.title ?? null,
        accentColor: catalog.accentColor,
        fontFamily: catalog.fontFamily,
        headerStyle: catalog.headerStyle,
        logoImageId: catalog.logoImageId ?? null,
        logoUrl: sanitizeImageUrl(catalog.logoImage?.url),
        publishedAt: catalog.publishedAt,
        updatedAt: catalog.updatedAt,
      },
    };
  });

export const createBazaarCatalogLogoImage = async (input: {
  organizationId: string;
  storeId: string;
  imageUrl: string;
}) => {
  await ensureStoreAccess(input.organizationId, input.storeId);
  const url = input.imageUrl.trim();
  if (!url) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  return prisma.bazaarCatalogImage.create({
    data: {
      organizationId: input.organizationId,
      url,
    },
    select: {
      id: true,
      url: true,
      createdAt: true,
    },
  });
};

type PublicCatalogPayload = {
  slug: string;
  storeId: string;
  title: string;
  storeName: string;
  accentColor: string;
  fontFamily: BazaarCatalogFontFamily;
  headerStyle: BazaarCatalogHeaderStyle;
  logoUrl: string | null;
  categories: Array<{ key: string; name: string | null; count: number }>;
  products: Array<{
    id: string;
    name: string;
    category: string | null;
    priceKgs: number;
    imageUrl: string | null;
    isBundle: boolean;
    variants: Array<{
      id: string;
      name: string;
      priceKgs: number;
    }>;
  }>;
};

export const getPublicBazaarCatalog = async (
  slug: string,
): Promise<PublicCatalogPayload | null> => {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug || normalizedSlug.length < 8) {
    return null;
  }

  const cacheKey = cacheKeyBySlug(normalizedSlug);
  const cached = await cacheGet<PublicCatalogPayload>(cacheKey);
  if (cached) {
    return cached;
  }

  const catalog = await prisma.bazaarCatalog.findUnique({
    where: { slug: normalizedSlug },
    select: {
      slug: true,
      organizationId: true,
      storeId: true,
      title: true,
      status: true,
      accentColor: true,
      fontFamily: true,
      headerStyle: true,
      store: {
        select: {
          name: true,
        },
      },
      logoImage: {
        select: {
          url: true,
        },
      },
    },
  });

  if (!catalog || catalog.status !== BazaarCatalogStatus.PUBLISHED) {
    return null;
  }

  const products = await prisma.product.findMany({
    where: {
      organizationId: catalog.organizationId,
      isDeleted: false,
      hiddenInBazaarCatalogs: {
        none: { storeId: catalog.storeId },
      },
    },
    select: {
      id: true,
      name: true,
      category: true,
      isBundle: true,
      photoUrl: true,
      basePriceKgs: true,
      variants: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
        },
        orderBy: { name: "asc" },
      },
      images: {
        where: {
          url: {
            not: { startsWith: "data:image/" },
          },
        },
        select: { url: true },
        orderBy: { position: "asc" },
        take: 1,
      },
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  const storePrices = products.length
    ? await prisma.storePrice.findMany({
        where: {
          organizationId: catalog.organizationId,
          storeId: catalog.storeId,
          productId: { in: products.map((product) => product.id) },
        },
        select: {
          productId: true,
          variantId: true,
          variantKey: true,
          priceKgs: true,
        },
      })
    : [];

  const basePriceByProductId = new Map<string, number>();
  const priceByProductVariantKey = new Map<string, number>();
  for (const storePrice of storePrices) {
    const variantKey = storePrice.variantKey || "BASE";
    priceByProductVariantKey.set(
      `${storePrice.productId}:${variantKey}`,
      Number(storePrice.priceKgs),
    );
    if (variantKey === "BASE") {
      basePriceByProductId.set(storePrice.productId, Number(storePrice.priceKgs));
    }
  }

  const categoryMap = new Map<string, { key: string; name: string | null; count: number }>();
  const payloadProducts = products.map((product) => {
    const categoryName = product.category?.trim() || null;
    const categoryKey = categoryName ? categoryName.toLowerCase() : "__uncategorized";
    const existing = categoryMap.get(categoryKey);
    if (existing) {
      existing.count += 1;
    } else {
      categoryMap.set(categoryKey, {
        key: categoryKey,
        name: categoryName,
        count: 1,
      });
    }

    const basePrice = toMoney(product.basePriceKgs);
    const effectivePrice = basePriceByProductId.get(product.id) ?? basePrice;
    const imageUrl = resolveProductListImageUrl(product);
    const variants = product.variants.map((variant) => {
      const variantPrice =
        priceByProductVariantKey.get(`${product.id}:${variant.id}`) ?? effectivePrice;
      return {
        id: variant.id,
        name: normalizeOptionalText(variant.name) ?? variant.id.slice(0, 8),
        priceKgs: roundMoney(variantPrice),
      };
    });

    return {
      id: product.id,
      name: product.name,
      category: categoryName,
      priceKgs: roundMoney(effectivePrice),
      imageUrl,
      isBundle: product.isBundle,
      variants,
    };
  });

  const payload: PublicCatalogPayload = {
    slug: catalog.slug,
    storeId: catalog.storeId,
    title: catalog.title?.trim() || catalog.store.name,
    storeName: catalog.store.name,
    accentColor: normalizeAccentColor(catalog.accentColor),
    fontFamily: catalog.fontFamily,
    headerStyle: catalog.headerStyle,
    logoUrl: sanitizeImageUrl(catalog.logoImage?.url),
    categories: Array.from(categoryMap.values()).sort((left, right) =>
      (left.name ?? "").localeCompare(right.name ?? "", "ru"),
    ),
    products: payloadProducts,
  };

  await cacheSet(cacheKey, payload);
  return payload;
};

export const createCatalogCheckoutOrder = async (input: {
  slug: string;
  customerName: string;
  customerPhone: string;
  comment?: string | null;
  lines: Array<{ productId: string; variantId?: string | null; qty: number }>;
}) => {
  const slug = input.slug.trim().toLowerCase();
  if (!slug) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }

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
        map.set(key, {
          productId,
          variantId,
          variantKey,
          qty,
        });
      }
      return map;
    }, new Map<string, { productId: string; variantId: string | null; variantKey: string; qty: number }>()),
  ).map((entry) => entry[1]);

  if (!normalizedLines.length) {
    throw new AppError("salesOrderEmpty", "BAD_REQUEST", 400);
  }

  const customerName = input.customerName.trim();
  const customerPhone = input.customerPhone.trim();
  if (!customerName || !customerPhone) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    const catalog = await tx.bazaarCatalog.findUnique({
      where: { slug },
      select: {
        organizationId: true,
        storeId: true,
        status: true,
      },
    });
    if (!catalog || catalog.status !== BazaarCatalogStatus.PUBLISHED) {
      throw new AppError("catalogNotFound", "NOT_FOUND", 404);
    }

    const productIds = Array.from(new Set(normalizedLines.map((line) => line.productId)));
    const variantIds = Array.from(
      new Set(
        normalizedLines
          .map((line) => line.variantId)
          .filter((variantId): variantId is string => Boolean(variantId)),
      ),
    );

    const [products, variants, storePrices, productCosts] = await Promise.all([
      tx.product.findMany({
        where: {
          organizationId: catalog.organizationId,
          isDeleted: false,
          id: { in: productIds },
          hiddenInBazaarCatalogs: {
            none: { storeId: catalog.storeId },
          },
        },
        select: {
          id: true,
          basePriceKgs: true,
        },
      }),
      variantIds.length
        ? tx.productVariant.findMany({
            where: {
              id: { in: variantIds },
              isActive: true,
            },
            select: {
              id: true,
              productId: true,
            },
          })
        : Promise.resolve([]),
      tx.storePrice.findMany({
        where: {
          organizationId: catalog.organizationId,
          storeId: catalog.storeId,
          productId: { in: productIds },
        },
        select: {
          productId: true,
          variantId: true,
          variantKey: true,
          priceKgs: true,
        },
      }),
      tx.productCost.findMany({
        where: {
          organizationId: catalog.organizationId,
          productId: { in: productIds },
        },
        select: {
          productId: true,
          variantId: true,
          variantKey: true,
          avgCostKgs: true,
        },
      }),
    ]);

    const productsById = new Map(products.map((product) => [product.id, product]));
    if (productsById.size !== productIds.length) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }

    const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
    const storePriceByProductVariantKey = new Map(
      storePrices.map((storePrice) => [
        `${storePrice.productId}:${storePrice.variantKey}`,
        Number(storePrice.priceKgs),
      ]),
    );
    const productCostByProductVariantKey = new Map(
      productCosts.map((productCost) => [
        `${productCost.productId}:${productCost.variantKey}`,
        Number(productCost.avgCostKgs),
      ]),
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
        storePriceByProductVariantKey.get(`${line.productId}:${line.variantKey}`) ??
        storePriceByProductVariantKey.get(`${line.productId}:BASE`) ??
        basePrice;
      const lineTotal = roundMoney(unitPrice * line.qty);
      const unitCost =
        productCostByProductVariantKey.get(`${line.productId}:${line.variantKey}`) ??
        (line.variantKey !== "BASE"
          ? (productCostByProductVariantKey.get(`${line.productId}:BASE`) ?? null)
          : null);
      const lineCostTotal = unitCost === null ? null : roundMoney(unitCost * line.qty);
      return {
        productId: line.productId,
        qty: line.qty,
        variantId: line.variantId,
        variantKey: line.variantKey,
        unitPriceKgs: roundMoney(unitPrice),
        lineTotalKgs: lineTotal,
        unitCostKgs: unitCost,
        lineCostTotalKgs: lineCostTotal,
      };
    });

    const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.lineTotalKgs, 0));
    const number = await nextSalesOrderNumber(tx, catalog.organizationId);
    const order = await tx.customerOrder.create({
      data: {
        organizationId: catalog.organizationId,
        storeId: catalog.storeId,
        number,
        status: CustomerOrderStatus.CONFIRMED,
        source: CustomerOrderSource.CATALOG,
        confirmedAt: new Date(),
        customerName,
        customerPhone,
        notes: normalizeOptionalText(input.comment),
        subtotalKgs: subtotal,
        totalKgs: subtotal,
        lines: {
          create: lines,
        },
      },
      select: {
        id: true,
        number: true,
        storeId: true,
      },
    });

    return order;
  });

  eventBus.publish({
    type: "customerOrder.created",
    payload: {
      customerOrderId: result.id,
      storeId: result.storeId,
      source: CustomerOrderSource.CATALOG,
    },
  });

  return result;
};
