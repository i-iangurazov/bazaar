import { PosPaymentMethod } from "@prisma/client";

import { displayMoneyToKgs, type CurrencySource } from "@/lib/currencyDisplay";
import { minorUnitsToMoney, moneyToMinorUnits, parseMoneyInput } from "@/lib/moneyInput";

export type PosCartLinePatch = {
  qty?: number;
  unitPriceKgs?: number;
};

export type PosCartLineForTotals = {
  qty: number;
  unitPriceKgs: number;
  lineTotalKgs: number;
  unitCostKgs?: number | null;
  lineCostTotalKgs?: number | null;
};

export type PosPaymentDraftForSubmit = {
  method: PosPaymentMethod;
  amount: string;
  providerRef: string;
};

export type PosPaymentSubmitPayload = {
  method: PosPaymentMethod;
  amountKgs: number;
  providerRef: string | null;
};

export type PosPaymentPayloadResult = {
  status: "ok" | "paymentRequired" | "paymentMismatch";
  payments: PosPaymentSubmitPayload[];
  displayPayments: PosPaymentDraftForSubmit[];
  cartTotalMinorUnits: number;
  paymentTotalMinorUnits: number;
};

export const roundPosMoney = (value: number) => Math.round(value * 100) / 100;

export const calculatePosLineTotalKgs = (qty: number, unitPriceKgs: number) =>
  roundPosMoney(unitPriceKgs * qty);

export const recalculatePosCartLine = <TLine extends PosCartLineForTotals>(
  line: TLine,
  patch: PosCartLinePatch,
): TLine => {
  const qty = patch.qty ?? line.qty;
  const unitPriceKgs = patch.unitPriceKgs ?? line.unitPriceKgs;

  return {
    ...line,
    qty,
    unitPriceKgs,
    lineTotalKgs: calculatePosLineTotalKgs(qty, unitPriceKgs),
    lineCostTotalKgs:
      line.unitCostKgs === null || line.unitCostKgs === undefined
        ? (line.lineCostTotalKgs ?? null)
        : calculatePosLineTotalKgs(qty, line.unitCostKgs),
  };
};

export const calculatePosCartSubtotalKgs = (lines: Array<{ lineTotalKgs: number }>) =>
  roundPosMoney(
    lines.reduce((sum, line) => {
      const lineTotal = Number(line.lineTotalKgs);
      return Number.isFinite(lineTotal) ? sum + lineTotal : sum;
    }, 0),
  );

export const calculatePosCartTotalKgs = (
  lines: Array<{ lineTotalKgs: number }>,
  discountKgs = 0,
) => {
  const subtotalKgs = calculatePosCartSubtotalKgs(lines);
  const normalizedDiscountKgs = Math.min(subtotalKgs, Math.max(0, roundPosMoney(discountKgs)));

  return {
    subtotalKgs,
    discountKgs: normalizedDiscountKgs,
    totalKgs: roundPosMoney(Math.max(0, subtotalKgs - normalizedDiscountKgs)),
  };
};

const normalizePaymentAmountKgs = (amountKgs: number) => {
  const minorUnits = moneyToMinorUnits(amountKgs);
  return minorUnits === null ? null : minorUnitsToMoney(minorUnits);
};

export const buildPosPaymentSubmitPayload = (input: {
  payments: PosPaymentDraftForSubmit[];
  cartTotalKgs: number;
  currencySource: CurrencySource;
  singlePaymentDisplayAmount?: string;
}): PosPaymentPayloadResult => {
  const currentPayments = input.payments.length
    ? input.payments
    : [{ method: PosPaymentMethod.CASH, amount: "", providerRef: "" }];
  const cartTotalKgs = roundPosMoney(input.cartTotalKgs);
  const cartTotalMinorUnits = moneyToMinorUnits(cartTotalKgs) ?? 0;
  const isSinglePaymentSale = currentPayments.length === 1;

  const displayPayments = isSinglePaymentSale
    ? [
        {
          ...currentPayments[0],
          amount: input.singlePaymentDisplayAmount ?? String(cartTotalKgs),
        },
      ]
    : currentPayments;

  let hasInvalidSplitPayment = false;
  const payments = isSinglePaymentSale
    ? cartTotalMinorUnits > 0
      ? [
          {
            method: currentPayments[0]?.method ?? PosPaymentMethod.CASH,
            amountKgs: minorUnitsToMoney(cartTotalMinorUnits),
            providerRef: currentPayments[0]?.providerRef.trim() || null,
          },
        ]
      : []
    : currentPayments
        .map((payment) => {
          const displayAmount = parseMoneyInput(payment.amount);
          if (displayAmount === null) {
            hasInvalidSplitPayment = true;
            return null;
          }

          const amountKgs = normalizePaymentAmountKgs(
            roundPosMoney(displayMoneyToKgs(displayAmount, input.currencySource)),
          );
          if (amountKgs === null || amountKgs <= 0) {
            hasInvalidSplitPayment = true;
            return null;
          }

          return {
            method: payment.method,
            amountKgs,
            providerRef: payment.providerRef.trim() || null,
          };
        })
        .filter((payment): payment is PosPaymentSubmitPayload => Boolean(payment));

  const paymentTotalMinorUnits = payments.reduce(
    (sum, payment) => sum + (moneyToMinorUnits(payment.amountKgs) ?? 0),
    0,
  );

  const status =
    cartTotalMinorUnits > 0 &&
    (!payments.length || (!isSinglePaymentSale && hasInvalidSplitPayment))
      ? "paymentRequired"
      : paymentTotalMinorUnits !== cartTotalMinorUnits
        ? "paymentMismatch"
        : "ok";

  return {
    status,
    payments,
    displayPayments,
    cartTotalMinorUnits,
    paymentTotalMinorUnits,
  };
};
