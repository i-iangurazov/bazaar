import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  CatalogDiscountPlanningError,
  planCatalogDiscountTargets,
} from "@/server/services/catalogDiscountPlanning";

const decimal = (value: string) => new Prisma.Decimal(value);

describe("planCatalogDiscountTargets", () => {
  it("materializes the BASE store price from the product fallback", () => {
    const result = planCatalogDiscountTargets({
      productIds: ["product-1"],
      products: [{ id: "product-1", basePriceKgs: decimal("100.00"), variants: [] }],
      storePrices: [],
      variantPolicy: "ALL_VARIANTS",
    });

    expect(result.affectedPriceRowCount).toBe(1);
    expect(result.materializedPriceRowCount).toBe(1);
    expect(result.targets[0]).toMatchObject({
      productId: "product-1",
      variantId: null,
      variantKey: "BASE",
      priceSource: "PRODUCT_FALLBACK",
      materializeStorePrice: true,
    });
    expect(result.targets[0]?.basePriceKgs.toFixed(2)).toBe("100.00");
  });

  it("preserves distinct BASE and variant prices for all-variant policy", () => {
    const result = planCatalogDiscountTargets({
      productIds: ["product-1"],
      products: [
        {
          id: "product-1",
          basePriceKgs: decimal("50"),
          variants: [
            { id: "variant-b", isActive: true },
            { id: "variant-a", isActive: true },
            { id: "variant-disabled", isActive: false },
          ],
        },
      ],
      storePrices: [
        {
          productId: "product-1",
          variantId: null,
          variantKey: "BASE",
          priceKgs: decimal("100"),
        },
        {
          productId: "product-1",
          variantId: "variant-a",
          variantKey: "variant-a",
          priceKgs: decimal("250"),
        },
        {
          productId: "product-1",
          variantId: "variant-b",
          variantKey: "variant-b",
          priceKgs: decimal("75"),
        },
      ],
      variantPolicy: "ALL_VARIANTS",
    });

    expect(
      result.targets.map((target) => [target.variantKey, target.basePriceKgs.toString()]),
    ).toEqual([
      ["BASE", "100"],
      ["variant-a", "250"],
      ["variant-b", "75"],
    ]);
    expect(result.affectedVariantCount).toBe(2);
    expect(result.materializedPriceRowCount).toBe(0);
  });

  it("materializes an inherited variant price without flattening explicit variants", () => {
    const result = planCatalogDiscountTargets({
      productIds: ["product-1"],
      products: [
        {
          id: "product-1",
          basePriceKgs: decimal("50"),
          variants: [
            { id: "variant-a", isActive: true },
            { id: "variant-b", isActive: true },
          ],
        },
      ],
      storePrices: [
        {
          productId: "product-1",
          variantId: null,
          variantKey: "BASE",
          priceKgs: decimal("100"),
        },
        {
          productId: "product-1",
          variantId: "variant-b",
          variantKey: "variant-b",
          priceKgs: decimal("180"),
        },
      ],
      variantPolicy: "ALL_VARIANTS",
    });

    expect(result.targets.find((target) => target.variantId === "variant-a")).toMatchObject({
      priceSource: "STORE_BASE_INHERITED",
      materializeStorePrice: true,
    });
    expect(
      result.targets.find((target) => target.variantId === "variant-a")?.basePriceKgs.toString(),
    ).toBe("100");
    expect(
      result.targets.find((target) => target.variantId === "variant-b")?.basePriceKgs.toString(),
    ).toBe("180");
  });

  it("selected-variant policy excludes BASE and other variants", () => {
    const result = planCatalogDiscountTargets({
      productIds: ["product-1"],
      products: [
        {
          id: "product-1",
          basePriceKgs: decimal("100"),
          variants: [
            { id: "variant-a", isActive: true },
            { id: "variant-b", isActive: true },
          ],
        },
      ],
      storePrices: [],
      variantPolicy: "SELECTED_VARIANTS",
      variantIds: ["variant-b"],
    });

    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]?.variantId).toBe("variant-b");
  });

  it("reports missing prices instead of inventing zero-valued prices", () => {
    const result = planCatalogDiscountTargets({
      productIds: ["product-1"],
      products: [
        {
          id: "product-1",
          basePriceKgs: null,
          variants: [{ id: "variant-a", isActive: true }],
        },
      ],
      storePrices: [],
      variantPolicy: "ALL_VARIANTS",
    });

    expect(result.targets).toEqual([]);
    expect(result.productsWithoutPrice).toEqual(["product-1"]);
    expect(result.missingTargets).toEqual([
      {
        productId: "product-1",
        variantId: null,
        variantKey: "BASE",
        reason: "PRICE_MISSING",
      },
      {
        productId: "product-1",
        variantId: "variant-a",
        variantKey: "variant-a",
        reason: "PRICE_MISSING",
      },
    ]);
  });

  it("rejects a selected variant outside the selected product scope", () => {
    expect(() =>
      planCatalogDiscountTargets({
        productIds: ["product-1"],
        products: [
          { id: "product-1", basePriceKgs: decimal("100"), variants: [] },
          {
            id: "product-2",
            basePriceKgs: decimal("100"),
            variants: [{ id: "variant-2", isActive: true }],
          },
        ],
        storePrices: [],
        variantPolicy: "SELECTED_VARIANTS",
        variantIds: ["variant-2"],
      }),
    ).toThrowError(new CatalogDiscountPlanningError("catalogDiscountVariantScopeMismatch"));
  });

  it("deduplicates and sorts target identity deterministically for replay fingerprints", () => {
    const result = planCatalogDiscountTargets({
      productIds: ["product-b", "product-a", "product-b"],
      products: [
        { id: "product-a", basePriceKgs: decimal("10"), variants: [] },
        { id: "product-b", basePriceKgs: decimal("20"), variants: [] },
      ],
      storePrices: [],
      variantPolicy: "ALL_VARIANTS",
    });

    expect(result.targets.map((target) => target.productId)).toEqual(["product-a", "product-b"]);
    expect(result.selectedProductCount).toBe(2);
  });
});
