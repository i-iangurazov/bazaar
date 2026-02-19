import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";

export const listCategoryTemplates = async (input: {
  organizationId: string;
  category?: string | null;
}) =>
  prisma.categoryAttributeTemplate.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.category ? { category: input.category } : {}),
      definition: { is: { isActive: true } },
    },
    include: { definition: true },
    orderBy: [{ category: "asc" }, { order: "asc" }],
  });

export const listTemplateCategories = async (organizationId: string) => {
  const [savedCategories, productCategories, templateCategories] = await Promise.all([
    prisma.productCategory.findMany({
      where: { organizationId },
      select: { name: true },
      distinct: ["name"],
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
    if (item.name) {
      categories.add(item.name);
    }
  });
  productCategories.forEach((item) => {
    if (item.category) {
      categories.add(item.category);
    }
  });
  templateCategories.forEach((item) => {
    if (item.category) {
      categories.add(item.category);
    }
  });

  return Array.from(categories).sort((a, b) => a.localeCompare(b));
};

export const setCategoryTemplate = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  category: string;
  attributeKeys: string[];
}) =>
  prisma.$transaction(async (tx) => {
    const category = input.category.trim();
    const uniqueKeys = Array.from(
      new Set(input.attributeKeys.map((key) => key.trim()).filter(Boolean)),
    );

    const before = await tx.categoryAttributeTemplate.findMany({
      where: { organizationId: input.organizationId, category },
      orderBy: { order: "asc" },
    });

    if (uniqueKeys.length) {
      const definitions = await tx.attributeDefinition.findMany({
        where: {
          organizationId: input.organizationId,
          key: { in: uniqueKeys },
          isActive: true,
        },
        select: { key: true },
      });
      if (definitions.length !== uniqueKeys.length) {
        throw new AppError("attributeNotFound", "NOT_FOUND", 404);
      }

      await tx.categoryAttributeTemplate.deleteMany({
        where: {
          organizationId: input.organizationId,
          category,
          attributeKey: { notIn: uniqueKeys },
        },
      });

      await Promise.all(
        uniqueKeys.map((key, index) =>
          tx.categoryAttributeTemplate.upsert({
            where: {
              organizationId_category_attributeKey: {
                organizationId: input.organizationId,
                category,
                attributeKey: key,
              },
            },
            update: { order: index },
            create: {
              organizationId: input.organizationId,
              category,
              attributeKey: key,
              order: index,
            },
          }),
        ),
      );
    } else {
      await tx.categoryAttributeTemplate.deleteMany({
        where: { organizationId: input.organizationId, category },
      });
    }

    const after = await tx.categoryAttributeTemplate.findMany({
      where: { organizationId: input.organizationId, category },
      orderBy: { order: "asc" },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "CATEGORY_TEMPLATE_SET",
      entity: "CategoryAttributeTemplate",
      entityId: category,
      before: toJson(before),
      after: toJson(after),
      requestId: input.requestId,
    });

    return after;
  });

export const removeCategoryTemplate = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  category: string;
}) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.categoryAttributeTemplate.findMany({
      where: { organizationId: input.organizationId, category: input.category },
    });
    await tx.categoryAttributeTemplate.deleteMany({
      where: { organizationId: input.organizationId, category: input.category },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "CATEGORY_TEMPLATE_REMOVE",
      entity: "CategoryAttributeTemplate",
      entityId: input.category,
      before: toJson(before),
      after: null,
      requestId: input.requestId,
    });
  });
