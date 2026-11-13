import { defaultLocale, locales, normalizeLocale, type Locale } from "@/lib/locales";

export const marketingSiteUrl = "https://www.bazaar.kg";
// Set by middleware after checking the pathname, never accepted from the browser.
export const marketingLocaleHeader = "x-bazaar-marketing-locale";

export const marketingLocaleFromPath = (pathname: string): Locale | undefined => {
  const match = /^\/(ru|kg|ky|en)\/?$/.exec(pathname);
  return match ? normalizeLocale(match[1]) : undefined;
};

export const marketingHomePath = (locale: string) =>
  `/${normalizeLocale(locale) ?? defaultLocale}`;

export const isMarketingLandingPath = (pathname: string) =>
  pathname === "/" || marketingLocaleFromPath(pathname) !== undefined;

export const marketingLanguageDestination = (locale: string, currentUrl: string) => {
  const normalized = normalizeLocale(locale);
  if (!normalized) return undefined;
  const destination = new URL(currentUrl);
  if (!isMarketingLandingPath(destination.pathname)) return undefined;
  destination.pathname = marketingHomePath(normalized);
  return `${destination.pathname}${destination.search}${destination.hash}`;
};

export const marketingLanguageAlternates = {
  "ru-KG": `${marketingSiteUrl}/ru`,
  "ky-KG": `${marketingSiteUrl}/kg`,
  en: `${marketingSiteUrl}/en`,
  "x-default": `${marketingSiteUrl}/`,
};

export const marketingCanonicalHomes = locales.map((locale) => ({
  locale,
  url: `${marketingSiteUrl}${marketingHomePath(locale)}`,
}));
