import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";

const resolveVariantKey = (variantId?: string | null) => variantId ?? "BASE";

export const upsertStorePrice = async (input: {
  storeId: string;
  productId: string;
  variantId?: string | null;
  priceKgs: number;
  actorId: string;
  organizationId: string;
  requestId: string;
}) =>
  prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({ where: { id: input.storeId } });
    if (!store || store.organizationId !== input.organizationId) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product || product.organizationId !== input.organizationId) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }

    if (input.variantId) {
      const variant = await tx.productVariant.findUnique({ where: { id: input.variantId } });
      if (!variant || variant.productId !== input.productId || !variant.isActive) {
        throw new AppError("variantNotFound", "NOT_FOUND", 404);
      }
    }

    const variantKey = resolveVariantKey(input.variantId);
    const before = await tx.storePrice.findUnique({
      where: {
        organizationId_storeId_productId_variantKey: {
          organizationId: input.organizationId,
          storeId: input.storeId,
          productId: input.productId,
          variantKey,
        },
      },
    });

    const price = await tx.storePrice.upsert({
      where: {
        organizationId_storeId_productId_variantKey: {
          organizationId: input.organizationId,
          storeId: input.storeId,
          productId: input.productId,
          variantKey,
        },
      },
      update: {
        priceKgs: input.priceKgs,
        updatedById: input.actorId,
      },
      create: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        productId: input.productId,
        variantId: input.variantId ?? undefined,
        variantKey,
        priceKgs: input.priceKgs,
        updatedById: input.actorId,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "STORE_PRICE_UPDATE",
      entity: "StorePrice",
      entityId: price.id,
      before: before ? toJson(before) : null,
      after: toJson(price),
      requestId: input.requestId,
    });

    return price;
  });

export const bulkUpdateStorePrices = async (input: {
  storeId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
  filter?: {
    search?: string;
    category?: string;
    type?: "all" | "product" | "bundle";
    includeArchived?: boolean;
  };
  mode: "set" | "increasePct" | "increaseAbs";
  value: number;
}) =>
  prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({ where: { id: input.storeId } });
    if (!store || store.organizationId !== input.organizationId) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }

    const products = await tx.product.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.filter?.includeArchived ? {} : { isDeleted: false }),
        ...(input.filter?.search
          ? {
              OR: [
                { name: { contains: input.filter.search, mode: "insensitive" } },
                { sku: { contains: input.filter.search, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(input.filter?.category ? { category: input.filter.category } : {}),
        ...(input.filter?.type === "product"
          ? { isBundle: false }
          : input.filter?.type === "bundle"
            ? { isBundle: true }
            : {}),
      },
      select: { id: true, basePriceKgs: true },
      orderBy: { name: "asc" },
    });

    if (!products.length) {
      return { updated: 0 };
    }

    const existingPrices = await tx.storePrice.findMany({
      where: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        productId: { in: products.map((product) => product.id) },
        variantKey: "BASE",
      },
    });

    const priceMap = new Map(existingPrices.map((price) => [price.productId, price]));
    let updated = 0;

    for (const product of products) {
      const existing = priceMap.get(product.id);
      const basePrice = product.basePriceKgs ? Number(product.basePriceKgs) : 0;
      const current = existing ? Number(existing.priceKgs) : basePrice;
      let next = current;
      if (input.mode === "set") {
        next = input.value;
      } else if (input.mode === "increasePct") {
        next = current * (1 + input.value / 100);
      } else {
        next = current + input.value;
      }
      if (Number.isNaN(next) || !Number.isFinite(next)) {
        continue;
      }
      if (next < 0) {
        next = 0;
      }
      if (existing && Number(existing.priceKgs) === next) {
        continue;
      }

      await tx.storePrice.upsert({
        where: {
          organizationId_storeId_productId_variantKey: {
            organizationId: input.organizationId,
            storeId: input.storeId,
            productId: product.id,
            variantKey: "BASE",
          },
        },
        update: {
          priceKgs: next,
          updatedById: input.actorId,
        },
        create: {
          organizationId: input.organizationId,
          storeId: input.storeId,
          productId: product.id,
          variantKey: "BASE",
          priceKgs: next,
          updatedById: input.actorId,
        },
      });

      updated += 1;
    }

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "STORE_PRICE_BULK_UPDATE",
      entity: "StorePrice",
      entityId: input.storeId,
      before: null,
      after: toJson({ mode: input.mode, value: input.value, updated }),
      requestId: input.requestId,
    });

    return { updated };
  });
