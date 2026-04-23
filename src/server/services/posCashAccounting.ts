export type CashDifferenceStatus = "BALANCED" | "SURPLUS" | "SHORTAGE";

export type ExpectedCashInput = {
  openingCashKgs: number;
  payInKgs: number;
  payOutKgs: number;
  cashSalesKgs: number;
  cashRefundsKgs: number;
};

export const roundCashAmount = (value: number) => Math.round(value * 100) / 100;

export const calculateExpectedCashKgs = (input: ExpectedCashInput) =>
  roundCashAmount(
    input.openingCashKgs +
      input.payInKgs -
      input.payOutKgs +
      input.cashSalesKgs -
      input.cashRefundsKgs,
  );

export const calculateCashDiscrepancyKgs = (input: {
  countedCashKgs: number;
  expectedCashKgs: number;
}) => roundCashAmount(input.countedCashKgs - input.expectedCashKgs);

export const resolveCashDifferenceStatus = (differenceKgs: number): CashDifferenceStatus => {
  if (differenceKgs > 0.009) {
    return "SURPLUS";
  }
  if (differenceKgs < -0.009) {
    return "SHORTAGE";
  }
  return "BALANCED";
};
