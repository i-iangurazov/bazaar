import { describe, expect, it } from "vitest";

import {
  convertFromKgs,
  convertToKgs,
  formatCurrencyAmount,
  normalizeCurrencyCode,
  normalizeCurrencyRateKgsPerUnit,
} from "@/lib/currency";
import {
  baseAccountingCurrency,
  displayMoneyFromKgs,
  displayMoneyToKgs,
  formatKgsMoney,
  formatStoreMoney,
  resolveCurrency,
} from "@/lib/currencyDisplay";

describe("currency helpers", () => {
  it("formats supported currencies without falling back to hardcoded KGS", () => {
    expect(formatCurrencyAmount(12.5, "en", "USD")).toContain("$");
    expect(formatCurrencyAmount(12.5, "en", "GBP")).toContain("£");
  });

  it("converts prices between KGS storage values and selected currencies", () => {
    expect(convertFromKgs(895, 89.5, "USD")).toBe(10);
    expect(convertToKgs(10, 89.5, "USD")).toBe(895);
    expect(convertFromKgs(895, 1, "KGS")).toBe(895);
  });

  it("normalizes missing or unsupported currency settings safely", () => {
    expect(normalizeCurrencyCode("usd")).toBe("USD");
    expect(normalizeCurrencyCode("eur")).toBe("KGS");
    expect(normalizeCurrencyRateKgsPerUnit(0, "USD")).toBe(1);
  });

  it("formats KGS storage amounts in the selected store currency", () => {
    const usdStore = { currencyCode: "USD", currencyRateKgsPerUnit: "89.5" };

    expect(displayMoneyFromKgs(895, usdStore)).toBe(10);
    expect(displayMoneyToKgs(10, usdStore)).toBe(895);
    expect(formatKgsMoney(895, "en-US", usdStore)).toContain("$10.00");
    expect(formatKgsMoney(895, "en-US", baseAccountingCurrency)).toContain("KGS");
  });

  it("formats store-denominated amounts without applying KGS conversion", () => {
    const usdStore = { currencyCode: "USD", currencyRateKgsPerUnit: 89.5 };

    expect(formatStoreMoney(10, "en-US", usdStore)).toContain("$10.00");
  });

  it("centralizes fallback currency when store currency is missing", () => {
    const resolved = resolveCurrency(null);

    expect(resolved.currencyCode).toBe("KGS");
    expect(resolved.currencyRateKgsPerUnit).toBe(1);
    expect(resolved.isFallback).toBe(true);
  });
});
