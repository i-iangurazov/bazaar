import { PosPaymentMethod } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  createDefaultPosPaymentDraft,
  reconcilePosPaymentDraftsForSaleTotal,
} from "@/lib/posPaymentDrafts";

describe("POS payment draft autofill", () => {
  it("initializes a new sale as a cash payment for the current total", () => {
    const result = reconcilePosPaymentDraftsForSaleTotal({
      currentPayments: [],
      saleId: "sale-1",
      totalKgs: 120,
      previousAutoFill: { saleId: null, totalKgs: null },
    });

    expect(result.payments).toEqual([createDefaultPosPaymentDraft("120")]);
    expect(result.autoFill).toEqual({ saleId: "sale-1", totalKgs: 120 });
  });

  it("keeps the selected payment method when the auto-filled total changes", () => {
    const result = reconcilePosPaymentDraftsForSaleTotal({
      currentPayments: [
        {
          method: PosPaymentMethod.CARD,
          amount: "120",
          providerRef: "",
        },
      ],
      saleId: "sale-1",
      totalKgs: 150,
      previousAutoFill: { saleId: "sale-1", totalKgs: 120 },
    });

    expect(result.payments).toEqual([
      {
        method: PosPaymentMethod.CARD,
        amount: "150",
        providerRef: "",
      },
    ]);
  });

  it("does not overwrite manually split payments", () => {
    const currentPayments = [
      { method: PosPaymentMethod.CASH, amount: "50", providerRef: "" },
      { method: PosPaymentMethod.TRANSFER, amount: "70", providerRef: "" },
    ];

    const result = reconcilePosPaymentDraftsForSaleTotal({
      currentPayments,
      saleId: "sale-1",
      totalKgs: 150,
      previousAutoFill: { saleId: "sale-1", totalKgs: 120 },
    });

    expect(result.payments).toBe(currentPayments);
  });
});
