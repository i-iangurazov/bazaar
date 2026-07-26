import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  previewCatalogDiscountApply,
  previewCatalogDiscountRemove,
  type CatalogDiscountPreviewProduct,
  type CatalogDiscountPreviewStorePrice,
} from "@/server/services/catalogDiscountPreview";

const now = new Date("2026-08-10T12:00:00.000Z");
const products: CatalogDiscountPreviewProduct[] = [
  {
    id: "product-a",
    name: "Coffee",
    basePriceKgs: new Prisma.Decimal(100),
    variants: [
      { id: "variant-a", name: "Small", isActive: true },
      { id: "variant-b", name: "Large", isActive: true },
    ],
  },
];
const prices: CatalogDiscountPreviewStorePrice[] = [
  {
    productId: "product-a",
    variantId: null,
    variantKey: "BASE",
    priceKgs: new Prisma.Decimal(100),
  },
  {
    productId: "product-a",
    variantId: "variant-a",
    variantKey: "variant-a",
    priceKgs: new Prisma.Decimal(80),
  },
  {
    productId: "product-a",
    variantId: "variant-b",
    variantKey: "variant-b",
    priceKgs: new Prisma.Decimal(140),
  },
];

describe("catalog discount preview", () => {
  it("shows each variant's own old/new percentage price", () => {
    const preview = previewCatalogDiscountApply({
      products,
      storePrices: prices,
      productIds: ["product-a"],
      variantPolicy: "ALL_VARIANTS",
      percentage: 20,
      currency: "KGS",
      now,
    });

    expect(preview.affectedPriceRowCount).toBe(3);
    expect(
      preview.samples.map((sample) => [sample.variantId, sample.currentPrice, sample.nextPrice]),
    ).toEqual([
      [null, "100.00", "80.00"],
      ["variant-a", "80.00", "64.00"],
      ["variant-b", "140.00", "112.00"],
    ]);
  });

  it("previews the sale price at a future schedule start", () => {
    const preview = previewCatalogDiscountApply({
      products,
      storePrices: prices,
      productIds: ["product-a"],
      variantPolicy: "SELECTED_VARIANTS",
      variantIds: ["variant-a"],
      percentage: 25,
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      currency: "KGS",
      now,
    });

    expect(preview.samples[0]).toMatchObject({
      currentPrice: "80.00",
      nextPrice: "60.00",
    });
  });

  it("rejects an already expired schedule", () => {
    expect(() =>
      previewCatalogDiscountApply({
        products,
        storePrices: prices,
        productIds: ["product-a"],
        variantPolicy: "ALL_VARIANTS",
        percentage: 20,
        endsAt: new Date("2026-08-01T00:00:00.000Z"),
        currency: "KGS",
        now,
      }),
    ).toThrow("catalogDiscountScheduleExpired");
  });

  it("removes only price rows with discount metadata", () => {
    const preview = previewCatalogDiscountRemove({
      products,
      storePrices: prices.map((price) => ({
        ...price,
        discount:
          price.variantId === "variant-a" ? { type: "PERCENTAGE" as const, percentage: 20 } : null,
      })),
      productIds: ["product-a"],
      variantPolicy: "ALL_VARIANTS",
      currency: "KGS",
      now,
    });

    expect(preview.affectedPriceRowCount).toBe(1);
    expect(preview.samples).toEqual([
      expect.objectContaining({
        variantId: "variant-a",
        currentPrice: "64.00",
        nextPrice: "80.00",
      }),
    ]);
  });
});
