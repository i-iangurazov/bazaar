import { describe, expect, it } from "vitest";

import { validateCorrectionDraft } from "@/lib/correctionDraftValidation";

const currency = { currencyCode: "KGS", currencyRateKgsPerUnit: 1 };

const returnRow = (
  overrides: Partial<Parameters<typeof validateCorrectionDraft>[0]["returns"][number]> = {},
) => ({
  lineId: "line-1",
  qtyInput: "1",
  availableQty: 2,
  restock: true,
  ...overrides,
});

const additionRow = (
  overrides: Partial<Parameters<typeof validateCorrectionDraft>[0]["additions"][number]> = {},
) => ({
  key: "addition-1",
  productId: "product-1",
  variantId: null as string | null,
  qtyInput: "1",
  priceInput: "100",
  priceEdited: true,
  ...overrides,
});

const validate = (input: {
  returns?: Array<Parameters<typeof validateCorrectionDraft>[0]["returns"][number]>;
  additions?: Array<Parameters<typeof validateCorrectionDraft>[0]["additions"][number]>;
}) =>
  validateCorrectionDraft({
    returns: input.returns ?? [],
    additions: input.additions ?? [],
    currency,
  });

describe("correction draft validation", () => {
  it("treats an empty return quantity as unselected and accepts a positive quantity within availability", () => {
    const result = validate({
      returns: [returnRow({ lineId: "empty", qtyInput: "" }), returnRow({ lineId: "valid" })],
    });

    expect(result.returnLines).toEqual([{ lineId: "valid", qty: 1, restock: true }]);
    expect(result.returnErrors).toEqual({});
    expect(result.hasErrors).toBe(false);
    expect(result.hasComposition).toBe(true);
  });

  it("reports non-numeric, non-positive and over-available return quantities without clamping them", () => {
    const result = validate({
      returns: [
        returnRow({ lineId: "text", qtyInput: "abc" }),
        returnRow({ lineId: "zero", qtyInput: "0" }),
        returnRow({ lineId: "negative", qtyInput: "-1" }),
        returnRow({ lineId: "too-much", qtyInput: "2.001", availableQty: 2 }),
        returnRow({ lineId: "valid", qtyInput: "2" }),
      ],
    });

    expect(result.returnErrors).toEqual({
      text: "qtyInvalid",
      zero: "qtyPositive",
      negative: "qtyPositive",
      "too-much": "qtyExceedsAvailable",
    });
    expect(result.returnLines).toEqual([{ lineId: "valid", qty: 2, restock: true }]);
    expect(result.hasErrors).toBe(true);
    expect(result.hasComposition).toBe(true);
  });

  it("rejects invalid addition quantities and keeps the valid row in the request", () => {
    const result = validate({
      additions: [
        additionRow({ key: "empty", qtyInput: "" }),
        additionRow({ key: "text", qtyInput: "1,2,3" }),
        additionRow({ key: "zero", qtyInput: "0" }),
        additionRow({ key: "valid", qtyInput: "3" }),
      ],
    });

    expect(result.additionErrors).toEqual({
      empty: { qty: "qtyRequired" },
      text: { qty: "qtyInvalid" },
      zero: { qty: "qtyPositive" },
    });
    expect(result.additionLines).toEqual([
      {
        key: "valid",
        productId: "product-1",
        variantId: null,
        qty: 3,
        unitPriceKgs: 100,
      },
    ]);
    expect(result.hasErrors).toBe(true);
  });

  it("never turns an empty or invalid manual price into catalogue pricing", () => {
    const result = validate({
      additions: [
        additionRow({ key: "empty-price", priceInput: "" }),
        additionRow({ key: "invalid-price", priceInput: "1.2.3" }),
        additionRow({ key: "zero-price", priceInput: "0" }),
        additionRow({ key: "automatic", priceEdited: false, priceInput: "" }),
      ],
    });

    expect(result.additionErrors).toEqual({
      "empty-price": { price: "priceRequired" },
      "invalid-price": { price: "priceInvalid" },
    });
    expect(result.additionLines).toEqual([
      {
        key: "zero-price",
        productId: "product-1",
        variantId: null,
        qty: 1,
        unitPriceKgs: 0,
      },
      {
        key: "automatic",
        productId: "product-1",
        variantId: null,
        qty: 1,
      },
    ]);
    expect(result.hasErrors).toBe(true);
  });

  it("reports quantity and price errors on the same row", () => {
    const result = validate({
      additions: [additionRow({ key: "double", qtyInput: "0", priceInput: "" })],
    });

    expect(result.additionErrors).toEqual({
      double: { qty: "qtyPositive", price: "priceRequired" },
    });
    expect(result.additionLines).toEqual([]);
    expect(result.hasErrors).toBe(true);
    expect(result.hasComposition).toBe(false);
  });

  it("keeps a valid row visible in the validated request when another row is invalid", () => {
    const result = validate({
      returns: [returnRow()],
      additions: [
        additionRow({ key: "broken", priceInput: "" }),
        additionRow({ key: "healthy", qtyInput: "2" }),
      ],
    });

    expect(result.hasErrors).toBe(true);
    expect(result.returnLines).toHaveLength(1);
    expect(result.additionLines.map((line) => line.key)).toEqual(["healthy"]);
    expect(result.additionErrors.broken?.price).toBe("priceRequired");
  });

  it("keeps decimal quantities and the restock flag on a valid return", () => {
    const result = validate({
      returns: [returnRow({ qtyInput: "0.125", restock: false, availableQty: 0.5 })],
    });

    expect(result.returnLines).toEqual([{ lineId: "line-1", qty: 0.125, restock: false }]);
  });
});
