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
  currencySourceWithFallback,
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

  it("normalizes fractional digit options before passing them to Intl", () => {
    expect(() =>
      formatCurrencyAmount(8750, "ru", "KGS", {
        maximumFractionDigits: 0,
      }),
    ).not.toThrow();
    expect(
      formatCurrencyAmount(8750, "ru", "KGS", {
        maximumFractionDigits: 0,
      }),
    ).not.toMatch(/[,.]00/);
  });

  it("formats Kyrgyz KGS deterministically with a localized number and som label", () => {
    expect(formatCurrencyAmount(160.92, "kg", "KGS")).toBe("160,92\u00a0сом");
    expect(formatCurrencyAmount(160.92, "ky", "KGS")).toBe("160,92\u00a0сом");
    expect(
      formatCurrencyAmount(8750, "kg", "KGS", {
        maximumFractionDigits: 0,
        useGrouping: false,
      }),
    ).toBe("8750\u00a0сом");
  });

  it("keeps non-Kyrgyz and non-KGS currency formatting on Intl currency semantics", () => {
    expect(formatCurrencyAmount(160.92, "en", "KGS")).toMatch(/KGS\s*160\.92/);
    expect(formatCurrencyAmount(160.92, "ru", "KGS")).not.toContain("сом");
    expect(formatCurrencyAmount(160.92, "kg", "USD")).not.toContain("сом");
    expect(formatCurrencyAmount(160.92, "kg", "GBP")).not.toContain("сом");
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

  it("prefers transaction currency snapshots over current store currency", () => {
    const snapshot = { currencyCode: "USD", currencyRateKgsPerUnit: "89.5" };
    const currentStore = { currencyCode: "KGS", currencyRateKgsPerUnit: "1" };

    const source = currencySourceWithFallback(snapshot, currentStore);

    expect(formatKgsMoney(895, "en-US", source)).toContain("$10.00");
  });

  it("falls back to current store currency for older records without a snapshot", () => {
    const oldRecord = { currencyCode: null, currencyRateKgsPerUnit: null };
    const currentStore = { currencyCode: "USD", currencyRateKgsPerUnit: "89.5" };

    const source = currencySourceWithFallback(oldRecord, currentStore);

    expect(formatKgsMoney(895, "en-US", source)).toContain("$10.00");
  });
});
