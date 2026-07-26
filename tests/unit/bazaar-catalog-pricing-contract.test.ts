import { describe, expect, it } from "vitest";

import {
  mapBazaarCatalogPricing,
  withBazaarCatalogPricing,
} from "@/server/services/bazaarCatalogPricingMapper";

const now = new Date("2026-08-10T12:00:00.000Z");
const scope = {
  organizationId: "org-a",
  storeId: "store-a",
  productId: "product-a",
  variantId: null,
  variantKey: "BASE",
  currency: "KGS",
  basePrice: "1000.00",
} as const;

describe("Bazaar API additive pricing contract", () => {
  it("preserves the legacy current-sellable-price field while exposing an active sale", () => {
    const result = withBazaarCatalogPricing({
      item: { id: "product-a", price: 800, priceKgs: 800 },
      priceScope: {
        ...scope,
        discount: { type: "PERCENTAGE", percentage: "20" },
      },
      now,
    });

    expect(result.price).toBe(800);
    expect(result.pricing).toEqual({
      currency: "KGS",
      basePrice: 1000,
      effectivePrice: 800,
      compareAtPrice: 1000,
      hasDiscount: true,
      discount: {
        type: "PERCENTAGE",
        value: 20,
        startsAt: null,
        endsAt: null,
      },
    });
  });

  it("returns explicit no-discount semantics", () => {
    expect(mapBazaarCatalogPricing(scope, now)).toEqual({
      currency: "KGS",
      basePrice: 1000,
      effectivePrice: 1000,
      compareAtPrice: null,
      hasDiscount: false,
      discount: null,
    });
  });

  it("exposes a future schedule without advertising it as active", () => {
    const result = mapBazaarCatalogPricing(
      {
        ...scope,
        discount: {
          type: "PERCENTAGE",
          percentage: 25,
          startsAt: new Date("2026-09-01T00:00:00.000Z"),
          endsAt: new Date("2026-10-01T00:00:00.000Z"),
        },
      },
      now,
    );

    expect(result.effectivePrice).toBe(1000);
    expect(result.compareAtPrice).toBeNull();
    expect(result.hasDiscount).toBe(false);
    expect(result.discount).toMatchObject({
      value: 25,
      startsAt: "2026-09-01T00:00:00.000Z",
      endsAt: "2026-10-01T00:00:00.000Z",
    });
  });

  it("keeps store and variant pricing independent", () => {
    const storeA = mapBazaarCatalogPricing(
      {
        ...scope,
        variantId: "variant-a",
        variantKey: "variant-a",
        basePrice: "200",
        discount: { type: "PERCENTAGE", percentage: 20 },
      },
      now,
    );
    const storeB = mapBazaarCatalogPricing(
      {
        ...scope,
        storeId: "store-b",
        variantId: "variant-a",
        variantKey: "variant-a",
        basePrice: "350",
        discount: { type: "PERCENTAGE", percentage: 10 },
      },
      now,
    );

    expect(storeA.effectivePrice).toBe(160);
    expect(storeB.effectivePrice).toBe(315);
  });
});
