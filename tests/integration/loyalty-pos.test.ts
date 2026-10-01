import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { applyEntry, ensureAccount } from "@/server/services/loyalty/ledger";
import { requestJoinOtp, verifyJoinOtp } from "@/server/services/loyalty/memberAuth";
import { approveLoyaltyConsent } from "@/server/services/loyalty/consent";
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

  const consentFor = async (f: Awaited<ReturnType<typeof fixture>>, saleId: string, points: number) => {
    const link = await prisma.loyaltyProgramStore.findFirstOrThrow({ where: { programId: f.program.id } });
    const otp = await requestJoinOtp({ programStoreId: link.id, email: f.member.email! });
    const session = await verifyJoinOtp({ programStoreId: link.id, email: f.member.email!, code: otp.code! });
    const request = await f.caller.loyalty.posRequestConsent({ saleId, memberId: f.member.id, points });
    expect(await approveLoyaltyConsent(session.token, request.id)).toBe(true);
    return request.id;
  };

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
      consentId: await consentFor(f, sale.id, 475),
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
    await f.caller.loyalty.posApply({ saleId: sale.id, memberId: f.member.id, points: 475, consentId: await consentFor(f, sale.id, 475) });
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

  it("restores the cart and frees the reservation when the bonus is removed", async () => {
    const f = await fixture(1000);
    const sale = await draft(f.caller, f.register.id, f.product.id);
    await f.caller.loyalty.posApply({ saleId: sale.id, memberId: f.member.id, points: 475, consentId: await consentFor(f, sale.id, 475) });
    expect(await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: f.account.id } })).toMatchObject({
      balancePoints: 1000,
      reservedPoints: 475,
    });

    await f.caller.loyalty.posRelease({ saleId: sale.id });
    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    expect(account).toMatchObject({ balancePoints: 1000, reservedPoints: 0 });
    const line = await prisma.customerOrderLine.findFirstOrThrow({ where: { customerOrderId: sale.id } });
    expect(Number(line.lineTotalKgs)).toBe(1000);
    expect(Number((await prisma.customerOrder.findUniqueOrThrow({ where: { id: sale.id } })).totalKgs)).toBe(1000);
  });

  it("releases the bonus and charges the restored price after an explicit cart edit", async () => {
    const f = await fixture(1000);
    const sale = await draft(f.caller, f.register.id, f.product.id);
    const line = await prisma.customerOrderLine.findFirstOrThrow({ where: { customerOrderId: sale.id } });
    await f.caller.loyalty.posApply({ saleId: sale.id, memberId: f.member.id, points: 475, consentId: await consentFor(f, sale.id, 475) });
    // Add a second unit after the bonus was priced.
    await f.caller.pos.sales.updateLine({ lineId: line.id, qty: 2 });
    const currentTotal = Number(
      (await prisma.customerOrder.findUniqueOrThrow({ where: { id: sale.id } })).totalKgs,
    );
    expect(currentTotal).toBe(2000);
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: f.account.id } })).reservedPoints).toBe(0);
    await f.caller.pos.sales.complete({ saleId: sale.id, idempotencyKey: "loyalty-stale-cart", payments: [{ method: "CASH", amountKgs: currentTotal }] });
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: f.account.id } })).balancePoints).toBe(1000);
    expect(await prisma.loyaltyLedgerEntry.count({ where: { customerOrderId: sale.id } })).toBe(0);
  });

  it("rejects spending without shopper approval and refuses a tampered snapshot", async () => {
    const f = await fixture(1000);
    const sale = await draft(f.caller, f.register.id, f.product.id);
    await expect(f.caller.loyalty.posApply({ saleId: sale.id, memberId: f.member.id, points: 475 })).rejects.toMatchObject({ message: "loyaltyConsentRequired" });
    await f.caller.loyalty.posApply({ saleId: sale.id, memberId: f.member.id, points: 475, consentId: await consentFor(f, sale.id, 475) });
    await prisma.customerOrderLine.updateMany({ where: { customerOrderId: sale.id }, data: { qty: 2 } });
    await expect(f.caller.pos.sales.complete({ saleId: sale.id, idempotencyKey: "tampered-cart", payments: [{ method: "CASH", amountKgs: 475 }] })).rejects.toMatchObject({ message: "loyaltyCartChanged" });
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: f.account.id } })).balancePoints).toBe(1000);
  });

  it("leaves an ordinary sale untouched when the programme is disabled", async () => {
    const f = await fixture(0);
    await prisma.loyaltyProgram.update({
      where: { id: f.program.id },
      data: { enabled: false },
    });
    const sale = await draft(f.caller, f.register.id, f.product.id);
    await f.caller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "no-loyalty-sale",
      payments: [{ method: "CASH", amountKgs: 1000 }],
    });
    const stored = await prisma.customerOrder.findUniqueOrThrow({ where: { id: sale.id } });
    expect(Number(stored.totalKgs)).toBe(1000);
    expect(Number(stored.discountKgs)).toBe(0);
    expect(await prisma.loyaltyLedgerEntry.count({ where: { customerOrderId: sale.id } })).toBe(0);
  });
});
