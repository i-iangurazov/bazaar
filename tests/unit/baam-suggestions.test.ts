import { describe, expect, it } from "vitest";
import { baamStarterKeys, getBaamUiPageContext } from "@/lib/baamSuggestions";

describe("BAAM page context and suggestions", () => {
  it("recognizes product references without sending URLs, queries, or fragment text", () => {
    expect(getBaamUiPageContext("/ru/products/synthetic-product?email=private#secret")).toEqual({ kind: "product", id: "synthetic-product" });
    expect(getBaamUiPageContext("/products/new")).toEqual({ kind: "section", section: "products" });
    expect(getBaamUiPageContext("/products/%2Fprivate")).toEqual({ kind: "section", section: "products" });
    expect(getBaamUiPageContext("/products/%invalid")).toEqual({ kind: "section", section: "products" });
    expect(getBaamUiPageContext("https://untrusted.test/products/one")).toEqual({ kind: "section", section: "unknown" });
  });
  it("changes useful starter questions between catalog, details, reports and management", () => {
    expect(baamStarterKeys(getBaamUiPageContext("/products"))).toContain("zeroProductsPrompt");
    expect(baamStarterKeys(getBaamUiPageContext("/products/one"))).toContain("productDetailsPrompt");
    expect(baamStarterKeys(getBaamUiPageContext("/reports"))).toContain("nextPrompt");
    expect(baamStarterKeys(getBaamUiPageContext("/customers"), ["customers"])).toContain("customersPrompt");
  });
  it("does not suggest navigation to a feature the server has not authorized", () => {
    expect(baamStarterKeys(getBaamUiPageContext("/settings/import"))).not.toContain("importsPrompt");
    expect(baamStarterKeys(getBaamUiPageContext("/settings/import"), ["imports"])).toContain("importsPrompt");
  });
});
