import { Prisma } from "@prisma/client";

export type CatalogDiscountVariantPolicy = "ALL_VARIANTS" | "SELECTED_VARIANTS";

export type CatalogDiscountPlanningProduct = {
  id: string;
  basePriceKgs: Prisma.Decimal | null;
  variants: Array<{
    id: string;
    isActive: boolean;
  }>;
};

export type CatalogDiscountPlanningStorePrice = {
  productId: string;
  variantId: string | null;
  variantKey: string;
  priceKgs: Prisma.Decimal;
};

export type CatalogDiscountPriceSource =
  | "STORE_PRICE"
  | "STORE_BASE_INHERITED"
  | "PRODUCT_FALLBACK";

export type CatalogDiscountTarget = {
  productId: string;
  variantId: string | null;
  variantKey: string;
  basePriceKgs: Prisma.Decimal;
  priceSource: CatalogDiscountPriceSource;
  materializeStorePrice: boolean;
};

export type CatalogDiscountMissingTarget = {
  productId: string;
  variantId: string | null;
  variantKey: string;
  reason: "PRICE_MISSING";
};

export class CatalogDiscountPlanningError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "CatalogDiscountPlanningError";
  }
}

const variantKeyFrom = (variantId?: string | null) => variantId ?? "BASE";

const uniqueSorted = (values: string[]) => Array.from(new Set(values)).sort();

/**
 * Builds deterministic store/variant price targets for preview and mutation.
 * Authorization and organization/store loading happen before calling this pure planner.
 */
export const planCatalogDiscountTargets = ({
  products,
  storePrices,
  productIds,
  variantPolicy,
  variantIds = [],
}: {
  products: CatalogDiscountPlanningProduct[];
  storePrices: CatalogDiscountPlanningStorePrice[];
  productIds: string[];
  variantPolicy: CatalogDiscountVariantPolicy;
  variantIds?: string[];
}) => {
  const selectedProductIds = uniqueSorted(productIds);
  const selectedProductIdSet = new Set(selectedProductIds);
  if (!selectedProductIds.length) {
    throw new CatalogDiscountPlanningError("catalogDiscountProductsRequired");
  }

  const productsById = new Map(products.map((product) => [product.id, product]));
  if (selectedProductIds.some((productId) => !productsById.has(productId))) {
    throw new CatalogDiscountPlanningError("catalogDiscountProductScopeMismatch");
  }

  const priceByTarget = new Map(
    storePrices.map((price) => [`${price.productId}:${price.variantKey}`, price]),
  );
  const selectedVariantIds = uniqueSorted(variantIds);
  const activeVariantById = new Map(
    products.flatMap((product) =>
      product.variants
        .filter((variant) => variant.isActive)
        .map((variant) => [variant.id, { productId: product.id, variant }] as const),
    ),
  );

  if (variantPolicy === "SELECTED_VARIANTS") {
    if (!selectedVariantIds.length) {
      throw new CatalogDiscountPlanningError("catalogDiscountVariantsRequired");
    }
    for (const variantId of selectedVariantIds) {
      const entry = activeVariantById.get(variantId);
      if (!entry || !selectedProductIdSet.has(entry.productId)) {
        throw new CatalogDiscountPlanningError("catalogDiscountVariantScopeMismatch");
      }
    }
  } else if (selectedVariantIds.length) {
    throw new CatalogDiscountPlanningError("catalogDiscountUnexpectedVariants");
  }

  const targets: CatalogDiscountTarget[] = [];
  const missingTargets: CatalogDiscountMissingTarget[] = [];

  const addTarget = ({
    product,
    variantId,
  }: {
    product: CatalogDiscountPlanningProduct;
    variantId: string | null;
  }) => {
    const variantKey = variantKeyFrom(variantId);
    const exactPrice = priceByTarget.get(`${product.id}:${variantKey}`);
    if (exactPrice) {
      targets.push({
        productId: product.id,
        variantId,
        variantKey,
        basePriceKgs: exactPrice.priceKgs,
        priceSource: "STORE_PRICE",
        materializeStorePrice: false,
      });
      return;
    }

    const storeBasePrice = priceByTarget.get(`${product.id}:BASE`);
    const inheritedPrice = storeBasePrice?.priceKgs ?? product.basePriceKgs;
    if (inheritedPrice === null || inheritedPrice === undefined) {
      missingTargets.push({
        productId: product.id,
        variantId,
        variantKey,
        reason: "PRICE_MISSING",
      });
      return;
    }

    targets.push({
      productId: product.id,
      variantId,
      variantKey,
      basePriceKgs: inheritedPrice,
      priceSource: storeBasePrice ? "STORE_BASE_INHERITED" : "PRODUCT_FALLBACK",
      materializeStorePrice: true,
    });
  };

  for (const productId of selectedProductIds) {
    const product = productsById.get(productId);
    if (!product) {
      continue;
    }
    if (variantPolicy === "ALL_VARIANTS") {
      addTarget({ product, variantId: null });
      for (const variant of product.variants
        .filter((candidate) => candidate.isActive)
        .sort((left, right) => left.id.localeCompare(right.id))) {
        addTarget({ product, variantId: variant.id });
      }
      continue;
    }

    for (const variantId of selectedVariantIds) {
      if (activeVariantById.get(variantId)?.productId === product.id) {
        addTarget({ product, variantId });
      }
    }
  }

  const affectedProductIds = uniqueSorted(targets.map((target) => target.productId));
  const productsWithoutPrice = selectedProductIds.filter(
    (productId) => !affectedProductIds.includes(productId),
  );
  const productsWithMissingPrices = uniqueSorted(missingTargets.map((target) => target.productId));

  return {
    selectedProductCount: selectedProductIds.length,
    affectedProductCount: affectedProductIds.length,
    affectedVariantCount: targets.filter((target) => target.variantId !== null).length,
    affectedPriceRowCount: targets.length,
    materializedPriceRowCount: targets.filter((target) => target.materializeStorePrice).length,
    productsWithoutPrice,
    productsWithMissingPrices,
    targets,
    missingTargets,
  };
};
