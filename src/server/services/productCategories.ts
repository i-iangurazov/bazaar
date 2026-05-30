import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";

export const normalizeProductCategoryName = (value?: string | null) => {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized : null;
};

export const normalizeProductCategoryKey = (value?: string | null) => {
  const normalized = normalizeProductCategoryName(value);
  return normalized ? normalized.toLocaleLowerCase("ru-RU") : null;
};

export const normalizeProductCategoryNames = (values?: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const categories: string[] = [];
  for (const value of values ?? []) {
    const normalized = normalizeProductCategoryName(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    categories.push(normalized);
  }
  return categories;
};

export const resolvePrimaryProductCategory = (categories: string[]) => categories[0] ?? null;

export const listProductCategoriesFromDb = async (
  db: PrismaClient | Prisma.TransactionClient,
  organizationId: string,
) => {
  const [savedCategories, productCategories, templateCategories] = await Promise.all([
    db.productCategory.findMany({
      where: { organizationId },
      select: { name: true },
      orderBy: { name: "asc" },
    }),
    db.product.findMany({
      where: { organizationId },
      select: { category: true, categories: true },
    }),
    db.categoryAttributeTemplate.findMany({
      where: { organizationId },
      select: { category: true },
      distinct: ["category"],
    }),
  ]);

  const categories = new Set<string>();
  savedCategories.forEach((item) => {
    const normalized = normalizeProductCategoryName(item.name);
    if (normalized) {
      categories.add(normalized);
    }
  });
  productCategories.forEach((item) => {
    const normalized = normalizeProductCategoryName(item.category);
    if (normalized) {
      categories.add(normalized);
    }
    for (const value of normalizeProductCategoryNames(item.categories)) {
      categories.add(value);
    }
  });
  templateCategories.forEach((item) => {
    const normalized = normalizeProductCategoryName(item.category);
    if (normalized) {
      categories.add(normalized);
    }
  });

  return Array.from(categories).sort((a, b) => a.localeCompare(b));
};

export const listProductCategories = async (organizationId: string) =>
  listProductCategoriesFromDb(prisma, organizationId);

export type StoreProductCategoryOption = {
  name: string;
  normalizedName: string;
  productCount: number;
  isVisibleInForms: boolean;
  isArchived: boolean;
};

type CategoryAccumulatorValue = StoreProductCategoryOption;

const addCategoryToAccumulator = (
  categories: Map<string, CategoryAccumulatorValue>,
  rawName?: string | null,
  options?: {
    productCount?: number;
  },
) => {
  const name = normalizeProductCategoryName(rawName);
  const normalizedName = normalizeProductCategoryKey(rawName);
  if (!name || !normalizedName) {
    return;
  }

  const current = categories.get(normalizedName);
  if (!current) {
    categories.set(normalizedName, {
      name,
      normalizedName,
      productCount: options?.productCount ?? 0,
      isVisibleInForms: true,
      isArchived: false,
    });
    return;
  }

  current.productCount += options?.productCount ?? 0;
};

export const listStoreProductCategoriesFromDb = async (
  db: PrismaClient | Prisma.TransactionClient,
  input: {
    organizationId: string;
    storeId: string;
    includeHidden?: boolean;
  },
) => {
  const store = await db.store.findFirst({
    where: { id: input.storeId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!store) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }

  const [products, preferences] = await Promise.all([
    db.product.findMany({
      where: {
        organizationId: input.organizationId,
        isDeleted: false,
        storeProducts: {
          some: {
            storeId: input.storeId,
            isActive: true,
          },
        },
      },
      select: { category: true, categories: true },
    }),
    db.storeCategoryPreference.findMany({
      where: { organizationId: input.organizationId, storeId: input.storeId },
      select: {
        name: true,
        normalizedName: true,
        isVisibleInForms: true,
        isArchived: true,
      },
    }),
  ]);

  const categories = new Map<string, CategoryAccumulatorValue>();

  products.forEach((product) => {
    const uniqueProductCategoryKeys = new Set<string>();
    normalizeProductCategoryNames([product.category, ...product.categories]).forEach((name) => {
      const key = normalizeProductCategoryKey(name);
      if (!key || uniqueProductCategoryKeys.has(key)) {
        return;
      }
      uniqueProductCategoryKeys.add(key);
      addCategoryToAccumulator(categories, name, { productCount: 1 });
    });
  });

  preferences.forEach((preference) => {
    addCategoryToAccumulator(categories, preference.name);
    const category = categories.get(preference.normalizedName);
    if (!category) {
      return;
    }
    category.name = preference.name;
    category.isVisibleInForms = preference.isVisibleInForms;
    category.isArchived = preference.isArchived;
  });

  return Array.from(categories.values())
    .filter((category) =>
      input.includeHidden ? true : category.isVisibleInForms && !category.isArchived,
    )
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const listStoreProductCategories = async (input: {
  organizationId: string;
  storeId: string;
  includeHidden?: boolean;
}) => listStoreProductCategoriesFromDb(prisma, input);

export const ensureProductCategory = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    name?: string | null;
  },
) => {
  const normalized = normalizeProductCategoryName(input.name);
  if (!normalized) {
    return null;
  }

  await tx.productCategory.upsert({
    where: {
      organizationId_name: {
        organizationId: input.organizationId,
        name: normalized,
      },
    },
    update: {},
    create: {
      organizationId: input.organizationId,
      name: normalized,
    },
  });

  return normalized;
};

export const createProductCategory = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  name: string;
  storeId?: string | null;
}) =>
  prisma.$transaction(async (tx) => {
    const normalized = normalizeProductCategoryName(input.name);
    const normalizedName = normalizeProductCategoryKey(input.name);
    if (!normalized) {
      throw new AppError("invalidInput", "BAD_REQUEST", 400);
    }
    if (input.storeId && !normalizedName) {
      throw new AppError("invalidInput", "BAD_REQUEST", 400);
    }

    if (input.storeId) {
      const store = await tx.store.findFirst({
        where: { id: input.storeId, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!store) {
        throw new AppError("storeNotFound", "NOT_FOUND", 404);
      }
    }

    const existing = await tx.productCategory.findUnique({
      where: {
        organizationId_name: {
          organizationId: input.organizationId,
          name: normalized,
        },
      },
    });

    if (existing && !input.storeId) {
      throw new AppError("categoryNameExists", "CONFLICT", 409);
    }

    const category =
      existing ??
      (await tx.productCategory.create({
        data: {
          organizationId: input.organizationId,
          name: normalized,
        },
      }));

    if (!existing) {
      await writeAuditLog(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "PRODUCT_CATEGORY_CREATE",
        entity: "ProductCategory",
        entityId: category.id,
        before: null,
        after: toJson(category),
        requestId: input.requestId,
      });
    }

    if (input.storeId && normalizedName) {
      const before = await tx.storeCategoryPreference.findUnique({
        where: {
          storeId_normalizedName: {
            storeId: input.storeId,
            normalizedName,
          },
        },
      });

      const preference = await tx.storeCategoryPreference.upsert({
        where: {
          storeId_normalizedName: {
            storeId: input.storeId,
            normalizedName,
          },
        },
        update: {
          name: normalized,
          isVisibleInForms: true,
          isArchived: false,
        },
        create: {
          organizationId: input.organizationId,
          storeId: input.storeId,
          name: normalized,
          normalizedName,
          isVisibleInForms: true,
          isArchived: false,
        },
      });

      await writeAuditLog(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "STORE_CATEGORY_PREFERENCE_UPDATE",
        entity: "StoreCategoryPreference",
        entityId: preference.id,
        before: before ? toJson(before) : null,
        after: toJson(preference),
        requestId: input.requestId,
      });
    }

    return category;
  });

export const updateStoreProductCategoryPreference = async (input: {
  organizationId: string;
  storeId: string;
  actorId: string;
  requestId: string;
  name: string;
  isVisibleInForms?: boolean;
  isArchived?: boolean;
}) =>
  prisma.$transaction(async (tx) => {
    const name = normalizeProductCategoryName(input.name);
    const normalizedName = normalizeProductCategoryKey(input.name);
    if (!name || !normalizedName) {
      throw new AppError("invalidInput", "BAD_REQUEST", 400);
    }

    const store = await tx.store.findFirst({
      where: { id: input.storeId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!store) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }

    const before = await tx.storeCategoryPreference.findUnique({
      where: {
        storeId_normalizedName: {
          storeId: input.storeId,
          normalizedName,
        },
      },
    });

    const nextArchived = input.isArchived ?? before?.isArchived ?? false;
    const nextVisible = nextArchived
      ? false
      : (input.isVisibleInForms ?? before?.isVisibleInForms ?? true);

    const preference = await tx.storeCategoryPreference.upsert({
      where: {
        storeId_normalizedName: {
          storeId: input.storeId,
          normalizedName,
        },
      },
      update: {
        name,
        isVisibleInForms: nextVisible,
        isArchived: nextArchived,
      },
      create: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        name,
        normalizedName,
        isVisibleInForms: nextVisible,
        isArchived: nextArchived,
      },
    });

    await ensureProductCategory(tx, {
      organizationId: input.organizationId,
      name,
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "STORE_CATEGORY_PREFERENCE_UPDATE",
      entity: "StoreCategoryPreference",
      entityId: preference.id,
      before: before ? toJson(before) : null,
      after: toJson(preference),
      requestId: input.requestId,
    });

    return preference;
  });

export const removeProductCategory = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  name: string;
}) =>
  prisma.$transaction(async (tx) => {
    const normalized = normalizeProductCategoryName(input.name);
    if (!normalized) {
      throw new AppError("invalidInput", "BAD_REQUEST", 400);
    }

    const category = await tx.productCategory.findUnique({
      where: {
        organizationId_name: {
          organizationId: input.organizationId,
          name: normalized,
        },
      },
    });

    if (!category) {
      throw new AppError("categoryNotFound", "NOT_FOUND", 404);
    }

    const [productUsageCount, templateUsageCount] = await Promise.all([
      tx.product.count({
        where: {
          organizationId: input.organizationId,
          OR: [{ category: normalized }, { categories: { has: normalized } }],
        },
      }),
      tx.categoryAttributeTemplate.count({
        where: {
          organizationId: input.organizationId,
          category: normalized,
        },
      }),
    ]);

    if (productUsageCount > 0 || templateUsageCount > 0) {
      throw new AppError("categoryInUse", "CONFLICT", 409);
    }

    await tx.productCategory.delete({ where: { id: category.id } });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PRODUCT_CATEGORY_REMOVE",
      entity: "ProductCategory",
      entityId: category.id,
      before: toJson(category),
      after: null,
      requestId: input.requestId,
    });

    return category;
  });
