import { z } from "zod";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { AppError } from "@/server/services/errors";

export const temporaryUpgradePriceSchema = z.object({
  storefrontId: z.string().regex(/^[0-9]{1,40}$/), currency: z.string().regex(/^[A-Z]{3}$/),
  priceMillis: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  // An explicitly approved commercial valuation, never an inferred live FX rate.
  serviceMinorPerUnitNumerator: z.number().int().positive().max(1_000_000_000),
  serviceMinorPerUnitDenominator: z.number().int().positive().max(1_000_000_000),
}).strict();
export const temporaryUpgradePolicySchema = z.object({
  version: z.string().min(1).max(80), termsVersion: z.literal(LEGAL_TERMS_VERSION), approved: z.literal(true),
  validUntil: z.string().datetime(), rounding: z.literal("DOWN_WITH_OWNER_DISCOUNT"),
  zeroPolicy: z.literal("BLOCK"), minimumPolicy: z.literal("BLOCK"),
  maxDiscountMinor: z.number().int().nonnegative().max(2_147_483_647), maxDiscountBps: z.number().int().min(0).max(10_000),
  bands: z.array(z.object({ key: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/), productId: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
    prices: z.array(temporaryUpgradePriceSchema).min(1).max(200) }).strict()).min(1).max(2000),
}).strict().superRefine((policy, ctx) => {
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
  price: temporaryUpgradePriceSchema, chargedServiceMinor: z.number().int().positive(), ownerDiscountMinor: z.number().int().nonnegative(),
  usageContext: z.object({ version: z.literal(1), origin: z.string().datetime(), anchorDay: z.number().int().min(1).max(31),
    paidEnd: z.string().datetime().nullable(), trialOrigin: z.string().datetime() }).strict().optional(),
}).strict();
export type TemporaryUpgradeContext = z.infer<typeof temporaryUpgradeContextSchema>;

export function temporaryUpgradePolicy(env: Record<string, string | undefined> = process.env, now = new Date()) {
  const parsed = temporaryUpgradePolicySchema.safeParse((() => { try { return JSON.parse(env.APPLE_BILLING_TEMPORARY_UPGRADES_JSON ?? "null"); } catch { return null; } })());
  return { policy: parsed.success ? parsed.data : null,
    ready: env.APPLE_BILLING_TEMPORARY_UPGRADES_APPROVED === "true" && parsed.success && new Date(parsed.data.validUntil) > now };
}
export function temporaryBandOfferKey(policy: TemporaryUpgradePolicy, key: string) { return `temporary-upgrade:${policy.version}:${key}`; }
export function selectTemporaryUpgradeBand(policy: TemporaryUpgradePolicy, dueMinor: number, storefrontId: string, currency: string) {
  if (!Number.isSafeInteger(dueMinor) || dueMinor <= 0) throw new AppError("billingNoPaidChange", "CONFLICT", 409);
  if (!policy.bands.some((band) => band.prices.some((price) => price.storefrontId === storefrontId && price.currency === currency)))
    throw new AppError("appleTemporaryUpgradeMarketUnavailable", "CONFLICT", 409);
  const candidates = policy.bands.flatMap((band) => band.prices.filter((price) => price.storefrontId === storefrontId && price.currency === currency).map((price) => {
    const denominator = 1000n * BigInt(price.serviceMinorPerUnitDenominator);
    const value = (BigInt(price.priceMillis) * BigInt(price.serviceMinorPerUnitNumerator) + denominator - 1n) / denominator;
    return { band, price, chargedServiceMinor: Number(value) };
  })).filter((entry) => Number.isSafeInteger(entry.chargedServiceMinor) && entry.chargedServiceMinor > 0 && entry.chargedServiceMinor <= dueMinor)
    .sort((a, b) => b.chargedServiceMinor - a.chargedServiceMinor || a.band.key.localeCompare(b.band.key));
  const selected = candidates[0];
  if (!selected) throw new AppError("appleTemporaryUpgradeBelowMinimum", "CONFLICT", 409);
  const ownerDiscountMinor = dueMinor - selected.chargedServiceMinor;
  if (ownerDiscountMinor > policy.maxDiscountMinor || BigInt(ownerDiscountMinor) * 10_000n > BigInt(dueMinor) * BigInt(policy.maxDiscountBps))
    throw new AppError("appleTemporaryUpgradeDiscountUnavailable", "CONFLICT", 409);
  return { ...selected, ownerDiscountMinor };
}
