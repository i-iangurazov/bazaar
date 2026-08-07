import { PurchaseOrderStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sideEffects = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock("@/server/events/eventBus", () => ({
  eventBus: { publish: sideEffects.publish },
}));

import { prisma } from "@/server/db/prisma";
import {
  addPurchaseOrderLine,
  cancelPurchaseOrder,
  createPurchaseOrder,
  removePurchaseOrderLine,
  submitPurchaseOrder,
  updatePurchaseOrderLine,
} from "@/server/services/purchaseOrders";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const waitForLockWaiters = async (minimum: number) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
    `;
    if (Number(rows[0]?.count ?? 0) >= minimum) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${minimum} database lock waiter(s)`);
};

const raceBehindParentLock = async <TFirst, TSecond>(input: {
  purchaseOrderId: string;
  first: () => Promise<TFirst>;
  second: () => Promise<TSecond>;
}) => {
  let markLocked!: () => void;
  let release!: () => void;
  const locked = new Promise<void>((resolve) => {
    markLocked = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blocker = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id" FROM "PurchaseOrder"
      WHERE "id" = ${input.purchaseOrderId}
      FOR UPDATE
    `;
    markLocked();
    await released;
  });

  await locked;
  const first = input.first();
  try {
    await waitForLockWaiters(1);
    const second = input.second();
    await waitForLockWaiters(2);
    release();
    const results = await Promise.allSettled([first, second]);
    await blocker;
    return results;
  } catch (error) {
    release();
    await Promise.allSettled([first, blocker]);
    throw error;
  }
};

const seedPurchaseOrder = async () => {
  const base = await seedBase({ plan: "BUSINESS" });
  const [secondProduct, addedProduct] = await Promise.all(
    [
      { sku: "PO-RACE-2", name: "PO Race Second" },
      { sku: "PO-RACE-3", name: "PO Race Added" },
    ].map((product) =>
      prisma.product.create({
        data: {
          organizationId: base.org.id,
          supplierId: base.supplier.id,
          sku: product.sku,
          name: product.name,
          unit: base.baseUnit.code,
          baseUnitId: base.baseUnit.id,
        },
      }),
    ),
  );
  await prisma.storeProduct.createMany({
    data: [secondProduct, addedProduct].map((product) => ({
      organizationId: base.org.id,
      storeId: base.store.id,
      productId: product.id,
      isActive: true,
    })),
  });
  const po = await createPurchaseOrder({
    organizationId: base.org.id,
    storeId: base.store.id,
    supplierId: base.supplier.id,
    actorId: base.adminUser.id,
    requestId: "a3-030-create",
    lines: [
      { productId: base.product.id, qtyOrdered: 2, unitCost: 10 },
      { productId: secondProduct.id, qtyOrdered: 3, unitCost: 20 },
    ],
  });
  const persisted = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: po.id },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  return { ...base, po: persisted, secondProduct, addedProduct };
};

const onOrderFor = async (storeId: string, productId: string) =>
  (
    await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: { storeId, productId, variantKey: "BASE" },
      },
      select: { onOrder: true },
    })
  )?.onOrder ?? 0;

describeDb("HARD-A3-030 purchase-order line/status serialization", () => {
  beforeEach(async () => {
    await resetDatabase();
    sideEffects.publish.mockClear();
  });

  it("hides foreign-organization parents and lines without audits or events", async () => {
    const fixture = await seedPurchaseOrder();
    const foreignOrganization = await prisma.organization.create({
      data: { name: "Foreign PO Organization", plan: "BUSINESS" },
    });
    sideEffects.publish.mockClear();
    const before = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: fixture.po.id },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    const auditCount = await prisma.auditLog.count({ where: { entityId: fixture.po.id } });
    const common = {
      organizationId: foreignOrganization.id,
      actorId: fixture.adminUser.id,
      requestId: "a3-030-cross-org",
    };

    await expect(
      addPurchaseOrderLine({
        ...common,
        purchaseOrderId: fixture.po.id,
        productId: fixture.addedProduct.id,
        qtyOrdered: 5,
      }),
    ).rejects.toMatchObject({ message: "poNotFound" });
    await expect(
      updatePurchaseOrderLine({
        ...common,
        lineId: fixture.po.lines[0]!.id,
        qtyOrdered: 99,
      }),
    ).rejects.toMatchObject({ message: "poLineNotFound" });
    await expect(
      removePurchaseOrderLine({
        ...common,
        lineId: fixture.po.lines[1]!.id,
      }),
    ).rejects.toMatchObject({ message: "poLineNotFound" });

    expect(
      await prisma.purchaseOrder.findUniqueOrThrow({
        where: { id: fixture.po.id },
        include: { lines: { orderBy: { position: "asc" } } },
      }),
    ).toEqual(before);
    expect(await prisma.auditLog.count({ where: { entityId: fixture.po.id } })).toBe(auditCount);
    expect(sideEffects.publish).not.toHaveBeenCalled();
  });

  it("rejects a stale add when submit acquires the parent lock first", async () => {
    const fixture = await seedPurchaseOrder();
    const common = {
      organizationId: fixture.org.id,
      actorId: fixture.adminUser.id,
    };
    const [submit, add] = await raceBehindParentLock({
      purchaseOrderId: fixture.po.id,
      first: () =>
        submitPurchaseOrder({
          ...common,
          purchaseOrderId: fixture.po.id,
          requestId: "a3-030-submit-first",
        }),
      second: () =>
        addPurchaseOrderLine({
          ...common,
          purchaseOrderId: fixture.po.id,
          productId: fixture.addedProduct.id,
          qtyOrdered: 5,
          requestId: "a3-030-add-second",
        }),
    });

    expect(submit).toMatchObject({ status: "fulfilled" });
    expect(add).toMatchObject({ status: "rejected", reason: { message: "poNotEditable" } });
    const po = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: fixture.po.id },
      include: { lines: true },
    });
    expect(po.status).toBe(PurchaseOrderStatus.SUBMITTED);
    expect(po.lines).toHaveLength(2);
    expect(await onOrderFor(fixture.store.id, fixture.product.id)).toBe(2);
    expect(await onOrderFor(fixture.store.id, fixture.secondProduct.id)).toBe(3);
    expect(await onOrderFor(fixture.store.id, fixture.addedProduct.id)).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { entityId: fixture.po.id, action: "PO_LINE_ADD" },
      }),
    ).toBe(0);
  });

  it("rejects a stale update when cancel acquires the parent lock first", async () => {
    const fixture = await seedPurchaseOrder();
    const line = fixture.po.lines[0]!;
    const common = {
      organizationId: fixture.org.id,
      actorId: fixture.adminUser.id,
    };
    const [cancel, update] = await raceBehindParentLock({
      purchaseOrderId: fixture.po.id,
      first: () =>
        cancelPurchaseOrder({
          ...common,
          purchaseOrderId: fixture.po.id,
          requestId: "a3-030-cancel-first",
        }),
      second: () =>
        updatePurchaseOrderLine({
          ...common,
          lineId: line.id,
          qtyOrdered: 99,
          requestId: "a3-030-update-second",
        }),
    });

    expect(cancel).toMatchObject({ status: "fulfilled" });
    expect(update).toMatchObject({ status: "rejected", reason: { message: "poNotEditable" } });
    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: fixture.po.id } });
    const persistedLine = await prisma.purchaseOrderLine.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(po.status).toBe(PurchaseOrderStatus.CANCELLED);
    expect(persistedLine.qtyOrdered).toBe(2);
    expect(await onOrderFor(fixture.store.id, fixture.product.id)).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { entityId: fixture.po.id, action: "PO_LINE_UPDATE" },
      }),
    ).toBe(0);
  });

  it("rejects a stale remove after submit and retains exact onOrder", async () => {
    const fixture = await seedPurchaseOrder();
    const line = fixture.po.lines[1]!;
    const common = {
      organizationId: fixture.org.id,
      actorId: fixture.adminUser.id,
    };
    const [submit, remove] = await raceBehindParentLock({
      purchaseOrderId: fixture.po.id,
      first: () =>
        submitPurchaseOrder({
          ...common,
          purchaseOrderId: fixture.po.id,
          requestId: "a3-030-submit-before-remove",
        }),
      second: () =>
        removePurchaseOrderLine({
          ...common,
          lineId: line.id,
          requestId: "a3-030-remove-second",
        }),
    });

    expect(submit).toMatchObject({ status: "fulfilled" });
    expect(remove).toMatchObject({ status: "rejected", reason: { message: "poNotEditable" } });
    expect(await prisma.purchaseOrderLine.count({ where: { purchaseOrderId: fixture.po.id } })).toBe(
      2,
    );
    expect(await onOrderFor(fixture.store.id, fixture.product.id)).toBe(2);
    expect(await onOrderFor(fixture.store.id, fixture.secondProduct.id)).toBe(3);
    expect(
      await prisma.auditLog.count({
        where: { entityId: fixture.po.id, action: "PO_LINE_REMOVE" },
      }),
    ).toBe(0);
  });

  it("serializes add/update/remove first so submit observes their authoritative lines", async () => {
    const scenarios = ["add", "update", "remove"] as const;
    for (const scenario of scenarios) {
      await resetDatabase();
      const fixture = await seedPurchaseOrder();
      const common = {
        organizationId: fixture.org.id,
        actorId: fixture.adminUser.id,
      };
      const edit =
        scenario === "add"
          ? () =>
              addPurchaseOrderLine({
                ...common,
                purchaseOrderId: fixture.po.id,
                productId: fixture.addedProduct.id,
                qtyOrdered: 5,
                requestId: "a3-030-add-first",
              })
          : scenario === "update"
            ? () =>
                updatePurchaseOrderLine({
                  ...common,
                  lineId: fixture.po.lines[0]!.id,
                  qtyOrdered: 7,
                  requestId: "a3-030-update-first",
                })
            : () =>
                removePurchaseOrderLine({
                  ...common,
                  lineId: fixture.po.lines[1]!.id,
                  requestId: "a3-030-remove-first",
                });
      const [editResult, submitResult] = await raceBehindParentLock({
        purchaseOrderId: fixture.po.id,
        first: edit,
        second: () =>
          submitPurchaseOrder({
            ...common,
            purchaseOrderId: fixture.po.id,
            requestId: `a3-030-submit-after-${scenario}`,
          }),
      });

      expect(editResult).toMatchObject({ status: "fulfilled" });
      expect(submitResult).toMatchObject({ status: "fulfilled" });
      const po = await prisma.purchaseOrder.findUniqueOrThrow({
        where: { id: fixture.po.id },
        include: { lines: true },
      });
      expect(po.status).toBe(PurchaseOrderStatus.SUBMITTED);
      expect(await onOrderFor(fixture.store.id, fixture.product.id)).toBe(
        scenario === "update" ? 7 : 2,
      );
      expect(await onOrderFor(fixture.store.id, fixture.secondProduct.id)).toBe(
        scenario === "remove" ? 0 : 3,
      );
      expect(await onOrderFor(fixture.store.id, fixture.addedProduct.id)).toBe(
        scenario === "add" ? 5 : 0,
      );
      expect(po.lines).toHaveLength(scenario === "add" ? 3 : scenario === "remove" ? 1 : 2);
    }
  });

  it("serializes add/update/remove first so cancel preserves each completed edit", async () => {
    const scenarios = ["add", "update", "remove"] as const;
    for (const scenario of scenarios) {
      await resetDatabase();
      const fixture = await seedPurchaseOrder();
      const common = {
        organizationId: fixture.org.id,
        actorId: fixture.adminUser.id,
      };
      const edit =
        scenario === "add"
          ? () =>
              addPurchaseOrderLine({
                ...common,
                purchaseOrderId: fixture.po.id,
                productId: fixture.addedProduct.id,
                qtyOrdered: 5,
                requestId: "a3-030-add-before-cancel",
              })
          : scenario === "update"
            ? () =>
                updatePurchaseOrderLine({
                  ...common,
                  lineId: fixture.po.lines[0]!.id,
                  qtyOrdered: 7,
                  requestId: "a3-030-update-before-cancel",
                })
            : () =>
                removePurchaseOrderLine({
                  ...common,
                  lineId: fixture.po.lines[1]!.id,
                  requestId: "a3-030-remove-before-cancel",
                });
      const [editResult, cancelResult] = await raceBehindParentLock({
        purchaseOrderId: fixture.po.id,
        first: edit,
        second: () =>
          cancelPurchaseOrder({
            ...common,
            purchaseOrderId: fixture.po.id,
            requestId: `a3-030-cancel-after-${scenario}`,
          }),
      });

      expect(editResult).toMatchObject({ status: "fulfilled" });
      expect(cancelResult).toMatchObject({ status: "fulfilled" });
      const po = await prisma.purchaseOrder.findUniqueOrThrow({
        where: { id: fixture.po.id },
        include: { lines: { orderBy: { position: "asc" } } },
      });
      expect(po.status).toBe(PurchaseOrderStatus.CANCELLED);
      expect(po.lines).toHaveLength(scenario === "add" ? 3 : scenario === "remove" ? 1 : 2);
      if (scenario === "update") {
        expect(po.lines[0]?.qtyOrdered).toBe(7);
      }
      expect(await onOrderFor(fixture.store.id, fixture.product.id)).toBe(0);
      expect(await onOrderFor(fixture.store.id, fixture.secondProduct.id)).toBe(0);
      expect(await onOrderFor(fixture.store.id, fixture.addedProduct.id)).toBe(0);
    }
  });
});
