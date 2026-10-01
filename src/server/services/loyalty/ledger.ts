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

/** Lock accounts before reservations everywhere to serialize balance transitions. */
export const lockLoyaltyAccount = async (tx: LoyaltyTx, accountId: string) => {
  await tx.$queryRaw`SELECT id FROM "LoyaltyAccount" WHERE id = ${accountId} FOR UPDATE`;
};

const sweepExpired = async (tx: LoyaltyTx, accountId: string, now: Date) => {
  await lockLoyaltyAccount(tx, accountId);
  const changed = await tx.$queryRaw<Array<{ points: number }>>`
    UPDATE "LoyaltyReservation" SET status = 'EXPIRED', "releasedAt" = ${now}
    WHERE "accountId" = ${accountId} AND status = 'ACTIVE' AND "expiresAt" <= ${now}
    RETURNING points
  `;
  const released = changed.reduce((sum, row) => sum + row.points, 0);
  if (released) await tx.loyaltyAccount.update({
    where: { id: accountId }, data: { reservedPoints: { decrement: released } },
  });
};

export const activeReservedPoints = async (tx: LoyaltyTx, accountId: string) => {
  const result = await tx.loyaltyReservation.aggregate({
    where: { accountId, status: "ACTIVE", expiresAt: { gt: new Date() } },
    _sum: { points: true },
  });
  return result._sum.points ?? 0;
};

/** Reads never mutate reservations, including public card requests outside a transaction. */
export const availablePoints = async (tx: LoyaltyTx, accountId: string, now = new Date()) => {
  const [row] = await tx.$queryRaw<Array<{ available: number }>>`
    SELECT GREATEST(0, a."balancePoints" - COALESCE((
      SELECT SUM(r.points) FROM "LoyaltyReservation" r
      WHERE r."accountId" = a.id AND r.status = 'ACTIVE' AND r."expiresAt" > ${now}
    ), 0))::int AS available FROM "LoyaltyAccount" a WHERE a.id = ${accountId}
  `;
  return row?.available ?? 0;
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
  await lockLoyaltyAccount(tx, input.accountId);
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
    const reserved = await activeReservedPoints(tx, input.accountId);
    const updated = await tx.loyaltyAccount.updateMany({
      where: { id: input.accountId, balancePoints: { gte: needed + reserved } },
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
  await lockLoyaltyAccount(tx, input.accountId);
  const existing = await tx.loyaltyReservation.findUnique({ where: { eventKey: input.eventKey } });
  if (existing) {
    if (existing.accountId !== input.accountId || existing.points !== input.points || existing.status !== "ACTIVE")
      throw new AppError("loyaltyReservationExpired", "CONFLICT", 409);
    return existing;
  }
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
  const identity = await tx.loyaltyReservation.findUnique({ where: { id: input.reservationId } });
  if (!identity) throw new AppError("loyaltyReservationExpired", "CONFLICT", 409);
  await lockLoyaltyAccount(tx, identity.accountId);
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
  const identity = await tx.loyaltyReservation.findUnique({ where: { id: input.reservationId } });
  if (!identity) return { released: false };
  await lockLoyaltyAccount(tx, identity.accountId);
  const changed = await tx.loyaltyReservation.updateMany({
    where: { id: input.reservationId, status: "ACTIVE" },
    data: { status: "RELEASED", releasedAt: now },
  });
  if (!changed.count) return { released: false };
  await tx.loyaltyAccount.update({
    where: { id: identity.accountId },
    data: { reservedPoints: { decrement: identity.points } },
  });
  return { released: true };
};

export const releaseReservationsForOrder = async (
  tx: LoyaltyTx,
  input: { organizationId: string; customerOrderId: string; now?: Date },
) => {
  const rows = await tx.loyaltyReservation.findMany({
    where: { organizationId: input.organizationId, customerOrderId: input.customerOrderId, status: "ACTIVE" },
    select: { id: true }, orderBy: [{ accountId: "asc" }, { id: "asc" }],
  });
  let count = 0;
  for (const row of rows) {
    if ((await releaseReservation(tx, { reservationId: row.id, now: input.now })).released) count++;
  }
  return count;
};

export const expireReservations = async (tx: LoyaltyTx, now = new Date()) => {
  const accounts = await tx.loyaltyReservation.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: now } },
    select: { accountId: true }, distinct: ["accountId"], orderBy: { accountId: "asc" },
  });
  let count = 0;
  for (const { accountId } of accounts) {
    await lockLoyaltyAccount(tx, accountId);
    count += await tx.loyaltyReservation.count({ where: { accountId, status: "ACTIVE", expiresAt: { lte: now } } });
    await sweepExpired(tx, accountId, now);
  }
  return { count };
};
