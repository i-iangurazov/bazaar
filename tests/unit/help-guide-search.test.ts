import { describe, expect, it } from "vitest";

import { getHelpGuideById, helpCategories, helpGuideId, helpGuides } from "@/content/help/catalog";
import { searchHelpGuides } from "@/content/help/search";

describe("Bazaar Guide catalog and search", () => {
  it("ships a focused first release with complete multilingual short guides", () => {
    expect(helpGuides).toHaveLength(20);
    expect(helpCategories).toHaveLength(8);
    for (const guide of helpGuides) {
      expect(guide.steps.length).toBeGreaterThanOrEqual(3);
      expect(guide.steps.length).toBeLessThanOrEqual(7);
      expect(guide.relatedGuides.length).toBeGreaterThanOrEqual(2);
      expect(guide.relatedGuides.length).toBeLessThanOrEqual(4);
      for (const locale of ["ru", "kg", "en"] as const) {
        expect(guide.title[locale]).toBeTruthy();
        expect(guide.summary[locale]).toBeTruthy();
        expect(guide.aliases[locale]).toBeTruthy();
        guide.steps.forEach((step) => {
          expect(step.title[locale]).toBeTruthy();
          expect(step.body[locale]).toBeTruthy();
        });
      }
      guide.relatedGuides.forEach((id) =>
        expect(getHelpGuideById(id), `${helpGuideId(guide)} -> ${id}`).toBeTruthy(),
      );
    }
  });

  it.each([
    ["закрыть кассу", "pos/close-shift"],
    ["закончить день", "pos/close-shift"],
    ["X отчет", "pos/close-shift"],
    ["добавить остаток", "inventory/receiving"],
    ["перекинуть товар", "inventory/transfer"],
    ["пробить чек", "pos/make-sale"],
    ["how is business doing", "reports/analytics-basics"],
    ["сменаны аяктоо", "pos/close-shift"],
  ])("maps everyday wording %s to %s", (query, expected) => {
    const locale =
      /[a-z]/i.test(query) && !/[а-я]/i.test(query)
        ? "en"
        : query.includes("сменаны")
          ? "kg"
          : "ru";
    expect(helpGuideId(searchHelpGuides(query, locale)[0]!.guide)).toBe(expected);
  });

  it("tolerates one-character customer typos", () => {
    expect(helpGuideId(searchHelpGuides("инвентаризаця", "ru")[0]!.guide)).toBe(
      "inventory/inventory-count",
    );
  });
});
