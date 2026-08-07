import { beforeEach, describe, expect, it } from "vitest";
import { PosPaymentMethod, StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { eventBus, type EventPayload } from "@/server/events/eventBus";
import { renderMetrics } from "@/server/metrics/metrics";
import { adjustStock } from "@/server/services/inventory";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const metricValue = (metrics: string, name: string) => {
  const match = new RegExp(`^${name} (\\d+)$`, "m").exec(metrics);
  return Number(match?.[1] ?? 0);
};

describeDb("POS idempotent event publication", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("publishes shift events and metrics only for the committed attempt", async () => {
    const { org, store, cashierUser, managerUser } = await seedBase({ plan: "BUSINESS" });
    const register = await prisma.posRegister.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Replay Register",
        code: "REPLAY-SHIFT",
      },
    });
    const caller = createTestCaller({
      id: cashierUser.id,
      email: cashierUser.email,
      role: cashierUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });
    const managerCaller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });
    const events: EventPayload[] = [];
    const unsubscribe = eventBus.subscribe((event) => events.push(event));
    const beforeMetrics = renderMetrics();

    try {
      const firstOpen = await caller.pos.shifts.open({
        registerId: register.id,
        openingCashKgs: 25,
        idempotencyKey: "p2-shift-open-replay-1",
      });
      const replayedOpen = await caller.pos.shifts.open({
        registerId: register.id,
        openingCashKgs: 25,
        idempotencyKey: "p2-shift-open-replay-1",
      });
      const firstClose = await managerCaller.pos.shifts.close({
        shiftId: firstOpen.id,
        closingCashCountedKgs: 25,
        idempotencyKey: "p2-shift-close-replay-1",
      });
      const replayedClose = await managerCaller.pos.shifts.close({
        shiftId: firstOpen.id,
        closingCashCountedKgs: 25,
        idempotencyKey: "p2-shift-close-replay-1",
      });

      expect(replayedOpen).toEqual(firstOpen);
      expect(replayedClose).toEqual(firstClose);
      expect(events.filter((event) => event.type === "shift.opened")).toHaveLength(1);
      expect(events.filter((event) => event.type === "shift.closed")).toHaveLength(1);

      const afterMetrics = renderMetrics();
      expect(metricValue(afterMetrics, "pos_shift_opened_total")).toBe(
        metricValue(beforeMetrics, "pos_shift_opened_total") + 1,
      );
      expect(metricValue(afterMetrics, "pos_shift_closed_total")).toBe(
        metricValue(beforeMetrics, "pos_shift_closed_total") + 1,
      );
      expect(
        await prisma.auditLog.count({
          where: {
            organizationId: org.id,
            entity: "RegisterShift",
            entityId: firstOpen.id,
            action: { in: ["POS_SHIFT_OPEN", "POS_SHIFT_CLOSE"] },
          },
        }),
      ).toBe(2);
    } finally {
      unsubscribe();
    }
  });

  it("publishes return inventory and refund events only for the committed attempt", async () => {
    const { org, store, product, cashierUser, managerUser, adminUser } = await seedBase({
      plan: "BUSINESS",
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 100 },
    });
    await adjustStock({
      organizationId: org.id,
      actorId: adminUser.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 10,
      reason: "seed replay return",
      idempotencyKey: "p2-return-stock-seed-1",
      requestId: "p2-return-stock-seed-1",
    });
    const register = await prisma.posRegister.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Replay Return Register",
        code: "REPLAY-RETURN",
      },
    });
    const cashierCaller = createTestCaller({
      id: cashierUser.id,
      email: cashierUser.email,
      role: cashierUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });
    const managerCaller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });
    const shift = await cashierCaller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "p2-return-shift-open-1",
    });
    const sale = await cashierCaller.pos.sales.createDraft({ registerId: register.id });
    const saleLine = await cashierCaller.pos.sales.addLine({
      saleId: sale.id,
      productId: product.id,
      qty: 2,
    });
    await cashierCaller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "p2-return-sale-complete-1",
      payments: [{ method: PosPaymentMethod.CASH, amountKgs: 200 }],
    });
    const returnDraft = await cashierCaller.pos.returns.createDraft({
      shiftId: shift.id,
      originalSaleId: sale.id,
    });
    await cashierCaller.pos.returns.addLine({
      saleReturnId: returnDraft.id,
      customerOrderLineId: saleLine.id,
      qty: 1,
    });

    const events: EventPayload[] = [];
    const unsubscribe = eventBus.subscribe((event) => events.push(event));
    try {
      const first = await managerCaller.pos.returns.complete({
        saleReturnId: returnDraft.id,
        idempotencyKey: "p2-return-complete-replay-1",
        payments: [{ method: PosPaymentMethod.CASH, amountKgs: 100 }],
      });
      const replayed = await managerCaller.pos.returns.complete({
        saleReturnId: returnDraft.id,
        idempotencyKey: "p2-return-complete-replay-1",
        payments: [{ method: PosPaymentMethod.CASH, amountKgs: 100 }],
      });

      expect(replayed).toEqual(first);
      expect(events.filter((event) => event.type === "inventory.updated")).toHaveLength(1);
      expect(events.filter((event) => event.type === "sale.refunded")).toHaveLength(1);
      expect(
        await prisma.stockMovement.count({
          where: {
            storeId: store.id,
            productId: product.id,
            type: StockMovementType.RETURN,
            referenceId: returnDraft.id,
          },
        }),
      ).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: {
            organizationId: org.id,
            entity: "SaleReturn",
            entityId: returnDraft.id,
            action: "POS_RETURN_COMPLETE",
          },
        }),
      ).toBe(1);
    } finally {
      unsubscribe();
    }
  });
});
