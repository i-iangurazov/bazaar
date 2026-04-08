import { describe, expect, it } from "vitest";

import { deriveBasePriceFallbackCandidate } from "@/lib/basePriceFallback";

describe("deriveBasePriceFallbackCandidate", () => {
  it("returns a candidate when exactly one store price is available", () => {
    expect(
      deriveBasePriceFallbackCandidate([
        {
          storeId: "store-1",
          storeName: "mpro.kg",
          overridePriceKgs: 200,
          effectivePriceKgs: 200,
        },
      ]),
    ).toEqual({
      priceKgs: 200,
      sourceStoreId: "store-1",
      sourceStoreName: "mpro.kg",
      matchingStoreCount: 1,
    });
  });

  it("returns a candidate when all store prices match", () => {
    expect(
      deriveBasePriceFallbackCandidate([
        {
          storeId: "store-1",
          storeName: "mpro.kg",
          overridePriceKgs: 200,
          effectivePriceKgs: 200,
        },
        {
          storeId: "store-2",
          storeName: "mpro-2.kg",
          overridePriceKgs: 200,
          effectivePriceKgs: 200,
        },
      ]),
    ).toEqual({
      priceKgs: 200,
      sourceStoreId: "store-1",
      sourceStoreName: "mpro.kg",
      matchingStoreCount: 2,
    });
  });

  it("returns null when store prices conflict", () => {
    expect(
      deriveBasePriceFallbackCandidate([
        {
          storeId: "store-1",
          storeName: "mpro.kg",
          overridePriceKgs: 200,
          effectivePriceKgs: 200,
        },
        {
          storeId: "store-2",
          storeName: "mpro-2.kg",
          overridePriceKgs: 220,
          effectivePriceKgs: 220,
        },
      ]),
    ).toBeNull();
  });
});
