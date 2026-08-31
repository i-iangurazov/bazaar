import { describe, expect, it } from "vitest";

import {
  calculatePurchaseOrderLineTotal,
  normalizePurchaseOrderUnitCost,
  PURCHASE_ORDER_MAX_QUANTITY,
  PURCHASE_ORDER_MAX_UNIT_COST,
  roundPurchaseOrderMoney,
} from "@/lib/purchaseOrderMoney";

describe("purchase-order money boundaries", () => {
  it("rounds unit cost before multiplication so displayed and persisted totals agree", () => {
    expect(roundPurchaseOrderMoney(10.005)).toBe(10.01);
    expect(normalizePurchaseOrderUnitCost(10.005)).toBe(10.01);
    expect(calculatePurchaseOrderLineTotal(3, 10.005)).toBe(30.03);
    expect(calculatePurchaseOrderLineTotal(4, 55.25)).toBe(221);
  });

  it("exposes the exact PostgreSQL Int and Decimal(12,2) storage ceilings", () => {
    expect(PURCHASE_ORDER_MAX_QUANTITY).toBe(2_147_483_647);
    expect(PURCHASE_ORDER_MAX_UNIT_COST).toBe(9_999_999_999.99);
  });
});
