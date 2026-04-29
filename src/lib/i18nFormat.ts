import { toIntlLocale } from "@/lib/locales";
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

export const formatNumber = (
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
) => new Intl.NumberFormat(toIntlLocale(locale), options).format(value);

export const formatDate = (value: Date | string | number, locale: string) =>
  new Intl.DateTimeFormat(toIntlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: defaultTimeZone,
  }).format(new Date(value));

export const formatDateTime = (value: Date | string | number, locale: string) =>
  new Intl.DateTimeFormat(toIntlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: defaultTimeZone,
  }).format(new Date(value));
