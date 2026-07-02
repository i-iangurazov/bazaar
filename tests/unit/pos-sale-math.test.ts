import { PosPaymentMethod } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildPosPaymentSubmitPayload,
  calculatePosCartSubtotalKgs,
  calculatePosCartTotalKgs,
  calculatePosLineTotalKgs,
  recalculatePosCartLine,
} from "@/lib/posSaleMath";
import { minorUnitsToMoney, moneyToMinorUnits } from "@/lib/moneyInput";

describe("POS sale math", () => {
  it("calculates line totals and cart totals in normalized money values", () => {
    expect(calculatePosLineTotalKgs(3, 12.345)).toBe(37.04);

    const lines = [{ lineTotalKgs: 37.04 }, { lineTotalKgs: 10 }, { lineTotalKgs: Number.NaN }];

    expect(calculatePosCartSubtotalKgs(lines)).toBe(47.04);
    expect(calculatePosCartTotalKgs(lines, 7.049)).toEqual({
      subtotalKgs: 47.04,
      discountKgs: 7.05,
      totalKgs: 39.99,
    });
  });

  it("updates quantity, unit price, line total, and cost total together", () => {
    const line = {
      qty: 1,
      unitPriceKgs: 100,
      lineTotalKgs: 100,
      unitCostKgs: 40,
      lineCostTotalKgs: 40,
    };

    expect(recalculatePosCartLine(line, { qty: 3, unitPriceKgs: 125 })).toEqual({
      qty: 3,
      unitPriceKgs: 125,
      lineTotalKgs: 375,
      unitCostKgs: 40,
      lineCostTotalKgs: 120,
    });
  });

  it("supports zero-price products and zero-total sales without payments", () => {
    const total = calculatePosCartTotalKgs([{ lineTotalKgs: 0 }]);
    const payload = buildPosPaymentSubmitPayload({
      payments: [{ method: PosPaymentMethod.CASH, amount: "999", providerRef: "" }],
      cartTotalKgs: total.totalKgs,
      currencySource: null,
      singlePaymentDisplayAmount: "0",
    });

    expect(payload.status).toBe("ok");
    expect(payload.cartTotalMinorUnits).toBe(0);
    expect(payload.paymentTotalMinorUnits).toBe(0);
    expect(payload.payments).toEqual([]);
    expect(payload.displayPayments[0]?.amount).toBe("0");
  });

  it("builds a single-payment payload from the latest cart total, not stale draft amount", () => {
    const payload = buildPosPaymentSubmitPayload({
      payments: [{ method: PosPaymentMethod.TRANSFER, amount: "10", providerRef: " ref-1 " }],
      cartTotalKgs: 150,
      currencySource: null,
      singlePaymentDisplayAmount: "150",
    });

    expect(payload.status).toBe("ok");
    expect(payload.payments).toEqual([
      { method: PosPaymentMethod.TRANSFER, amountKgs: 150, providerRef: "ref-1" },
    ]);
    expect(payload.displayPayments).toEqual([
      { method: PosPaymentMethod.TRANSFER, amount: "150", providerRef: " ref-1 " },
    ]);
  });

  it("normalizes split payments through display currency and validates minor units", () => {
    const payload = buildPosPaymentSubmitPayload({
      payments: [
        { method: PosPaymentMethod.CASH, amount: "5.00", providerRef: "" },
        { method: PosPaymentMethod.CARD, amount: "5,00", providerRef: "card" },
      ],
      cartTotalKgs: 895,
      currencySource: { currencyCode: "USD", currencyRateKgsPerUnit: 89.5 },
    });

    expect(payload.status).toBe("ok");
    expect(payload.payments).toEqual([
      { method: PosPaymentMethod.CASH, amountKgs: 447.5, providerRef: null },
      { method: PosPaymentMethod.CARD, amountKgs: 447.5, providerRef: "card" },
    ]);
    expect(payload.cartTotalMinorUnits).toBe(moneyToMinorUnits(895));
    expect(minorUnitsToMoney(payload.paymentTotalMinorUnits)).toBe(895);
  });

  it("reports required and mismatched split payments without float comparisons", () => {
    expect(
      buildPosPaymentSubmitPayload({
        payments: [
          { method: PosPaymentMethod.CASH, amount: "bad", providerRef: "" },
          { method: PosPaymentMethod.CARD, amount: "0", providerRef: "" },
        ],
        cartTotalKgs: 100,
        currencySource: null,
      }).status,
    ).toBe("paymentRequired");

    expect(
      buildPosPaymentSubmitPayload({
        payments: [
          { method: PosPaymentMethod.CASH, amount: "33.33", providerRef: "" },
          { method: PosPaymentMethod.CARD, amount: "33.33", providerRef: "" },
          { method: PosPaymentMethod.TRANSFER, amount: "33.33", providerRef: "" },
        ],
        cartTotalKgs: 100,
        currencySource: null,
      }).status,
    ).toBe("paymentMismatch");
  });

  it("blocks empty or zero rows in split-payment mode", () => {
    expect(
      buildPosPaymentSubmitPayload({
        payments: [
          { method: PosPaymentMethod.CASH, amount: "100", providerRef: "" },
          { method: PosPaymentMethod.CARD, amount: "", providerRef: "" },
        ],
        cartTotalKgs: 100,
        currencySource: null,
      }).status,
    ).toBe("paymentRequired");

    expect(
      buildPosPaymentSubmitPayload({
        payments: [
          { method: PosPaymentMethod.CASH, amount: "40", providerRef: "" },
          { method: PosPaymentMethod.TRANSFER, amount: "0", providerRef: "" },
          { method: PosPaymentMethod.CARD, amount: "60", providerRef: "" },
        ],
        cartTotalKgs: 100,
        currencySource: null,
      }).status,
    ).toBe("paymentRequired");
  });
});
