import { Prisma } from "@prisma/client";

import {
  getEffectiveProductPrice,
  type CatalogPercentageDiscount,
} from "@/server/services/effectiveProductPrice";

export const BASE_CATALOG_VARIANT_KEY = "BASE";

export type CatalogPriceScopeInput = {
  organizationId: string;
  storeId: string;
  productId: string;
  variantId: string | null;
  variantKey: string;
  currency: string;
  basePrice: Prisma.Decimal | number | string;
  discount?: CatalogPercentageDiscount | null;
};

export type CatalogPriceReadModel = {
  organizationId: string;
  storeId: string;
  productId: string;
  variantId: string | null;
  variantKey: string;
  currency: string;
  basePrice: Prisma.Decimal;
  effectivePrice: Prisma.Decimal;
  compareAtPrice: Prisma.Decimal | null;
  hasActiveDiscount: boolean;
  discount: {
    type: "PERCENTAGE";
    percentage: Prisma.Decimal;
    startsAt: Date | null;
    endsAt: Date | null;
    isActive: boolean;
  } | null;
};

export class CatalogPricingReadModelError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "CatalogPricingReadModelError";
  }
}

const requireScopeId = (value: string, code: string) => {
  const normalized = value.trim();
  if (!normalized) {
    throw new CatalogPricingReadModelError(code);
  }
  return normalized;
};

/**
 * Maps one future schema price row into the domain read contract.
 *
 * The adapter deliberately accepts explicit scalar fields instead of a Prisma model. The eventual
 * StorePrice/CatalogDiscount query must populate this boundary, while every API, UI, cache and
 * integration consumer can share the mapping without coupling to the migration's generated types.
 */
export const mapCatalogPriceReadModel = (
  input: CatalogPriceScopeInput,
  now: Date,
): CatalogPriceReadModel => {
  const organizationId = requireScopeId(input.organizationId, "catalogPriceOrganizationRequired");
  const storeId = requireScopeId(input.storeId, "catalogPriceStoreRequired");
  const productId = requireScopeId(input.productId, "catalogPriceProductRequired");
  const variantId = input.variantId
    ? requireScopeId(input.variantId, "catalogPriceVariantRequired")
    : null;
  const variantKey = requireScopeId(input.variantKey, "catalogPriceVariantKeyRequired");
  const expectedVariantKey = variantId ?? BASE_CATALOG_VARIANT_KEY;
  if (variantKey !== expectedVariantKey) {
    throw new CatalogPricingReadModelError("catalogPriceVariantScopeMismatch");
  }

  const effective = getEffectiveProductPrice({
    basePrice: input.basePrice,
    discount: input.discount,
    now,
    currency: input.currency,
  });

  return {
    organizationId,
    storeId,
    productId,
    variantId,
    variantKey,
    currency: effective.currency,
    basePrice: effective.basePrice,
    effectivePrice: effective.effectivePrice,
    compareAtPrice: effective.compareAtPrice,
    hasActiveDiscount: effective.hasActiveDiscount,
    discount: input.discount
      ? {
          type: "PERCENTAGE",
          percentage: new Prisma.Decimal(input.discount.percentage),
          startsAt: effective.startsAt,
          endsAt: effective.endsAt,
          isActive: effective.hasActiveDiscount,
        }
      : null,
  };
};

export type CatalogProductPricingSummary = {
  organizationId: string;
  storeId: string;
  productId: string;
  currency: string;
  base: CatalogPriceReadModel | null;
  variants: CatalogPriceReadModel[];
  minBasePrice: Prisma.Decimal | null;
  maxBasePrice: Prisma.Decimal | null;
  minEffectivePrice: Prisma.Decimal | null;
  maxEffectivePrice: Prisma.Decimal | null;
  hasActiveDiscount: boolean;
};

const minDecimal = (values: Prisma.Decimal[]) =>
  values.reduce((minimum, value) => (value.lt(minimum) ? value : minimum));

const maxDecimal = (values: Prisma.Decimal[]) =>
  values.reduce((maximum, value) => (value.gt(maximum) ? value : maximum));

/**
 * Produces the product-level min/max summary without flattening variant-specific prices.
 */
export const summarizeCatalogProductPricing = (input: {
  base: CatalogPriceReadModel | null;
  variants: CatalogPriceReadModel[];
}): CatalogProductPricingSummary => {
  const rows = [...(input.base ? [input.base] : []), ...input.variants];
  if (!rows.length) {
    throw new CatalogPricingReadModelError("catalogProductPriceRequired");
  }
  const [scope] = rows;
  if (!scope) {
    throw new CatalogPricingReadModelError("catalogProductPriceRequired");
  }
  for (const row of rows) {
    if (
      row.organizationId !== scope.organizationId ||
      row.storeId !== scope.storeId ||
      row.productId !== scope.productId ||
      row.currency !== scope.currency
    ) {
      throw new CatalogPricingReadModelError("catalogProductPriceScopeMismatch");
    }
  }
  if (input.base?.variantId !== null || input.base?.variantKey !== BASE_CATALOG_VARIANT_KEY) {
    throw new CatalogPricingReadModelError("catalogProductBasePriceScopeMismatch");
  }
  if (input.variants.some((variant) => variant.variantId === null)) {
    throw new CatalogPricingReadModelError("catalogProductVariantPriceScopeMismatch");
  }

  const rangeRows = input.variants.length ? input.variants : input.base ? [input.base] : [];
  const basePrices = rangeRows.map((row) => row.basePrice);
  const effectivePrices = rangeRows.map((row) => row.effectivePrice);

  return {
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    productId: scope.productId,
    currency: scope.currency,
    base: input.base,
    variants: input.variants,
    minBasePrice: basePrices.length ? minDecimal(basePrices) : null,
    maxBasePrice: basePrices.length ? maxDecimal(basePrices) : null,
    minEffectivePrice: effectivePrices.length ? minDecimal(effectivePrices) : null,
    maxEffectivePrice: effectivePrices.length ? maxDecimal(effectivePrices) : null,
    hasActiveDiscount: rows.some((row) => row.hasActiveDiscount),
  };
};
