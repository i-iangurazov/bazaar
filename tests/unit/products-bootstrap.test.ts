import { describe, expect, it } from "vitest";

import { resolveProductsBootstrapStoreId } from "@/server/services/products/read";

describe("products bootstrap store resolution", () => {
  it("auto-selects the only store when no preference is stored", () => {
    expect(
      resolveProductsBootstrapStoreId({
        storeIds: ["store-1"],
      }),
    ).toBe("store-1");
  });

  it("keeps multi-store orgs unfiltered until the user chooses a store", () => {
    expect(
      resolveProductsBootstrapStoreId({
        storeIds: ["store-1", "store-2"],
      }),
    ).toBeNull();
  });

  it("preserves an explicit stored preference", () => {
    expect(
      resolveProductsBootstrapStoreId({
        preferredStoreId: "store-2",
        storeIds: ["store-1", "store-2"],
      }),
    ).toBe("store-2");
  });
});
