import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";
import {
  approvePurchaseOrder,
  createPurchaseOrder,
  receivePurchaseOrder,
} from "@/server/services/purchaseOrders";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("period close", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("prevents duplicate period close", async () => {
    const { org, store, managerUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    const start = new Date("2025-01-01T00:00:00Z");
    const end = new Date("2025-01-31T23:59:59Z");

    await caller.periodClose.close({ storeId: store.id, periodStart: start, periodEnd: end });

    await expect(
      caller.periodClose.close({ storeId: store.id, periodStart: start, periodEnd: end }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("returns a bounded, deterministic history page", async () => {
    const { org, store, managerUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });
    const base = new Date("2025-01-01T00:00:00Z");

    await prisma.periodClose.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        organizationId: org.id,
        storeId: store.id,
        periodStart: new Date(base.getTime() + index * 86_400_000),
        periodEnd: new Date(base.getTime() + index * 86_400_000 + 3_600_000),
        closedAt: new Date(base.getTime() + index * 86_400_000),
        closedById: managerUser.id,
      })),
    });

    const result = await caller.periodClose.list({ storeId: store.id, page: 2, pageSize: 10 });

    expect(result).toMatchObject({ total: 12, page: 2, pageSize: 10 });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.closedAt.getTime()).toBeGreaterThan(
      result.items[1]?.closedAt.getTime() ?? 0,
    );
  });

  it("normalizes concurrent duplicate closes and commits one audit", async () => {
    const { org, store, managerUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });
    const periodStart = new Date("2025-02-01T00:00:00Z");
    const periodEnd = new Date("2025-02-28T23:59:59Z");

    const attempts = await Promise.allSettled([
      caller.periodClose.close({ storeId: store.id, periodStart, periodEnd }),
      caller.periodClose.close({ storeId: store.id, periodStart, periodEnd }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect(attempts.find((attempt) => attempt.status === "rejected")).toMatchObject({
      reason: { code: "CONFLICT", message: "periodAlreadyClosed" },
    });
    await expect(
      prisma.periodClose.count({ where: { organizationId: org.id, storeId: store.id } }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: { organizationId: org.id, action: "PERIOD_CLOSED", entity: "PeriodClose" },
      }),
    ).resolves.toBe(1);
  });

  it("uses valued purchase-order receipts in purchase totals", async () => {
    const { org, store, supplier, product, adminUser, managerUser } = await seedBase({
      plan: "BUSINESS",
    });
    const periodStart = new Date(Date.now() - 60_000);
    const periodEnd = new Date(Date.now() + 60_000);
    const purchaseOrder = await createPurchaseOrder({
      organizationId: org.id,
      storeId: store.id,
      supplierId: supplier.id,
      lines: [{ productId: product.id, qtyOrdered: 7, unitCost: 6 }],
      actorId: adminUser.id,
      requestId: "period-close-valued-po-create",
      submit: true,
    });
    await approvePurchaseOrder({
      purchaseOrderId: purchaseOrder.id,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "period-close-valued-po-approve",
    });
    await receivePurchaseOrder({
      purchaseOrderId: purchaseOrder.id,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "period-close-valued-po-receive",
      idempotencyKey: "period-close-valued-po-receive",
    });

    const close = await createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    }).periodClose.close({ storeId: store.id, periodStart, periodEnd });

    expect(close.totals).toMatchObject({ purchasesTotalKgs: 42 });
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { referenceType: "PURCHASE_ORDER", referenceId: purchaseOrder.id },
      select: { qtyDelta: true, unitCostKgs: true, lineTotalKgs: true },
    });
    expect({
      qtyDelta: movement.qtyDelta,
      unitCostKgs: Number(movement.unitCostKgs),
      lineTotalKgs: Number(movement.lineTotalKgs),
    }).toEqual({ qtyDelta: 7, unitCostKgs: 6, lineTotalKgs: 42 });
  });
});
