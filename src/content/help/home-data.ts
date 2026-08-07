import {
  getHelpCategory,
  getHelpGuideById,
  getGuidesForCategory,
  helpCategories,
  helpGuideId,
  helpGuides,
  helpJourney,
  helpRoleTracks,
  helpTasks,
} from "./catalog";
import type { HelpSearchDocument } from "./search-core";
import type { HelpLocale, HelpRole } from "./types";
import { localize } from "./ui";

export type HelpHomeData = {
  guides: HelpSearchDocument[];
  quickSearches: string[];
  tasks: { title: string; description: string; guideId: string; icon: string }[];
  journey: { title: string; description: string; guideId: string; estimatedMinutes: number }[];
  roles: {
    role: HelpRole;
    title: string;
    description: string;
    guides: { id: string; title: string }[];
  }[];
  categories: { slug: string; title: string; description: string; icon: string; count: number }[];
};

export const buildHelpHomeData = (locale: HelpLocale): HelpHomeData => ({
  quickSearches:
    locale === "kg"
      ? ["сменаны жабуу", "товар кошуу", "кириштөө"]
      : locale === "en"
        ? ["close a shift", "add a product", "receive stock"]
        : ["закрыть смену", "добавить товар", "оприходование"],
  guides: helpGuides.map((guide) => {
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
  tasks: helpTasks.map((item) => ({
    ...item,
    title: localize(item.title, locale),
    description: localize(item.description, locale),
  })),
  journey: helpJourney.map((item) => ({
    ...item,
    title: localize(item.title, locale),
    description: localize(item.description, locale),
  })),
  roles: helpRoleTracks.map((track) => ({
    role: track.role,
    title: localize(track.title, locale),
    description: localize(track.description, locale),
    guides: track.guideIds.flatMap((id) => {
      const guide = getHelpGuideById(id);
      return guide ? [{ id, title: localize(guide.title, locale) }] : [];
    }),
  })),
  categories: helpCategories.map((category) => ({
    slug: category.slug,
    title: localize(category.title, locale),
    description: localize(category.description, locale),
    icon: category.icon,
    count: getGuidesForCategory(category.slug).length,
  })),
});
