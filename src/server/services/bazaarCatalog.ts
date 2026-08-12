import { randomBytes } from "node:crypto";
import {
  Prisma,
  BazaarCatalogFontFamily,
  BazaarCatalogHeaderStyle,
  BazaarCatalogStatus,
  CustomerOrderSource,
  CustomerOrderStatus,
  OperationRequestPrincipalType,
} from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { getLogger } from "@/server/logging";
import { AppError } from "@/server/services/errors";
import { normalizeOptionalCustomerPhone } from "@/server/services/customerContact";
import { writeAuditLog } from "@/server/services/audit";
import { upsertCustomerFromOrderTx } from "@/server/services/customers";
import { toJson } from "@/server/services/json";
import {
  OPERATION_FAILURE_AMBIGUOUS,
  OPERATION_FAILURE_SAFE_BEFORE_EFFECTS,
  runOperationRequest,
  type OperationFailureDecision,
} from "@/server/services/operationRequests";
import {
  orderConfirmationEmailOperationKey,
  queueOrderConfirmationEmailTx,
  queueOwnerOrderNotificationTx,
} from "@/server/services/orderEmailOutbox";
import { sendOrderConfirmationEmail } from "@/server/services/orderEmails";
import { getRedisPublisher } from "@/server/redis";
import { eventBus } from "@/server/events/eventBus";
import { normalizeProductImageUrl } from "@/server/services/productImageStorage";
import {
  convertFromKgs,
  normalizeCurrencyCode,
  normalizeCurrencyRateKgsPerUnit,
  roundUpToCurrencyTens,
  type SupportedCurrencyCode,
} from "@/lib/currency";
import { resolveCurrencySnapshot } from "@/lib/currencyDisplay";
import { getEffectiveProductPrice } from "@/server/services/effectiveProductPrice";

const DEFAULT_ACCENT_COLOR = "#2a6be4";
const DEFAULT_FONT_FAMILY = BazaarCatalogFontFamily.NotoSans;
const DEFAULT_HEADER_STYLE = BazaarCatalogHeaderStyle.STANDARD;
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
    select: {
      id: true,
      name: true,
      organizationId: true,
      currencyCode: true,
      currencyRateKgsPerUnit: true,
    },
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

const cacheKeyBySlug = (slug: string) => `bazaar-catalog:public:v3:${slug}`;

const cacheDel = async (key: string) => {
  try {
    const redis = getRedisPublisher();
    if (!redis) {
      return;
    }
    await redis.del(key);
  } catch {
    // Cache invalidation is best-effort when Redis is unavailable.
  }
};

const toMoney = (value: Prisma.Decimal | number | null | undefined) =>
  typeof value === "number" ? value : value ? Number(value) : 0;
const roundMoney = (value: number) => Math.round(value * 100) / 100;
const variantKeyFrom = (variantId?: string | null) => variantId ?? "BASE";
const normalizeSearch = (value?: string | null) => value?.trim() ?? "";
const roundCatalogPrice = (
  valueKgs: number,
  currencyCode: SupportedCurrencyCode,
  currencyRateKgsPerUnit: number,
) => roundUpToCurrencyTens(convertFromKgs(valueKgs, currencyRateKgsPerUnit, currencyCode));

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

export const listBazaarCatalogStores = async (organizationId: string, storeIds?: string[]) => {
  const [stores, catalogs] = await Promise.all([
    prisma.store.findMany({
      where: {
        organizationId,
        ...(storeIds
          ? { id: { in: storeIds.length ? storeIds : ["__no_accessible_store__"] } }
          : {}),
      },
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

const ensureProductAccess = async (
  organizationId: string,
  storeId: string,
  productIds: string[],
) => {
  const uniqueIds = Array.from(new Set(productIds.map((id) => id.trim()).filter(Boolean)));
  if (!uniqueIds.length) {
    return [];
  }

  const products = await prisma.product.findMany({
    where: {
      organizationId,
      id: { in: uniqueIds },
      isDeleted: false,
      storeProducts: { some: { storeId, isActive: true } },
    },
    select: { id: true },
  });

  if (products.length !== uniqueIds.length) {
    throw new AppError("productNotFound", "NOT_FOUND", 404);
  }

  return uniqueIds;
};

export const invalidateBazaarCatalogCacheForStore = async (
  organizationId: string,
  storeId: string,
) => {
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
  const store = await ensureStoreAccess(input.organizationId, input.storeId);
  const currencyCode = normalizeCurrencyCode(store.currencyCode);
  const currencyRateKgsPerUnit = normalizeCurrencyRateKgsPerUnit(
    Number(store.currencyRateKgsPerUnit),
    currencyCode,
  );

  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(10, Math.max(1, Math.trunc(input.pageSize ?? 10)));
  const search = normalizeSearch(input.search);
  const visibility = input.visibility ?? "all";

  const baseWhere: Prisma.ProductWhereInput = {
    organizationId: input.organizationId,
    isDeleted: false,
    storeProducts: { some: { storeId: input.storeId, isActive: true } },
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
      priceKgs: roundCatalogPrice(
        storePriceByProductId.get(product.id) ?? toMoney(product.basePriceKgs),
        currencyCode,
        currencyRateKgsPerUnit,
      ),
      imageUrl: resolveProductListImageUrl(product),
      onHandQty: onHandByProductId.get(product.id) ?? 0,
      hidden: product.hiddenInBazaarCatalogs.length > 0,
    })),
    total,
    page,
    pageSize,
    currencyCode,
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
  const productIds = await ensureProductAccess(
    input.organizationId,
    input.storeId,
    input.productIds,
  );
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

  await invalidateBazaarCatalogCacheForStore(input.organizationId, input.storeId);

  return {
    updatedCount: productIds.length,
  };
};

export const upsertBazaarCatalogSettings = async (input: {
  organizationId: string;
  storeId: string;
  actorId: string;
  requestId: string;
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
        storeId: true,
        slug: true,
        status: true,
        title: true,
        accentColor: true,
        fontFamily: true,
        headerStyle: true,
        logoImageId: true,
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

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: existing ? "BAZAAR_CATALOG_SETTINGS_UPDATED" : "BAZAAR_CATALOG_SETTINGS_CREATED",
      entity: "BazaarCatalog",
      entityId: catalog.id,
      before: existing
        ? toJson({
            storeId: existing.storeId,
            status: existing.status,
            title: existing.title,
            accentColor: existing.accentColor,
            fontFamily: existing.fontFamily,
            headerStyle: existing.headerStyle,
            logoImageId: existing.logoImageId,
            publishedAt: existing.publishedAt,
          })
        : null,
      after: toJson({
        storeId: catalog.storeId,
        status: catalog.status,
        title: catalog.title,
        accentColor: catalog.accentColor,
        fontFamily: catalog.fontFamily,
        headerStyle: catalog.headerStyle,
        logoImageId: catalog.logoImageId,
        publishedAt: catalog.publishedAt,
      }),
      requestId: input.requestId,
    });

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
  actorId: string;
  requestId: string;
  imageUrl: string;
}) => {
  const url = input.imageUrl.trim();
  if (!url) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }

  return prisma.$transaction(async (tx) => {
    const store = await tx.store.findFirst({
      where: {
        id: input.storeId,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });
    if (!store) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }

    const image = await tx.bazaarCatalogImage.create({
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

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "BAZAAR_CATALOG_LOGO_CREATED",
      entity: "BazaarCatalogImage",
      entityId: image.id,
      before: null,
      after: toJson({
        storeId: store.id,
        imageId: image.id,
      }),
      requestId: input.requestId,
    });

    return image;
  });
};

type PublicCatalogPayload = {
  slug: string;
  storeId: string;
  title: string;
  storeName: string;
  currencyCode: SupportedCurrencyCode;
  accentColor: string;
  fontFamily: BazaarCatalogFontFamily;
  headerStyle: BazaarCatalogHeaderStyle;
  logoUrl: string | null;
  categories: Array<{ key: string; name: string | null; count: number }>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
  products: Array<{
    id: string;
    name: string;
    category: string | null;
    priceKgs: number;
    quotedUnitPriceKgs: number;
    compareAtPriceKgs: number | null;
    hasDiscount: boolean;
    discountPercentage: number | null;
    imageUrl: string | null;
    isBundle: boolean;
    variants: Array<{
      id: string;
      name: string;
      priceKgs: number;
      quotedUnitPriceKgs: number;
      compareAtPriceKgs: number | null;
      hasDiscount: boolean;
      discountPercentage: number | null;
      imageUrl: string | null;
    }>;
  }>;
};

export const getPublicBazaarCatalog = async (
  slug: string,
  options: {
    page?: number;
    pageSize?: number;
    search?: string;
    category?: string;
    productIds?: string[];
  } = {},
): Promise<PublicCatalogPayload | null> => {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug || normalizedSlug.length < 8) {
    return null;
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
          currencyCode: true,
          currencyRateKgsPerUnit: true,
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

  const productIds = Array.from(
    new Set((options.productIds ?? []).map((value) => value.trim()).filter(Boolean)),
  ).slice(0, 100);
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const requestedPageSize = Math.max(1, Math.trunc(options.pageSize ?? 24));
  const pageSize = productIds.length
    ? Math.min(100, Math.max(requestedPageSize, productIds.length))
    : Math.min(60, requestedPageSize);
  const search = normalizeOptionalText(options.search)?.slice(0, 200) ?? null;
  const category = normalizeOptionalText(options.category)?.slice(0, 200) ?? null;
  const baseWhere: Prisma.ProductWhereInput = {
    organizationId: catalog.organizationId,
    isDeleted: false,
    hiddenInBazaarCatalogs: {
      none: { storeId: catalog.storeId },
    },
    storeProducts: { some: { storeId: catalog.storeId, isActive: true } },
  };
  const filters: Prisma.ProductWhereInput[] = [
    ...(search ? [{ name: { contains: search, mode: Prisma.QueryMode.insensitive } }] : []),
    ...(category === "__uncategorized"
      ? [{ OR: [{ category: null }, { category: "" }] }]
      : category
        ? [{ category: { equals: category, mode: Prisma.QueryMode.insensitive } }]
        : []),
    ...(productIds.length ? [{ id: { in: productIds } }] : []),
  ];
  const where: Prisma.ProductWhereInput = {
    ...baseWhere,
    ...(filters.length ? { AND: filters } : {}),
  };

  const [total, products, categoryRows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
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
            image: {
              select: { url: true },
            },
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
      orderBy: [{ category: "asc" }, { name: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.product.groupBy({
      by: ["category"],
      where: baseWhere,
      _count: { _all: true },
      orderBy: { category: "asc" },
    }),
  ]);

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
          discountType: true,
          discountPercentage: true,
          discountStartsAt: true,
          discountEndsAt: true,
        },
      })
    : [];

  const basePriceByProductId = new Map(
    storePrices
      .filter((price) => price.variantKey === "BASE")
      .map((price) => [price.productId, price]),
  );
  const priceByProductVariantKey = new Map(
    storePrices.map((price) => [`${price.productId}:${price.variantKey || "BASE"}`, price]),
  );

  const currencyCode = normalizeCurrencyCode(catalog.store.currencyCode);
  const currencyRateKgsPerUnit = normalizeCurrencyRateKgsPerUnit(
    Number(catalog.store.currencyRateKgsPerUnit),
    currencyCode,
  );

  const categoryMap = new Map<string, { key: string; name: string | null; count: number }>();
  for (const row of categoryRows) {
    const categoryName = row.category?.trim() || null;
    const categoryKey = categoryName ? categoryName.toLowerCase() : "__uncategorized";
    const existing = categoryMap.get(categoryKey);
    if (existing) {
      existing.count += row._count._all;
    } else {
      categoryMap.set(categoryKey, {
        key: categoryKey,
        name: categoryName,
        count: row._count._all,
      });
    }
  }
  const pricingNow = new Date();
  const payloadProducts = products.map((product) => {
    const categoryName = product.category?.trim() || null;

    const baseRow = basePriceByProductId.get(product.id);
    const basePricing = getEffectiveProductPrice({
      basePrice: baseRow?.priceKgs ?? product.basePriceKgs ?? 0,
      discount:
        baseRow?.discountType === "PERCENTAGE" && baseRow.discountPercentage
          ? {
              type: "PERCENTAGE",
              percentage: baseRow.discountPercentage,
              startsAt: baseRow.discountStartsAt,
              endsAt: baseRow.discountEndsAt,
            }
          : null,
      now: pricingNow,
      currency: "KGS",
    });
    const imageUrl = resolveProductListImageUrl(product);
    const variants = product.variants.map((variant) => {
      const variantRow = priceByProductVariantKey.get(`${product.id}:${variant.id}`) ?? baseRow;
      const variantPricing = getEffectiveProductPrice({
        basePrice: variantRow?.priceKgs ?? product.basePriceKgs ?? 0,
        discount:
          variantRow?.discountType === "PERCENTAGE" && variantRow.discountPercentage
            ? {
                type: "PERCENTAGE",
                percentage: variantRow.discountPercentage,
                startsAt: variantRow.discountStartsAt,
                endsAt: variantRow.discountEndsAt,
              }
            : null,
        now: pricingNow,
        currency: "KGS",
      });
      return {
        id: variant.id,
        name: normalizeOptionalText(variant.name) ?? variant.id.slice(0, 8),
        priceKgs: roundCatalogPrice(
          variantPricing.effectivePrice.toNumber(),
          currencyCode,
          currencyRateKgsPerUnit,
        ),
        quotedUnitPriceKgs: roundMoney(variantPricing.effectivePrice.toNumber()),
        compareAtPriceKgs: variantPricing.compareAtPrice
          ? roundCatalogPrice(
              variantPricing.compareAtPrice.toNumber(),
              currencyCode,
              currencyRateKgsPerUnit,
            )
          : null,
        hasDiscount: variantPricing.hasActiveDiscount,
        discountPercentage: variantPricing.discountPercentage?.toNumber() ?? null,
        imageUrl: sanitizeImageUrl(variant.image?.url),
      };
    });

    return {
      id: product.id,
      name: product.name,
      category: categoryName,
      priceKgs: roundCatalogPrice(
        basePricing.effectivePrice.toNumber(),
        currencyCode,
        currencyRateKgsPerUnit,
      ),
      quotedUnitPriceKgs: roundMoney(basePricing.effectivePrice.toNumber()),
      compareAtPriceKgs: basePricing.compareAtPrice
        ? roundCatalogPrice(
            basePricing.compareAtPrice.toNumber(),
            currencyCode,
            currencyRateKgsPerUnit,
          )
        : null,
      hasDiscount: basePricing.hasActiveDiscount,
      discountPercentage: basePricing.discountPercentage?.toNumber() ?? null,
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
    currencyCode,
    accentColor: normalizeAccentColor(catalog.accentColor),
    fontFamily: catalog.fontFamily,
    headerStyle: catalog.headerStyle,
    logoUrl: sanitizeImageUrl(catalog.logoImage?.url),
    categories: Array.from(categoryMap.values()).sort((left, right) =>
      (left.name ?? "").localeCompare(right.name ?? "", "ru"),
    ),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasMore: page * pageSize < total,
    },
    products: payloadProducts,
  };

  return payload;
};

export type CatalogCheckoutLineInput = {
  productId: string;
  variantId?: string | null;
  qty: number;
  quotedUnitPriceKgs: number;
};

export type CreateCatalogCheckoutOrderInput = {
  slug: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  comment?: string | null;
  lines: CatalogCheckoutLineInput[];
};

type NormalizedCatalogCheckoutLine = {
  productId: string;
  variantId: string | null;
  variantKey: string;
  qty: number;
  quotedUnitPriceKgs: number;
};

const normalizeCatalogCheckoutLines = (
  lines: CatalogCheckoutLineInput[],
): NormalizedCatalogCheckoutLine[] => {
  const normalized = lines.reduce((map, line) => {
    const productId = line.productId.trim();
    const variantId = normalizeOptionalText(line.variantId);
    const variantKey = variantKeyFrom(variantId);
    const qty = Math.trunc(line.qty);
    const quotedUnitPriceKgs = roundMoney(line.quotedUnitPriceKgs);
    if (!productId || !Number.isFinite(qty) || qty < 1) {
      throw new AppError("invalidQuantity", "BAD_REQUEST", 400);
    }
    if (!Number.isFinite(line.quotedUnitPriceKgs) || quotedUnitPriceKgs < 0) {
      throw new AppError("invalidInput", "BAD_REQUEST", 400);
    }
    const key = `${productId}:${variantKey}`;
    const existing = map.get(key);
    if (existing) {
      if (existing.quotedUnitPriceKgs !== quotedUnitPriceKgs) {
        throw new AppError("catalogPriceChanged", "CONFLICT", 409);
      }
      existing.qty += qty;
    } else {
      map.set(key, {
        productId,
        variantId,
        variantKey,
        qty,
        quotedUnitPriceKgs,
      });
    }
    return map;
  }, new Map<string, NormalizedCatalogCheckoutLine>());

  return Array.from(normalized.values()).sort((left, right) =>
    `${left.productId}:${left.variantKey}`.localeCompare(`${right.productId}:${right.variantKey}`),
  );
};

export type TrustedCatalogCheckoutScope = {
  catalogId: string;
  organizationId: string;
  storeId: string;
};

const createCatalogCheckoutOrderTx = async (
  tx: Prisma.TransactionClient,
  input: CreateCatalogCheckoutOrderInput,
  expectedScope?: TrustedCatalogCheckoutScope,
) => {
  const slug = input.slug.trim().toLowerCase();
  if (!slug) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }

  const normalizedLines = normalizeCatalogCheckoutLines(input.lines);

  if (!normalizedLines.length) {
    throw new AppError("salesOrderEmpty", "BAD_REQUEST", 400);
  }

  const customerName = input.customerName.trim();
  const customerEmail = input.customerEmail.trim();
  const customerPhone = normalizeOptionalCustomerPhone(input.customerPhone);
  if (!customerName || !customerEmail || !customerPhone) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }

  const catalog = await tx.bazaarCatalog.findUnique({
    where: { slug },
    select: {
      id: true,
      organizationId: true,
      storeId: true,
      status: true,
      store: {
        select: {
          currencyCode: true,
          currencyRateKgsPerUnit: true,
        },
      },
    },
  });
  if (!catalog || catalog.status !== BazaarCatalogStatus.PUBLISHED) {
    throw new AppError("catalogNotFound", "NOT_FOUND", 404);
  }
  if (
    expectedScope &&
    (catalog.id !== expectedScope.catalogId ||
      catalog.organizationId !== expectedScope.organizationId ||
      catalog.storeId !== expectedScope.storeId)
  ) {
    throw new AppError("catalogScopeChanged", "CONFLICT", 409);
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
        storeProducts: { some: { storeId: catalog.storeId, isActive: true } },
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
        discountType: true,
        discountPercentage: true,
        discountStartsAt: true,
        discountEndsAt: true,
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
      storePrice,
    ]),
  );
  const productCostByProductVariantKey = new Map(
    productCosts.map((productCost) => [
      `${productCost.productId}:${productCost.variantKey}`,
      Number(productCost.avgCostKgs),
    ]),
  );

  const pricedAt = new Date();
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

    const storePrice =
      storePriceByProductVariantKey.get(`${line.productId}:${line.variantKey}`) ??
      storePriceByProductVariantKey.get(`${line.productId}:BASE`);
    const effective = getEffectiveProductPrice({
      basePrice: storePrice?.priceKgs ?? product.basePriceKgs ?? 0,
      discount:
        storePrice?.discountType === "PERCENTAGE" && storePrice.discountPercentage
          ? {
              type: "PERCENTAGE",
              percentage: storePrice.discountPercentage,
              startsAt: storePrice.discountStartsAt,
              endsAt: storePrice.discountEndsAt,
            }
          : null,
      now: pricedAt,
      currency: "KGS",
    });
    const basePrice = effective.basePrice.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const unitPrice = effective.effectivePrice;
    const currentUnitPriceKgs = roundMoney(unitPrice.toNumber());
    if (line.quotedUnitPriceKgs !== currentUnitPriceKgs) {
      throw new AppError("catalogPriceChanged", "CONFLICT", 409);
    }
    const lineTotal = unitPrice.mul(line.qty).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
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
      baseUnitPriceKgs: basePrice,
      appliedDiscountType: effective.hasActiveDiscount ? ("PERCENTAGE" as const) : null,
      appliedDiscountPercentage: effective.hasActiveDiscount ? effective.discountPercentage : null,
      appliedDiscountAmountKgs: effective.hasActiveDiscount
        ? basePrice.minus(unitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
        : null,
      unitPriceKgs: unitPrice,
      lineTotalKgs: lineTotal,
      unitCostKgs: unitCost,
      lineCostTotalKgs: lineCostTotal,
    };
  });

  const subtotal = lines
    .reduce((sum, line) => sum.plus(line.lineTotalKgs), new Prisma.Decimal(0))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
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
      customerEmail,
      customerPhone,
      notes: normalizeOptionalText(input.comment),
      subtotalKgs: subtotal,
      totalKgs: subtotal,
      ...resolveCurrencySnapshot(catalog.store),
      lines: {
        create: lines,
      },
    },
    select: {
      id: true,
      number: true,
      organizationId: true,
      storeId: true,
    },
  });

  await upsertCustomerFromOrderTx(tx, {
    organizationId: catalog.organizationId,
    storeId: catalog.storeId,
    customerName,
    customerEmail,
    customerPhone,
  });
  await queueOrderConfirmationEmailTx(tx, {
    organizationId: catalog.organizationId,
    storeId: catalog.storeId,
    customerOrderId: order.id,
    recipientEmail: customerEmail,
  });
  await queueOwnerOrderNotificationTx(tx, {
    organizationId: catalog.organizationId,
    storeId: catalog.storeId,
    customerOrderId: order.id,
  });

  return order;
};

type CatalogCheckoutOrderResult = Awaited<ReturnType<typeof createCatalogCheckoutOrderTx>>;

const dispatchCatalogCheckoutOrderCreated = async (result: CatalogCheckoutOrderResult) => {
  eventBus.publish({
    type: "customerOrder.created",
    payload: {
      customerOrderId: result.id,
      storeId: result.storeId,
      source: CustomerOrderSource.CATALOG,
    },
  });
  const confirmation = sendOrderConfirmationEmail({
    organizationId: result.organizationId,
    customerOrderId: result.id,
    throwOnMissingEmail: false,
    deliveryOperationKey: orderConfirmationEmailOperationKey(result.id),
  }).catch((error: unknown) => {
    getLogger().error(
      { error, customerOrderId: result.id, storeId: result.storeId },
      "catalogue order confirmation email send failed",
    );
  });
  if (process.env.NODE_ENV === "test") await confirmation;
  else void confirmation;
};

const toCatalogCheckoutOrderResponse = (result: CatalogCheckoutOrderResult) => ({
  id: result.id,
  number: result.number,
  storeId: result.storeId,
});

export const createCatalogCheckoutOrder = async (input: CreateCatalogCheckoutOrderInput) => {
  const result = await prisma.$transaction((tx) => createCatalogCheckoutOrderTx(tx, input));
  await dispatchCatalogCheckoutOrderCreated(result);
  return toCatalogCheckoutOrderResponse(result);
};

type CatalogCheckoutOperationResponse = Prisma.InputJsonObject & {
  order: {
    id: string;
    number: string;
  };
};

const classifyCatalogCheckoutOperationFailure = (error: unknown): OperationFailureDecision => {
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

export const createCatalogCheckoutOrderOperationForTrustedScope = async (
  input: CreateCatalogCheckoutOrderInput & { idempotencyKey: string },
  trustedCatalog: TrustedCatalogCheckoutScope,
) => {
  const slug = input.slug.trim().toLowerCase();
  if (!slug) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  const normalizedLines = normalizeCatalogCheckoutLines(input.lines);
  if (!normalizedLines.length) {
    throw new AppError("salesOrderEmpty", "BAD_REQUEST", 400);
  }
  const normalizedInput: CreateCatalogCheckoutOrderInput = {
    ...input,
    slug,
    lines: normalizedLines,
  };

  let createdResult: CatalogCheckoutOrderResult | null = null;
  const operation = await runOperationRequest<CatalogCheckoutOperationResponse>(
    {
      organizationId: trustedCatalog.organizationId,
      storeId: trustedCatalog.storeId,
      scope: "catalog.checkout.create.v1",
      principal: {
        type: OperationRequestPrincipalType.ANONYMOUS_CATALOG,
        id: trustedCatalog.catalogId,
      },
      idempotencyKey: input.idempotencyKey,
      payload: {
        version: "v2",
        value: {
          slug,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          comment: input.comment ?? null,
          lines: normalizedLines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId ?? null,
            qty: line.qty,
            quotedUnitPriceKgs: line.quotedUnitPriceKgs,
          })),
        },
      },
      allowedResponsePaths: ["order", "order.id", "order.number"],
      classifyFailure: classifyCatalogCheckoutOperationFailure,
    },
    async (tx) => {
      const result = await createCatalogCheckoutOrderTx(tx, normalizedInput, {
        catalogId: trustedCatalog.catalogId,
        organizationId: trustedCatalog.organizationId,
        storeId: trustedCatalog.storeId,
      });
      createdResult = result;
      return {
        response: {
          order: {
            id: result.id,
            number: result.number,
          },
        },
        responseStatus: 200,
        responseCode: "created",
        resource: { type: "CustomerOrder", id: result.id },
      };
    },
  );

  if (createdResult) {
    await dispatchCatalogCheckoutOrderCreated(createdResult);
  }
  return operation;
};

export const createCatalogCheckoutOrderOperation = async (
  input: CreateCatalogCheckoutOrderInput & { idempotencyKey: string },
) => {
  const slug = input.slug.trim().toLowerCase();
  if (!slug) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  const trustedCatalog = await prisma.bazaarCatalog.findUnique({
    where: { slug },
    select: { id: true, organizationId: true, storeId: true },
  });
  if (!trustedCatalog) {
    throw new AppError("catalogNotFound", "NOT_FOUND", 404);
  }

  return createCatalogCheckoutOrderOperationForTrustedScope(input, {
    catalogId: trustedCatalog.id,
    organizationId: trustedCatalog.organizationId,
    storeId: trustedCatalog.storeId,
  });
};
