import { describe, expect, it } from "vitest";

import { buildVariantMatrix, findVariantTemplate } from "@/lib/variantGenerator";

describe("buildVariantMatrix", () => {
  it("returns empty for no attributes", () => {
    expect(buildVariantMatrix([])).toEqual([]);
  });

  it("returns empty when any attribute lacks values", () => {
    expect(
      buildVariantMatrix([
        { key: "color", values: [] },
        { key: "size", values: ["S"] },
      ]),
    ).toEqual([]);
  });

  it("builds a matrix of combinations", () => {
    const result = buildVariantMatrix([
      { key: "color", values: ["red", "blue"] },
      { key: "size", values: ["S", "M"] },
    ]);

    expect(result).toHaveLength(4);
    expect(result).toContainEqual({ color: "red", size: "S" });
    expect(result).toContainEqual({ color: "red", size: "M" });
    expect(result).toContainEqual({ color: "blue", size: "S" });
    expect(result).toContainEqual({ color: "blue", size: "M" });
  });
});

it("keeps the matching size price when a second option is added", () => {
  const variants = [1, 2, 3, 4, 5].map((size) => ({
    attributes: [{ key: "size", value: String(size) }],
    storePriceKgs: size * 10,
  }));
  for (const color of ["red", "blue"]) {
    for (let size = 1; size <= 5; size++)
      expect(
        findVariantTemplate(variants, { size: String(size), color }, (key) => key)?.storePriceKgs,
      ).toBe(size * 10);
  }
  expect(findVariantTemplate(variants, { size: "6", color: "red" }, (key) => key)).toBeUndefined();
});
