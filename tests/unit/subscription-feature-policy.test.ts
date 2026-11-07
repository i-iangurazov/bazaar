import { describe, expect, it } from "vitest";
import { requiredPlanFeature } from "@/server/billing/featurePolicy";
import { requiredPageFeature } from "@/lib/billing/pageFeatures";

describe("commercial operation boundaries", () => {
  it.each([
    "pos.checkout",
    "pos.return",
    "inventory.receive",
    "inventory.writeOff",
    "stockCounts.apply",
    "products.inlineUpdate",
    "products.update",
    "products.bulkUpdateCategory",
    "products.exportCsv",
    "customers.exportRows",
    "customerOrders.create",
    "periodClose.list",
  ])("keeps %s out of additional premium gates", (path) => {
    expect(requiredPlanFeature(path)).toBeNull();
  });
  it.each([
    ["priceBooks.preview", "priceBooks"],
    ["stores.applyAssortmentShare", "assortments"],
    ["inventory.transfer", "assortments"],
    ["purchaseOrders.receive", "purchaseOrders"],
    ["forecast.explain", "replenishment"],
    ["bundles.addComponent", "bundles"],
    ["stockLots.list", "expiryLots"],
    ["periodClose.close", "periodClose"],
    ["products.bulkGenerateDescriptions", "bulkAiContent"],
    ["products.bulkGenerateBarcodes", "bulkProducts"],
    ["products.arrangeClothingCategories", "bulkProducts"],
    ["customers.importRows", "imports"],
    ["loyalty.upsert", "loyalty"],
    ["storePrices.bulkUpdate", "priceBooks"],
  ])("protects %s with %s", (path, feature) => expect(requiredPlanFeature(path)).toBe(feature));
  it("does not gate old loyalty transaction history, POS accrual or order reads", () => {
    for (const op of ["posStatus", "customerHistory", "orderSummary"])
      expect(requiredPlanFeature(`loyalty.${op}`)).toBeNull();
  });
  it("keeps period history and base pages while protecting premium direct pages", () => {
    for (const path of [
      "/reports/close",
      "/products",
      "/inventory/receiving",
      "/settings/import",
      "/sales-orders",
    ])
      expect(requiredPageFeature(path)).toBeNull();
    expect(requiredPageFeature("/ru/settings/price-lists/book")).toBe("priceBooks");
    expect(requiredPageFeature("/en/purchase-orders/123")).toBe("purchaseOrders");
    expect(requiredPageFeature("/settings/price-lists-other")).toBeNull();
  });
});
