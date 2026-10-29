import { afterEach, describe, expect, it, vi } from "vitest";

import { PLAN_CODES, PLAN_FEATURE_CODES, getPlanRank, toPlanCode } from "@/lib/billing/plans";
import {
  getPlanCatalogEntries,
  getPlanFeatureMap,
  getPlanLimits,
  getPlanMonthlyPriceKgs,
} from "@/server/billing/planCatalog";

describe("plan catalog limits", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses production store and product limits for each tier", () => {
    expect(getPlanLimits("STARTER")).toEqual({
      maxStores: 1,
      maxProducts: 1000,
      maxActiveUsers: 5,
    });
    expect(getPlanLimits("BUSINESS")).toEqual({
      maxStores: 5,
      maxProducts: 5000,
      maxActiveUsers: 10,
    });
    expect(getPlanLimits("ENTERPRISE")).toEqual({
      maxStores: 15,
      maxProducts: 20000,
      maxActiveUsers: 20,
    });
  });

  it("makes POS available on Starter while preserving the advanced module gates", () => {
    expect(getPlanFeatureMap("STARTER")).toMatchObject({
      pos: true,
      priceTags: true,
      customerOrders: true,
      imports: false,
      exports: false,
      analytics: false,
      compliance: false,
      stockCounts: false,
      kkm: false,
    });
  });

  it("keeps advertised inheritance valid and covers every feature in the comparison", () => {
    const plans = getPlanCatalogEntries();
    expect(plans.map((p) => p.code)).toEqual([...PLAN_CODES]);
    for (const [index, plan] of plans.entries()) {
      expect(Object.keys(plan.features).sort()).toEqual([...PLAN_FEATURE_CODES].sort());
      const previous = plans[index - 1];
      if (previous)
        for (const feature of PLAN_FEATURE_CODES) {
          if (previous.features[feature]) expect(plan.features[feature]).toBe(true);
        }
    }
  });

  it("resolves the same exact KGS override for public and billing catalog entries", () => {
    vi.stubEnv("PLAN_PRICE_STARTER_KGS", "1890.50");
    expect(getPlanMonthlyPriceKgs("STARTER")).toBe(1890.5);
    expect(getPlanCatalogEntries()[0].monthlyPriceKgs).toBe(1890.5);
  });

  it.each(["", "0", "-5", "NaN", "Infinity"])("ignores invalid price override %s", (value) => {
    vi.stubEnv("PLAN_PRICE_STARTER_KGS", value);
    expect(getPlanCatalogEntries()[0].monthlyPriceKgs).toBe(1750);
  });

  it("preserves legacy PRO mapping and upgrade order", () => {
    expect(toPlanCode("PRO")).toBe("BUSINESS");
    expect(getPlanRank("PRO")).toBe(getPlanRank("BUSINESS"));
    expect(getPlanRank("STARTER")).toBeLessThan(getPlanRank("BUSINESS"));
    expect(getPlanRank("BUSINESS")).toBeLessThan(getPlanRank("ENTERPRISE"));
  });
});
