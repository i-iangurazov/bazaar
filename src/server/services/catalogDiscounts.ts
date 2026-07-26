import { randomUUID } from "node:crypto";

import {
  CatalogDiscountType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import type {
  ApplyCatalogDiscountInput,
  CatalogDiscountOperationResult,
  PreviewCatalogDiscountInput,
  RemoveCatalogDiscountInput,
} from "@/lib/catalogDiscountContract";
import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { invalidateBazaarCatalogCacheForStore } from "@/server/services/bazaarCatalog";
import { invalidateBazaarApiProductsCacheForStore } from "@/server/services/bazaarApi";
import {
  previewCatalogDiscountApply,
  previewCatalogDiscountRemove,
  type CatalogDiscountPreviewProduct,
  type CatalogDiscountPreviewStorePrice,
} from "@/server/services/catalogDiscountPreview";
import { planCatalogDiscountTargets } from "@/server/services/catalogDiscountPlanning";
import { AppError } from "@/server/services/errors";
import { withIdempotency } from "@/server/services/idempotency";
import { toJson } from "@/server/services/json";
import {
  assertUserCanAccessStore,
  type StoreAccessUser,
} from "@/server/services/storeAccess";

type DiscountSelection = Pick<
  ApplyCatalogDiscountInput,
  "storeId" | "productIds" | "variantPolicy" | "variantIds"
>;

const uniqueSorted = (values: string[]) => Array.from(new Set(values)).sort();

const discountFromStorePrice = (price: {
  discountType: CatalogDiscountType | null;
  discountPercentage: Prisma.Decimal | null;
  discountStartsAt: Date | null;
  discountEndsAt: Date | null;
}) =>
  price.discountType && price.discountPercentage
    ? {
        type: price.discountType as "PERCENTAGE",
        percentage: price.discountPercentage,
        startsAt: price.discountStartsAt,
        endsAt: price.discountEndsAt,
      }
    : null;

const loadDiscountScope = async (
  client: PrismaClient | Prisma.TransactionClient,
  input: DiscountSelection & { organizationId: string },
) => {
  const productIds = uniqueSorted(input.productIds);
  const store = await client.store.findFirst({
    where: { id: input.storeId, organizationId: input.organizationId },
    select: { id: true, currencyCode: true },
  });
  if (!store) throw new AppError("storeNotFound", "NOT_FOUND", 404);

  const products = await client.product.findMany({
    where: {
      id: { in: productIds },
      organizationId: input.organizationId,
      isDeleted: false,
      storeProducts: { some: { storeId: input.storeId, isActive: true } },
    },
    select: {
      id: true,
      name: true,
      basePriceKgs: true,
      variants: {
        where: { isActive: true },
        select: { id: true, name: true, isActive: true },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { id: "asc" },
  });
  if (products.length !== productIds.length) {
    throw new AppError("catalogDiscountProductScopeMismatch", "NOT_FOUND", 404);
  }
  const prices = await client.storePrice.findMany({
    where: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      productId: { in: productIds },
    },
    orderBy: [{ productId: "asc" }, { variantKey: "asc" }],
  });

  const planningProducts: CatalogDiscountPreviewProduct[] = products.map((product) => ({
    id: product.id,
    name: product.name,
    basePriceKgs: product.basePriceKgs,
    variants: product.variants,
  }));
  const planningPrices: CatalogDiscountPreviewStorePrice[] = prices.map((price) => ({
    productId: price.productId,
    variantId: price.variantId,
    variantKey: price.variantKey,
    priceKgs: price.priceKgs,
    discount: discountFromStorePrice(price),
  }));

  return { store, products: planningProducts, prices, planningPrices };
};

export const previewCatalogDiscount = async (input: {
  user: StoreAccessUser;
  discount: PreviewCatalogDiscountInput;
}) => {
  await assertUserCanAccessStore(prisma, input.user, input.discount.storeId);
  const now = new Date();
  const scope = await loadDiscountScope(prisma, {
    organizationId: input.user.organizationId,
    ...input.discount,
  });
  const shared = {
    products: scope.products,
    storePrices: scope.planningPrices,
    productIds: uniqueSorted(input.discount.productIds),
    variantPolicy: input.discount.variantPolicy,
    variantIds: uniqueSorted(input.discount.variantIds),
    currency: scope.store.currencyCode,
    now,
  };
  return input.discount.action === "APPLY"
    ? previewCatalogDiscountApply({
        ...shared,
        percentage: input.discount.percentage,
        startsAt: input.discount.startsAt,
        endsAt: input.discount.endsAt,
      })
    : previewCatalogDiscountRemove(shared);
};

const mutateCatalogDiscount = async (input: {
  user: StoreAccessUser;
  actorId: string;
  requestId: string;
  action: "APPLY" | "REMOVE";
  discount: ApplyCatalogDiscountInput | RemoveCatalogDiscountInput;
}): Promise<CatalogDiscountOperationResult> => {
  await assertUserCanAccessStore(prisma, input.user, input.discount.storeId);
  const productIds = uniqueSorted(input.discount.productIds);
  const variantIds = uniqueSorted(input.discount.variantIds);
  const operationId = randomUUID();

  const transaction = await prisma.$transaction(
    async (tx) =>
      withIdempotency(
        tx,
        {
          key: input.discount.idempotencyKey,
          route: `catalogDiscounts.${input.action.toLowerCase()}`,
          userId: input.actorId,
        },
        async () => {
          const scope = await loadDiscountScope(tx, {
            organizationId: input.user.organizationId,
            storeId: input.discount.storeId,
            productIds,
            variantPolicy: input.discount.variantPolicy,
            variantIds,
          });
          const plan = planCatalogDiscountTargets({
            products: scope.products,
            storePrices: scope.planningPrices,
            productIds,
            variantPolicy: input.discount.variantPolicy,
            variantIds,
          });
          if (plan.missingTargets.length) {
            throw new AppError("catalogDiscountMissingPrices", "BAD_REQUEST", 400);
          }

          let affectedPriceRowCount = 0;
          const affectedProductIds = new Set<string>();
          if (input.action === "APPLY") {
            const apply = input.discount as ApplyCatalogDiscountInput;
            const percentage = new Prisma.Decimal(apply.percentage);
            if (!percentage.isFinite() || percentage.lte(0) || percentage.gte(100)) {
              throw new AppError("invalidDiscountPercentage", "BAD_REQUEST", 400);
            }
            if (apply.endsAt && apply.endsAt.getTime() <= Date.now()) {
              throw new AppError("catalogDiscountScheduleExpired", "BAD_REQUEST", 400);
            }
            for (const target of plan.targets) {
              await tx.storePrice.upsert({
                where: {
                  organizationId_storeId_productId_variantKey: {
                    organizationId: input.user.organizationId,
                    storeId: input.discount.storeId,
                    productId: target.productId,
                    variantKey: target.variantKey,
                  },
                },
                update: {
                  discountType: CatalogDiscountType.PERCENTAGE,
                  discountPercentage: percentage,
                  discountStartsAt: apply.startsAt,
                  discountEndsAt: apply.endsAt,
                  discountCreatedById: input.actorId,
                  discountUpdatedAt: new Date(),
                  updatedById: input.actorId,
                },
                create: {
                  organizationId: input.user.organizationId,
                  storeId: input.discount.storeId,
                  productId: target.productId,
                  variantId: target.variantId,
                  variantKey: target.variantKey,
                  priceKgs: target.basePriceKgs,
                  discountType: CatalogDiscountType.PERCENTAGE,
                  discountPercentage: percentage,
                  discountStartsAt: apply.startsAt,
                  discountEndsAt: apply.endsAt,
                  discountCreatedById: input.actorId,
                  discountUpdatedAt: new Date(),
                  updatedById: input.actorId,
                },
              });
              affectedPriceRowCount += 1;
              affectedProductIds.add(target.productId);
            }
          } else {
            for (const target of plan.targets) {
              const result = await tx.storePrice.updateMany({
                where: {
                  organizationId: input.user.organizationId,
                  storeId: input.discount.storeId,
                  productId: target.productId,
                  variantKey: target.variantKey,
                  discountType: { not: null },
                },
                data: {
                  discountType: null,
                  discountPercentage: null,
                  discountStartsAt: null,
                  discountEndsAt: null,
                  discountCreatedById: null,
                  discountUpdatedAt: new Date(),
                  updatedById: input.actorId,
                },
              });
              affectedPriceRowCount += result.count;
              if (result.count) affectedProductIds.add(target.productId);
            }
          }

          const result = {
            operationId,
            status: "COMPLETED" as const,
            selectedProductCount: productIds.length,
            affectedProductCount: affectedProductIds.size,
            affectedPriceRowCount,
            skippedProductIds: plan.productsWithoutPrice,
          };
          await writeAuditLog(tx, {
            organizationId: input.user.organizationId,
            actorId: input.actorId,
            action: input.action === "APPLY" ? "CATALOG_DISCOUNT_APPLY" : "CATALOG_DISCOUNT_REMOVE",
            entity: "StorePrice",
            entityId: input.discount.storeId,
            before: null,
            after: toJson({
              ...result,
              productIds,
              variantPolicy: input.discount.variantPolicy,
              variantIds,
              ...(input.action === "APPLY"
                ? {
                    percentage: (input.discount as ApplyCatalogDiscountInput).percentage,
                    startsAt: (input.discount as ApplyCatalogDiscountInput).startsAt,
                    endsAt: (input.discount as ApplyCatalogDiscountInput).endsAt,
                  }
                : {}),
            }),
            requestId: input.requestId,
          });
          return result;
        },
      ),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 60_000 },
  );

  await Promise.all([
    invalidateBazaarCatalogCacheForStore(input.user.organizationId, input.discount.storeId),
    invalidateBazaarApiProductsCacheForStore(input.user.organizationId, input.discount.storeId),
  ]);
  return { ...transaction.result, replayed: transaction.replayed };
};

export const applyCatalogDiscount = (input: {
  user: StoreAccessUser;
  actorId: string;
  requestId: string;
  discount: ApplyCatalogDiscountInput;
}) => mutateCatalogDiscount({ ...input, action: "APPLY" });

export const removeCatalogDiscount = (input: {
  user: StoreAccessUser;
  actorId: string;
  requestId: string;
  discount: RemoveCatalogDiscountInput;
}) => mutateCatalogDiscount({ ...input, action: "REMOVE" });
