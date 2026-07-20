import type { PosPaymentDraft } from "@/lib/posPaymentDrafts";
import { parseMoneyInput } from "@/lib/moneyInput";

export const hasMobilePosNavigationRisk = (input: {
  cartLineCount: number;
  payments: PosPaymentDraft[];
  discountKgs: number;
  comment: string;
  hasCustomer: boolean;
  sellInDebt: boolean;
}) => {
  const hasMeaningfulPayment = input.payments.some((payment, index) => {
    const amount = parseMoneyInput(payment.amount);
    return (
      index > 0 ||
      payment.providerRef.trim().length > 0 ||
      (amount !== null && Math.abs(amount) > 0.004)
    );
  });

  return (
    input.cartLineCount > 0 ||
    hasMeaningfulPayment ||
    input.discountKgs > 0 ||
    input.comment.trim().length > 0 ||
    input.hasCustomer ||
    input.sellInDebt
  );
};
