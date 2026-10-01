import { describe, expect, it } from "vitest";

import { calculateLoyalty, type LoyaltyRules } from "@/server/services/loyalty/calc";

const rules: LoyaltyRules = {
  memberDiscountPercent: 5,
  earnPercent: 5,
  maxSpendPercent: 50,
  pointValueKgs: 1,
  minRedeemPoints: 0,
  excludePromoItems: true,
  combinePromoDiscount: false,
};

const oneThousandLine = (overrides: Partial<{ participates: boolean; promoDiscountKgs: number }> = {}) => [
  {
    lineId: "l1",
    baseUnitPriceKgs: 1000,
    promoDiscountKgs: overrides.promoDiscountKgs ?? 0,
    qty: 1,
    participates: overrides.participates ?? true,
  },
];

describe("loyalty calculation", () => {
  it.each([0, 0.00001, 0.0001, 0.001, 1.001])("rejects point value %s that could debit points with no money value", pointValueKgs => {
    expect(() => calculateLoyalty({ rules: { ...rules, pointValueKgs }, lines: oneThousandLine(), availablePoints: 1000, requestedPoints: 1 })).toThrow("loyaltyInvalidPointValue");
  });
  it("matches the 1000 KGS example: 5% member discount, 50% redeem cap, 5% earn", () => {
    const base = calculateLoyalty({ rules, lines: oneThousandLine(), availablePoints: 100000 });
    expect(base.memberDiscountKgs).toBe(50);
    expect(base.eligibleKgs).toBe(950);
    expect(base.maxRedeemPoints).toBe(475);
    expect(base.payableKgs).toBe(950);
    expect(base.earnPoints).toBe(47); // floor(950 * 5%)
  });

  it("spending the full cap leaves 475 to pay and earns 23", () => {
    const result = calculateLoyalty({
      rules,
      lines: oneThousandLine(),
      availablePoints: 100000,
      requestedPoints: 475,
    });
    expect(result.redeemPoints).toBe(475);
    expect(result.redeemValueKgs).toBe(475);
    expect(result.payableKgs).toBe(475);
    expect(result.earnPoints).toBe(23); // floor(475 * 5%)
  });

  it("caps the spend at the available balance (balance 100 → pay 850, earn 42)", () => {
    const result = calculateLoyalty({
      rules,
      lines: oneThousandLine(),
      availablePoints: 100,
      requestedPoints: 475,
    });
    expect(result.maxRedeemPoints).toBe(100);
    expect(result.redeemPoints).toBe(100);
    expect(result.payableKgs).toBe(850);
    expect(result.earnPoints).toBe(42); // floor(850 * 5%)
  });

  it("never sums the member discount with an existing promo discount", () => {
    const result = calculateLoyalty({
      rules,
      lines: oneThousandLine({ promoDiscountKgs: 200 }),
      availablePoints: 100000,
    });
    // max(200 promo, 50 member) = 200, so member contributes nothing extra.
    expect(result.memberDiscountKgs).toBe(0);
    expect(result.eligibleKgs).toBe(800);
    expect(result.maxRedeemPoints).toBe(400);
  });

  it("excludes non-participating positions (delivery/services) from discount and earn", () => {
    const result = calculateLoyalty({
      rules,
      lines: [
        ...oneThousandLine(),
        { lineId: "delivery", baseUnitPriceKgs: 100, promoDiscountKgs: 0, qty: 1, participates: false },
      ],
      availablePoints: 0,
    });
    expect(result.eligibleKgs).toBe(950);
    expect(result.nonEligibleKgs).toBe(100);
    expect(result.memberDiscountKgs).toBe(50);
    expect(result.payableKgs).toBe(1050);
    expect(result.earnPoints).toBe(47); // earn only on the 950 eligible
  });

  it("ignores a redemption below the configured minimum", () => {
    const result = calculateLoyalty({
      rules: { ...rules, minRedeemPoints: 100 },
      lines: oneThousandLine(),
      availablePoints: 100000,
      requestedPoints: 50,
    });
    expect(result.redeemPoints).toBe(0);
    expect(result.payableKgs).toBe(950);
  });
});
