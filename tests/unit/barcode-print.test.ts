import { describe, expect, it } from "vitest";

import {
  buildBarcodeLabelPrintItems,
  findProductsMissingPrintableBarcode,
  hasPrintableBarcode,
} from "@/lib/barcodePrint";

describe("barcode print helpers", () => {
  it("builds a de-duplicated batch print request with the selected quantity", () => {
    expect(
      buildBarcodeLabelPrintItems({
        productIds: ["p1", "p2", "p1", "", "p3"],
        quantity: 3,
      }),
    ).toEqual([
      { productId: "p1", quantity: 3 },
      { productId: "p2", quantity: 3 },
      { productId: "p3", quantity: 3 },
    ]);
  });

  it("identifies products missing printable barcodes", () => {
    const products = [
      { id: "p1", barcodes: [{ value: " 12345 " }] },
      { id: "p2", barcodes: [{ value: " " }] },
      { id: "p3", barcodes: [] },
    ];

    expect(hasPrintableBarcode(products[0])).toBe(true);
    expect(findProductsMissingPrintableBarcode(products).map((product) => product.id)).toEqual([
      "p2",
      "p3",
    ]);
  });
});
