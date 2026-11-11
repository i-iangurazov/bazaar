import { describe, expect, it } from "vitest";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { selectTemporaryUpgradeBand, temporaryUpgradePolicy, temporaryUpgradePolicySchema } from "@/server/billing/appleTemporaryUpgradePolicy";

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
