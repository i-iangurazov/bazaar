import { describe, expect, it } from "vitest";

import { resolveBazaarApiPayment } from "@/server/services/bazaarApi";

const payment = (
  amountKgs: number,
  settlementStatus: "ACTUAL" | "OFFSET" | "PENDING" | "VOID",
  isRefund = false,
) => ({
  method: "CASH" as const,
  amountKgs,
  isRefund,
  settlementStatus,
});

describe("Bazaar API payment settlement", () => {
  it("keeps a fully paid order PAID when refunds are only pending or void", () => {
    const result = resolveBazaarApiPayment({
      totalKgs: 100,
      payments: [
        payment(100, "ACTUAL"),
        payment(40, "PENDING", true),
        payment(20, "VOID", true),
      ],
    });
    expect(result).toMatchObject({ status: "PAID", paidKgs: 100, methods: ["CASH"] });
  });

  it("reduces paid money only for an actual refund", () => {
    const result = resolveBazaarApiPayment({
      totalKgs: 100,
      payments: [payment(100, "ACTUAL"), payment(30, "ACTUAL", true)],
    });
    expect(result).toMatchObject({ status: "PARTIALLY_PAID", paidKgs: 70 });
  });

  it("treats an offset credit as settled without confusing it with a cash refund", () => {
    const result = resolveBazaarApiPayment({
      totalKgs: 100,
      payments: [payment(100, "OFFSET"), payment(25, "PENDING", true)],
    });
    expect(result).toMatchObject({ status: "PAID", paidKgs: 100, methods: ["CASH"] });
  });

  it("ignores pending purchases and counts an offset sale plus actual cash", () => {
    const result = resolveBazaarApiPayment({
      totalKgs: 150,
      payments: [
        payment(100, "OFFSET"),
        payment(50, "ACTUAL"),
        payment(90, "PENDING"),
      ],
    });
    expect(result).toMatchObject({ status: "PAID", paidKgs: 150 });
  });
});
