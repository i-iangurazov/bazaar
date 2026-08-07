import { getHelpCategory, helpGuides, helpGuideId } from "./catalog";
import { searchHelpDocuments } from "./search-core";
import { localize } from "./ui";
import type { HelpLocale } from "./types";

export const searchHelpGuides = (rawQuery: string, locale: HelpLocale, limit = 8) =>
  searchHelpDocuments(
    helpGuides.map((guide) => {
      const category = getHelpCategory(guide.category);
      return {
        id: helpGuideId(guide),
        title: localize(guide.title, locale),
        summary: localize(guide.summary, locale),
        keywords: localize(guide.keywords, locale),
        aliases: localize(guide.aliases, locale),
        headings: guide.steps.map((item) => localize(item.title, locale)).join(" "),
        categoryTitle: category ? localize(category.title, locale) : "Bazaar Guide",
        categoryIcon: category?.icon ?? "rocket",
      };
    }),
    rawQuery,
    limit,
  ).map(({ document, score }) => ({
    guide: helpGuides.find((guide) => helpGuideId(guide) === document.id)!,
    score,
  }));

export { normalizeHelpSearchQuery } from "./search-core";
