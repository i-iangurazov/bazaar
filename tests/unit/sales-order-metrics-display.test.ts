import { describe, expect, it } from "vitest";

import {
  formatSalesOrderMargin,
  salesOrderMetricsProfitability,
  salesOrderMetricsTrendMoney,
} from "@/lib/salesOrderMetricsDisplay";

describe("sales order metrics cost completeness", () => {
  it("does not present unknown cost as zero or a 100% margin", () => {
    const view = salesOrderMetricsProfitability({
      missingCostLines: 3,
      totalCostKgs: 0,
      totalProfitKgs: 2450,
      marginPct: 100,
    });

    expect(view).toEqual({
      costsComplete: false,
      costKgs: null,
      profitKgs: null,
      marginPct: null,
    });
    expect(salesOrderMetricsTrendMoney(2450, view.costsComplete)).toBeNull();
    expect(formatSalesOrderMargin(view.marginPct, "ru")).toBe("—");
  });

  it("keeps the existing values when every line has a known cost", () => {
    const view = salesOrderMetricsProfitability({
      missingCostLines: 0,
      totalCostKgs: 550,
      totalProfitKgs: 2450,
      marginPct: 81.6667,
    });

    expect(view).toEqual({
      costsComplete: true,
      costKgs: 550,
      profitKgs: 2450,
      marginPct: 81.6667,
    });
    expect(salesOrderMetricsTrendMoney(2450, view.costsComplete)).toBe(2450);
    expect(formatSalesOrderMargin(view.marginPct, "ru")).toBe("81,67%");
    expect(formatSalesOrderMargin(100, "ru")).toBe("100%");
    expect(formatSalesOrderMargin(100, "ru")).not.toContain("100.00");
  });
});
