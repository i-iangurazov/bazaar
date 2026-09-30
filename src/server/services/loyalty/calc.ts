import { Prisma } from "@prisma/client";

/**
 * Single server-side loyalty calculation shared by the register and the online
 * catalogue. Money is computed with Prisma.Decimal (never JS float) and points are
 * whole numbers rounded down.
 */
export type LoyaltyRules = {
  memberDiscountPercent: number;
  earnPercent: number;
  maxSpendPercent: number;
  pointValueKgs: number;
  minRedeemPoints: number;
  excludePromoItems: boolean;
  combinePromoDiscount: boolean;
};

export type LoyaltyLineInput = {
  lineId: string;
  /** Unit price before any discount. */
  baseUnitPriceKgs: Prisma.Decimal | number;
  /** Existing catalogue/promo discount already granted on the line. */
  promoDiscountKgs: Prisma.Decimal | number;
  qty: number;
  /** False for delivery, services and other non-participating positions. */
  participates: boolean;
};

export type LoyaltyLineResult = {
  lineId: string;
  baseKgs: number;
  promoDiscountKgs: number;
  memberDiscountKgs: number;
  afterDiscountKgs: number;
  participates: boolean;
};

export type LoyaltyCalcResult = {
  memberDiscountKgs: number;
  eligibleKgs: number;
  nonEligibleKgs: number;
  maxRedeemPoints: number;
  redeemPoints: number;
  redeemValueKgs: number;
  payableKgs: number;
  earnPoints: number;
  lines: LoyaltyLineResult[];
};

const decimal = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value as never);
const money = (value: Prisma.Decimal) => Number(value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP));
const percentOf = (amount: Prisma.Decimal, percent: number) =>
  amount.mul(percent).div(100);

export function calculateLoyalty(input: {
  rules: LoyaltyRules;
  lines: LoyaltyLineInput[];
  availablePoints: number;
  requestedPoints?: number;
}): LoyaltyCalcResult {
  const { rules } = input;
  const lines: LoyaltyLineResult[] = input.lines.map((line) => {
    const qty = new Prisma.Decimal(Math.max(0, Math.trunc(line.qty)));
    const base = decimal(line.baseUnitPriceKgs).mul(qty).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const promo = decimal(line.promoDiscountKgs).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const memberCandidate = percentOf(base, rules.memberDiscountPercent).toDecimalPlaces(
      2,
      Prisma.Decimal.ROUND_HALF_UP,
    );
    // Default keeps the larger of the member vs promo discount; never the sum.
    const effectiveDiscount =
      line.participates && !rules.combinePromoDiscount
        ? Prisma.Decimal.max(promo, memberCandidate)
        : promo.plus(line.participates ? memberCandidate : 0);
    const memberDiscount = line.participates
      ? Prisma.Decimal.max(0, effectiveDiscount.minus(promo))
      : new Prisma.Decimal(0);
    const after = Prisma.Decimal.max(0, base.minus(effectiveDiscount));
    return {
      lineId: line.lineId,
      baseKgs: money(base),
      promoDiscountKgs: money(promo),
      memberDiscountKgs: money(memberDiscount),
      afterDiscountKgs: money(after),
      participates: line.participates,
    };
  });

  const eligible = lines
    .filter((line) => line.participates)
    .reduce((sum, line) => sum.plus(decimal(line.afterDiscountKgs)), new Prisma.Decimal(0));
  const nonEligible = lines
    .filter((line) => !line.participates)
    .reduce((sum, line) => sum.plus(decimal(line.afterDiscountKgs)), new Prisma.Decimal(0));
  const memberDiscountTotal = lines.reduce(
    (sum, line) => sum.plus(decimal(line.memberDiscountKgs)),
    new Prisma.Decimal(0),
  );

  const pointValue = decimal(rules.pointValueKgs);
  const rawMax = percentOf(eligible, rules.maxSpendPercent)
    .div(pointValue)
    .floor()
    .toNumber();
  const maxRedeemPoints = Math.max(0, Math.min(Math.trunc(input.availablePoints), rawMax));
  const requested = Math.max(0, Math.trunc(input.requestedPoints ?? 0));
  let redeemPoints = Math.min(requested, maxRedeemPoints);
  if (redeemPoints < rules.minRedeemPoints) redeemPoints = 0;

  const redeemValue = pointValue.mul(redeemPoints);
  const earnBase = Prisma.Decimal.max(0, eligible.minus(redeemValue));
  const earnPoints = percentOf(earnBase, rules.earnPercent).floor().toNumber();
  const payable = eligible.plus(nonEligible).minus(redeemValue);

  return {
    memberDiscountKgs: money(memberDiscountTotal),
    eligibleKgs: money(eligible),
    nonEligibleKgs: money(nonEligible),
    maxRedeemPoints,
    redeemPoints,
    redeemValueKgs: money(redeemValue),
    payableKgs: money(payable),
    earnPoints,
    lines,
  };
}
