import { defaultLocale, normalizeLocale, type Locale } from "@/lib/locales";

// Shared by public routing and measurement. Keep this registry free of page copy,
// server imports and visitor-provided titles or URL fragments.
export const solutionPages = [
  { id: "inventory", slug: "inventory-management" },
  { id: "pos", slug: "pos-for-retail" },
  { id: "warehouse", slug: "warehouse-management" },
  { id: "grocery", slug: "grocery-store" },
  { id: "clothing", slug: "clothing-store" },
  { id: "store-guide", slug: "store-accounting-guide" },
] as const;

export type SolutionId = (typeof solutionPages)[number]["id"];

export const getSolutionBySlug = (slug: string) =>
  solutionPages.find((page) => page.slug === slug);

export type MarketingSolutionPath = {
  locale: Locale;
  id: SolutionId | null;
  isAlias: boolean;
};

export const parseMarketingSolutionPath = (pathname: string): MarketingSolutionPath | undefined => {
  const match = /^\/(ru|kg|ky|en)\/solutions(?:\/([^/]+))?$/.exec(pathname);
  if (!match) return undefined;
  const locale = normalizeLocale(match[1]);
  if (!locale) return undefined;
  const page = match[2] ? getSolutionBySlug(match[2]) : undefined;
  if (match[2] && !page) return undefined;
  return { locale, id: page?.id ?? null, isAlias: match[1] === "ky" };
};

export const marketingSolutionPath = (locale: string, id?: SolutionId | null) => {
  const prefix = `/${normalizeLocale(locale) ?? defaultLocale}/solutions`;
  if (id == null) return prefix;
  const page = solutionPages.find((item) => item.id === id);
  if (!page) throw new Error("Unknown marketing solution");
  return `${prefix}/${page.slug}`;
};

export const marketingSolutionsLanguageAlternates = (id?: SolutionId | null) => {
  const origin = "https://www.bazaar.kg";
  return {
    "ru-KG": `${origin}${marketingSolutionPath("ru", id)}`,
    "ky-KG": `${origin}${marketingSolutionPath("kg", id)}`,
    en: `${origin}${marketingSolutionPath("en", id)}`,
    "x-default": `${origin}${marketingSolutionPath("ru", id)}`,
  };
};
