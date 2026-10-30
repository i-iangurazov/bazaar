import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { adjustStock } from "@/server/services/inventory";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

(shouldRunDbTests ? describe : describe.skip)("continued POS session", () => {
  beforeEach(resetDatabase);

  it("keeps searching and completing receipts after repeated checkout and lost-result recovery", async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 25 } });
    await prisma.productBarcode.create({
      data: {
        organizationId: f.org.id,
        productId: f.product.id,
        value: "5901234123457",
      },
    });
    await adjustStock({
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      storeId: f.store.id,
      productId: f.product.id,
      qtyDelta: 100,
      reason: "isolated session fixture",
      requestId: "session-fixture",
      idempotencyKey: "session-fixture-stock",
    });
    const register = await prisma.posRegister.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        name: "Session QA",
        code: "SESSION",
      },
    });
    const caller = createTestCaller({
      ...f.cashierUser,
      organizationId: f.org.id,
      isOrgOwner: false,
    });
    await caller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "session-open-once",
    });
    const completed = new Set<string>();
    for (let index = 0; index < 24; index++) {
      const products = await caller.products.list({
        storeId: f.store.id,
        search: "Test Product",
        pageSize: 40,
      });
      expect(products.items.map((product) => product.id)).toContain(f.product.id);
      const scan = await caller.products.lookupScan({ q: "5901234123457" });
      expect(scan.items.map((product) => product.id)).toContain(f.product.id);
      const draft = await caller.pos.sales.createDraft({ registerId: register.id });
      expect(completed.has(draft.id)).toBe(false);
      await caller.pos.sales.addLine({ saleId: draft.id, productId: f.product.id, qty: 1 });
      const payment = {
        saleId: draft.id,
        idempotencyKey: `session-payment-${index}`,
        payments: [{ method: "CASH" as const, amountKgs: 25 }],
      };
      await caller.pos.sales.complete(payment);
      if (index % 5 === 0) await caller.pos.sales.complete(payment);
      completed.add(draft.id);
    }
    expect(completed.size).toBe(24);
    expect(
      await prisma.customerOrder.count({
        where: {
          organizationId: f.org.id,
          registerId: register.id,
          status: "COMPLETED",
          isPosSale: true,
        },
      }),
    ).toBe(24);
    const stock = await prisma.inventorySnapshot.findUniqueOrThrow({
      where: {
        storeId_productId_variantKey: {
          storeId: f.store.id,
          productId: f.product.id,
          variantKey: "BASE",
        },
      },
    });
    expect(stock.onHand).toBe(76);
  }, 30_000);
});
