import { describe, expect, it } from "vitest";
import { buildHelpHomeData } from "@/content/help/home-data";
import { normalizeHelpSearchQuery, searchHelpDocuments } from "@/content/help/search-core";

describe("the public guide's advertised searches", () => {
  for (const locale of ["ru", "kg", "en"] as const) {
    const data = buildHelpHomeData(locale);
    const expected = ["pos/close-shift", "products/add-product", "inventory/receiving", "loyalty/"];
    data.quickSearches.forEach((query, index) => {
      it(`finds the intended instruction for ${locale}: ${query}`, () => {
        const results = searchHelpDocuments(data.guides, query);
        expect(results.length).toBeGreaterThan(0);
        if (index === 3) expect(results[0].document.id).toMatch(/^loyalty\//);
        else expect(results[0].document.id).toBe(expected[index]);
      });
    });
  }
  it("keeps Kyrgyz letters distinct rather than discarding them from search words", () => {
    expect(normalizeHelpSearchQuery("КӨК өрүк ҮЙ")).toBe("көк өрүк үй");
  });
  it("still normalizes punctuation, repeated spaces and Russian yo", () => {
    expect(normalizeHelpSearchQuery("  Ёлка: ‘Товар’ №42 ")).toBe("елка товар 42");
  });
});
