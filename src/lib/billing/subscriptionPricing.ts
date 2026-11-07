import { z } from "zod";
import { PLAN_CODES, type PlanCode } from "./plans";

export const LEGACY_CATALOG_VERSION = "2026-10";
export const CURRENT_CATALOG_VERSION = "2026-11";
// Existing organizations retain their immutable contract catalog. This catalog
// applies to new contracts; changing a public price never rewrites an old one.
export const PUBLISHED_CATALOG_VERSION = CURRENT_CATALOG_VERSION;
export const SUBSCRIPTION_MONTHS = [1, 6, 12] as const;
export type SubscriptionMonths = (typeof SUBSCRIPTION_MONTHS)[number];
export const subscriptionExtrasSchema = z.object({
  stores: z.number().int().min(0).max(14),
  productPacks: z.number().int().min(0).max(1),
  // Kept at zero for compatibility with the unpublished draft's wire format.
  // The single reserve pack includes both products and people.
  userPacks: z.number().int().min(0).max(0),
});
export type SubscriptionExtras = z.infer<typeof subscriptionExtrasSchema>;
export const EMPTY_SUBSCRIPTION_EXTRAS: SubscriptionExtras = {
  stores: 0, productPacks: 0, userPacks: 0,
};
export const ADDITIONAL_STORE_CAPS: Record<PlanCode, number> = {
  STARTER: 0, BUSINESS: 4, ENTERPRISE: 14,
};
export const validateSubscriptionExtras = (plan: PlanCode, extras: SubscriptionExtras) => {
  subscriptionExtrasSchema.parse(extras);
  if (extras.stores > ADDITIONAL_STORE_CAPS[plan]) throw new Error("billingInvalidExtras");
  return extras;
};
export const subscriptionSelectionSchema = z.object({
  plan: z.enum(PLAN_CODES),
  months: z.union([z.literal(1), z.literal(6), z.literal(12)]).default(1),
  extras: subscriptionExtrasSchema.default(EMPTY_SUBSCRIPTION_EXTRAS),
});
export type SubscriptionSelection = z.infer<typeof subscriptionSelectionSchema>;
export const EXTRA_MONTHLY_PRICES_MINOR = {
  stores: 100_000, productPacks: 50_000, userPacks: 0,
} as const;
export const discountBasisPoints = (months: SubscriptionMonths) =>
  months === 12 ? 1500 : months === 6 ? 500 : 0;

export function subscriptionPrice(
  monthlyBaseMinor: number,
  months: SubscriptionMonths,
  extras: SubscriptionExtras = EMPTY_SUBSCRIPTION_EXTRAS,
) {
  subscriptionExtrasSchema.parse(extras);
  if (!SUBSCRIPTION_MONTHS.includes(months) || !Number.isSafeInteger(monthlyBaseMinor) || monthlyBaseMinor <= 0)
    throw new Error("billingInvalidAmount");
  const monthlyMinor = monthlyBaseMinor + extras.stores * EXTRA_MONTHLY_PRICES_MINOR.stores +
    extras.productPacks * EXTRA_MONTHLY_PRICES_MINOR.productPacks +
    extras.userPacks * EXTRA_MONTHLY_PRICES_MINOR.userPacks;
  const discountBps = discountBasisPoints(months);
  const fullAmountMinor = monthlyMinor * months;
  const amountMinor = Number((BigInt(fullAmountMinor) * BigInt(10000 - discountBps) + 5000n) / 10000n);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > 2_147_483_647)
    throw new Error("billingInvalidAmount");
  return { monthlyMinor, months, discountBps, fullAmountMinor, amountMinor };
}

export const sameSubscriptionSelection = (a: SubscriptionSelection, b: SubscriptionSelection) =>
  a.plan === b.plan && a.months === b.months && a.extras.stores === b.extras.stores &&
  a.extras.productPacks === b.extras.productPacks && a.extras.userPacks === b.extras.userPacks;

export type SubscriptionCatalogVersion = typeof LEGACY_CATALOG_VERSION | typeof CURRENT_CATALOG_VERSION;
export const catalogVersion = (value: string | null | undefined): SubscriptionCatalogVersion =>
  value === CURRENT_CATALOG_VERSION ? CURRENT_CATALOG_VERSION : LEGACY_CATALOG_VERSION;

export const NEW_MONTHLY_PRICES_KGS: Record<PlanCode, number> = {
  STARTER: 2000, BUSINESS: 3500, ENTERPRISE: 5500,
};
