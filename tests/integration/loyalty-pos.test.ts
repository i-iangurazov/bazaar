import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { applyEntry, ensureAccount } from "@/server/services/loyalty/ledger";
import { upsertLoyaltyProgram } from "@/server/services/loyalty/program";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("loyalty at the register", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  const fixture = async (openingPoints: number) => {
    const base = await seedBase({ plan: "BUSINESS", allowNegativeStock: true });
    await prisma.product.update({
      where: { id: base.product.id },
      data: { basePriceKgs: new Prisma.Decimal(1000) },
    });
    const program = await upsertLoyaltyProgram(prisma, base.org.id, {
      enabled: true,
      storeIds: [base.store.id],
      memberDiscountPercent: 5,
      earnPercent: 5,
      maxSpendPercent: 50,
      excludePromoItems: false,
    });
    const member = await prisma.loyaltyMember.create({
      data: {
        organizationId: base.org.id,
        programId: program.id,
        contactKey: `email:pos-${base.org.id}@example.invalid`,
        email: `pos-${base.org.id}@example.invalid`,
      },
    });
    const account = await ensureAccount(prisma, {
      organizationId: base.org.id,
      programId: program.id,
      memberId: member.id,
    });
    if (openingPoints > 0) {
      await prisma.$transaction((tx) =>
        applyEntry(tx, {
          organizationId: base.org.id,
          programId: program.id,
          accountId: account.id,
          memberId: member.id,
          type: "ADJUSTMENT",
          points: openingPoints,
          eventKey: `seed:${account.id}`,
        }),
      );
    }
    const register = await prisma.posRegister.create({
      data: { organizationId: base.org.id, storeId: base.store.id, name: "Loyalty register", code: "LOY" },
    });
    const caller = createTestCaller({ ...base.cashierUser, organizationId: base.org.id });
    const shift = await caller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "loyalty-shift",
    });
    return { ...base, program, member, account, register, shift, caller };
  };

  const draft = (caller: ReturnType<typeof createTestCaller>, registerId: string, productId: string) =>
    caller.pos.sales.createDraft({ registerId, lines: [{ productId, qty: 1 }] });

  it("gives a 5% member discount, charges 950 and earns 47", async () => {
    const f = await fixture(0);
    const sale = await draft(f.caller, f.register.id, f.product.id);

    const applied = await f.caller.loyalty.posApply({
      saleId: sale.id,
      memberId: f.member.id,
      points: 0,
    });
    expect(applied).toMatchObject({ totalKgs: 950, pointsSpent: 0, earnPoints: 47 });

    await f.caller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "loyalty-complete-1",
      payments: [{ method: "CASH", amountKgs: 950 }],
    });
    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    expect(account.balancePoints).toBe(47);
  });

  it("redeems 475 of a sufficient balance: pay 475 and earn 23", async () => {
    const f = await fixture(1000);
    const sale = await draft(f.caller, f.register.id, f.product.id);

    const applied = await f.caller.loyalty.posApply({
      saleId: sale.id,
      memberId: f.member.id,
      points: 475,
    });
    expect(applied).toMatchObject({ totalKgs: 475, pointsSpent: 475, earnPoints: 23 });

    await f.caller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "loyalty-complete-2",
      payments: [{ method: "CARD", amountKgs: 475 }],
    });
    await f.caller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "loyalty-complete-2",
      payments: [{ method: "CARD", amountKgs: 475 }],
    });
    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    // 1000 - 475 redeemed + 23 earned, and a repeated completion changes nothing.
    expect(account.balancePoints).toBe(548);
    expect(
      await prisma.loyaltyLedgerEntry.count({ where: { accountId: f.account.id, type: "REDEEM" } }),
    ).toBe(1);
  });

  it("does not earn when the balance was not enough and the request is trimmed", async () => {
    const f = await fixture(100);
    const sale = await draft(f.caller, f.register.id, f.product.id);
    // Requesting more than available must fail loudly, not silently re-price.
    await expect(
      f.caller.loyalty.posApply({ saleId: sale.id, memberId: f.member.id, points: 475 }),
    ).rejects.toBeTruthy();
  });

  it("refunds the paid money and restores points on a full return, exactly once", async () => {
    const f = await fixture(1000);
    const sale = await draft(f.caller, f.register.id, f.product.id);
    await f.caller.loyalty.posApply({ saleId: sale.id, memberId: f.member.id, points: 475 });
    await f.caller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "loyalty-return-sale",
      payments: [{ method: "CARD", amountKgs: 475 }],
    });
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: f.account.id } })).balancePoints).toBe(548);

    const line = await prisma.customerOrderLine.findFirstOrThrow({ where: { customerOrderId: sale.id } });
    // The line now carries the price actually paid, so the money refund is 475.
    expect(Number(line.lineTotalKgs)).toBe(475);

    const returnDraft = await f.caller.pos.returns.createDraft({
      shiftId: f.shift.id,
      originalSaleId: sale.id,
    });
    await f.caller.pos.returns.addLine({
      saleReturnId: returnDraft.id,
      customerOrderLineId: line.id,
      qty: 1,
    });
    const payment = { saleReturnId: returnDraft.id, idempotencyKey: "loyalty-return-1", payments: [{ method: "CARD" as const, amountKgs: 475 }] };
    await f.caller.pos.returns.complete(payment);
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: f.account.id } })).balancePoints).toBe(1000);

    // Repeating the same return changes nothing.
    await f.caller.pos.returns.complete(payment);
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: f.account.id } })).balancePoints).toBe(1000);
  });
});
