import { beforeEach, describe, expect, it } from "vitest";

import { createTestCaller } from "../helpers/context";
import { prisma } from "@/server/db/prisma";
import { adjustStock } from "@/server/services/inventory";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("plan feature gates", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("allows a Starter trial to complete an idempotent sale through the actual POS services", async () => {
    const f = await seedBase({ plan: "STARTER" });
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { trialEndsAt: future, currentPeriodEndsAt: future },
    });
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 150 } });
    await adjustStock({
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      storeId: f.store.id,
      productId: f.product.id,
      qtyDelta: 3,
      reason: "Starter trial fixture",
      idempotencyKey: "starter-trial-stock",
      requestId: "starter-trial-stock",
    });
    const register = await prisma.posRegister.create({
      data: { organizationId: f.org.id, storeId: f.store.id, name: "Starter POS", code: "STARTER" },
    });
    const cashier = createTestCaller({ ...f.cashierUser, organizationId: f.org.id });
    await cashier.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "starter-trial-shift",
    });
    const sale = await cashier.pos.sales.createDraft({ registerId: register.id });
    await cashier.pos.sales.addLine({ saleId: sale.id, productId: f.product.id, qty: 2 });
    const complete = {
      saleId: sale.id,
      idempotencyKey: "starter-trial-complete",
      payments: [{ method: "CASH" as const, amountKgs: 300 }],
    };
    await cashier.pos.sales.complete(complete);
    await cashier.pos.sales.complete(complete);
    const stored = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: sale.id },
      include: { payments: true },
    });
    expect(stored.status).toBe("COMPLETED");
    expect(Number(stored.totalKgs)).toBe(300);
    expect(stored.payments).toHaveLength(1);
    expect(
      (
        await prisma.inventorySnapshot.findFirstOrThrow({
          where: { storeId: f.store.id, productId: f.product.id },
        })
      ).onHand,
    ).toBe(1);
  });

  it("returns FORBIDDEN with key for locked exports, analytics and reports on starter", async () => {
    const { org, adminUser } = await seedBase({ plan: "STARTER" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    await expect(caller.exports.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "featureLockedExports",
    });

    await expect(
      caller.analytics.salesTrend({
        rangeDays: 30,
        granularity: "day",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "featureLockedAnalytics",
    });

    await expect(
      caller.reports.stockouts({
        days: 30,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "featureLockedAnalytics",
    });
  });

  it("business plan allows imports, exports, analytics and reports", async () => {
    const { org, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const imports = await caller.imports.list();
    const exports = await caller.exports.list();
    const analytics = await caller.analytics.salesTrend({
      rangeDays: 30,
      granularity: "day",
    });
    const reports = await caller.reports.stockouts({
      days: 30,
    });

    expect(Array.isArray(imports.items)).toBe(true);
    expect(Array.isArray(exports)).toBe(true);
    expect(Array.isArray(analytics.series)).toBe(true);
    expect(Array.isArray(reports.items)).toBe(true);
  });
});
