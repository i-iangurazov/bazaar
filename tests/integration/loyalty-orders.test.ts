import { beforeEach, describe, expect, it } from "vitest";
import { CustomerOrderStatus, Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import {
  applyLoyaltyToOrder,
  confirmLoyaltyForOrder,
  quoteLoyaltyForOrder,
  reverseLoyaltyForReturn,
} from "@/server/services/loyalty/apply";
import { applyEntry, ensureAccount } from "@/server/services/loyalty/ledger";
import { upsertLoyaltyProgram } from "@/server/services/loyalty/program";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("loyalty order application", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  const fixture = async (balancePoints = 0) => {
    const base = await seedBase({ plan: "BUSINESS" });
    const program = await upsertLoyaltyProgram(prisma, base.org.id, {
      enabled: true,
      storeIds: [base.store.id],
    });
    const member = await prisma.loyaltyMember.create({
      data: {
        organizationId: base.org.id,
        programId: program.id,
        contactKey: `email:member-${base.org.id}@example.invalid`,
        email: `member-${base.org.id}@example.invalid`,
      },
    });
    const account = await ensureAccount(prisma, {
      organizationId: base.org.id,
      programId: program.id,
      memberId: member.id,
    });
    if (balancePoints > 0) {
      await prisma.$transaction((tx) =>
        applyEntry(tx, {
          organizationId: base.org.id,
          programId: program.id,
          accountId: account.id,
          memberId: member.id,
          type: "EARN",
          points: balancePoints,
          eventKey: `seed:${account.id}`,
        }),
      );
    }
    const order = (totalKgs: number, number: string) =>
      prisma.customerOrder.create({
        data: {
          organizationId: base.org.id,
          storeId: base.store.id,
          number,
          status: CustomerOrderStatus.DRAFT,
          isPosSale: true,
          subtotalKgs: new Prisma.Decimal(totalKgs),
          totalKgs: new Prisma.Decimal(totalKgs),
          lines: {
            create: {
              productId: base.product.id,
              qty: 1,
              unitPriceKgs: new Prisma.Decimal(totalKgs),
              baseUnitPriceKgs: new Prisma.Decimal(totalKgs),
              lineTotalKgs: new Prisma.Decimal(totalKgs),
            },
          },
        },
      });
    return { ...base, program, member, account, order };
  };

  it("reproduces the 1000 KGS example end to end", async () => {
    const f = await fixture(500);
    const order = await f.order(1000, "L-1");
    const quote = await prisma.$transaction((tx) =>
      quoteLoyaltyForOrder(tx, {
        organizationId: f.org.id,
        storeId: f.store.id,
        customerOrderId: order.id,
        memberId: f.member.id,
        requestedPoints: 475,
      }),
    );
    expect(quote.memberDiscountKgs).toBe(50);
    expect(quote.eligibleKgs).toBe(950);
    expect(quote.maxRedeemPoints).toBe(475);
    expect(quote.payableKgs).toBe(475);
    expect(quote.earnPoints).toBe(23);

    const applied = await prisma.$transaction((tx) =>
      applyLoyaltyToOrder(tx, {
        organizationId: f.org.id,
        storeId: f.store.id,
        customerOrderId: order.id,
        memberId: f.member.id,
        requestedPoints: 475,
      }),
    );
    expect(applied.totalKgs).toBe(475);
    expect(applied.discountKgs).toBe(0);
    expect(Number((await prisma.customerOrder.findUniqueOrThrow({where:{id:order.id}})).subtotalKgs)).toBe(475);

    const confirmed = await prisma.$transaction((tx) =>
      confirmLoyaltyForOrder(tx, { organizationId: f.org.id, customerOrderId: order.id, paidInFull: true }),
    );
    expect(confirmed).toMatchObject({ applied: true, earned: true });
    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    expect(account.balancePoints).toBe(500 - 475 + 23);
  });

  it("does not let two parallel orders reserve the same points", async () => {
    const f = await fixture(500);
    const a = await f.order(1000, "L-A");
    const b = await f.order(1000, "L-B");
    const reserve = (customerOrderId: string) =>
      prisma.$transaction((tx) =>
        applyLoyaltyToOrder(tx, {
          organizationId: f.org.id,
          storeId: f.store.id,
          customerOrderId,
          memberId: f.member.id,
          requestedPoints: 400,
        }),
      );
    const results = await Promise.allSettled([reserve(a.id), reserve(b.id)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    // The losing order kept its original price.
    const losing = results[0].status === "rejected" ? a : b;
    expect(
      Number((await prisma.customerOrder.findUniqueOrThrow({ where: { id: losing.id } })).totalKgs),
    ).toBe(1000);
  });

  it("confirms a reservation once, even when called twice", async () => {
    const f = await fixture(500);
    const order = await f.order(1000, "L-2");
    await prisma.$transaction((tx) =>
      applyLoyaltyToOrder(tx, {
        organizationId: f.org.id,
        storeId: f.store.id,
        customerOrderId: order.id,
        memberId: f.member.id,
        requestedPoints: 475,
      }),
    );
    await prisma.$transaction((tx) =>
      confirmLoyaltyForOrder(tx, { organizationId: f.org.id, customerOrderId: order.id, paidInFull: true }),
    );
    await prisma.$transaction((tx) =>
      confirmLoyaltyForOrder(tx, { organizationId: f.org.id, customerOrderId: order.id, paidInFull: true }),
    );
    expect(await prisma.loyaltyLedgerEntry.count({ where: { customerOrderId: order.id, type: "REDEEM" } })).toBe(1);
    expect(await prisma.loyaltyLedgerEntry.count({ where: { customerOrderId: order.id, type: "EARN" } })).toBe(1);
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: f.account.id } })).balancePoints).toBe(48);
  });

  it("refuses a late confirmation after the reservation expired", async () => {
    const f = await fixture(500);
    const order = await f.order(1000, "L-3");
    await prisma.$transaction((tx) =>
      applyLoyaltyToOrder(tx, {
        organizationId: f.org.id,
        storeId: f.store.id,
        customerOrderId: order.id,
        memberId: f.member.id,
        requestedPoints: 475,
      }),
    );
    await prisma.loyaltyReservation.updateMany({
      where: { customerOrderId: order.id, status: "ACTIVE" },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await expect(
      prisma.$transaction((tx) =>
        confirmLoyaltyForOrder(tx, { organizationId: f.org.id, customerOrderId: order.id, paidInFull: true }),
      ),
    ).rejects.toMatchObject({ message: "loyaltyReservationExpired" });
    // The balance was never reduced.
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: f.account.id } })).balancePoints).toBe(500);
  });

  it("reverses spend and earnings proportionally and exactly on full return", async () => {
    const f = await fixture(500);
    const order = await f.order(1000, "L-4");
    await prisma.customerOrderLine.updateMany({ where: { customerOrderId: order.id }, data: { qty: 4, unitPriceKgs: 250, baseUnitPriceKgs: 250 } });
    await prisma.$transaction((tx) =>
      applyLoyaltyToOrder(tx, {
        organizationId: f.org.id,
        storeId: f.store.id,
        customerOrderId: order.id,
        memberId: f.member.id,
        requestedPoints: 475,
      }),
    );
    await prisma.$transaction((tx) =>
      confirmLoyaltyForOrder(tx, { organizationId: f.org.id, customerOrderId: order.id, paidInFull: true }),
    );
    await prisma.customerOrder.update({ where: { id: order.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    const line = await prisma.customerOrderLine.findFirstOrThrow({ where: { customerOrderId: order.id } });
    const register = await prisma.posRegister.create({
      data: { organizationId: f.org.id, storeId: f.store.id, name: "R", code: "R" },
    });
    const shift = await prisma.registerShift.create({
      data: { organizationId: f.org.id, storeId: f.store.id, registerId: register.id, openedById: f.adminUser.id },
    });
    const makeReturn = async (number: string, amountKgs: number, qty: number) => {
      const saleReturn = await prisma.saleReturn.create({
        data: {
          organizationId: f.org.id,
          storeId: f.store.id,
          registerId: register.id,
          shiftId: shift.id,
          originalSaleId: order.id,
          number,
          status: "COMPLETED",
          completedAt: new Date(),
          createdById: f.adminUser.id,
          completedById: f.adminUser.id,
          subtotalKgs: new Prisma.Decimal(amountKgs),
          totalKgs: new Prisma.Decimal(amountKgs),
          lines: {
            create: {
              customerOrderLineId: line.id,
              productId: f.product.id,
              qty,
              unitPriceKgs: new Prisma.Decimal(118.75),
              lineTotalKgs: new Prisma.Decimal(amountKgs),
            },
          },
        },
      });
      return saleReturn;
    };

    const first = await makeReturn("RET-1", 118.75, 1);
    const firstReversal = await prisma.$transaction((tx) =>
      reverseLoyaltyForReturn(tx, {
        organizationId: f.org.id,
        customerOrderId: order.id,
        saleReturnId: first.id,
      }),
    );
    expect(firstReversal.reversedSpend).toBeGreaterThan(0);
    expect(firstReversal.reversedSpend).toBeLessThan(475);

    // A second, larger partial return completes the coverage; successive returns
    // must not reverse more than the original amounts.
    const second = await makeReturn("RET-2", 356.25, 3);
    const full = await prisma.$transaction((tx) =>
      reverseLoyaltyForReturn(tx, {
        organizationId: f.org.id,
        customerOrderId: order.id,
        saleReturnId: second.id,
      }),
    );
    expect(firstReversal.reversedSpend + full.reversedSpend).toBe(475);
    expect(firstReversal.reversedEarn + full.reversedEarn).toBe(23);
    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    expect(account.balancePoints).toBe(500);
  });
});
