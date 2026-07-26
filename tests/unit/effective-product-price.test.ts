import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  EffectiveProductPriceError,
  getEffectiveProductPrice,
} from "@/server/services/effectiveProductPrice";

const NOW = new Date("2026-07-26T06:00:00.000Z");

const money = (value: Prisma.Decimal | null) => value?.toFixed(2) ?? null;

describe("getEffectiveProductPrice", () => {
  it("calculates an active percentage discount with Decimal half-up rounding", () => {
    const result = getEffectiveProductPrice({
      basePrice: new Prisma.Decimal("10.01"),
      discount: { type: "PERCENTAGE", percentage: new Prisma.Decimal("33.33") },
      now: NOW,
      currency: "kgs",
    });

    expect(result.currency).toBe("KGS");
    expect(money(result.basePrice)).toBe("10.01");
    expect(money(result.effectivePrice)).toBe("6.67");
    expect(money(result.compareAtPrice)).toBe("10.01");
    expect(result.discountPercentage?.toFixed(2)).toBe("33.33");
    expect(result.hasActiveDiscount).toBe(true);
  });

  it("treats the start as inclusive and the end as exclusive", () => {
    const atStart = getEffectiveProductPrice({
      basePrice: "100.00",
      discount: {
        type: "PERCENTAGE",
        percentage: "20",
        startsAt: NOW,
        endsAt: new Date("2026-07-26T07:00:00.000Z"),
      },
      now: NOW,
      currency: "KGS",
    });
    const atEnd = getEffectiveProductPrice({
      basePrice: "100.00",
      discount: {
        type: "PERCENTAGE",
        percentage: "20",
        startsAt: new Date("2026-07-26T05:00:00.000Z"),
        endsAt: NOW,
      },
      now: NOW,
      currency: "KGS",
    });

    expect(money(atStart.effectivePrice)).toBe("80.00");
    expect(atStart.hasActiveDiscount).toBe(true);
    expect(money(atEnd.effectivePrice)).toBe("100.00");
    expect(atEnd.compareAtPrice).toBeNull();
    expect(atEnd.hasActiveDiscount).toBe(false);
  });

  it("preserves future discount metadata without applying it early", () => {
    const startsAt = new Date("2026-07-27T00:00:00.000Z");
    const result = getEffectiveProductPrice({
      basePrice: "1000",
      discount: { type: "PERCENTAGE", percentage: "20", startsAt },
      now: NOW,
      currency: "KGS",
    });

    expect(money(result.effectivePrice)).toBe("1000.00");
    expect(result.hasActiveDiscount).toBe(false);
    expect(result.discountPercentage?.toString()).toBe("20");
    expect(result.startsAt).toEqual(startsAt);
  });

  it("returns the base price when no discount exists", () => {
    const result = getEffectiveProductPrice({
      basePrice: "125.40",
      discount: null,
      now: NOW,
      currency: "KGS",
    });

    expect(money(result.effectivePrice)).toBe("125.40");
    expect(result.compareAtPrice).toBeNull();
    expect(result.discountPercentage).toBeNull();
    expect(result.hasActiveDiscount).toBe(false);
  });

  it.each(["0", "100", "-1", "Infinity", "NaN"])("rejects invalid percentage %s", (percentage) => {
    expect(() =>
      getEffectiveProductPrice({
        basePrice: "100",
        discount: { type: "PERCENTAGE", percentage },
        now: NOW,
        currency: "KGS",
      }),
    ).toThrowError(new EffectiveProductPriceError("invalidDiscountPercentage"));
  });

  it("rejects a non-positive schedule window", () => {
    expect(() =>
      getEffectiveProductPrice({
        basePrice: "100",
        discount: {
          type: "PERCENTAGE",
          percentage: "20",
          startsAt: NOW,
          endsAt: NOW,
        },
        now: NOW,
        currency: "KGS",
      }),
    ).toThrowError(new EffectiveProductPriceError("discountEndMustBeAfterStart"));
  });

  it("rejects a negative base price", () => {
    expect(() =>
      getEffectiveProductPrice({
        basePrice: "-0.01",
        discount: null,
        now: NOW,
        currency: "KGS",
      }),
    ).toThrowError(new EffectiveProductPriceError("invalidBasePrice"));
  });
});
