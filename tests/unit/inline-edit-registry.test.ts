import { describe, expect, it } from "vitest";

import { inlineEditRegistry } from "@/lib/inlineEdit/registry";

describe("inline edit registry", () => {
  it("edits only store wholesale in the displayed currency, including zero and clearing", () => {
    const row = {
      id: "p",
      name: "Product",
      category: null,
      unit: "шт",
      baseUnitId: "u",
      basePriceKgs: 100,
      onHandQty: 5,
    };
    const context = {
      storeId: "s",
      wholesalePricesEnabled: true,
      categories: [],
      stockAdjustReason: "edit",
      currencyCode: "USD",
      currencyRateKgsPerUnit: 86,
    };
    const definition = inlineEditRegistry.products.wholesalePrice;
    expect(definition.parser("1,5", row, context)).toEqual({ ok: true, value: 129 });
    expect(definition.parser("0", row, context)).toEqual({ ok: true, value: 0 });
    expect(definition.parser("", row, context)).toEqual({ ok: true, value: null });
    expect(definition.parser("-1", row, context).ok).toBe(false);
    expect(definition.mutation(row, 129, context)).toEqual({
      route: "storePrices.upsert",
      input: { storeId: "s", productId: "p", variantId: null, wholesalePriceKgs: 129 },
    });
    for (const role of ["ADMIN", "MANAGER"])
      expect(definition.permissionCheck(role, row, context)).toBe(true);
    for (const role of ["STAFF", "CASHIER"])
      expect(definition.permissionCheck(role, row, context)).toBe(false);
    expect(definition.permissionCheck("ADMIN", row, { ...context, storeId: null })).toBe(false);
    expect(
      definition.permissionCheck("ADMIN", row, { ...context, wholesalePricesEnabled: false }),
    ).toBe(false);
  });
  it("sends an absolute stock target with the displayed baseline", () => {
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
      route: "inventory.setOnHand",
      input: {
        storeId: "store-1",
        productId: "product-1",
        targetOnHand: 18,
        expectedOnHand: 12,
        expectedVersion: 0,
        reason: "inlineStockEdit",
      },
    });
    if (operation.route === "inventory.setOnHand") {
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
      inlineEditRegistry.products.onHand.permissionCheck("MANAGER", row, {
        ...context,
        storeId: "store-1",
      }),
    ).toBe(true);
    expect(
      inlineEditRegistry.products.onHand.permissionCheck("ADMIN", row, {
        ...context,
        storeId: "store-1",
      }),
    ).toBe(true);
  });

  it("allows managers to inline edit master product fields", () => {
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
      categories: ["Shoes"],
      stockAdjustReason: "inlineStockEdit",
    };

    expect(inlineEditRegistry.products.name.permissionCheck("MANAGER", row, context)).toBe(true);
    expect(inlineEditRegistry.products.category.permissionCheck("MANAGER", row, context)).toBe(
      true,
    );
    expect(inlineEditRegistry.products.salePrice.permissionCheck("MANAGER", row, context)).toBe(
      true,
    );
    expect(inlineEditRegistry.products.avgCost.permissionCheck("MANAGER", row, context)).toBe(true);
  });
});
