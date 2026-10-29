import { helpGuides } from "@/content/help/catalog";

// Only bundled documentation is sent with the user's question. No business
// records, figures, customer details or previous database answers enter this context.
export function baamGuideContext(text: string, locale: string, page?: string) {
  const language = locale === "en" || locale === "kg" ? locale : "ru";
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return helpGuides
    .map((guide) => {
      const terms =
        `${guide.title[language]} ${guide.summary[language]} ${guide.keywords[language]} ${guide.aliases[language]}`.toLowerCase();
      const score =
        words.reduce((sum, word) => sum + (terms.includes(word) ? 1 : 0), 0) +
        (page?.startsWith(guide.appRoute) ? 2 : 0);
      return { guide, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ guide, score }) => ({
      relevant: score > 0,
      title: guide.title[language],
      summary: guide.summary[language],
      page: guide.appRoute,
      steps: guide.steps.map((step) => ({
        title: step.title[language],
        body: step.body[language],
      })),
    }));
}
