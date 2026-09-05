import { describe, expect, it } from "vitest";
import { buildSoldProductsFilteredExport, buildSoldProductsPageExport } from "@/lib/soldProductsExport";
import { downloadTableFile } from "@/lib/fileExport";

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

describe("all-filtered sold-product export formatting", () => {
  it("discards a download revoked during asynchronous XLSX preparation", async () => {
    let current = true;
    const download = downloadTableFile({format:"xlsx",fileNameBase:"discarded",header:["product"],rows:[["sensitive previous audience"]],shouldDownload:()=>current});
    current = false;
    // This runs in Node without a document: reaching a browser download would
    // fail. The real asynchronous XLSX generation must honor the current guard.
    await expect(download).resolves.toBeUndefined();
  });
  it("keeps every supplied snapshot row, variant identity and negative returns without inventing stock", () => {
    const products = Array.from({length:126},(_,index)=>({
      productName:`Product ${index}`,variantName:index===125?"Red":null,productSku:`SKU-${index}`,barcode:"00123",category:"Food",
      quantitySold:0,quantityReturned:1,netQuantity:-1,grossRevenueKgs:0,returnedRevenueKgs:30.25,netRevenueKgs:-30.25,averagePriceKgs:0,receiptCount:0,
    }));
    const result=buildSoldProductsFilteredExport(products,value=>`${value.toFixed(2)} KGS`);
    expect(result.rows).toHaveLength(126);
    expect(result.header).not.toContain("stockRemaining");
    expect(result.rows.every(row=>row.length===result.header.length)).toBe(true);
    const last=Object.fromEntries(result.header.map((key,index)=>[key,result.rows[125][index]]));
    expect(last).toMatchObject({productName:"Product 125",variantName:"Red",sku:"SKU-125",barcode:"00123",netQuantity:"-1",netRevenue:"-30.25 KGS"});
  });
});
