import { describe, expect, it } from "vitest";

import {
  isExactLikeGlobalSearchQuery,
  resolveGlobalSearchPlan,
} from "@/server/services/search/global";

describe("global search planning", () => {
  it("treats barcode and sku-like terms as exact lookups", () => {
    expect(
      isExactLikeGlobalSearchQuery({
        query: "BAR-001",
        normalizedScanQuery: "BAR-001",
      }),
    ).toBe(true);

    expect(
      isExactLikeGlobalSearchQuery({
        query: "acme",
        normalizedScanQuery: "acme",
      }),
    ).toBe(false);
  });

  it("short-circuits on exact sku-like hits and narrows misses to product-only fuzzy search", () => {
    expect(
      resolveGlobalSearchPlan({
        query: "BAR-001",
        normalizedScanQuery: "BAR-001",
        exactMatchCount: 1,
      }),
    ).toMatchObject({
      exactLookupLike: true,
      shortCircuitOnExact: true,
      productOnlyFuzzy: false,
    });

    expect(
      resolveGlobalSearchPlan({
        query: "BAR-001",
        normalizedScanQuery: "BAR-001",
        exactMatchCount: 0,
      }),
    ).toMatchObject({
      exactLookupLike: true,
      shortCircuitOnExact: false,
      productOnlyFuzzy: true,
      includeGroupedEntities: false,
      includePurchaseOrders: false,
    });
  });

  it("keeps grouped fuzzy search for text queries", () => {
    expect(
      resolveGlobalSearchPlan({
        query: "acm",
        normalizedScanQuery: "acm",
        exactMatchCount: 0,
      }),
    ).toMatchObject({
      exactLookupLike: false,
      shortCircuitOnExact: false,
      productOnlyFuzzy: false,
      includeGroupedEntities: true,
      includePurchaseOrders: true,
    });

    expect(
      resolveGlobalSearchPlan({
        query: "ac",
        normalizedScanQuery: "ac",
        exactMatchCount: 0,
      }),
    ).toMatchObject({
      includePurchaseOrders: false,
    });
  });
});
