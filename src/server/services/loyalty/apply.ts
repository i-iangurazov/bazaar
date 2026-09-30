import { Prisma } from "@prisma/client";

import { AppError } from "@/server/services/errors";
import { assertLoyaltyEnabled, toLoyaltyRules } from "@/server/services/loyalty/program";
import {
  calculateLoyalty,
  type LoyaltyCalcResult,
  type LoyaltyLineInput,
} from "@/server/services/loyalty/calc";
import {
  applyEntry,
  availablePoints,
  confirmReservation,
  ensureAccount,
  releaseReservation,
  reservePoints,
  type LoyaltyTx,
} from "@/server/services/loyalty/ledger";

const decimal = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value as never);

export const reserveKey = (customerOrderId: string) => `loyalty:reserve:${customerOrderId}`;
export const redeemKey = (customerOrderId: string) => `loyalty:redeem:${customerOrderId}`;
export const earnKey = (customerOrderId: string) => `loyalty:earn:${customerOrderId}`;

/** Builds participation-aware line inputs from an order's stored lines. */
export const orderLinesForLoyalty = async (
  tx: LoyaltyTx,
  customerOrderId: string,
  options: { excludePromoItems: boolean },
): Promise<LoyaltyLineInput[]> => {
  const lines = await tx.customerOrderLine.findMany({
    where: { customerOrderId },
    select: {
      id: true,
      qty: true,
      baseUnitPriceKgs: true,
      unitPriceKgs: true,
      lineTotalKgs: true,
    },
  });
  return lines.map((line) => {
    const base = decimal(line.baseUnitPriceKgs ?? line.unitPriceKgs);
    const unit = decimal(line.unitPriceKgs);
    const promo = Prisma.Decimal.max(0, base.minus(unit)).mul(line.qty);
    return {
      lineId: line.id,
      baseUnitPriceKgs: base,
      promoDiscountKgs: promo,
      qty: line.qty,
      // Promo positions are excluded from the programme by default.
      participates: !(options.excludePromoItems && promo.gt(0)),
    };
  });
};

export type LoyaltyQuote = LoyaltyCalcResult & {
  programId: string;
  accountId: string;
  memberId: string;
  availablePoints: number;
  reservationTtlMinutes: number;
  rules: ReturnType<typeof toLoyaltyRules>;
};

/** One quote shared by the register and the online checkout; the UI only renders it. */
export const quoteLoyaltyForOrder = async (
  tx: LoyaltyTx,
  input: {
    organizationId: string;
    storeId: string;
    customerOrderId: string;
    memberId: string;
    requestedPoints?: number;
  },
): Promise<LoyaltyQuote> => {
  const program = await assertLoyaltyEnabled(tx, input.organizationId, input.storeId);
  const member = await tx.loyaltyMember.findFirst({
    where: { id: input.memberId, organizationId: input.organizationId, programId: program.id },
  });
  if (!member || member.status !== "ACTIVE") {
    throw new AppError("loyaltyMemberNotAvailable", "NOT_FOUND", 404);
  }
  const account = await ensureAccount(tx, {
    organizationId: input.organizationId,
    programId: program.id,
    memberId: member.id,
  });
  const available = await availablePoints(tx, account.id);
  const rules = toLoyaltyRules(program);
  const lines = await orderLinesForLoyalty(tx, input.customerOrderId, {
    excludePromoItems: rules.excludePromoItems,
  });
  const calc = calculateLoyalty({
    rules,
    lines,
    availablePoints: available,
    requestedPoints: input.requestedPoints,
  });
  return {
    ...calc,
    programId: program.id,
    accountId: account.id,
    memberId: member.id,
    availablePoints: available,
    reservationTtlMinutes: program.reservationTtlMinutes,
    rules,
  };
};

/**
 * Applies the member discount and reserves the chosen points, then snapshots the
 * rules, amounts and line distribution on the order. Later rule changes never
 * rewrite this sale.
 */
export const applyLoyaltyToOrder = async (
  tx: LoyaltyTx,
  input: {
    organizationId: string;
    storeId: string;
    customerOrderId: string;
    memberId: string;
    requestedPoints?: number;
    actorId?: string | null;
  },
) => {
  const quote = await quoteLoyaltyForOrder(tx, input);
  // Never silently rewrite a price the cashier already quoted: if the requested
  // points are no longer fully available (for example another register reserved
  // them first), fail so the checkout re-quotes.
  const requested = Math.max(0, Math.trunc(input.requestedPoints ?? 0));
  if (requested > 0 && quote.redeemPoints < requested) {
    throw new AppError("loyaltyInsufficientPoints", "CONFLICT", 409);
  }
  if (quote.redeemPoints > 0) {
    await reservePoints(tx, {
      organizationId: input.organizationId,
      programId: quote.programId,
      accountId: quote.accountId,
      memberId: quote.memberId,
      customerOrderId: input.customerOrderId,
      points: quote.redeemPoints,
      ttlMinutes: quote.reservationTtlMinutes,
      eventKey: reserveKey(input.customerOrderId),
    });
  }
  const application = await tx.loyaltyOrderApplication.upsert({
    where: { customerOrderId: input.customerOrderId },
    create: {
      organizationId: input.organizationId,
      programId: quote.programId,
      memberId: quote.memberId,
      accountId: quote.accountId,
      customerOrderId: input.customerOrderId,
      status: "APPLIED",
      memberDiscountKgs: decimal(quote.memberDiscountKgs),
      pointsSpent: quote.redeemPoints,
      pointsEarned: quote.earnPoints,
      eligibleKgs: decimal(quote.eligibleKgs),
      rulesSnapshot: quote.rules as unknown as Prisma.InputJsonValue,
      lineDistribution: quote.lines as unknown as Prisma.InputJsonValue,
    },
    update: {
      status: "APPLIED",
      memberDiscountKgs: decimal(quote.memberDiscountKgs),
      pointsSpent: quote.redeemPoints,
      pointsEarned: quote.earnPoints,
      eligibleKgs: decimal(quote.eligibleKgs),
      rulesSnapshot: quote.rules as unknown as Prisma.InputJsonValue,
      lineDistribution: quote.lines as unknown as Prisma.InputJsonValue,
    },
  });

  // The member discount and the redeemed points both reduce the price; record them
  // once, never subtract them again later.
  const priceReduction = decimal(quote.memberDiscountKgs).plus(quote.redeemValueKgs);
  // Write the reduction onto the lines so receipts, returns and reports all use the
  // amount the customer actually pays. Allocation is sequential and exact.
  let remainingRedeem = decimal(quote.redeemValueKgs);
  const lineRows = await tx.customerOrderLine.findMany({
    where: { customerOrderId: input.customerOrderId },
    select: { id: true, qty: true },
  });
  const qtyByLine = new Map(lineRows.map((row) => [row.id, row.qty]));
  for (const line of quote.lines) {
    const qty = qtyByLine.get(line.lineId);
    if (!qty || qty <= 0) continue;
    let target = decimal(line.afterDiscountKgs);
    if (line.participates && !remainingRedeem.isZero()) {
      const applied = Prisma.Decimal.min(target, remainingRedeem).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      target = target.minus(applied);
      remainingRedeem = remainingRedeem.minus(applied);
    }
    await tx.customerOrderLine.update({
      where: { id: line.lineId },
      data: {
        lineTotalKgs: target,
        unitPriceKgs: target.div(qty).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      },
    });
  }
  const order = await tx.customerOrder.update({
    where: { id: input.customerOrderId },
    data: {
      discountKgs: { increment: priceReduction },
      totalKgs: { decrement: priceReduction },
    },
    select: { totalKgs: true, discountKgs: true },
  });
  return { quote, application, totalKgs: Number(order.totalKgs), discountKgs: Number(order.discountKgs) };
};

/** Converts the reservation into a redemption and, once fully paid, an earning. */
export const confirmLoyaltyForOrder = async (
  tx: LoyaltyTx,
  input: {
    organizationId: string;
    customerOrderId: string;
    paidInFull: boolean;
    actorId?: string | null;
    now?: Date;
  },
) => {
  const application = await tx.loyaltyOrderApplication.findUnique({
    where: { customerOrderId: input.customerOrderId },
  });
  if (!application || application.status === "REVERSED") return { applied: false, earned: false };
  if (application.pointsSpent > 0) {
    const reservation = await tx.loyaltyReservation.findUnique({
      where: { eventKey: reserveKey(input.customerOrderId) },
    });
    if (reservation) {
      await confirmReservation(tx, {
        reservationId: reservation.id,
        eventKey: redeemKey(input.customerOrderId),
        reason: "loyaltyRedeem",
        now: input.now,
      });
    }
  }
  let earned = false;
  // Points are granted only for a completed order whose money part is fully paid.
  if (input.paidInFull && application.pointsEarned > 0) {
    await applyEntry(tx, {
      organizationId: input.organizationId,
      programId: application.programId,
      accountId: application.accountId,
      memberId: application.memberId,
      type: "EARN",
      points: application.pointsEarned,
      eventKey: earnKey(input.customerOrderId),
      reason: "loyaltyEarn",
      customerOrderId: input.customerOrderId,
      actorId: input.actorId ?? null,
      actorType: "SYSTEM",
    });
    earned = true;
  }
  await tx.loyaltyOrderApplication.update({
    where: { id: application.id },
    data: { status: input.paidInFull ? "CONFIRMED" : "APPLIED" },
  });
  return { applied: true, earned };
};

/** Cancels an unfinished checkout: the reservation stops reducing availability. */
export const releaseLoyaltyForOrder = async (
  tx: LoyaltyTx,
  input: { customerOrderId: string; now?: Date },
) => {
  const reservation = await tx.loyaltyReservation.findUnique({
    where: { eventKey: reserveKey(input.customerOrderId) },
  });
  if (reservation) {
    await releaseReservation(tx, { reservationId: reservation.id, now: input.now });
  }
  await tx.loyaltyOrderApplication.updateMany({
    where: { customerOrderId: input.customerOrderId, status: "APPLIED" },
    data: { status: "RELEASED" },
  });
};

/** Cumulative proportional reversal so successive partial returns cannot over-reverse. */
export const reverseLoyaltyForReturn = async (
  tx: LoyaltyTx,
  input: {
    organizationId: string;
    customerOrderId: string;
    saleReturnId: string;
    returnNumber?: string | null;
  },
) => {
  const application = await tx.loyaltyOrderApplication.findUnique({
    where: { customerOrderId: input.customerOrderId },
  });
  if (!application) return { reversedSpend: 0, reversedEarn: 0 };

  const [returnedBase, originalBase] = await Promise.all([
    tx.saleReturnLine.aggregate({
      where: { saleReturn: { originalSaleId: input.customerOrderId, status: "COMPLETED" } },
      _sum: { lineTotalKgs: true },
    }),
    tx.customerOrderLine.aggregate({
      where: { customerOrderId: input.customerOrderId },
      _sum: { lineTotalKgs: true },
    }),
  ]);
  const original = Number(originalBase._sum.lineTotalKgs ?? 0);
  const returned = Math.min(Number(returnedBase._sum.lineTotalKgs ?? 0), original);
  if (original <= 0) return { reversedSpend: 0, reversedEarn: 0 };
  const ratio = returned / original;

  const targetRedeemReturn = Math.floor(application.pointsSpent * ratio);
  const targetEarnCancel = Math.floor(application.pointsEarned * ratio);

  const alreadySpend = await tx.loyaltyLedgerEntry.aggregate({
    where: { customerOrderId: input.customerOrderId, saleReturnId: { not: null }, type: "REVERSAL_REDEEM" },
    _sum: { points: true },
  });
  const alreadyEarn = await tx.loyaltyLedgerEntry.aggregate({
    where: { customerOrderId: input.customerOrderId, saleReturnId: { not: null }, type: "REVERSAL_EARN" },
    _sum: { points: true },
  });
  const reversedSpend = Math.max(0, targetRedeemReturn - (alreadySpend._sum.points ?? 0));
  const reversedEarn = Math.max(0, targetEarnCancel + (alreadyEarn._sum.points ?? 0));

  if (reversedSpend > 0) {
    await applyEntry(tx, {
      organizationId: input.organizationId,
      programId: application.programId,
      accountId: application.accountId,
      memberId: application.memberId,
      type: "REVERSAL_REDEEM",
      points: reversedSpend,
      eventKey: `loyalty:rev-redeem:${input.saleReturnId}`,
      reason: "loyaltyReturnRedeem",
      customerOrderId: input.customerOrderId,
      saleReturnId: input.saleReturnId,
      actorType: "SYSTEM",
    });
  }
  if (reversedEarn > 0) {
    await applyEntry(tx, {
      organizationId: input.organizationId,
      programId: application.programId,
      accountId: application.accountId,
      memberId: application.memberId,
      type: "REVERSAL_EARN",
      points: -reversedEarn,
      eventKey: `loyalty:rev-earn:${input.saleReturnId}`,
      reason: "loyaltyReturnEarn",
      customerOrderId: input.customerOrderId,
      saleReturnId: input.saleReturnId,
      allowNegative: true,
      actorType: "SYSTEM",
    });
  }
  return { reversedSpend, reversedEarn };
};
