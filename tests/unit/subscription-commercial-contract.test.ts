import { afterEach, describe, expect, it, vi } from "vitest";
import { contractPlan, createContractTerms, readContractTerms } from "@/server/billing/contractTerms";
import { subscriptionPrice, validateSubscriptionExtras } from "@/lib/billing/subscriptionPricing";

afterEach(() => vi.unstubAllEnvs());
describe("commercial contract, independent from future public configuration", () => {
  it("keeps agreed prices when legacy environment overrides change", () => {
    vi.stubEnv("PLAN_PRICE_STARTER_KGS", "1800");
    const frozen = JSON.parse(JSON.stringify(createContractTerms("2026-10")));
    vi.stubEnv("PLAN_PRICE_STARTER_KGS", "9000");
    expect(contractPlan(readContractTerms(frozen)!, "STARTER").monthlyPriceKgs).toBe(1800);
  });
  it("preserves the old Business grants and capacity while selling a distinct new contract", () => {
    const old = contractPlan(createContractTerms("2026-10"), "BUSINESS");
    const current = contractPlan(createContractTerms("2026-11"), "BUSINESS");
    expect(old.limits).toEqual({ maxStores: 5, maxProducts: 5000, maxActiveUsers: 10 });
    expect(old.features).toMatchObject({ bundles: true, expiryLots: true, periodClose: true,
      bazaarApi: true, marketplaces: true, emailMarketing: true });
    expect(current.limits).toEqual({ maxStores: 1, maxProducts: 5000, maxActiveUsers: 5 });
    expect(current.features).toMatchObject({ bundles: false, expiryLots: false, periodClose: false,
      bazaarApi: false, marketplaces: false, emailMarketing: true });
    expect(old.countArchivedProducts).toBe(true);
    expect(current.countArchivedProducts).toBe(false);
  });
  it.each(["STARTER", "BUSINESS", "ENTERPRISE"] as const)("keeps core commerce usable on %s", (plan) => {
    const terms = contractPlan(createContractTerms("2026-11"), plan);
    expect(terms.features).toMatchObject({ pos: true, stockCounts: true, storePrices: true,
      priceTags: true, customerOrders: true, initialImport: true, rawDataExport: true, kkm: false });
  });
  it("checks all 42 allowed configurations and all three payment terms", () => {
    const table = [
      { plan: "STARTER", price: 2000, extraMax: 0, cards: 1000, users: 2, ai: 100 },
      { plan: "BUSINESS", price: 3500, extraMax: 4, cards: 5000, users: 5, ai: 300 },
      { plan: "ENTERPRISE", price: 5500, extraMax: 14, cards: 15000, users: 15, ai: 500 },
    ] as const;
    let configurations = 0;
    const contract = createContractTerms("2026-11");
    for (const row of table) for (let stores = 0; stores <= row.extraMax; stores++)
      for (const reserve of [0, 1]) {
        const extras = { stores, productPacks: reserve, userPacks: 0 };
        const selected = contractPlan(contract, row.plan, extras);
        expect(selected.limits).toEqual({ maxStores: 1 + stores,
          maxProducts: row.cards + reserve * 1000, maxActiveUsers: row.users + reserve * 2 });
        expect(selected.features).toEqual(contract.plans[row.plan].features);
        expect(selected.usageLimits.ai).toBe(row.ai);
        const amount = row.price + stores * 1000 + reserve * 500;
        expect(subscriptionPrice(row.price * 100, 1, extras).amountMinor).toBe(amount * 100);
        expect(subscriptionPrice(row.price * 100, 6, extras).amountMinor).toBe(amount * 570);
        expect(subscriptionPrice(row.price * 100, 12, extras).amountMinor).toBe(amount * 1020);
        configurations++;
      }
    expect(configurations).toBe(42);
  });
  it.each([
    ["STARTER", 1, 0, 0], ["STARTER", 14, 0, 0], ["BUSINESS", 5, 0, 0],
    ["ENTERPRISE", 15, 0, 0], ["STARTER", 0, 2, 0], ["BUSINESS", 0, 0, 1],
    ["ENTERPRISE", -1, 0, 0], ["BUSINESS", 1.5, 0, 0],
  ] as const)("rejects bypass %s / %s / %s / %s", (plan, stores, productPacks, userPacks) => {
    expect(() => validateSubscriptionExtras(plan, { stores, productPacks, userPacks })).toThrow();
    expect(() => contractPlan(createContractTerms("2026-11"), plan, { stores, productPacks, userPacks }))
      .toThrow("billingInvalidExtras");
  });
  it("does not attach new paid add-ons to old contracts", () => {
    expect(() => contractPlan(createContractTerms("2026-10"), "BUSINESS",
      { stores: 1, productPacks: 0, userPacks: 0 })).toThrow("billingInvalidExtras");
  });
  it("fails closed for incomplete or malformed frozen contracts", () => {
    expect(() => readContractTerms({})).toThrow("billingContractNeedsReview");
    const terms = createContractTerms("2026-11");
    const invalid = JSON.parse(JSON.stringify(terms));
    delete invalid.plans.STARTER.features.pos;
    expect(() => readContractTerms(invalid)).toThrow("billingContractNeedsReview");
  });
});
