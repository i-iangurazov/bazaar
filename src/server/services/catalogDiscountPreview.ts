import type { Prisma } from "@prisma/client";

import type {
  CatalogDiscountPreview,
  CatalogDiscountVariantPolicy,
} from "@/lib/catalogDiscountContract";
import {
  planCatalogDiscountTargets,
  type CatalogDiscountPlanningProduct,
  type CatalogDiscountPlanningStorePrice,
} from "@/server/services/catalogDiscountPlanning";
import {
  getEffectiveProductPrice,
  type CatalogPercentageDiscount,
} from "@/server/services/effectiveProductPrice";

export type CatalogDiscountPreviewProduct = Omit<CatalogDiscountPlanningProduct, "variants"> & {
  name: string;
  variants: Array<{ id: string; name: string | null; isActive: boolean }>;
};

export type CatalogDiscountPreviewStorePrice = CatalogDiscountPlanningStorePrice & {
  discount?: CatalogPercentageDiscount | null;
};

const targetKey = (productId: string, variantKey: string) => `${productId}:${variantKey}`;

const previewPrice = (value: Prisma.Decimal) => value.toFixed(2);

const validatePreviewSchedule = (input: {
  startsAt?: Date | null;
  endsAt?: Date | null;
  now: Date;
}) => {
  if (input.endsAt && input.endsAt.getTime() <= input.now.getTime()) {
    throw new Error("catalogDiscountScheduleExpired");
  }
  return input.startsAt && input.startsAt > input.now ? input.startsAt : input.now;
};

const planPreviewTargets = (input: {
  products: CatalogDiscountPreviewProduct[];
  storePrices: CatalogDiscountPreviewStorePrice[];
  productIds: string[];
  variantPolicy: CatalogDiscountVariantPolicy;
  variantIds?: string[];
}) =>
  planCatalogDiscountTargets({
    products: input.products,
    storePrices: input.storePrices,
    productIds: input.productIds,
    variantPolicy: input.variantPolicy,
    variantIds: input.variantIds,
  });

const namedTargets = (input: {
  products: CatalogDiscountPreviewProduct[];
  targets: ReturnType<typeof planCatalogDiscountTargets>["targets"];
}) => {
  const productById = new Map(input.products.map((product) => [product.id, product]));
  return input.targets.map((target) => {
    const product = productById.get(target.productId);
    return {
      target,
      productName: product?.name ?? target.productId,
      variantName:
        product?.variants.find((variant) => variant.id === target.variantId)?.name ?? null,
    };
  });
};

export const previewCatalogDiscountApply = (input: {
  products: CatalogDiscountPreviewProduct[];
  storePrices: CatalogDiscountPreviewStorePrice[];
  productIds: string[];
  variantPolicy: CatalogDiscountVariantPolicy;
  variantIds?: string[];
  percentage: Prisma.Decimal | number | string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  currency: string;
  now: Date;
}): CatalogDiscountPreview => {
  const plan = planPreviewTargets(input);
  const storePriceByTarget = new Map(
    input.storePrices.map((price) => [targetKey(price.productId, price.variantKey), price]),
  );
  const discount: CatalogPercentageDiscount = {
    type: "PERCENTAGE",
    percentage: input.percentage,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  };
  const effectiveAt = validatePreviewSchedule(input);
  const samples = namedTargets({ products: input.products, targets: plan.targets })
    .slice(0, 10)
    .map(({ target, productName, variantName }) => {
      const currentDiscount = storePriceByTarget.get(
        targetKey(target.productId, target.variantKey),
      )?.discount;
      const current = getEffectiveProductPrice({
        basePrice: target.basePriceKgs,
        discount: currentDiscount,
        now: input.now,
        currency: input.currency,
      });
      const next = getEffectiveProductPrice({
        basePrice: target.basePriceKgs,
        discount,
        now: effectiveAt,
        currency: input.currency,
      });
      return {
        productId: target.productId,
        productName,
        variantId: target.variantId,
        variantName,
        currency: next.currency,
        basePrice: previewPrice(target.basePriceKgs),
        currentPrice: previewPrice(current.effectivePrice),
        nextPrice: previewPrice(next.effectivePrice),
      };
    });

  return {
    selectedProductCount: plan.selectedProductCount,
    affectedProductCount: plan.affectedProductCount,
    affectedVariantCount: plan.affectedVariantCount,
    affectedPriceRowCount: plan.affectedPriceRowCount,
    productsWithoutPrice: plan.productsWithoutPrice,
    productsWithMissingPrices: plan.productsWithMissingPrices,
    samples,
  };
};

export const previewCatalogDiscountRemove = (input: {
  products: CatalogDiscountPreviewProduct[];
  storePrices: CatalogDiscountPreviewStorePrice[];
  productIds: string[];
  variantPolicy: CatalogDiscountVariantPolicy;
  variantIds?: string[];
  currency: string;
  now: Date;
}): CatalogDiscountPreview => {
  const plan = planPreviewTargets(input);
  const storePriceByTarget = new Map(
    input.storePrices.map((price) => [targetKey(price.productId, price.variantKey), price]),
  );
  const discountedTargets = plan.targets.filter((target) =>
    Boolean(storePriceByTarget.get(targetKey(target.productId, target.variantKey))?.discount),
  );
  const affectedProductIds = new Set(discountedTargets.map((target) => target.productId));
  const samples = namedTargets({ products: input.products, targets: discountedTargets })
    .slice(0, 10)
    .map(({ target, productName, variantName }) => {
      const current = getEffectiveProductPrice({
        basePrice: target.basePriceKgs,
        discount: storePriceByTarget.get(targetKey(target.productId, target.variantKey))?.discount,
        now: input.now,
        currency: input.currency,
      });
      return {
        productId: target.productId,
        productName,
        variantId: target.variantId,
        variantName,
        currency: current.currency,
        basePrice: previewPrice(target.basePriceKgs),
        currentPrice: previewPrice(current.effectivePrice),
        nextPrice: previewPrice(current.basePrice),
      };
    });

  return {
    selectedProductCount: plan.selectedProductCount,
    affectedProductCount: affectedProductIds.size,
    affectedVariantCount: discountedTargets.filter((target) => target.variantId !== null).length,
    affectedPriceRowCount: discountedTargets.length,
    productsWithoutPrice: plan.productsWithoutPrice,
    productsWithMissingPrices: plan.productsWithMissingPrices,
    samples,
  };
};
