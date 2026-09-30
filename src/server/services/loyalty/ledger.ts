import type { Prisma } from "@prisma/client";

import { AppError } from "@/server/services/errors";

export type LoyaltyLedgerTypeName =
  | "EARN"
  | "REDEEM"
  | "REVERSAL_REDEEM"
  | "REVERSAL_EARN"
  | "ADJUSTMENT";

/** The ledger and the cached balance must always change in the same transaction. */
export type LoyaltyTx = Prisma.TransactionClient;

export const ensureAccount = async (
  tx: LoyaltyTx,
  input: { organizationId: string; programId: string; memberId: string },
) =>
  tx.loyaltyAccount.upsert({
    where: { memberId: input.memberId },
    create: {
      organizationId: input.organizationId,
      programId: input.programId,
      memberId: input.memberId,
    },
    update: {},
  });

/**
 * Expired reservations stop counting immediately: they are swept (and the counter
 * released) before any availability read or reservation.
 */
const sweepExpired = async (tx: LoyaltyTx, accountId: string, now: Date) => {
  const expired = await tx.loyaltyReservation.findMany({
    where: { accountId, status: "ACTIVE", expiresAt: { lte: now } },
    select: { id: true, points: true },
  });
  if (!expired.length) return;
  const releasedPoints = expired.reduce((sum, row) => sum + row.points, 0);
  await tx.loyaltyReservation.updateMany({
    where: { id: { in: expired.map((row) => row.id) }, status: "ACTIVE" },
    data: { status: "EXPIRED" },
  });
  await tx.loyaltyAccount.updateMany({
    where: { id: accountId, reservedPoints: { gte: releasedPoints } },
    data: { reservedPoints: { decrement: releasedPoints } },
  });
};

export const activeReservedPoints = async (tx: LoyaltyTx, accountId: string) => {
  const account = await tx.loyaltyAccount.findUnique({
    where: { id: accountId },
    select: { reservedPoints: true },
  });
  return account?.reservedPoints ?? 0;
};

/** Available = balance minus live reservations, never below zero. */
export const availablePoints = async (tx: LoyaltyTx, accountId: string, now = new Date()) => {
  await sweepExpired(tx, accountId, now);
  const account = await tx.loyaltyAccount.findUnique({
    where: { id: accountId },
    select: { balancePoints: true, reservedPoints: true },
  });
  if (!account) return 0;
  return Math.max(0, account.balancePoints - account.reservedPoints);
};

/**
 * Append one journal entry and move the cached balance atomically. `eventKey` makes
 * the write idempotent: a replay returns the original entry and never moves the
 * balance twice. Must be called inside a transaction so a unique-key conflict rolls
 * the balance change back.
 */
export const applyEntry = async (
  tx: LoyaltyTx,
  input: {
    organizationId: string;
    programId: string;
    accountId: string;
    memberId: string;
    type: LoyaltyLedgerTypeName;
    /** Signed: positive earns, negative spends/reversals. */
    points: number;
    eventKey: string;
    reason?: string | null;
    customerOrderId?: string | null;
    saleReturnId?: string | null;
    actorId?: string | null;
    actorType?: string | null;
    note?: string | null;
    /** Reversals may legitimately push the accounting balance negative. */
    allowNegative?: boolean;
  },
) => {
  const existing = await tx.loyaltyLedgerEntry.findUnique({ where: { eventKey: input.eventKey } });
  if (existing) return { entry: existing, replayed: true };

  let balanceAfter: number;
  if (input.points >= 0) {
    const updated = await tx.loyaltyAccount.update({
      where: { id: input.accountId },
      data: { balancePoints: { increment: input.points } },
      select: { balancePoints: true },
    });
    balanceAfter = updated.balancePoints;
  } else if (input.allowNegative) {
    const updated = await tx.loyaltyAccount.update({
      where: { id: input.accountId },
      data: { balancePoints: { decrement: -input.points } },
      select: { balancePoints: true },
    });
    balanceAfter = updated.balancePoints;
  } else {
    const needed = -input.points;
    const updated = await tx.loyaltyAccount.updateMany({
      where: { id: input.accountId, balancePoints: { gte: needed } },
      data: { balancePoints: { decrement: needed } },
    });
    if (updated.count === 0) throw new AppError("loyaltyInsufficientPoints", "CONFLICT", 409);
    const row = await tx.loyaltyAccount.findUniqueOrThrow({
      where: { id: input.accountId },
      select: { balancePoints: true },
    });
    balanceAfter = row.balancePoints;
  }

  const entry = await tx.loyaltyLedgerEntry.create({
    data: {
      organizationId: input.organizationId,
      programId: input.programId,
      accountId: input.accountId,
      memberId: input.memberId,
      type: input.type,
      points: input.points,
      balanceAfter,
      reason: input.reason ?? null,
      customerOrderId: input.customerOrderId ?? null,
      saleReturnId: input.saleReturnId ?? null,
      actorId: input.actorId ?? null,
      actorType: input.actorType ?? null,
      eventKey: input.eventKey,
      note: input.note ?? null,
    },
  });
  return { entry, replayed: false };
};

/** Reserves points for an unfinished checkout without touching the balance. */
export const reservePoints = async (
  tx: LoyaltyTx,
  input: {
    organizationId: string;
    programId: string;
    accountId: string;
    memberId: string;
    customerOrderId?: string | null;
    points: number;
    ttlMinutes: number;
    eventKey: string;
    now?: Date;
  },
) => {
  if (input.points <= 0) return null;
  const existing = await tx.loyaltyReservation.findUnique({ where: { eventKey: input.eventKey } });
  if (existing) return existing;
  const now = input.now ?? new Date();
  await sweepExpired(tx, input.accountId, now);
  // Atomic conditional guard: two parallel checkouts cannot reserve the same points,
  // regardless of transaction isolation.
  const claimed = await tx.$executeRaw`
    UPDATE "LoyaltyAccount"
    SET "reservedPoints" = "reservedPoints" + ${input.points}
    WHERE "id" = ${input.accountId}
      AND "balancePoints" - "reservedPoints" >= ${input.points}
  `;
  if (claimed === 0) throw new AppError("loyaltyInsufficientPoints", "CONFLICT", 409);
  return tx.loyaltyReservation.create({
    data: {
      organizationId: input.organizationId,
      programId: input.programId,
      accountId: input.accountId,
      memberId: input.memberId,
      customerOrderId: input.customerOrderId ?? null,
      points: input.points,
      status: "ACTIVE",
      eventKey: input.eventKey,
      expiresAt: new Date(now.getTime() + input.ttlMinutes * 60_000),
    },
  });
};

/** Converts a live reservation into exactly one REDEEM entry. */
export const confirmReservation = async (
  tx: LoyaltyTx,
  input: { reservationId: string; eventKey: string; reason?: string | null; now?: Date },
) => {
  const now = input.now ?? new Date();
  // Claim the reservation under a row lock so a duplicate confirmation cannot
  // convert it twice.
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "LoyaltyReservation" WHERE id = ${input.reservationId} FOR UPDATE
  `;
  if (locked.length === 0) throw new AppError("loyaltyReservationExpired", "CONFLICT", 409);
  const reservation = await tx.loyaltyReservation.findUniqueOrThrow({
    where: { id: input.reservationId },
  });
  if (reservation.status === "CONFIRMED") return { replayed: true as const };
  if (reservation.status !== "ACTIVE" || reservation.expiresAt <= now) {
    // Late confirmation after expiry: re-check, never silently re-spend.
    throw new AppError("loyaltyReservationExpired", "CONFLICT", 409);
  }
  await tx.loyaltyReservation.update({
    where: { id: reservation.id },
    data: { status: "CONFIRMED", confirmedAt: now },
  });
  await tx.loyaltyAccount.updateMany({
    where: { id: reservation.accountId, reservedPoints: { gte: reservation.points } },
    data: { reservedPoints: { decrement: reservation.points } },
  });
  await applyEntry(tx, {
    organizationId: reservation.organizationId,
    programId: reservation.programId,
    accountId: reservation.accountId,
    memberId: reservation.memberId,
    type: "REDEEM",
    points: -reservation.points,
    eventKey: input.eventKey,
    reason: input.reason ?? "loyaltyRedeem",
    customerOrderId: reservation.customerOrderId,
  });
  return { replayed: false as const };
};

export const releaseReservation = async (
  tx: LoyaltyTx,
  input: { reservationId: string; reason?: string | null; now?: Date },
) => {
  const now = input.now ?? new Date();
  const reservation = await tx.loyaltyReservation.findUnique({ where: { id: input.reservationId } });
  if (!reservation || reservation.status !== "ACTIVE") return { released: false };
  await tx.loyaltyReservation.update({
    where: { id: reservation.id },
    data: { status: "RELEASED", releasedAt: now },
  });
  await tx.loyaltyAccount.updateMany({
    where: { id: reservation.accountId, reservedPoints: { gte: reservation.points } },
    data: { reservedPoints: { decrement: reservation.points } },
  });
  return { released: true };
};

export const releaseReservationsForOrder = async (
  tx: LoyaltyTx,
  input: { organizationId: string; customerOrderId: string; now?: Date },
) => {
  const now = input.now ?? new Date();
  const rows = await tx.loyaltyReservation.findMany({
    where: {
      organizationId: input.organizationId,
      customerOrderId: input.customerOrderId,
      status: "ACTIVE",
    },
    select: { id: true, accountId: true, points: true },
  });
  if (!rows.length) return 0;
  const result = await tx.loyaltyReservation.updateMany({
    where: { id: { in: rows.map((row) => row.id) }, status: "ACTIVE" },
    data: { status: "RELEASED", releasedAt: now },
  });
  for (const row of rows) {
    await tx.loyaltyAccount.updateMany({
      where: { id: row.accountId, reservedPoints: { gte: row.points } },
      data: { reservedPoints: { decrement: row.points } },
    });
  }
  return result.count;
};

export const expireReservations = async (tx: LoyaltyTx, now = new Date()) => {
  const expired = await tx.loyaltyReservation.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: now } },
    select: { id: true, accountId: true, points: true },
  });
  if (!expired.length) return { count: 0 };
  const result = await tx.loyaltyReservation.updateMany({
    where: { id: { in: expired.map((row) => row.id) }, status: "ACTIVE" },
    data: { status: "EXPIRED" },
  });
  for (const row of expired) {
    await tx.loyaltyAccount.updateMany({
      where: { id: row.accountId, reservedPoints: { gte: row.points } },
      data: { reservedPoints: { decrement: row.points } },
    });
  }
  return { count: result.count };
};
