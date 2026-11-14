import { z } from "zod";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { AppError } from "@/server/services/errors";
import { approvedTemporaryUpgradeCatalog } from "./appleTemporaryUpgradeCatalogs";

export const temporaryUpgradePriceSchema = z.object({
  storefrontId: z.string().regex(/^[0-9]{1,40}$/), currency: z.string().regex(/^[A-Z]{3}$/),
  priceMillis: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  // An explicitly approved commercial valuation, never an inferred live FX rate.
  serviceMinorPerUnitNumerator: z.number().int().positive().max(1_000_000_000),
  serviceMinorPerUnitDenominator: z.number().int().positive().max(1_000_000_000),
}).strict();
export const temporaryUpgradePolicySchema = z.object({
  version: z.string().min(1).max(80), termsVersion: z.literal(LEGAL_TERMS_VERSION), approved: z.literal(true),
  validUntil: z.string().datetime(), rounding: z.enum(["DOWN_WITH_OWNER_DISCOUNT", "UP_TO_COVER_QUOTE"]),
  zeroPolicy: z.literal("BLOCK"), minimumPolicy: z.enum(["BLOCK", "CHARGE_MINIMUM_FOR_POSITIVE"]),
  maxDiscountMinor: z.number().int().nonnegative().max(2_147_483_647), maxDiscountBps: z.number().int().min(0).max(10_000),
  bands: z.array(z.object({ key: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/), productId: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
    prices: z.array(temporaryUpgradePriceSchema).min(1).max(200) }).strict()).min(1).max(2000),
}).strict().superRefine((policy, ctx) => {
  if (policy.rounding === "UP_TO_COVER_QUOTE" &&
    (policy.maxDiscountMinor !== 0 || policy.maxDiscountBps !== 0 || policy.minimumPolicy !== "CHARGE_MINIMUM_FOR_POSITIVE"))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Upward rounding has no owner discount and retains the approved minimum" });
  if (new Set(policy.bands.map((band) => band.key)).size !== policy.bands.length || new Set(policy.bands.map((band) => band.productId)).size !== policy.bands.length ||
    policy.bands.some((band) => new Set(band.prices.map((p) => `${p.storefrontId}:${p.currency}`)).size !== band.prices.length))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ambiguous upgrade band mapping" });
  const rates = new Map<string, { numerator: number; denominator: number }>();
  for (const price of policy.bands.flatMap((band) => band.prices)) {
    const key = `${price.storefrontId}:${price.currency}`, prior = rates.get(key);
    if (prior && BigInt(prior.numerator) * BigInt(price.serviceMinorPerUnitDenominator) !== BigInt(price.serviceMinorPerUnitNumerator) * BigInt(prior.denominator))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "One approved valuation per storefront currency is required" });
    rates.set(key, { numerator: price.serviceMinorPerUnitNumerator, denominator: price.serviceMinorPerUnitDenominator });
  }
});
export type TemporaryUpgradePolicy = z.infer<typeof temporaryUpgradePolicySchema>;
export const temporaryUpgradeContextSchema = z.object({
  version: z.literal(1), policyVersion: z.string().min(1).max(80), policyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/), bandKey: z.string().min(1).max(80), productId: z.string().min(1).max(100),
  price: temporaryUpgradePriceSchema, chargedServiceMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  ownerDiscountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  // A service-valuation difference, never a customer balance or extra entitlement.
  minimumCharge: z.object({ serviceAdjustmentMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict().optional(),
  // Explicit new cohort: an UP difference is neither a discount nor a wallet.
  roundingMode: z.literal("UP_TO_COVER_QUOTE").optional(),
  upwardRounding: z.object({ serviceAdjustmentMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    minimumPriceApplied: z.boolean() }).strict().optional(),
  usageContext: z.object({ version: z.literal(1), origin: z.string().datetime(), anchorDay: z.number().int().min(1).max(31),
    paidEnd: z.string().datetime().nullable(), trialOrigin: z.string().datetime() }).strict().optional(),
}).strict();
export type TemporaryUpgradeContext = z.infer<typeof temporaryUpgradeContextSchema>;

const positiveSafeInteger = (value: number, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value > 0 && value <= maximum;

export function temporaryUpgradeServiceMinor(price: z.infer<typeof temporaryUpgradePriceSchema>) {
  // Zod refinements can receive dirty numbers after an earlier bounds failure.
  // Validate every operand before BigInt conversion or division.
  if (!price || !positiveSafeInteger(price.priceMillis) || !positiveSafeInteger(price.serviceMinorPerUnitNumerator, 1_000_000_000) ||
    !positiveSafeInteger(price.serviceMinorPerUnitDenominator, 1_000_000_000)) return null;
  const denominator = 1000n * BigInt(price.serviceMinorPerUnitDenominator);
  const value = (BigInt(price.priceMillis) * BigInt(price.serviceMinorPerUnitNumerator) + denominator - 1n) / denominator;
  return value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

export function validTemporaryUpgradePricing(amountMinor: number, context: TemporaryUpgradeContext) {
  if (!positiveSafeInteger(amountMinor, 2_147_483_647) || !context || !positiveSafeInteger(context.chargedServiceMinor) ||
    !Number.isSafeInteger(context.ownerDiscountMinor) || context.ownerDiscountMinor < 0 ||
    temporaryUpgradeServiceMinor(context.price) !== context.chargedServiceMinor) return false;
  if (context.minimumCharge !== undefined && (!context.minimumCharge || !positiveSafeInteger(context.minimumCharge.serviceAdjustmentMinor))) return false;
  const due = BigInt(amountMinor), charged = BigInt(context.chargedServiceMinor), discount = BigInt(context.ownerDiscountMinor);
  if (context.roundingMode !== undefined || context.upwardRounding !== undefined) {
    const marker = context.upwardRounding;
    return context.roundingMode === "UP_TO_COVER_QUOTE" && marker != null && context.minimumCharge === undefined && discount === 0n &&
      Number.isSafeInteger(marker.serviceAdjustmentMinor) && marker.serviceAdjustmentMinor >= 0 &&
      typeof marker.minimumPriceApplied === "boolean" && (!marker.minimumPriceApplied || charged > due) &&
      charged >= due && charged - due === BigInt(marker.serviceAdjustmentMinor) && temporaryUpgradePriceCoversQuote(context.price, amountMinor);
  }
  return context.minimumCharge
    ? discount === 0n && charged > due && charged - due === BigInt(context.minimumCharge.serviceAdjustmentMinor)
    : charged + discount === due;
}

export function temporaryUpgradePolicy(env: Record<string, string | undefined> = process.env, now = new Date()) {
  const source = env.APPLE_BILLING_TEMPORARY_UPGRADES_CATALOG?.trim();
  const parsed = temporaryUpgradePolicySchema.safeParse((() => {
    if (source) return env.APPLE_BILLING_TEMPORARY_UPGRADES_JSON?.trim() ? null : approvedTemporaryUpgradeCatalog(source);
    try { return JSON.parse(env.APPLE_BILLING_TEMPORARY_UPGRADES_JSON ?? "null"); } catch { return null; }
  })());
  return { policy: parsed.success ? parsed.data : null,
    ready: env.APPLE_BILLING_TEMPORARY_UPGRADES_APPROVED === "true" && parsed.success && new Date(parsed.data.validUntil) > now };
}
export function temporaryBandOfferKey(policy: TemporaryUpgradePolicy, key: string) { return `temporary-upgrade:${policy.version}:${key}`; }
/** Compare the exact rational value BEFORE rounding minor units. */
export function temporaryUpgradePriceCoversQuote(price: z.infer<typeof temporaryUpgradePriceSchema>, dueMinor: number) {
  return positiveSafeInteger(dueMinor, 2_147_483_647) && temporaryUpgradeServiceMinor(price) !== null &&
    BigInt(price.priceMillis) * BigInt(price.serviceMinorPerUnitNumerator) >=
      BigInt(dueMinor) * 1000n * BigInt(price.serviceMinorPerUnitDenominator);
}
export function selectTemporaryUpgradeBand(policy: TemporaryUpgradePolicy, dueMinor: number, storefrontId: string, currency: string) {
  if (!Number.isSafeInteger(dueMinor) || dueMinor <= 0) throw new AppError("billingNoPaidChange", "CONFLICT", 409);
  if (!policy.bands.some((band) => band.prices.some((price) => price.storefrontId === storefrontId && price.currency === currency)))
    throw new AppError("appleTemporaryUpgradeMarketUnavailable", "CONFLICT", 409);
  const market = policy.bands.flatMap((band) => band.prices.filter((price) => price.storefrontId === storefrontId && price.currency === currency).flatMap((price) => {
    const chargedServiceMinor = temporaryUpgradeServiceMinor(price);
    return chargedServiceMinor === null ? [] : [{ band, price, chargedServiceMinor }];
  }));
  const floor = [...market].sort((a, b) => a.price.priceMillis - b.price.priceMillis || a.band.key.localeCompare(b.band.key))[0];
  if (policy.rounding === "UP_TO_COVER_QUOTE") {
    const selected = market.filter((entry) => temporaryUpgradePriceCoversQuote(entry.price, dueMinor))
      .sort((a, b) => a.price.priceMillis - b.price.priceMillis || a.band.key.localeCompare(b.band.key))[0];
    if (!selected) throw new AppError("appleTemporaryUpgradeAboveMaximum", "CONFLICT", 409);
    return { ...selected, ownerDiscountMinor: 0, minimumCharge: undefined,
      roundingMode: "UP_TO_COVER_QUOTE" as const,
      upwardRounding: { serviceAdjustmentMinor: selected.chargedServiceMinor - dueMinor,
        minimumPriceApplied: selected === floor && selected.chargedServiceMinor > dueMinor } };
  }
  if (floor && dueMinor < floor.chargedServiceMinor && policy.minimumPolicy === "CHARGE_MINIMUM_FOR_POSITIVE")
    return { ...floor, ownerDiscountMinor: 0, minimumCharge: { serviceAdjustmentMinor: floor.chargedServiceMinor - dueMinor },
      roundingMode: undefined, upwardRounding: undefined };
  const candidates = market.filter((entry) => entry.chargedServiceMinor <= dueMinor)
    .sort((a, b) => b.chargedServiceMinor - a.chargedServiceMinor || a.band.key.localeCompare(b.band.key));
  const selected = candidates[0];
  if (!selected) throw new AppError("appleTemporaryUpgradeBelowMinimum", "CONFLICT", 409);
  const ownerDiscountMinor = dueMinor - selected.chargedServiceMinor;
  if (ownerDiscountMinor > policy.maxDiscountMinor || BigInt(ownerDiscountMinor) * 10_000n > BigInt(dueMinor) * BigInt(policy.maxDiscountBps))
    throw new AppError("appleTemporaryUpgradeDiscountUnavailable", "CONFLICT", 409);
  return { ...selected, ownerDiscountMinor, minimumCharge: undefined, roundingMode: undefined, upwardRounding: undefined };
}
