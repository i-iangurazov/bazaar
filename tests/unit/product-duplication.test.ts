import { describe, expect, it } from "vitest";

import {
  buildQuickProductDuplicateInput,
  QUICK_PRODUCT_DUPLICATION_PRESET,
} from "@/lib/productDuplication";

describe("quick product duplication", () => {
  it("copies normal catalog configuration without fabricating physical inventory", () => {
    const input = buildQuickProductDuplicateInput({
      productId: "product-1",
      idempotencyKey: "duplicate-product-1",
    });

    expect(input).toEqual({
      productId: "product-1",
      idempotencyKey: "duplicate-product-1",
      status: "ACTIVE",
      copyImages: true,
      copyDescription: true,
      copyCategory: true,
      copyOtherDetails: true,
      copyPrice: true,
      copyCost: true,
      copyVariants: true,
      copyCharacteristics: true,
      copySku: true,
    });
    expect(input).not.toHaveProperty("name");
    // Omitting copyInventory is the backend's safe catalog-copy default:
    // preserve reorder configuration while physical on-hand remains zero.
    expect(input).not.toHaveProperty("copyInventory");
    expect(QUICK_PRODUCT_DUPLICATION_PRESET).not.toHaveProperty("copyInventory");
  });
});
