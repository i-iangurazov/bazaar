import { describe, expect, it } from "vitest";

import { resolveProductsBootstrapStoreId } from "@/server/services/products/read";

describe("products bootstrap store resolution", () => {
  it("preserves an explicit all-stores selection instead of selecting the first store", () => {
    expect(
      resolveProductsBootstrapStoreId({
        preferredStoreId: "all",
        storeIds: ["empty-store", "populated-store"],
      }),
    ).toBeNull();
  });

  it("auto-selects the only store when no preference is stored", () => {
    expect(
      resolveProductsBootstrapStoreId({
        storeIds: ["store-1"],
      }),
    ).toBe("store-1");
  });

  it("uses a safe accessible fallback instead of showing all stores when no preference exists", () => {
    expect(
      resolveProductsBootstrapStoreId({
        storeIds: ["store-1", "store-2"],
      }),
    ).toBe("store-1");
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
