import { PosPaymentMethod } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  addPosPaymentDraftRow,
  createDefaultPosPaymentDraft,
  reconcilePosPaymentDraftsForSaleTotal,
  removePosPaymentDraftRow,
  posCheckoutPaymentMethod,
} from "@/lib/posPaymentDrafts";

describe("POS payment draft autofill", () => {
  it("preserves a cashless choice or split made while the first draft is being created", () => {
    const cashless = { method: PosPaymentMethod.TRANSFER, amount: "", providerRef: "bank-ref" };
    const input = {
      saleId: "new-sale",
      totalKgs: 100,
      previousAutoFill: { saleId: null, totalKgs: null },
    };
    expect(
      reconcilePosPaymentDraftsForSaleTotal({ ...input, currentPayments: [cashless] }).payments,
    ).toEqual([{ ...cashless, amount: "100" }]);
    const split = [{ ...cashless, amount: "60" }, createDefaultPosPaymentDraft("40")];
    expect(
      reconcilePosPaymentDraftsForSaleTotal({ ...input, currentPayments: split }).payments,
    ).toEqual(split);
    expect(
      reconcilePosPaymentDraftsForSaleTotal({
        ...input,
        currentPayments: [cashless],
        previousAutoFill: { saleId: "old-sale", totalKgs: 100 },
      }).payments,
    ).toEqual([createDefaultPosPaymentDraft("100")]);
  });
  it("initializes a new sale as a cash payment for the current total", () => {
    const result = reconcilePosPaymentDraftsForSaleTotal({
      currentPayments: [],
      saleId: "sale-1",
      totalKgs: 120,
      previousAutoFill: { saleId: null, totalKgs: null },
    });

    expect(result.payments).toEqual([createDefaultPosPaymentDraft("120")]);
    expect(result.autoFill).toEqual({ saleId: "sale-1", totalKgs: 120, displayTotal: 120 });
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

  it("overwrites a stale manual amount in single-payment mode", () => {
    const result = reconcilePosPaymentDraftsForSaleTotal({
      currentPayments: [
        {
          method: PosPaymentMethod.TRANSFER,
          amount: "10",
          providerRef: "ref-1",
        },
      ],
      saleId: "sale-1",
      totalKgs: 150,
      previousAutoFill: { saleId: "sale-1", totalKgs: 120 },
    });

    expect(result.payments).toEqual([
      {
        method: PosPaymentMethod.TRANSFER,
        amount: "150",
        providerRef: "ref-1",
      },
    ]);
  });

  it("keeps auto-filling when the current amount is formatted differently", () => {
    const result = reconcilePosPaymentDraftsForSaleTotal({
      currentPayments: [
        {
          method: PosPaymentMethod.TRANSFER,
          amount: "8 545,00 сом",
          providerRef: "",
        },
      ],
      saleId: "sale-1",
      totalKgs: 9000,
      displayTotal: 9000,
      previousAutoFill: { saleId: "sale-1", totalKgs: 8545, displayTotal: 8545 },
    });

    expect(result.payments).toEqual([
      {
        method: PosPaymentMethod.TRANSFER,
        amount: "9000",
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

  it("auto-fills the selected currency amount while tracking the KGS total", () => {
    const result = reconcilePosPaymentDraftsForSaleTotal({
      currentPayments: [],
      saleId: "sale-usd",
      totalKgs: 895,
      displayTotal: 10,
      previousAutoFill: { saleId: null, totalKgs: null },
    });

    expect(result.payments).toEqual([createDefaultPosPaymentDraft("10")]);
    expect(result.autoFill).toEqual({ saleId: "sale-usd", totalKgs: 895, displayTotal: 10 });
  });

  it("materializes the displayed single-payment total before adding a split row", () => {
    expect(
      addPosPaymentDraftRow({
        currentPayments: [{ method: PosPaymentMethod.CASH, amount: "", providerRef: "" }],
        displayTotalAmount: "10000",
      }),
    ).toEqual([
      { method: PosPaymentMethod.CASH, amount: "10000", providerRef: "" },
      { method: PosPaymentMethod.TRANSFER, amount: "", providerRef: "" },
    ]);
  });

  it("groups legacy non-cash methods for display while retaining original payment records", () => {
    const existing = { method: PosPaymentMethod.CARD, amount: "100", providerRef: "card-ref" };
    expect(posCheckoutPaymentMethod(existing.method)).toBe(PosPaymentMethod.TRANSFER);
    expect(posCheckoutPaymentMethod(PosPaymentMethod.OTHER)).toBe(PosPaymentMethod.TRANSFER);
    expect(posCheckoutPaymentMethod(PosPaymentMethod.CASH)).toBe(PosPaymentMethod.CASH);
    const split = addPosPaymentDraftRow({ currentPayments: [existing], displayTotalAmount: "100" });
    expect(split[0]).toEqual(existing);
    expect(split[1]?.method).toBe(PosPaymentMethod.CASH);
  });

  it("keeps a single remaining payment synced to the current total after removing a split row", () => {
    expect(
      removePosPaymentDraftRow({
        currentPayments: [
          { method: PosPaymentMethod.CASH, amount: "4000", providerRef: "" },
          { method: PosPaymentMethod.CARD, amount: "6000", providerRef: "" },
        ],
        index: 1,
        displayTotalAmount: "10000",
      }),
    ).toEqual([{ method: PosPaymentMethod.CASH, amount: "10000", providerRef: "" }]);
  });
});
