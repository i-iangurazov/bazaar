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
      copyInventory: false,
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
    expect(QUICK_PRODUCT_DUPLICATION_PRESET.copyInventory).toBe(false);
  });
});
