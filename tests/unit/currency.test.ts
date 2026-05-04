import { describe, expect, it } from "vitest";

import {
  convertFromKgs,
  convertToKgs,
  formatCurrencyAmount,
  normalizeCurrencyCode,
  normalizeCurrencyRateKgsPerUnit,
} from "@/lib/currency";

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
});
