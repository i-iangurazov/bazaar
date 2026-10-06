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

export const POS_CHECKOUT_PAYMENT_METHODS = [
  PosPaymentMethod.CASH,
  PosPaymentMethod.TRANSFER,
] as const;

// Display old non-cash methods as one choice without rewriting stored payments.
export const posCheckoutPaymentMethod = (method: PosPaymentMethod) =>
  method === PosPaymentMethod.CASH ? PosPaymentMethod.CASH : PosPaymentMethod.TRANSFER;

const nextPaymentMethod = (payments: PosPaymentDraft[]) =>
  POS_CHECKOUT_PAYMENT_METHODS.find((method) =>
    payments.every((payment) => posCheckoutPaymentMethod(payment.method) !== method),
  ) ?? PosPaymentMethod.TRANSFER;

export const addPosPaymentDraftRow = (input: {
  currentPayments: PosPaymentDraft[];
  displayTotalAmount: string;
}): PosPaymentDraft[] => {
  const currentPayments = input.currentPayments.length
    ? input.currentPayments
    : [createDefaultPosPaymentDraft(input.displayTotalAmount)];
  const materializedPayments =
    currentPayments.length === 1
      ? [{ ...currentPayments[0]!, amount: input.displayTotalAmount }]
      : currentPayments;

  return [
    ...materializedPayments,
    {
      ...createDefaultPosPaymentDraft(),
      method: nextPaymentMethod(materializedPayments),
    },
  ];
};

export const removePosPaymentDraftRow = (input: {
  currentPayments: PosPaymentDraft[];
  index: number;
  displayTotalAmount: string;
}): PosPaymentDraft[] => {
  if (input.currentPayments.length <= 1) {
    return input.currentPayments;
  }

  const nextPayments = input.currentPayments.filter((_, index) => index !== input.index);
  if (nextPayments.length === 1) {
    return [{ ...nextPayments[0]!, amount: input.displayTotalAmount }];
  }

  return nextPayments.length
    ? nextPayments
    : [createDefaultPosPaymentDraft(input.displayTotalAmount)];
};

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
    // A cashier may choose a method or split before the draft creation finishes.
    // Only switching away from an already initialized sale resets its payments.
    const pendingPayments = input.previousAutoFill.saleId === null ? input.currentPayments : [];
    return {
      payments:
        pendingPayments.length === 1
          ? [{ ...pendingPayments[0]!, amount: nextAmount }]
          : pendingPayments.length
            ? pendingPayments
            : [createDefaultPosPaymentDraft(nextAmount)],
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
