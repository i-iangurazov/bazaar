import { Prisma } from "@prisma/client";

import {
  mapCatalogPriceReadModel,
  type CatalogPriceScopeInput,
} from "@/server/services/catalogPricingReadModel";

export type BazaarCatalogDiscountJson = {
  type: "PERCENTAGE";
  value: number;
  startsAt: string | null;
  endsAt: string | null;
};

export type BazaarCatalogPricingJson = {
  currency: string;
  basePrice: number;
  effectivePrice: number;
  compareAtPrice: number | null;
  hasDiscount: boolean;
  discount: BazaarCatalogDiscountJson | null;
};

const jsonMoney = (value: Prisma.Decimal | number | string) =>
  new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();

/**
 * Serializes the additive Bazaar API pricing object from an explicit price-scope adapter row.
 * Scheduled discounts remain visible in `discount`, while `hasDiscount` means active right now.
 */
export const mapBazaarCatalogPricing = (
  input: CatalogPriceScopeInput,
  now: Date,
): BazaarCatalogPricingJson => {
  const pricing = mapCatalogPriceReadModel(input, now);
  return {
    currency: pricing.currency,
    basePrice: jsonMoney(pricing.basePrice),
    effectivePrice: jsonMoney(pricing.effectivePrice),
    compareAtPrice: pricing.compareAtPrice ? jsonMoney(pricing.compareAtPrice) : null,
    hasDiscount: pricing.hasActiveDiscount,
    discount: pricing.discount
      ? {
          type: "PERCENTAGE",
          value: pricing.discount.percentage.toNumber(),
          startsAt: pricing.discount.startsAt?.toISOString() ?? null,
          endsAt: pricing.discount.endsAt?.toISOString() ?? null,
        }
      : null,
  };
};

/**
 * Adds pricing without deriving or rewriting the legacy `price` field. Bazaar's documented legacy
 * semantics are the current sellable price, so callers pass `pricing.effectivePrice` there while
 * older clients continue to receive the same scalar field and newer clients get the full breakdown.
 */
export const withBazaarCatalogPricing = <TItem extends { price: number }>(input: {
  item: TItem;
  priceScope: CatalogPriceScopeInput;
  now: Date;
}): TItem & { pricing: BazaarCatalogPricingJson } => ({
  ...input.item,
  pricing: mapBazaarCatalogPricing(input.priceScope, input.now),
});
