import {
  convertFromKgs,
  convertToKgs,
  defaultCurrencyCode,
  defaultCurrencyRateKgsPerUnit,
  formatCurrencyAmount,
  normalizeCurrencyCode,
  normalizeCurrencyRateKgsPerUnit,
  type SupportedCurrencyCode,
} from "@/lib/currency";

export type CurrencySource =
  | {
      currencyCode?: string | null;
      currencyRateKgsPerUnit?:
        | number
        | string
        | { toNumber?: () => number; toString?: () => string }
        | null;
    }
  | null
  | undefined;

export type ResolvedCurrency = {
  currencyCode: SupportedCurrencyCode;
  currencyRateKgsPerUnit: number;
  isFallback: boolean;
};

export const currencySourceWithFallback = (
  snapshot: CurrencySource,
  fallback: CurrencySource,
): CurrencySource => (snapshot?.currencyCode ? snapshot : fallback);

export const resolveCurrency = (source: CurrencySource): ResolvedCurrency => {
  const currencyCode = normalizeCurrencyCode(source?.currencyCode);
  const rawRate = source?.currencyRateKgsPerUnit;
  const rateInput =
    typeof rawRate === "object" && rawRate !== null
      ? typeof rawRate.toNumber === "function"
        ? rawRate.toNumber()
        : rawRate.toString?.()
      : rawRate;
  const currencyRateKgsPerUnit = normalizeCurrencyRateKgsPerUnit(rateInput, currencyCode);
  return {
    currencyCode,
    currencyRateKgsPerUnit,
    isFallback:
      !source?.currencyCode ||
      (currencyCode === defaultCurrencyCode && !source?.currencyRateKgsPerUnit),
  };
};

export const resolveCurrencySnapshot = (source: CurrencySource) => {
  const { currencyCode, currencyRateKgsPerUnit } = resolveCurrency(source);
  return { currencyCode, currencyRateKgsPerUnit };
};

export const displayMoneyFromKgs = (amountKgs: number, source: CurrencySource) => {
  const { currencyCode, currencyRateKgsPerUnit } = resolveCurrency(source);
  return convertFromKgs(amountKgs, currencyRateKgsPerUnit, currencyCode);
};

export const displayMoneyToKgs = (amount: number, source: CurrencySource) => {
  const { currencyCode, currencyRateKgsPerUnit } = resolveCurrency(source);
  return convertToKgs(amount, currencyRateKgsPerUnit, currencyCode);
};

export const formatKgsMoney = (
  amountKgs: number,
  locale: string,
  source: CurrencySource,
  options?: Intl.NumberFormatOptions,
) => {
  const { currencyCode, currencyRateKgsPerUnit } = resolveCurrency(source);
  return formatCurrencyAmount(
    convertFromKgs(amountKgs, currencyRateKgsPerUnit, currencyCode),
    locale,
    currencyCode,
    options,
  );
};

export const formatStoreMoney = (
  amount: number,
  locale: string,
  source: CurrencySource,
  options?: Intl.NumberFormatOptions,
) => {
  const { currencyCode } = resolveCurrency(source);
  return formatCurrencyAmount(amount, locale, currencyCode, options);
};

export const baseAccountingCurrency: ResolvedCurrency = {
  currencyCode: defaultCurrencyCode,
  currencyRateKgsPerUnit: defaultCurrencyRateKgsPerUnit,
  isFallback: false,
};
