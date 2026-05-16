import { describe, expect, it } from "vitest";

import { compareProductSearchRelevance } from "@/server/services/products/searchRelevance";

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const sortByQuery = <TProduct extends { id: string; name: string; sku: string }>(
  query: string,
  products: TProduct[],
) =>
  [...products].sort((left, right) =>
    compareProductSearchRelevance({
      query,
      left,
      right,
      collator,
    }),
  );

describe("product search relevance", () => {
  it("ranks product names that start with the query above names that only contain it", () => {
    const sorted = sortByQuery("Резьба", [
      { id: "aerator", name: "Аэратор внут. резьба", sku: "01033" },
      { id: "thread-10", name: "Резьба 15 (10см)", sku: "05318" },
      { id: "valve", name: "Водяной клапан резьба SD2302", sku: "01411" },
    ]);

    expect(sorted.map((product) => product.id)).toEqual(["thread-10", "aerator", "valve"]);
  });

  it("keeps exact sku and barcode matches ahead of fuzzy name matches", () => {
    const sorted = sortByQuery("BAR-001", [
      { id: "name", name: "BAR-001 adapter", sku: "SKU-NAME" },
      { id: "sku", name: "Adapter", sku: "BAR-001" },
      {
        id: "barcode",
        name: "Other Adapter",
        sku: "SKU-BC",
        barcodes: [{ value: "BAR-001" }],
      },
    ]);

    expect(
      sorted
        .map((product) => product.id)
        .slice(0, 2)
        .sort(),
    ).toEqual(["barcode", "sku"]);
  });

  it("matches all query tokens even when the words are not adjacent", () => {
    const sorted = sortByQuery("резьба 15", [
      { id: "partial", name: "Резьба переходная", sku: "A" },
      { id: "full", name: "Муфта 15 внутренняя резьба", sku: "B" },
    ]);

    expect(sorted[0]?.id).toBe("full");
  });
});
