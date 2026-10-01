import { cumulativeReturnPoints } from "./returnAllocation";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import { AppError } from "@/server/services/errors";
import { assertLoyaltyEnabled, toLoyaltyRules } from "@/server/services/loyalty/program";
import { calculateLoyalty, type LoyaltyCalcResult, type LoyaltyLineInput } from "@/server/services/loyalty/calc";
import { applyEntry, lockLoyaltyAccount, availablePoints, confirmReservation, ensureAccount, releaseReservationsForOrder, reservePoints, type LoyaltyTx } from "@/server/services/loyalty/ledger";

const decimal = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);
const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
export const reserveKey = (id: string) => `loyalty:reserve:${id}`;
export const redeemKey = (id: string) => `loyalty:redeem:${id}`;
export const earnKey = (id: string) => `loyalty:earn:${id}`;

type SnapshotLine = {
  lineId: string; productId: string; variantKey: string; qty: number; originalUnitPriceKgs: string; originalLineTotalKgs: string;
  baseUnitPriceKgs: string; appliedLineTotalKgs: string; appliedUnitPriceKgs: string;
  redeemValueKgs: string; earnWeightKgs: string;
};
type Snapshot = {
  version?: number; reserveEventKey?: string; quote?: LoyaltyQuote; pointValueKgs?: number;
  appliedLineTotalKgs?: number; originalDiscountKgs?: string;
};

/** Read old local snapshots without rewriting completed receipts or migration history. */
const snapshotLines = async (tx: LoyaltyTx, application: { customerOrderId: string; rulesSnapshot: Prisma.JsonValue; lineDistribution: Prisma.JsonValue; pointsSpent: number }): Promise<SnapshotLine[]> => {
  const snapshot = application.rulesSnapshot as unknown as Snapshot;
  if (snapshot.version === 2) return application.lineDistribution as unknown as SnapshotLine[];
  const rows = await tx.customerOrderLine.findMany({ where: { customerOrderId: application.customerOrderId } });
  const legacy = application.lineDistribution as unknown as Array<{ lineId: string; baseKgs: number; originalLineTotalKgs: number; afterDiscountKgs: number; participates: boolean }>;
  if (rows.length !== legacy.length || legacy.some((line) => !rows.some((row) => row.id === line.lineId))) throw new AppError("loyaltyCartChanged", "CONFLICT", 409);
  const savedTotal = snapshot.appliedLineTotalKgs;
  if (savedTotal === undefined || !rows.reduce((sum, row) => sum.plus(row.lineTotalKgs), decimal(0)).eq(savedTotal)) throw new AppError("loyaltyCartChanged", "CONFLICT", 409);
  let remaining = decimal(application.pointsSpent).mul(snapshot.pointValueKgs ?? 1);
  return legacy.map((line) => {
    const row = rows.find((candidate) => candidate.id === line.lineId)!;
    const baseUnit = row.baseUnitPriceKgs ?? row.unitPriceKgs;
    const qty = baseUnit.gt(0) ? decimal(line.baseKgs).div(baseUnit).toNumber() : row.qty;
    const redeem = line.participates ? money(Prisma.Decimal.min(remaining, decimal(line.afterDiscountKgs))) : decimal(0);
    remaining = remaining.minus(redeem);
    const appliedTotal = decimal(line.afterDiscountKgs).minus(redeem);
    if (qty !== row.qty || qty <= 0 || !row.lineTotalKgs.eq(appliedTotal) || !row.unitPriceKgs.eq(money(appliedTotal.div(qty)))) throw new AppError("loyaltyCartChanged", "CONFLICT", 409);
    return { lineId: row.id, productId: row.productId, variantKey: row.variantKey, qty, originalUnitPriceKgs: money(decimal(line.originalLineTotalKgs).div(qty)).toString(), originalLineTotalKgs: String(line.originalLineTotalKgs), baseUnitPriceKgs: baseUnit.toString(), appliedLineTotalKgs: appliedTotal.toString(), appliedUnitPriceKgs: row.unitPriceKgs.toString(), redeemValueKgs: redeem.toString(), earnWeightKgs: line.participates ? appliedTotal.toString() : "0" };
  });
};

export const lockLoyaltyOrder = async (tx: LoyaltyTx, customerOrderId: string) => {
  await tx.$queryRaw`SELECT id FROM "CustomerOrder" WHERE id = ${customerOrderId} FOR UPDATE`;
};

/** Fingerprint includes quantities and exact prices, not just the final sum. */
export const loyaltyCartFingerprint = async (tx: LoyaltyTx, customerOrderId: string) => {
  const order = await tx.customerOrder.findUniqueOrThrow({ where: { id: customerOrderId }, select: { storeId: true, discountKgs: true, totalKgs: true } });
  const lines = await tx.customerOrderLine.findMany({ where: { customerOrderId }, orderBy: { id: "asc" }, select: { id: true, productId: true, variantKey: true, qty: true, unitPriceKgs: true, lineTotalKgs: true } });
  return createHash("sha256").update(JSON.stringify({ order, lines })).digest("hex");
};

export const orderLinesForLoyalty = async (tx: LoyaltyTx, customerOrderId: string, options: { excludePromoItems: boolean }): Promise<LoyaltyLineInput[]> => {
  const [lines, application] = await Promise.all([
    tx.customerOrderLine.findMany({ where: { customerOrderId }, orderBy: { id: "asc" } }),
    tx.loyaltyOrderApplication.findUnique({ where: { customerOrderId } }),
  ]);
  const snapshot = application?.status === "APPLIED" ? await snapshotLines(tx, application) : [];
  return lines.map((line) => {
    const original = snapshot.find((row) => row.lineId === line.id);
    const base = decimal(line.baseUnitPriceKgs ?? line.unitPriceKgs);
    const total = original?.originalLineTotalKgs !== undefined ? decimal(original.originalLineTotalKgs) : line.lineTotalKgs;
    const promo = Prisma.Decimal.max(0, base.mul(line.qty).minus(total));
    return { lineId: line.id, baseUnitPriceKgs: base, promoDiscountKgs: promo, qty: line.qty, participates: !(options.excludePromoItems && promo.gt(0)) };
  });
};

export type LoyaltyQuote = LoyaltyCalcResult & {
  programId: string; accountId: string; memberId: string; availablePoints: number;
  reservationTtlMinutes: number; rules: ReturnType<typeof toLoyaltyRules>;
};

type ApplyInput = { organizationId: string; storeId: string; customerOrderId: string; memberId: string; requestedPoints?: number; actorId?: string | null };

export const quoteLoyaltyForOrder = async (tx: LoyaltyTx, input: ApplyInput): Promise<LoyaltyQuote> => {
  const order = await tx.customerOrder.findFirst({ where: { id: input.customerOrderId, organizationId: input.organizationId, storeId: input.storeId } });
  if (!order) throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
  if (order.discountKgs.gt(0)) throw new AppError("loyaltyManualDiscount", "CONFLICT", 409);
  const program = await assertLoyaltyEnabled(tx, input.organizationId, input.storeId);
  const member = await tx.loyaltyMember.findFirst({ where: { id: input.memberId, organizationId: input.organizationId, programId: program.id, status: "ACTIVE" } });
  if (!member) throw new AppError("loyaltyMemberNotAvailable", "NOT_FOUND", 404);
  const account = await ensureAccount(tx, { organizationId: input.organizationId, programId: program.id, memberId: member.id });
  const own = await tx.loyaltyReservation.aggregate({ where: { accountId: account.id, customerOrderId: input.customerOrderId, status: "ACTIVE", expiresAt: { gt: new Date() } }, _sum: { points: true } });
  const available = (await availablePoints(tx, account.id)) + (own._sum.points ?? 0);
  const rules = toLoyaltyRules(program);
  const lines = await orderLinesForLoyalty(tx, input.customerOrderId, { excludePromoItems: rules.excludePromoItems });
  return { ...calculateLoyalty({ rules, lines, availablePoints: available, requestedPoints: input.requestedPoints }), programId: program.id, accountId: account.id, memberId: member.id, availablePoints: available, reservationTtlMinutes: program.reservationTtlMinutes, rules };
};

/** Money invariant: reduced line totals are the payable subtotal; discountKgs holds only manual discount. */
export const applyLoyaltyToOrder = async (tx: LoyaltyTx, input: ApplyInput) => {
  await lockLoyaltyOrder(tx, input.customerOrderId);
  const order = await tx.customerOrder.findFirst({ where: { id: input.customerOrderId, organizationId: input.organizationId, storeId: input.storeId } });
  if (!order || !["DRAFT", "CONFIRMED", "READY"].includes(order.status)) throw new AppError("posSaleNotEditable", "CONFLICT", 409);
  const previous = await tx.loyaltyOrderApplication.findUnique({ where: { customerOrderId: order.id } });
  const requestedAccount = await tx.loyaltyAccount.findUnique({ where: { memberId: input.memberId }, select: { id: true } });
  for (const accountId of [...new Set([previous?.accountId, requestedAccount?.id].filter((id): id is string => Boolean(id)))].sort()) await lockLoyaltyAccount(tx, accountId);
  const requested = Math.max(0, Math.trunc(input.requestedPoints ?? 0));
  if (previous?.status === "APPLIED") {
    const saved = previous.rulesSnapshot as unknown as Snapshot;
    if (previous.memberId === input.memberId && previous.pointsSpent === requested && saved.quote) {
      await assertAppliedCart(tx, order.id, previous.lineDistribution as unknown as SnapshotLine[]);
      return { quote: saved.quote, application: previous, totalKgs: Number(order.totalKgs), discountKgs: Number(order.discountKgs) };
    }
    await releaseLoyaltyForOrder(tx, { customerOrderId: order.id });
  }
  const quote = await quoteLoyaltyForOrder(tx, input);
  if (requested > quote.redeemPoints) throw new AppError("loyaltyInsufficientPoints", "CONFLICT", 409);
  const reservationKey = `${reserveKey(order.id)}:${randomUUID()}`;
  if (quote.redeemPoints) await reservePoints(tx, { ...input, programId: quote.programId, accountId: quote.accountId, memberId: quote.memberId, points: quote.redeemPoints, ttlMinutes: quote.reservationTtlMinutes, eventKey: reservationKey });
  const rows = await tx.customerOrderLine.findMany({ where: { customerOrderId: order.id } });
  const rowMap = new Map(rows.map((line) => [line.id, line]));
  const distribution: SnapshotLine[] = [];
  let remaining = decimal(quote.redeemValueKgs);
  let total = decimal(0);
  for (const line of quote.lines) {
    const row = rowMap.get(line.lineId)!;
    const redeem = line.participates ? Prisma.Decimal.min(remaining, decimal(line.afterDiscountKgs)) : decimal(0);
    remaining = remaining.minus(redeem);
    const target = money(decimal(line.afterDiscountKgs).minus(redeem));
    const unit = money(target.div(row.qty));
    distribution.push({ lineId: row.id, productId: row.productId, variantKey: row.variantKey, qty: row.qty, originalUnitPriceKgs: row.unitPriceKgs.toString(), originalLineTotalKgs: row.lineTotalKgs.toString(), baseUnitPriceKgs: (row.baseUnitPriceKgs ?? row.unitPriceKgs).toString(), appliedLineTotalKgs: target.toString(), appliedUnitPriceKgs: unit.toString(), redeemValueKgs: redeem.toString(), earnWeightKgs: line.participates ? target.toString() : "0" });
    await tx.customerOrderLine.update({ where: { id: row.id }, data: { lineTotalKgs: target, unitPriceKgs: unit } });
    total = total.plus(target);
  }
  const data = { programId: quote.programId, memberId: quote.memberId, accountId: quote.accountId, status: "APPLIED" as const, memberDiscountKgs: decimal(quote.memberDiscountKgs), pointsSpent: quote.redeemPoints, pointsEarned: quote.earnPoints, eligibleKgs: decimal(quote.eligibleKgs), rulesSnapshot: { ...quote.rules, version: 2, reserveEventKey: reservationKey, quote, appliedLineTotalKgs: Number(total), originalDiscountKgs: "0" } as unknown as Prisma.InputJsonValue, lineDistribution: distribution as unknown as Prisma.InputJsonValue };
  const application = await tx.loyaltyOrderApplication.upsert({ where: { customerOrderId: order.id }, create: { ...data, organizationId: input.organizationId, customerOrderId: order.id }, update: data });
  const updated = await tx.customerOrder.update({ where: { id: order.id }, data: { subtotalKgs: total, totalKgs: total, discountKgs: 0 } });
  return { quote, application, totalKgs: Number(updated.totalKgs), discountKgs: Number(updated.discountKgs) };
};

const assertAppliedCart = async (tx: LoyaltyTx, id: string, snapshot: SnapshotLine[]) => {
  const rows = await tx.customerOrderLine.findMany({ where: { customerOrderId: id } });
  if (rows.length !== snapshot.length || rows.some((row) => {
    const original = snapshot.find((line) => line.lineId === row.id);
    return !original || original.productId !== row.productId || original.variantKey !== row.variantKey || original.qty !== row.qty || !row.lineTotalKgs.eq(original.appliedLineTotalKgs) || !row.unitPriceKgs.eq(original.appliedUnitPriceKgs);
  })) throw new AppError("loyaltyCartChanged", "CONFLICT", 409);
  const order = await tx.customerOrder.findUniqueOrThrow({ where: { id } });
  const sum = rows.reduce((total, row) => total.plus(row.lineTotalKgs), decimal(0));
  if (!sum.eq(order.totalKgs) || !order.discountKgs.isZero()) throw new AppError("loyaltyCartChanged", "CONFLICT", 409);
};

export const confirmLoyaltyForOrder = async (tx: LoyaltyTx, input: { organizationId: string; customerOrderId: string; paidInFull: boolean; actorId?: string | null; now?: Date }) => {
  await lockLoyaltyOrder(tx, input.customerOrderId);
  const application = await tx.loyaltyOrderApplication.findFirst({ where: { customerOrderId: input.customerOrderId, organizationId: input.organizationId } });
  if (!application || !["APPLIED", "CONFIRMED"].includes(application.status)) return { applied: false, earned: false };
  const snapshot = application.rulesSnapshot as unknown as Snapshot;
  const immutableLines = await snapshotLines(tx, application);
  if (application.status === "APPLIED") {
    if (snapshot.version !== 2) {
      const reduction = decimal(application.memberDiscountKgs).plus(decimal(application.pointsSpent).mul(snapshot.pointValueKgs ?? 1));
      const current = await tx.customerOrder.findUniqueOrThrow({ where: { id: input.customerOrderId } });
      await tx.customerOrder.update({ where: { id: current.id }, data: { discountKgs: Prisma.Decimal.max(0, current.discountKgs.minus(reduction)), subtotalKgs: current.totalKgs } });
    }
    await assertAppliedCart(tx, input.customerOrderId, immutableLines);
    if (application.pointsSpent) {
      const reservation = await tx.loyaltyReservation.findUnique({ where: { eventKey: snapshot.reserveEventKey ?? reserveKey(input.customerOrderId) } });
      if (!reservation) throw new AppError("loyaltyReservationExpired", "CONFLICT", 409);
      await confirmReservation(tx, { reservationId: reservation.id, eventKey: redeemKey(input.customerOrderId), now: input.now });
    }
  }
  if (snapshot.version === 2) await assertAppliedCart(tx, input.customerOrderId, immutableLines);
  let earned = false;
  if (input.paidInFull && application.pointsEarned > 0) {
    await applyEntry(tx, { organizationId: input.organizationId, programId: application.programId, accountId: application.accountId, memberId: application.memberId, type: "EARN", points: application.pointsEarned, eventKey: earnKey(input.customerOrderId), reason: "loyaltyEarn", customerOrderId: input.customerOrderId, actorId: input.actorId, actorType: "SYSTEM" });
    earned = true;
  }
  await tx.loyaltyOrderApplication.update({ where: { id: application.id }, data: { status: "CONFIRMED" } });
  return { applied: true, earned };
};

export const releaseLoyaltyForOrder = async (tx: LoyaltyTx, input: { customerOrderId: string; now?: Date }) => {
  await lockLoyaltyOrder(tx, input.customerOrderId);
  const application = await tx.loyaltyOrderApplication.findUnique({ where: { customerOrderId: input.customerOrderId } });
  if (!application || application.status !== "APPLIED") return;
  const order = await tx.customerOrder.findUniqueOrThrow({ where: { id: input.customerOrderId } });
  if (order.status === "COMPLETED") return;
  const lines = await snapshotLines(tx, application);
  for (const line of lines) {
    const row = await tx.customerOrderLine.findUnique({ where: { id: line.lineId } });
    if (!row) continue;
    const unit = decimal(line.originalUnitPriceKgs);
    await tx.customerOrderLine.update({ where: { id: line.lineId }, data: { unitPriceKgs: unit, lineTotalKgs: row.qty === line.qty ? decimal(line.originalLineTotalKgs) : money(unit.mul(row.qty)) } });
  }
  const totals = await tx.customerOrderLine.aggregate({ where: { customerOrderId: input.customerOrderId }, _sum: { lineTotalKgs: true } });
  const subtotal = totals._sum.lineTotalKgs ?? decimal(0);
  await tx.customerOrder.update({ where: { id: input.customerOrderId }, data: { subtotalKgs: subtotal, totalKgs: subtotal, discountKgs: 0 } });
  await releaseReservationsForOrder(tx, { organizationId: application.organizationId, customerOrderId: input.customerOrderId, now: input.now });
  await tx.loyaltyOrderApplication.update({ where: { id: application.id }, data: { status: "RELEASED" } });
};

/** Reverse cumulative original line allocations, capped by entries actually posted. */
export const reverseLoyaltyForReturn = async (tx: LoyaltyTx, input: { organizationId: string; customerOrderId: string; saleReturnId: string; returnNumber?: string | null }) => {
  await lockLoyaltyOrder(tx, input.customerOrderId);
  const application = await tx.loyaltyOrderApplication.findFirst({ where: { customerOrderId: input.customerOrderId, organizationId: input.organizationId, status: { in: ["CONFIRMED", "APPLIED"] } } });
  if (!application) return { reversedSpend: 0, reversedEarn: 0 };
  const originalOrder = await tx.customerOrder.findUniqueOrThrow({ where: { id: input.customerOrderId }, select: { status: true } });
  if (originalOrder.status !== "COMPLETED") return { reversedSpend: 0, reversedEarn: 0 };
  const lines = await snapshotLines(tx, application);
  const returns = await tx.saleReturnLine.groupBy({ by: ["customerOrderLineId"], where: { saleReturn: { originalSaleId: input.customerOrderId, organizationId: input.organizationId, status: "COMPLETED" } }, _sum: { qty: true } });
  const quantities = new Map(returns.map((row) => [row.customerOrderLineId, row._sum.qty ?? 0]));
  const entries = await tx.loyaltyLedgerEntry.groupBy({ by: ["type"], where: { organizationId: input.organizationId, customerOrderId: input.customerOrderId }, _sum: { points: true } });
  const points = (type: string) => entries.find((row) => row.type === type)?._sum.points ?? 0;
  const allocation = (field: "redeemValueKgs" | "earnWeightKgs") => lines.map(line => ({ weightKgs: String(line[field]), qty: line.qty, returnedQty: quantities.get(line.lineId) ?? 0 }));
  const targetSpend = cumulativeReturnPoints(-points("REDEEM"), allocation("redeemValueKgs"));
  const targetEarn = cumulativeReturnPoints(points("EARN"), allocation("earnWeightKgs"));
  const reversedSpend = Math.max(0, targetSpend - points("REVERSAL_REDEEM"));
  const reversedEarn = Math.max(0, targetEarn + points("REVERSAL_EARN"));
  for (const [type, amount, reason] of [["REVERSAL_REDEEM", reversedSpend, "loyaltyReturnRedeem"], ["REVERSAL_EARN", -reversedEarn, "loyaltyReturnEarn"]] as const) {
    if (amount) await applyEntry(tx, { organizationId: input.organizationId, programId: application.programId, accountId: application.accountId, memberId: application.memberId, type, points: amount, eventKey: `loyalty:${type}:${input.saleReturnId}`, reason, customerOrderId: input.customerOrderId, saleReturnId: input.saleReturnId, allowNegative: true, actorType: "SYSTEM" });
  }
  return { reversedSpend, reversedEarn };
};
