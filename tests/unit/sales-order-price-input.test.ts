import { describe, expect, it } from "vitest";

import {
  parseSalesOrderPriceInput,
  salesOrderLineTotal,
  salesOrderPriceInput,
} from "@/lib/salesOrderPriceInput";

describe("manual sales order price input", () => {
  it("accepts localized decimals and explicit zero, rejecting incomplete or invalid amounts", () => {
    expect(parseSalesOrderPriceInput("68,50", { currencyCode: "KGS" })).toBe(68.5);
    expect(parseSalesOrderPriceInput("68.50", { currencyCode: "KGS" })).toBe(68.5);
    expect(parseSalesOrderPriceInput("0", { currencyCode: "KGS" })).toBe(0);
    expect(parseSalesOrderPriceInput("+.01", { currencyCode: "KGS" })).toBe(0.01);
    for (const value of ["", "-1", "1,234", "1.2.3", "Infinity", "1e3", "10000000000"]) {
      expect(parseSalesOrderPriceInput(value, { currencyCode: "KGS" })).toBeNull();
    }
  });

  it("previews fractional line totals with the same half-up rounding as the server", () => {
    expect(salesOrderLineTotal(0.5, 2.01)).toBe(1.01);
    expect(salesOrderLineTotal(0.125, 68.5)).toBe(8.56);
    expect(salesOrderLineTotal(3, 0)).toBe(0);
    expect(salesOrderLineTotal(0, 68.5)).toBeNull();
    expect(salesOrderLineTotal(1, null)).toBeNull();
  });

  it("converts the entered document currency to KGS using its snapshot", () => {
    const snapshot = { currencyCode: "USD", currencyRateKgsPerUnit: 87.5 };
    expect(salesOrderPriceInput(875, snapshot)).toBe("10");
    expect(parseSalesOrderPriceInput("10,25", snapshot)).toBe(896.88);
    expect(parseSalesOrderPriceInput("2,01", snapshot)).toBe(175.88);
    expect(
      parseSalesOrderPriceInput("1,14", { currencyCode: "USD", currencyRateKgsPerUnit: 87.25 }),
    ).toBe(99.47);
    expect(parseSalesOrderPriceInput("0", snapshot)).toBe(0);
    expect(parseSalesOrderPriceInput("9999999999.99", snapshot)).toBeNull();
  });
});
