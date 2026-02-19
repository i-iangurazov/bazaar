import type { Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";

export const normalizeProductCategoryName = (value?: string | null) => {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized : null;
};

export const listProductCategories = async (organizationId: string) => {
  const [savedCategories, productCategories, templateCategories] = await Promise.all([
    prisma.productCategory.findMany({
      where: { organizationId },
      select: { name: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { organizationId, category: { not: null } },
      select: { category: true },
      distinct: ["category"],
    }),
    prisma.categoryAttributeTemplate.findMany({
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
  });
  templateCategories.forEach((item) => {
    const normalized = normalizeProductCategoryName(item.category);
    if (normalized) {
      categories.add(normalized);
    }
  });

  return Array.from(categories).sort((a, b) => a.localeCompare(b));
};

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
}) =>
  prisma.$transaction(async (tx) => {
    const normalized = normalizeProductCategoryName(input.name);
    if (!normalized) {
      throw new AppError("invalidInput", "BAD_REQUEST", 400);
    }

    const existing = await tx.productCategory.findUnique({
      where: {
        organizationId_name: {
          organizationId: input.organizationId,
          name: normalized,
        },
      },
    });

    if (existing) {
      throw new AppError("categoryNameExists", "CONFLICT", 409);
    }

    const category = await tx.productCategory.create({
      data: {
        organizationId: input.organizationId,
        name: normalized,
      },
    });

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

    return category;
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
          category: normalized,
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
