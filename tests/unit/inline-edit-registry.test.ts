import { describe, expect, it } from "vitest";

import { inlineEditRegistry } from "@/lib/inlineEdit/registry";

describe("inline edit registry", () => {
  it("maps products.onHand absolute value to inventory.adjust delta", () => {
    const row = {
      id: "product-1",
      name: "Product 1",
      category: null,
      unit: "шт",
      baseUnitId: "unit-1",
      basePriceKgs: 100,
      onHandQty: 12,
    };
    const context = {
      storeId: "store-1",
      categories: [],
      stockAdjustReason: "inlineStockEdit",
    };

    const parsed = inlineEditRegistry.products.onHand.parser("18", row, context);
    expect(parsed).toEqual({ ok: true, value: 18 });

    const operation = inlineEditRegistry.products.onHand.mutation(row, 18, context);
    expect(operation).toMatchObject({
      route: "inventory.adjust",
      input: {
        storeId: "store-1",
        productId: "product-1",
        qtyDelta: 6,
        reason: "inlineStockEdit",
      },
    });
    if (operation.route === "inventory.adjust") {
      expect(operation.input.idempotencyKey.length).toBeGreaterThanOrEqual(8);
    }
  });

  it("blocks products.onHand inline parsing and permission when store is not selected", () => {
    const row = {
      id: "product-1",
      name: "Product 1",
      category: null,
      unit: "шт",
      baseUnitId: "unit-1",
      basePriceKgs: 100,
      onHandQty: 12,
    };
    const context = {
      storeId: null,
      categories: [],
      stockAdjustReason: "inlineStockEdit",
    };

    const parsed = inlineEditRegistry.products.onHand.parser("18", row, context);
    expect(parsed).toEqual({ ok: false, errorKey: "storeRequired" });

    expect(inlineEditRegistry.products.onHand.permissionCheck("MANAGER", row, context)).toBe(false);
    expect(
      inlineEditRegistry.products.onHand.permissionCheck("MANAGER", row, { ...context, storeId: "store-1" }),
    ).toBe(true);
  });
});
