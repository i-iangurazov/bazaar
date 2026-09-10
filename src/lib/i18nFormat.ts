import { normalizeLocale, toIntlLocale } from "@/lib/locales";
import { defaultTimeZone } from "@/lib/timezone";
import { formatCurrencyAmount, type SupportedCurrencyCode } from "@/lib/currency";

export const formatCurrencyKGS = (amount: number, locale: string) =>
  formatCurrencyAmount(amount, locale, "KGS");

export const formatCurrency = (
  amount: number,
  locale: string,
  currencyCode: SupportedCurrencyCode,
  options?: Intl.NumberFormatOptions,
) => formatCurrencyAmount(amount, locale, currencyCode, options);

export const formatNumber = (value: number, locale: string, options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(toIntlLocale(locale), options).format(value);

const dateFormatter = (locale: string, includeTime = false) => {
  const intlLocale = toIntlLocale(locale);
  // Some browser ICU bundles omit Kyrgyz and silently fall back to English.
  // A numeric day.month.year keeps the date readable without changing language.
  const numericFallback =
    normalizeLocale(locale) === "kg" &&
    Intl.DateTimeFormat.supportedLocalesOf([intlLocale]).length === 0;
  return new Intl.DateTimeFormat(numericFallback ? "ru" : intlLocale, {
    year: "numeric",
    month: numericFallback ? "2-digit" : "short",
    day: "2-digit",
    ...(includeTime ? ({ hour: "2-digit", minute: "2-digit" } as const) : {}),
    timeZone: defaultTimeZone,
  });
};

export const formatDate = (value: Date | string | number, locale: string) =>
  dateFormatter(locale).format(new Date(value));

export const formatDateTime = (value: Date | string | number, locale: string) =>
  dateFormatter(locale, true).format(new Date(value));
