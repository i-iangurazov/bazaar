import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  mapCatalogPriceReadModel,
  summarizeCatalogProductPricing,
} from "@/server/services/catalogPricingReadModel";

const at = new Date("2026-08-10T12:00:00.000Z");

const row = (input: {
  storeId?: string;
  variantId: string | null;
  basePrice: string;
  percentage?: number;
}) =>
  mapCatalogPriceReadModel(
    {
      organizationId: "org-a",
      storeId: input.storeId ?? "store-a",
      productId: "product-a",
      variantId: input.variantId,
      variantKey: input.variantId ?? "BASE",
      currency: "KGS",
      basePrice: new Prisma.Decimal(input.basePrice),
      discount: input.percentage ? { type: "PERCENTAGE", percentage: input.percentage } : null,
    },
    at,
  );

describe("catalog pricing read model", () => {
  it("maps a store/variant scoped discount without flattening prices", () => {
    const base = row({ variantId: null, basePrice: "100", percentage: 20 });
    const variantA = row({ variantId: "variant-a", basePrice: "80", percentage: 20 });
    const variantB = row({ variantId: "variant-b", basePrice: "140", percentage: 10 });
    const summary = summarizeCatalogProductPricing({ base, variants: [variantA, variantB] });

    expect(variantA.effectivePrice.toFixed(2)).toBe("64.00");
    expect(variantB.effectivePrice.toFixed(2)).toBe("126.00");
    expect(summary.minEffectivePrice?.toFixed(2)).toBe("64.00");
    expect(summary.maxEffectivePrice?.toFixed(2)).toBe("126.00");
    expect(summary.base?.effectivePrice.toFixed(2)).toBe("80.00");
  });

  it("rejects a variant key that does not match its variant identity", () => {
    expect(() =>
      mapCatalogPriceReadModel(
        {
          organizationId: "org-a",
          storeId: "store-a",
          productId: "product-a",
          variantId: "variant-a",
          variantKey: "BASE",
          currency: "KGS",
          basePrice: "100",
        },
        at,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "catalogPriceVariantScopeMismatch",
      }),
    );
  });

  it("rejects mixing rows from different stores", () => {
    const base = row({ variantId: null, basePrice: "100" });
    const wrongStore = row({ storeId: "store-b", variantId: "variant-a", basePrice: "80" });
    expect(() => summarizeCatalogProductPricing({ base, variants: [wrongStore] })).toThrowError(
      expect.objectContaining({
        code: "catalogProductPriceScopeMismatch",
      }),
    );
  });
});
