import { describe, expect, it } from "vitest";

import {
  serializeSalesOrderUpdateLines,
  type SalesOrderUpdateSourceLine,
} from "@/lib/salesOrderUpdateLines";

const line = (overrides: Partial<SalesOrderUpdateSourceLine>): SalesOrderUpdateSourceLine => ({
  lineId: "line-1",
  productId: "product-1",
  variantId: null,
  qty: 1,
  unitPriceKgs: 100,
  initialPriceKgs: 100,
  priceEdited: false,
  priceSource: "RETAIL",
  repriced: false,
  ...overrides,
});

const serialized = (input: SalesOrderUpdateSourceLine) =>
  serializeSalesOrderUpdateLines([input])[0]!;

describe("sales order update line provenance", () => {
  it("keeps an edited manual line as MANUAL through 95 → 96 → 95", () => {
    const initial = line({ unitPriceKgs: 95, initialPriceKgs: 95, priceEdited: false });
    expect(serialized(initial)).not.toHaveProperty("unitPriceKgs");
    expect(serialized(initial)).not.toHaveProperty("priceSource");

    const raised = line({ unitPriceKgs: 96, initialPriceKgs: 95, priceEdited: true });
    expect(serialized(raised)).toMatchObject({ unitPriceKgs: 96, priceSource: "MANUAL" });

    const returned = line({ unitPriceKgs: 95, initialPriceKgs: 95, priceEdited: true });
    expect(serialized(returned)).toMatchObject({ unitPriceKgs: 95, priceSource: "MANUAL" });
  });

  it("keeps a bulk-repriced wholesale line as WHOLESALE through 90 → 91 → 90", () => {
    const repricedUp = line({
      unitPriceKgs: 91,
      initialPriceKgs: 90,
      priceEdited: false,
      repriced: true,
      priceSource: "WHOLESALE",
    });
    expect(serialized(repricedUp)).toMatchObject({
      unitPriceKgs: 91,
      priceSource: "WHOLESALE",
    });

    const repricedBack = line({
      unitPriceKgs: 90,
      initialPriceKgs: 90,
      priceEdited: false,
      repriced: true,
      priceSource: "WHOLESALE",
    });
    expect(serialized(repricedBack)).toMatchObject({
      unitPriceKgs: 90,
      priceSource: "WHOLESALE",
    });
  });

  it("marks a manual price equal to the catalogue price as MANUAL", () => {
    const manualAtCatalogue = line({
      unitPriceKgs: 100,
      initialPriceKgs: 100,
      priceEdited: true,
    });
    expect(serialized(manualAtCatalogue)).toMatchObject({
      unitPriceKgs: 100,
      priceSource: "MANUAL",
    });
  });

  it("sends RETAIL when bulk repricing lands on the same amount", () => {
    const sameAmount = line({
      unitPriceKgs: 100,
      initialPriceKgs: 100,
      priceEdited: false,
      repriced: true,
      priceSource: "RETAIL",
    });
    expect(serialized(sameAmount)).toMatchObject({ unitPriceKgs: 100, priceSource: "RETAIL" });
  });

  it("omits unresolved and untouched values instead of inventing a price", () => {
    const missing = line({
      unitPriceKgs: null,
      initialPriceKgs: null,
      priceEdited: false,
      priceSource: "MISSING",
      repriced: true,
    });
    expect(serialized(missing)).toEqual({
      lineId: "line-1",
      productId: "product-1",
      variantId: null,
      qty: 1,
    });

    const clearedManual = line({ unitPriceKgs: null, priceEdited: true });
    expect(serialized(clearedManual)).toEqual({
      lineId: "line-1",
      productId: "product-1",
      variantId: null,
      qty: 1,
    });

    const untouched = line({});
    expect(serialized(untouched)).toEqual({
      lineId: "line-1",
      productId: "product-1",
      variantId: null,
      qty: 1,
    });
  });

  it("omits a loaded manual snapshot on a qty-only edit", () => {
    const loadedManual = line({
      unitPriceKgs: 80,
      initialPriceKgs: 80,
      priceEdited: true,
      priceTouched: false,
      priceSource: "MANUAL",
    });
    expect(serialized(loadedManual)).toEqual({
      lineId: "line-1",
      productId: "product-1",
      variantId: null,
      qty: 1,
    });
  });

  it("keeps new lines addressable without a line id", () => {
    const added = line({
      lineId: null,
      variantId: "variant-1",
      unitPriceKgs: 0,
      priceEdited: true,
      priceSource: "MANUAL",
    });
    expect(serialized(added)).toEqual({
      productId: "product-1",
      variantId: "variant-1",
      qty: 1,
      unitPriceKgs: 0,
      priceSource: "MANUAL",
    });
  });
});
