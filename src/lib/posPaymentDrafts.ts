import { PosPaymentMethod } from "@prisma/client";

export type PosPaymentDraft = {
  method: PosPaymentMethod;
  amount: string;
  providerRef: string;
};

export type PosPaymentAutoFillState = {
  saleId: string | null;
  totalKgs: number | null;
  displayTotal?: number | null;
};

export const createDefaultPosPaymentDraft = (amount = ""): PosPaymentDraft => ({
  method: PosPaymentMethod.CASH,
  amount,
  providerRef: "",
});

export const reconcilePosPaymentDraftsForSaleTotal = (input: {
  currentPayments: PosPaymentDraft[];
  saleId: string;
  totalKgs: number;
  displayTotal?: number;
  previousAutoFill: PosPaymentAutoFillState;
}): { payments: PosPaymentDraft[]; autoFill: PosPaymentAutoFillState } => {
  const nextDisplayTotal = input.displayTotal ?? input.totalKgs;
  const nextAutoFill = {
    saleId: input.saleId,
    totalKgs: input.totalKgs,
    displayTotal: nextDisplayTotal,
  };
  const nextAmount = String(nextDisplayTotal);

  if (input.previousAutoFill.saleId !== input.saleId) {
    return {
      payments: [createDefaultPosPaymentDraft(nextAmount)],
      autoFill: nextAutoFill,
    };
  }

  if (input.currentPayments.length !== 1) {
    return {
      payments: input.currentPayments,
      autoFill: nextAutoFill,
    };
  }

  const [payment] = input.currentPayments;
  return {
    payments: [{ ...payment, amount: nextAmount }],
    autoFill: nextAutoFill,
  };
};
