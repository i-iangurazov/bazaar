import { describe, expect, it } from "vitest";

import { ROLL_PRICE_TAG_TEMPLATE } from "@/lib/priceTags";
import { buildPriceTagLayout, clampPriceTagTextLines, mmToPoints } from "@/server/services/priceTagsLayout";

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

  it("uses exact 58x40 page size for XP-365B roll template", () => {
    const layout = buildPriceTagLayout(ROLL_PRICE_TAG_TEMPLATE, { storeName: null });
    expect(layout.pageWidth).toBeCloseTo(mmToPoints(58), 3);
    expect(layout.pageHeight).toBeCloseTo(mmToPoints(40), 3);
    expect(layout.labelWidth).toBeCloseTo(mmToPoints(58), 3);
    expect(layout.labelHeight).toBeCloseTo(mmToPoints(40), 3);
  });

  it("supports custom roll page size", () => {
    const layout = buildPriceTagLayout(ROLL_PRICE_TAG_TEMPLATE, {
      storeName: null,
      rollDimensionsMm: { width: 60, height: 50 },
    });
    expect(layout.pageWidth).toBeCloseTo(mmToPoints(60), 3);
    expect(layout.pageHeight).toBeCloseTo(mmToPoints(50), 3);
    expect(layout.labelWidth).toBeCloseTo(mmToPoints(60), 3);
    expect(layout.labelHeight).toBeCloseTo(mmToPoints(50), 3);
  });

  it("uses 5mm padding and keeps roll blocks within printable bounds", () => {
    const layout = buildPriceTagLayout(ROLL_PRICE_TAG_TEMPLATE, { storeName: null });
    expect(layout.padding).toBeCloseTo(mmToPoints(5), 3);
    expect(layout.name.y).toBeGreaterThanOrEqual(layout.padding);
    expect(layout.barcodeValue.y + layout.barcodeValue.height).toBeLessThanOrEqual(
      layout.labelHeight - layout.padding + 0.1,
    );
  });

  it("increases spacing between blocks on taller custom roll labels", () => {
    const base = buildPriceTagLayout(ROLL_PRICE_TAG_TEMPLATE, {
      storeName: null,
      rollDimensionsMm: { width: 58, height: 40 },
    });
    const taller = buildPriceTagLayout(ROLL_PRICE_TAG_TEMPLATE, {
      storeName: null,
      rollDimensionsMm: { width: 58, height: 60 },
    });
    expect(taller.config.gap).toBeGreaterThan(base.config.gap);
  });

  it("clamps long names to max lines with ellipsis", () => {
    const lines = clampPriceTagTextLines({
      text: "Очень длинное название товара для проверки переноса и ограничения строк в шаблоне ценника",
      maxLines: 2,
      canFit: (value) => value.length <= 18,
    });
    expect(lines.length).toBe(2);
    expect(lines[1]?.endsWith("…")).toBe(true);
  });
});
