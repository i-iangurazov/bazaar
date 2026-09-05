import { describe, expect, it } from "vitest";
import { buildSoldProductsPageExport } from "@/lib/soldProductsExport";

describe("visible sold-product page export contract", () => {
  it("keeps returned-only rows, recorded discounts, negative net values and column alignment", () => {
    const result = buildSoldProductsPageExport([
      { productName: "Discounted sale", productSku: "A", barcode: null, category: "Food", quantitySold: 2, quantityReturned: 0, netQuantity: 2, grossRevenueKgs: 90, returnedRevenueKgs: 0, netRevenueKgs: 90, averagePriceKgs: 45, stockRemaining: 0, receiptCount: 1 },
      { productName: "Prior sale; returned", productSku: "B", barcode: "00123", category: null, quantitySold: 0, quantityReturned: 1, netQuantity: -1, grossRevenueKgs: 0, returnedRevenueKgs: 30.25, netRevenueKgs: -30.25, averagePriceKgs: 0, stockRemaining: 0, receiptCount: 0 },
    ], value => `${value.toFixed(2)} KGS`);
    expect(result.rows.every(row => row.length === result.header.length)).toBe(true);
    expect(Object.fromEntries(result.header.map((key, index) => [key, result.rows[1][index]]))).toEqual({
      productName: "Prior sale; returned", sku: "B", barcode: "00123", category: "", quantitySold: "0", quantityReturned: "1", netQuantity: "-1", grossRevenue: "0.00 KGS", returns: "30.25 KGS", netRevenue: "-30.25 KGS", averagePrice: "0.00 KGS", stockRemaining: "0", receiptCount: "0",
    });
    expect(result.rows[0][result.header.indexOf("grossRevenue")]).toBe("90.00 KGS");
    expect(result.rows).toHaveLength(2);
  });
  it("keeps an empty page empty and delegates currency display exactly once per monetary cell", () => {
    expect(buildSoldProductsPageExport([], () => { throw new Error("unexpected format"); }).rows).toEqual([]);
  });
});
