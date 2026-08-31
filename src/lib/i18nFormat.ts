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

const kyrgyzShortMonths = [
  "янв.",
  "фев.",
  "мар.",
  "апр.",
  "май",
  "июн.",
  "июл.",
  "авг.",
  "сен.",
  "окт.",
  "ноя.",
  "дек.",
] as const;

const kyrgyzDateParts = (value: Date | string | number, includeTime: boolean) => {
  const parts = new Intl.DateTimeFormat("en-US-u-nu-latn", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(includeTime
      ? {
          hour: "2-digit" as const,
          minute: "2-digit" as const,
          hourCycle: "h23" as const,
        }
      : {}),
    timeZone: defaultTimeZone,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  const monthIndex = Number(part("month")) - 1;
  const month = kyrgyzShortMonths[monthIndex];
  if (!month) {
    throw new RangeError("Invalid Kyrgyz calendar month");
  }
  const date = `${part("year")}-ж. ${part("day")}-${month}`;
  return includeTime ? `${date} ${part("hour")}:${part("minute")}` : date;
};

export const formatDate = (value: Date | string | number, locale: string) =>
  normalizeLocale(locale) === "kg"
    ? kyrgyzDateParts(value, false)
    : new Intl.DateTimeFormat(toIntlLocale(locale), {
        year: "numeric",
        month: "short",
        day: "2-digit",
        timeZone: defaultTimeZone,
      }).format(new Date(value));

export const formatDateTime = (value: Date | string | number, locale: string) =>
  normalizeLocale(locale) === "kg"
    ? kyrgyzDateParts(value, true)
    : new Intl.DateTimeFormat(toIntlLocale(locale), {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: defaultTimeZone,
      }).format(new Date(value));
