import { describe, expect, it } from "vitest";

import {
  applyCatalogDiscountInputSchema,
  previewCatalogDiscountInputSchema,
  removeCatalogDiscountInputSchema,
} from "@/lib/catalogDiscountContract";

describe("catalog discount router contract", () => {
  it("accepts a store-scoped percentage schedule", () => {
    const input = applyCatalogDiscountInputSchema.parse({
      idempotencyKey: "discount-operation-1",
      storeId: "store-a",
      productIds: ["product-a", "product-b"],
      variantPolicy: "ALL_VARIANTS",
      variantIds: [],
      percentage: 20,
      startsAt: new Date("2026-08-01T00:00:00.000Z"),
      endsAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    expect(input).toMatchObject({
      storeId: "store-a",
      productIds: ["product-a", "product-b"],
      percentage: 20,
    });
  });

  it("requires an explicit selected-variant set", () => {
    const result = previewCatalogDiscountInputSchema.safeParse({
      action: "APPLY",
      storeId: "store-a",
      productIds: ["product-a"],
      variantPolicy: "SELECTED_VARIANTS",
      variantIds: [],
      percentage: 20,
      startsAt: null,
      endsAt: null,
    });

    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((issue) => issue.message)).toContain(
      "catalogDiscountVariantsRequired",
    );
  });

  it("rejects an inverted schedule and invalid percentage", () => {
    const result = applyCatalogDiscountInputSchema.safeParse({
      idempotencyKey: "discount-operation-2",
      storeId: "store-a",
      productIds: ["product-a"],
      variantPolicy: "ALL_VARIANTS",
      variantIds: [],
      percentage: 100,
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
    expect(messages).toContain("Number must be less than 100");
    expect(messages).toContain("catalogDiscountEndMustBeAfterStart");
  });

  it("keeps remove operations idempotent and store scoped", () => {
    expect(
      removeCatalogDiscountInputSchema.parse({
        idempotencyKey: "discount-remove-1",
        storeId: "store-b",
        productIds: ["product-a"],
        variantPolicy: "SELECTED_VARIANTS",
        variantIds: ["variant-a"],
      }),
    ).toEqual({
      idempotencyKey: "discount-remove-1",
      storeId: "store-b",
      productIds: ["product-a"],
      variantPolicy: "SELECTED_VARIANTS",
      variantIds: ["variant-a"],
    });
  });
});
