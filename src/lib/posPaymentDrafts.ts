import { PosPaymentMethod } from "@prisma/client";

export type PosPaymentDraft = {
  method: PosPaymentMethod;
  amount: string;
  providerRef: string;
};

export type PosPaymentAutoFillState = {
  saleId: string | null;
  totalKgs: number | null;
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
  previousAutoFill: PosPaymentAutoFillState;
}): { payments: PosPaymentDraft[]; autoFill: PosPaymentAutoFillState } => {
  const nextAutoFill = { saleId: input.saleId, totalKgs: input.totalKgs };
  const nextAmount = String(input.totalKgs);

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
  const previousAmount =
    input.previousAutoFill.totalKgs === null ? "" : String(input.previousAutoFill.totalKgs);
  const amountWasAutoFilled = payment.amount === "" || payment.amount === previousAmount;

  if (!amountWasAutoFilled) {
    return {
      payments: input.currentPayments,
      autoFill: nextAutoFill,
    };
  }

  return {
    payments: [{ ...payment, amount: nextAmount }],
    autoFill: nextAutoFill,
  };
};
