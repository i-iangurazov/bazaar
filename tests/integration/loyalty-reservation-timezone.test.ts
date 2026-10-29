import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import {
  applyEntry,
  availablePoints,
  confirmReservation,
  ensureAccount,
  reservePoints,
} from "@/server/services/loyalty/ledger";
import { upsertLoyaltyProgram } from "@/server/services/loyalty/program";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("loyalty reservation UTC storage contract", () => {
  beforeEach(resetDatabase);

  it.each(["UTC", "Asia/Bishkek", "Asia/Shanghai"])(
    "keeps availability, expiry and release timestamps correct in a %s session",
    async (timeZone) => {
      const f = await seedBase({ plan: "BUSINESS" });
      const program = await upsertLoyaltyProgram(prisma, f.org.id, {
        enabled: true,
        storeIds: [f.store.id],
      });
      const member = await prisma.loyaltyMember.create({
        data: {
          organizationId: f.org.id,
          programId: program.id,
          contactKey: `timezone:${timeZone}`,
        },
      });
      const account = await ensureAccount(prisma, {
        organizationId: f.org.id,
        programId: program.id,
        memberId: member.id,
      });
      const now = new Date("2026-10-26T23:50:00.123Z");
      const expiredAt = new Date("2026-10-27T00:20:00.123Z");
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('TimeZone', ${timeZone}, true)`;
        await applyEntry(tx, {
          organizationId: f.org.id,
          programId: program.id,
          accountId: account.id,
          memberId: member.id,
          type: "ADJUSTMENT",
          points: 500,
          eventKey: "timezone-opening-balance",
        });
        const reservation = await reservePoints(tx, {
          organizationId: f.org.id,
          programId: program.id,
          accountId: account.id,
          memberId: member.id,
          points: 350,
          ttlMinutes: 30,
          eventKey: "timezone-first-reservation",
          now,
        });
        expect(reservation?.expiresAt.toISOString()).toBe(expiredAt.toISOString());
        expect(await availablePoints(tx, account.id, now)).toBe(150);
        expect(await availablePoints(tx, account.id, new Date(expiredAt.getTime() - 1))).toBe(150);
        expect(await availablePoints(tx, account.id, expiredAt)).toBe(500);
        // Availability reads must not expire or release records themselves.
        expect(
          await tx.loyaltyReservation.findUniqueOrThrow({ where: { id: reservation!.id } }),
        ).toMatchObject({ status: "ACTIVE", releasedAt: null });
        await reservePoints(tx, {
          organizationId: f.org.id,
          programId: program.id,
          accountId: account.id,
          memberId: member.id,
          points: 100,
          ttlMinutes: 30,
          eventKey: "timezone-next-reservation",
          now: expiredAt,
        });
        const expired = await tx.loyaltyReservation.findUniqueOrThrow({
          where: { id: reservation!.id },
        });
        expect(expired.status).toBe("EXPIRED");
        expect(expired.releasedAt?.toISOString()).toBe(expiredAt.toISOString());
        expect(await availablePoints(tx, account.id, expiredAt)).toBe(400);
        expect(
          await tx.loyaltyAccount.findUniqueOrThrow({ where: { id: account.id } }),
        ).toMatchObject({ balancePoints: 500, reservedPoints: 100 });
        await expect(
          confirmReservation(tx, {
            reservationId: reservation!.id,
            eventKey: "timezone-late-confirmation",
            now: expiredAt,
          }),
        ).rejects.toMatchObject({ message: "loyaltyReservationExpired" });
        expect(await tx.loyaltyLedgerEntry.count({ where: { accountId: account.id } })).toBe(1);
      });
    },
  );
});
