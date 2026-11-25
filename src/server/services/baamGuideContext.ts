import { helpGuideId, helpGuides } from "@/content/help/catalog";

// Only bundled documentation is sent with the user's question. No business
// records, figures, customer details or previous database answers enter this context.
export function baamGuideContext(text: string, locale: string, page?: string) {
  const language = locale === "en" || locale === "kg" ? locale : "ru";
  const generic = new Set(["как", "где", "что", "мне", "это", "the", "how", "can", "show", "get", "with", "мен", "бул", "кантип", "жана"]);
  const words = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter((word) => !generic.has(word));
  const pageHelp = /(?:этой страниц|this page|бул барак)/iu.test(text);
  return helpGuides
    .map((guide) => {
      const terms =
        `${guide.title[language]} ${guide.summary[language]} ${guide.keywords[language]} ${guide.aliases[language]}`.toLowerCase();
      const score =
        words.reduce((sum, word) => sum + (terms.includes(word) ? 1 : 0), 0) +
        (pageHelp && (page === guide.appRoute || page?.startsWith(`${guide.appRoute}/`)) ? 2 : 0);
      return { guide, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ guide }) => ({
      guideId: helpGuideId(guide),
      title: guide.title[language],
      summary: guide.summary[language],
      page: guide.appRoute,
      steps: guide.steps.map((step) => ({
        title: step.title[language],
        body: step.body[language],
      })),
    }));
}
