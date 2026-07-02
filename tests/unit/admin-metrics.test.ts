import { describe, expect, it } from "vitest";

import { calculateInventoryValuationWithMargin } from "@/server/services/adminMetrics";

describe("admin inventory valuation metrics", () => {
  it("calculates valuation while exposing incomplete price and stock warnings", () => {
    const totals = calculateInventoryValuationWithMargin([
      {
        stockQty: 10,
        costPriceKgs: 100,
        salePriceKgs: 150,
        hasImage: true,
        minStock: 5,
        isAssigned: true,
      },
      {
        stockQty: 5,
        costPriceKgs: null,
        salePriceKgs: 200,
        hasImage: false,
        minStock: 0,
        isAssigned: true,
      },
      {
        stockQty: 4,
        costPriceKgs: 80,
        salePriceKgs: null,
        hasImage: true,
        minStock: 0,
        isAssigned: true,
      },
      {
        stockQty: -2,
        costPriceKgs: 50,
        salePriceKgs: 100,
        hasImage: true,
        minStock: 1,
        isAssigned: true,
      },
      {
        stockQty: 2,
        costPriceKgs: 10,
        salePriceKgs: 20,
        hasImage: true,
        minStock: 5,
        isAssigned: false,
      },
    ]);

    expect(totals.totalStockQty).toBe(19);
    expect(totals.costValueKgs).toBe(1240);
    expect(totals.retailValueKgs).toBe(2340);
    expect(totals.potentialGrossProfitKgs).toBe(420);
    expect(totals.potentialMarginPercent).toBeCloseTo(31.34, 2);
    expect(totals.rowsWithCost).toBe(4);
    expect(totals.rowsWithPrice).toBe(4);
    expect(totals.rowsWithProfitData).toBe(3);
    expect(totals.warningCounts).toEqual({
      noCost: 1,
      noPrice: 1,
      noImage: 1,
      negativeStock: 1,
      lowStock: 1,
      unassigned: 1,
    });
  });
});
