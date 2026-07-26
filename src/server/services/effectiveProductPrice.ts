import { Prisma } from "@prisma/client";

export type CatalogPercentageDiscount = {
  type: "PERCENTAGE";
  percentage: Prisma.Decimal | number | string;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

export type EffectiveProductPrice = {
  currency: string;
  basePrice: Prisma.Decimal;
  effectivePrice: Prisma.Decimal;
  compareAtPrice: Prisma.Decimal | null;
  discountPercentage: Prisma.Decimal | null;
  hasActiveDiscount: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

export class EffectiveProductPriceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "EffectiveProductPriceError";
  }
}

const MONEY_DECIMAL_PLACES = 2;

const requireFiniteDecimal = (
  value: Prisma.Decimal | number | string,
  code: string,
): Prisma.Decimal => {
  let decimal: Prisma.Decimal;
  try {
    decimal = new Prisma.Decimal(value);
  } catch {
    throw new EffectiveProductPriceError(code);
  }
  if (!decimal.isFinite()) {
    throw new EffectiveProductPriceError(code);
  }
  return decimal;
};

const requireValidDate = (value: Date | null | undefined, code: string) => {
  if (value === null || value === undefined) {
    return null;
  }
  if (Number.isNaN(value.getTime())) {
    throw new EffectiveProductPriceError(code);
  }
  return value;
};

/**
 * Resolves a catalog price without converting money through JavaScript floating point.
 *
 * Scheduling uses a closed start and open end interval: startsAt <= now < endsAt.
 * Bazaar currently persists prices with two decimal places, so percentage results use
 * the repository's existing half-up, two-decimal monetary policy.
 */
export const getEffectiveProductPrice = ({
  basePrice,
  discount,
  now,
  currency,
}: {
  basePrice: Prisma.Decimal | number | string;
  discount?: CatalogPercentageDiscount | null;
  now: Date;
  currency: string;
}): EffectiveProductPrice => {
  const normalizedCurrency = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
    throw new EffectiveProductPriceError("invalidCurrency");
  }
  if (Number.isNaN(now.getTime())) {
    throw new EffectiveProductPriceError("invalidPricingTime");
  }

  const normalizedBasePrice = requireFiniteDecimal(basePrice, "invalidBasePrice");
  if (normalizedBasePrice.isNegative()) {
    throw new EffectiveProductPriceError("invalidBasePrice");
  }

  if (!discount) {
    return {
      currency: normalizedCurrency,
      basePrice: normalizedBasePrice,
      effectivePrice: normalizedBasePrice,
      compareAtPrice: null,
      discountPercentage: null,
      hasActiveDiscount: false,
      startsAt: null,
      endsAt: null,
    };
  }

  if (discount.type !== "PERCENTAGE") {
    throw new EffectiveProductPriceError("unsupportedDiscountType");
  }
  const percentage = requireFiniteDecimal(discount.percentage, "invalidDiscountPercentage");
  if (percentage.lte(0) || percentage.gte(100)) {
    throw new EffectiveProductPriceError("invalidDiscountPercentage");
  }

  const startsAt = requireValidDate(discount.startsAt, "invalidDiscountStart");
  const endsAt = requireValidDate(discount.endsAt, "invalidDiscountEnd");
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new EffectiveProductPriceError("discountEndMustBeAfterStart");
  }

  const active =
    (startsAt === null || startsAt.getTime() <= now.getTime()) &&
    (endsAt === null || now.getTime() < endsAt.getTime());
  if (!active) {
    return {
      currency: normalizedCurrency,
      basePrice: normalizedBasePrice,
      effectivePrice: normalizedBasePrice,
      compareAtPrice: null,
      discountPercentage: percentage,
      hasActiveDiscount: false,
      startsAt,
      endsAt,
    };
  }

  const multiplier = new Prisma.Decimal(100).minus(percentage).div(100);
  const effectivePrice = normalizedBasePrice
    .mul(multiplier)
    .toDecimalPlaces(MONEY_DECIMAL_PLACES, Prisma.Decimal.ROUND_HALF_UP);
  if (effectivePrice.isNegative()) {
    throw new EffectiveProductPriceError("invalidEffectivePrice");
  }

  return {
    currency: normalizedCurrency,
    basePrice: normalizedBasePrice,
    effectivePrice,
    compareAtPrice: normalizedBasePrice,
    discountPercentage: percentage,
    hasActiveDiscount: true,
    startsAt,
    endsAt,
  };
};
