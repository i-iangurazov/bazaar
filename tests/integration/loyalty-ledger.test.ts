import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import {
  applyEntry,
  availablePoints,
  ensureAccount,
  expireReservations,
  reservePoints,
  confirmReservation,
} from "@/server/services/loyalty/ledger";
import {
  assertLoyaltyEnabled,
  getLoyaltyProgram,
  upsertLoyaltyProgram,
} from "@/server/services/loyalty/program";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("loyalty ledger", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  const fixture = async () => {
    const base = await seedBase({ plan: "BUSINESS" });
    const program = await upsertLoyaltyProgram(prisma, base.org.id, { enabled: true });
    const member = await prisma.loyaltyMember.create({
      data: {
        organizationId: base.org.id,
        programId: program.id,
        contactKey: "phone:996700000001",
        phoneNormalized: "996700000001",
        displayName: "Loyalty QA",
      },
    });
    const account = await ensureAccount(prisma, {
      organizationId: base.org.id,
      programId: program.id,
      memberId: member.id,
    });
    return { ...base, program, member, account };
  };

  it("is disabled by default until an owner enables it", async () => {
    const { org } = await seedBase({ plan: "BUSINESS" });
    expect(await getLoyaltyProgram(prisma, org.id)).toBeNull();
    await expect(assertLoyaltyEnabled(prisma, org.id)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const program = await upsertLoyaltyProgram(prisma, org.id, {});
    expect(program.enabled).toBe(false);
    await expect(assertLoyaltyEnabled(prisma, org.id)).rejects.toMatchObject({ code: "FORBIDDEN" });

    await upsertLoyaltyProgram(prisma, org.id, { enabled: true });
    await expect(assertLoyaltyEnabled(prisma, org.id)).resolves.toBeTruthy();
  });

  it("applies an earning once and replays the same event without moving the balance", async () => {
    const { program } = await fixture();
    const member = await prisma.loyaltyMember.findFirstOrThrow({ where: { programId: program.id } });
    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { memberId: member.id } });

    const first = await prisma.$transaction((tx) =>
      applyEntry(tx, {
        organizationId: program.organizationId,
        programId: program.id,
        accountId: account.id,
        memberId: member.id,
        type: "EARN",
        points: 100,
        eventKey: "earn:order-1",
      }),
    );
    const replay = await prisma.$transaction((tx) =>
      applyEntry(tx, {
        organizationId: program.organizationId,
        programId: program.id,
        accountId: account.id,
        memberId: member.id,
        type: "EARN",
        points: 100,
        eventKey: "earn:order-1",
      }),
    );
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: account.id } })).toMatchObject({
      balancePoints: 100,
    });
    expect(await prisma.loyaltyLedgerEntry.count({ where: { accountId: account.id } })).toBe(1);
  });

  it("prevents two parallel redemptions from spending the same points", async () => {
    const { program } = await fixture();
    const member = await prisma.loyaltyMember.findFirstOrThrow({ where: { programId: program.id } });
    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { memberId: member.id } });
    await prisma.$transaction((tx) =>
      applyEntry(tx, {
        organizationId: program.organizationId,
        programId: program.id,
        accountId: account.id,
        memberId: member.id,
        type: "EARN",
        points: 100,
        eventKey: "earn:seed",
      }),
    );

    const redeem = (eventKey: string) =>
      prisma.$transaction((tx) =>
        applyEntry(tx, {
          organizationId: program.organizationId,
          programId: program.id,
          accountId: account.id,
          memberId: member.id,
          type: "REDEEM",
          points: -60,
          eventKey,
        }),
      );
    const results = await Promise.allSettled([redeem("redeem:a"), redeem("redeem:b")]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect(await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: account.id } })).toMatchObject({
      balancePoints: 40,
    });
  });

  it("keeps expired reservations out of the available balance", async () => {
    const { program } = await fixture();
    const member = await prisma.loyaltyMember.findFirstOrThrow({ where: { programId: program.id } });
    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { memberId: member.id } });
    await prisma.$transaction((tx) =>
      applyEntry(tx, {
        organizationId: program.organizationId,
        programId: program.id,
        accountId: account.id,
        memberId: member.id,
        type: "EARN",
        points: 100,
        eventKey: "earn:seed",
      }),
    );

    const past = new Date(Date.now() - 60_000);
    await prisma.$transaction((tx) =>
      reservePoints(tx, {
        organizationId: program.organizationId,
        programId: program.id,
        accountId: account.id,
        memberId: member.id,
        points: 80,
        ttlMinutes: 30,
        eventKey: "reserve:live",
        now: new Date(),
      }),
    );
    await expect(
      prisma.$transaction((tx) => availablePoints(tx, account.id)),
    ).resolves.toBe(20);

    // An already expired reservation never reduces availability, even before cleanup.
    const expired = await prisma.loyaltyReservation.create({
      data: {
        organizationId: program.organizationId,
        programId: program.id,
        accountId: account.id,
        memberId: member.id,
        points: 80,
        status: "ACTIVE",
        eventKey: "reserve:expired",
        expiresAt: past,
      },
    });
    expect(expired.expiresAt.getTime()).toBeLessThan(Date.now());
    await expect(
      prisma.$transaction((tx) => availablePoints(tx, account.id)),
    ).resolves.toBe(20); // only the live reservation counts
    expect((await prisma.$transaction((tx) => expireReservations(tx))).count).toBe(1);
  });

  it("converts a live reservation into exactly one redemption", async () => {
    const { program } = await fixture();
    const member = await prisma.loyaltyMember.findFirstOrThrow({ where: { programId: program.id } });
    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { memberId: member.id } });
    await prisma.$transaction((tx) =>
      applyEntry(tx, {
        organizationId: program.organizationId,
        programId: program.id,
        accountId: account.id,
        memberId: member.id,
        type: "EARN",
        points: 500,
        eventKey: "earn:seed",
      }),
    );
    const reservation = await prisma.$transaction((tx) =>
      reservePoints(tx, {
        organizationId: program.organizationId,
        programId: program.id,
        accountId: account.id,
        memberId: member.id,
        points: 475,
        ttlMinutes: 30,
        eventKey: "reserve:order-1",
      }),
    );
    expect(reservation).not.toBeNull();
    await prisma.$transaction((tx) =>
      confirmReservation(tx, { reservationId: reservation!.id, eventKey: "redeem:order-1" }),
    );
    await prisma.$transaction((tx) =>
      confirmReservation(tx, { reservationId: reservation!.id, eventKey: "redeem:order-1" }),
    );
    expect(await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: account.id } })).toMatchObject({
      balancePoints: 25,
    });
    expect(
      await prisma.loyaltyLedgerEntry.count({ where: { accountId: account.id, type: "REDEEM" } }),
    ).toBe(1);
  });
});
