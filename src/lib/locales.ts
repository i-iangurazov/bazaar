export const locales = ["ru", "kg", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "ru";

const legacyLocaleMap = {
  ky: "kg",
} as const;

export type LegacyLocale = keyof typeof legacyLocaleMap;

export const normalizeLocale = (value?: string | null): Locale | undefined => {
  if (!value) {
    return undefined;
  }
  if (value in legacyLocaleMap) {
    return legacyLocaleMap[value as LegacyLocale];
  }
  return locales.includes(value as Locale) ? (value as Locale) : undefined;
};

export const isLocale = (value?: string | null): value is Locale =>
  locales.includes(value as Locale);

export const toIntlLocale = (value?: string | null) => {
  const normalized = normalizeLocale(value);
  if (normalized === "kg") {
    return "ky-KG";
  }
  if (normalized === "en") {
    return "en-US";
  }
  return normalized ?? value ?? defaultLocale;
};

export const getLocaleFromAcceptLanguage = (header?: string | null): Locale | undefined => {
  if (!header) {
    return undefined;
  }
  const parts = header
    .split(",")
    .map((part) => part.trim().split(";")[0])
    .filter(Boolean);
  for (const part of parts) {
    const base = part.split("-")[0]?.toLowerCase();
    const normalized = normalizeLocale(base);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
};
