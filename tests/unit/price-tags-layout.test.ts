import { describe, expect, it } from "vitest";

import { buildPriceTagLayout } from "@/server/services/priceTagsLayout";

describe("price tag layout", () => {
  it("keeps blocks within bounds for 3x8 template", () => {
    const layout = buildPriceTagLayout("3x8", { storeName: "Store" });
    const bottom =
      layout.padding +
      layout.contentHeight +
      0.1;
    expect(layout.name.y).toBeGreaterThanOrEqual(layout.padding);
    expect(layout.price.y).toBeGreaterThan(layout.name.y);
    expect(layout.meta.y).toBeGreaterThan(layout.price.y);
    expect(layout.barcode.y).toBeGreaterThan(layout.meta.y);
    expect(layout.barcodeValue.y).toBeGreaterThan(layout.barcode.y);
    expect(layout.barcodeValue.y + layout.barcodeValue.height).toBeLessThanOrEqual(bottom);
  });

  it("keeps blocks within bounds for 2x5 template", () => {
    const layout = buildPriceTagLayout("2x5", { storeName: null });
    const bottom =
      layout.padding +
      layout.contentHeight +
      0.1;
    expect(layout.name.y).toBeGreaterThanOrEqual(layout.padding);
    expect(layout.barcodeValue.y + layout.barcodeValue.height).toBeLessThanOrEqual(bottom);
  });
});
