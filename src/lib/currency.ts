import { toIntlLocale } from "@/lib/locales";

export const supportedCurrencyCodes = ["KGS", "USD", "GBP"] as const;

export type SupportedCurrencyCode = (typeof supportedCurrencyCodes)[number];

export const defaultCurrencyCode: SupportedCurrencyCode = "KGS";
export const defaultCurrencyRateKgsPerUnit = 1;

const currencyCodeSet = new Set<string>(supportedCurrencyCodes);

export const normalizeCurrencyCode = (value?: string | null): SupportedCurrencyCode => {
  const normalized = value?.trim().toUpperCase();
  return normalized && currencyCodeSet.has(normalized)
    ? (normalized as SupportedCurrencyCode)
    : defaultCurrencyCode;
};

export const normalizeCurrencyRateKgsPerUnit = (
  value?: number | string | null,
  currencyCode: SupportedCurrencyCode = defaultCurrencyCode,
) => {
  if (currencyCode === "KGS") {
    return defaultCurrencyRateKgsPerUnit;
  }
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric) || !numeric || numeric <= 0) {
    return defaultCurrencyRateKgsPerUnit;
  }
  return numeric;
};

export const convertFromKgs = (
  amountKgs: number,
  currencyRateKgsPerUnit: number,
  currencyCode: SupportedCurrencyCode = defaultCurrencyCode,
) => {
  if (currencyCode === "KGS") {
    return amountKgs;
  }
  const rate = normalizeCurrencyRateKgsPerUnit(currencyRateKgsPerUnit, currencyCode);
  return amountKgs / rate;
};

export const convertToKgs = (
  amount: number,
  currencyRateKgsPerUnit: number,
  currencyCode: SupportedCurrencyCode = defaultCurrencyCode,
) => {
  if (currencyCode === "KGS") {
    return amount;
  }
  const rate = normalizeCurrencyRateKgsPerUnit(currencyRateKgsPerUnit, currencyCode);
  return amount * rate;
};

export const roundUpToCurrencyTens = (amount: number) => {
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }
  return Math.ceil(amount / 10) * 10;
};

export const formatCurrencyAmount = (
  amount: number,
  locale: string,
  currencyCode: SupportedCurrencyCode = defaultCurrencyCode,
  options?: Intl.NumberFormatOptions,
) =>
  new Intl.NumberFormat(toIntlLocale(locale), {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: currencyCode === "KGS" ? 2 : 2,
    maximumFractionDigits: currencyCode === "KGS" ? 2 : 2,
    ...options,
  }).format(amount);
