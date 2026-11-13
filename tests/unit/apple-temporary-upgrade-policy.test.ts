import { describe, expect, it } from "vitest";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { selectTemporaryUpgradeBand, temporaryUpgradePolicy, temporaryUpgradePolicySchema, validTemporaryUpgradePricing } from "@/server/billing/appleTemporaryUpgradePolicy";
import { purchaseSnapshotSchema, readPurchaseSnapshot } from "@/server/billing/purchaseSnapshot";

const now = new Date("2026-11-12T12:00:00Z");
const price = (priceMillis: number) => ({ storefrontId: "143441", currency: "USD", priceMillis,
  serviceMinorPerUnitNumerator: 9000, serviceMinorPerUnitDenominator: 1 });
const policy = () => temporaryUpgradePolicySchema.parse({ version: "synthetic-policy-only", termsVersion: LEGAL_TERMS_VERSION, approved: true,
  validUntil: "2026-11-13T00:00:00.000Z", rounding: "DOWN_WITH_OWNER_DISCOUNT", zeroPolicy: "BLOCK", minimumPolicy: "BLOCK",
  maxDiscountMinor: 100000, maxDiscountBps: 10000,
  bands: [2990, 4990, 5990].map((value, index) => ({ key: `band-${index}`, productId: `synthetic.temporary.${index}`, prices: [price(value)] })) });

describe("explicitly approved temporary-upgrade price bands", () => {
  it("defaults off and refuses unapproved, expired, malformed or mismatched commercial terms", () => {
    expect(temporaryUpgradePolicy({}, now).ready).toBe(false);
    const config = { APPLE_BILLING_TEMPORARY_UPGRADES_APPROVED: "true", APPLE_BILLING_TEMPORARY_UPGRADES_JSON: JSON.stringify(policy()) };
    expect(temporaryUpgradePolicy(config, now).ready).toBe(true);
    expect(temporaryUpgradePolicy({ ...config, APPLE_BILLING_TEMPORARY_UPGRADES_APPROVED: "false" }, now).ready).toBe(false);
    expect(temporaryUpgradePolicy(config, new Date("2026-11-14T00:00:00Z")).ready).toBe(false);
    for (const patch of [{ approved: false }, { termsVersion: "old-terms" }, { minimumPolicy: "ROUND_UP" }, { zeroPolicy: "FREE_WITHOUT_APPROVAL" }])
      expect(temporaryUpgradePolicy({ ...config, APPLE_BILLING_TEMPORARY_UPGRADES_JSON: JSON.stringify({ ...policy(), ...patch }) }, now).ready).toBe(false);
  });
  it("selects the highest affordable approved band and records an owner-funded discount without a balance", () => {
    const selected = selectTemporaryUpgradeBand(policy(), 50000, "143441", "USD");
    expect(selected.band.key).toBe("band-1"); expect(selected.price.priceMillis).toBe(4990);
    expect(selected.chargedServiceMinor).toBe(44910); expect(selected.ownerDiscountMinor).toBe(5090);
    expect(selected).not.toHaveProperty("balance"); expect(selected).not.toHaveProperty("creditLot");
  });
  it("never rounds up, invents a free grant, or silently chooses another storefront/currency", () => {
    expect(() => selectTemporaryUpgradeBand(policy(), 26909, "143441", "USD")).toThrow("appleTemporaryUpgradeBelowMinimum");
    expect(() => selectTemporaryUpgradeBand(policy(), 0, "143441", "USD")).toThrow("billingNoPaidChange");
    expect(() => selectTemporaryUpgradeBand(policy(), 50000, "143442", "USD")).toThrow("appleTemporaryUpgradeMarketUnavailable");
    expect(() => selectTemporaryUpgradeBand(policy(), 50000, "143441", "KGS")).toThrow("appleTemporaryUpgradeMarketUnavailable");
  });
  it("enforces both the absolute and relative owner-discount limits", () => {
    expect(() => selectTemporaryUpgradeBand({ ...policy(), maxDiscountMinor: 5089 }, 50000, "143441", "USD")).toThrow("appleTemporaryUpgradeDiscountUnavailable");
    expect(() => selectTemporaryUpgradeBand({ ...policy(), maxDiscountBps: 1000 }, 50000, "143441", "USD")).toThrow("appleTemporaryUpgradeDiscountUnavailable");
  });
  it("charges the configured market minimum only for an explicitly enabled positive below-floor quote", () => {
    const p = policy(); p.minimumPolicy = "CHARGE_MINIMUM_FOR_POSITIVE";
    p.bands.reverse(); p.maxDiscountMinor = 0; p.maxDiscountBps = 0;
    const selected = selectTemporaryUpgradeBand(p, 1, "143441", "USD");
    expect(selected.band.key).toBe("band-0"); expect(selected.price.priceMillis).toBe(2990);
    expect(selected.chargedServiceMinor).toBe(26910); expect(selected.ownerDiscountMinor).toBe(0);
    expect(selected.minimumCharge).toEqual({ serviceAdjustmentMinor: 26909 });
    for (const amount of [0, -1, 0.1, Number.MAX_SAFE_INTEGER + 1])
      expect(() => selectTemporaryUpgradeBand(p, amount, "143441", "USD")).toThrow("billingNoPaidChange");
    expect(() => selectTemporaryUpgradeBand(p, 1, "143442", "USD")).toThrow("appleTemporaryUpgradeMarketUnavailable");
    expect(selectTemporaryUpgradeBand(p, 26910, "143441", "USD").minimumCharge).toBeUndefined();
    expect(() => selectTemporaryUpgradeBand(p, 50000, "143441", "USD")).toThrow("appleTemporaryUpgradeDiscountUnavailable");
  });
  it("uses the lowest actual price in its own currency rather than a hardcoded dollar floor", () => {
    const p = policy(); p.minimumPolicy = "CHARGE_MINIMUM_FOR_POSITIVE";
    p.bands.push({ key: "euro-minimum", productId: "synthetic.euro", prices: [{ ...price(1090), storefrontId: "143442", currency: "EUR" }] });
    const result = selectTemporaryUpgradeBand(p, 2, "143442", "EUR");
    expect(result.price).toMatchObject({ priceMillis: 1090, currency: "EUR", storefrontId: "143442" });
    expect(result.minimumCharge?.serviceAdjustmentMinor).toBe(9808);
  });
  it("binds minimum accounting to its exact positive quote while keeping old discounted snapshots readable", () => {
    const p = policy(); p.minimumPolicy = "CHARGE_MINIMUM_FOR_POSITIVE";
    const selected = selectTemporaryUpgradeBand(p, 1, "143441", "USD");
    const context = { version: 1 as const, policyVersion: p.version, policyDigest: "a".repeat(64), sourceFingerprint: "b".repeat(64),
      bandKey: selected.band.key, productId: selected.band.productId, price: selected.price, chargedServiceMinor: selected.chargedServiceMinor,
      ownerDiscountMinor: 0, minimumCharge: selected.minimumCharge };
    expect(validTemporaryUpgradePricing(1, context)).toBe(true);
    expect(validTemporaryUpgradePricing(0, context)).toBe(false);
    expect(validTemporaryUpgradePricing(1, { ...context, minimumCharge: undefined })).toBe(false);
    expect(validTemporaryUpgradePricing(1, { ...context, ownerDiscountMinor: 1 })).toBe(false);
    const snapshot = { version: 1, catalogVersion: "2026-11", kind: "UPGRADE", plan: "BUSINESS", months: 1,
      extras: { stores: 0, productPacks: 0, userPacks: 0 }, monthlyMinor: 350000, discountBps: 0, fullAmountMinor: 350000,
      amountMinor: 1, serviceValueMinor: 2, creditMinor: 1, organizationId: "synthetic", expectedPlan: "STARTER", expectedPeriodEnd: null,
      sourcePeriodId: "synthetic-base", startsAt: now.toISOString(), endsAt: p.validUntil, cycleStartsAt: now.toISOString(),
      cycleEndsAt: p.validUntil, anchorDay: 12, issuedAt: now.toISOString(), expiresAt: p.validUntil, appleTemporaryUpgrade: context };
    expect(purchaseSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(purchaseSnapshotSchema.safeParse({ ...snapshot, amountMinor: 0 }).success).toBe(false);
    expect(purchaseSnapshotSchema.safeParse({ ...snapshot, appleTemporaryUpgrade: { ...context, minimumCharge: { serviceAdjustmentMinor: 1 } } }).success).toBe(false);
    const dirtyContexts = [
      ...[0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Infinity].flatMap((value) => [
        { ...context, price: { ...context.price, serviceMinorPerUnitDenominator: value } },
        { ...context, price: { ...context.price, serviceMinorPerUnitNumerator: value } },
        { ...context, price: { ...context.price, priceMillis: value } },
      ]),
      { ...context, chargedServiceMinor: 1.5 }, { ...context, ownerDiscountMinor: 1.5 },
      { ...context, minimumCharge: { serviceAdjustmentMinor: 0.5 } },
    ];
    for (const dirty of dirtyContexts) {
      const invalid = { ...snapshot, appleTemporaryUpgrade: dirty };
      expect(() => purchaseSnapshotSchema.safeParse(invalid)).not.toThrow();
      expect(purchaseSnapshotSchema.safeParse(invalid).success).toBe(false);
      expect(() => readPurchaseSnapshot(invalid)).toThrow("billingPaymentNeedsReview");
    }
    const old = selectTemporaryUpgradeBand(policy(), 50000, "143441", "USD");
    expect(purchaseSnapshotSchema.safeParse({ ...snapshot, amountMinor: 50000, appleTemporaryUpgrade: { ...context,
      price: old.price, chargedServiceMinor: old.chargedServiceMinor, ownerDiscountMinor: old.ownerDiscountMinor, minimumCharge: undefined } }).success).toBe(true);
  });
  it("uses exact rational arithmetic and rounds valuation conservatively at subminor boundaries", () => {
    const p = policy(); p.bands = [{ key: "fraction", productId: "synthetic.fraction", prices: [{ ...price(1001), serviceMinorPerUnitNumerator: 1, serviceMinorPerUnitDenominator: 3 }] }];
    expect(selectTemporaryUpgradeBand(p, 1, "143441", "USD").chargedServiceMinor).toBe(1);
    p.bands[0].prices[0] = { ...price(1_000_000_000), serviceMinorPerUnitNumerator: 1_000_000_000, serviceMinorPerUnitDenominator: 1 };
    expect(() => selectTemporaryUpgradeBand(p, 2_147_483_647, "143441", "USD")).toThrow("appleTemporaryUpgradeBelowMinimum");
  });
  it("rejects duplicate SKU bands and inconsistent valuation rates for one market", () => {
    const p = policy();
    p.bands[1].productId = p.bands[0].productId;
    expect(temporaryUpgradePolicySchema.safeParse(p).success).toBe(false);
    const rates = policy(); rates.bands[1].prices[0].serviceMinorPerUnitNumerator = 9001;
    expect(temporaryUpgradePolicySchema.safeParse(rates).success).toBe(false);
  });
});
