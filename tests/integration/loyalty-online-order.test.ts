import { beforeEach, describe, expect, it } from "vitest";
import { BazaarCatalogStatus, Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { createCatalogCheckoutOrder, upsertBazaarCatalogSettings } from "@/server/services/bazaarCatalog";
import { availablePoints, applyEntry, ensureAccount } from "@/server/services/loyalty/ledger";
import { requestJoinOtp, verifyJoinOtp } from "@/server/services/loyalty/memberAuth";
import { upsertLoyaltyProgram } from "@/server/services/loyalty/program";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("loyalty in the online catalogue order", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  const fixture = async (openingPoints: number) => {
    const base = await seedBase({ plan: "BUSINESS" });
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
    const link = await prisma.loyaltyProgramStore.findFirstOrThrow({
      where: { programId: program.id, storeId: base.store.id },
    });
    const email = "online@example.invalid";
    const requested = await requestJoinOtp({ programStoreId: link.id, email });
    const session = await verifyJoinOtp({ programStoreId: link.id, email, code: requested.code! });
    const member = await prisma.loyaltyMember.findFirstOrThrow({ where: { email } });
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
          eventKey: `online-seed:${account.id}`,
        }),
      );
    }
    const saved = await upsertBazaarCatalogSettings({
      organizationId: base.org.id,
      storeId: base.store.id,
      actorId: base.adminUser.id,
      requestId: "loyalty-online",
      status: BazaarCatalogStatus.PUBLISHED,
    });
    return { ...base, program, account, member, session: session.token, slug: saved.catalog.slug, caller: createTestCaller({
      id: base.adminUser.id,
      email: base.adminUser.email,
      role: base.adminUser.role,
      organizationId: base.org.id,
    }) };
  };

  it("applies the member discount and reserves the chosen points, earning only with payment evidence", async () => {
    const f = await fixture(1000);
    const order = await createCatalogCheckoutOrder({
      slug: f.slug,
      customerName: "Online Customer",
      customerEmail: "online@example.invalid",
      customerPhone: "+996555100201",
      lines: [{ productId: f.product.id, qty: 1, quotedUnitPriceKgs: 1000 }],
      loyaltySessionToken: f.session,
      loyaltyPoints: 475,
    });

    const stored = await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.saleChannel).toBe("ONLINE");
    expect(Number(stored.totalKgs)).toBe(475);
    expect(Number(stored.discountKgs)).toBe(525);
    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    expect(account.reservedPoints).toBe(475);
    expect(await prisma.$transaction((tx) => availablePoints(tx, f.account.id))).toBe(525);

    // Completion by staff without payment evidence: the redemption is confirmed but
    // no points are granted just because the order exists.
    await f.caller.salesOrders.markReady({ customerOrderId: order.id });
    await f.caller.salesOrders.complete({ customerOrderId: order.id, idempotencyKey: "online-complete" });
    const after = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    expect(after).toMatchObject({ balancePoints: 525, reservedPoints: 0 });
    expect(await prisma.loyaltyLedgerEntry.count({ where: { customerOrderId: order.id, type: "EARN" } })).toBe(0);
  });

  it("ignores a client that asks for points it does not have", async () => {
    const f = await fixture(100);
    await expect(
      createCatalogCheckoutOrder({
        slug: f.slug,
        customerName: "Online Customer",
        customerEmail: "online@example.invalid",
        customerPhone: "+996555100202",
        lines: [{ productId: f.product.id, qty: 1, quotedUnitPriceKgs: 1000 }],
        loyaltySessionToken: f.session,
        loyaltyPoints: 475,
      }),
    ).rejects.toMatchObject({ message: "loyaltyInsufficientPoints" });
  });
});
