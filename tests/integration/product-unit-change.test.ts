import { beforeEach, describe, expect, it } from "vitest";
import { StockMovementType } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { adjustStock, applyStockMovement } from "@/server/services/inventory";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("product unit corrections", () => {
  beforeEach(resetDatabase);

  async function setup(precision: 0 | 3 = 0) {
    const f = await seedBase({ plan: "BUSINESS" });
    await prisma.unit.update({
      where: { id: f.baseUnit.id },
      data: { quantityPrecision: precision },
    });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const target = await caller.units.create({
      code: "m",
      labelRu: "м",
      labelKg: "м",
      quantityPrecision: 3,
    });
    const whole = await caller.units.create({
      code: "box",
      labelRu: "коробка",
      labelKg: "куту",
      quantityPrecision: 0,
    });
    const product = await caller.products.create({
      idempotencyKey: "unit-correction-product",
      name: "Cable",
      sku: "UNIT-CABLE",
      storeId: f.store.id,
      baseUnitId: f.baseUnit.id,
      initialOnHand: 5,
      basePriceKgs: 100,
      avgCostKgs: 40,
      barcodes: ["UNIT-CODE"],
      packs: [{ packName: "Roll", multiplierToBase: 10 }],
    });
    const change = (baseUnitId: string, extras: { name?: string; basePriceKgs?: number } = {}) =>
      caller.products.update({
        productId: product.id,
        storeId: f.store.id,
        name: product.name,
        sku: product.sku,
        baseUnitId,
        barcodes: ["UNIT-CODE"],
        ...extras,
      });
    const state = () =>
      prisma.product.findUniqueOrThrow({
        where: { id: product.id },
        include: {
          inventorySnapshots: true,
          stockMovements: true,
          productCosts: true,
          packs: true,
          barcodes: true,
          storePrices: true,
        },
      });
    const adjust = (qtyDelta: number) =>
      adjustStock({
        organizationId: f.org.id,
        actorId: f.adminUser.id,
        requestId: `unit-stock-${qtyDelta}`,
        storeId: f.store.id,
        productId: product.id,
        qtyDelta,
        reason: "Count correction",
        idempotencyKey: `unit-stock-${qtyDelta}`,
      });
    return { ...f, caller, target, whole, product, change, state, adjust };
  }

  it("corrects an initially stocked product without changing stock, costs, prices, packs or history", async () => {
    const f = await setup();
    const before = await f.state();
    expect(before.stockMovements).toHaveLength(1);
    await f.change(f.target.id);
    const after = await f.state();
    expect(after.baseUnitId).toBe(f.target.id);
    expect(after.unit).toBe("m");
    for (const key of [
      "inventorySnapshots",
      "stockMovements",
      "productCosts",
      "packs",
      "storePrices",
    ] as const) {
      expect(after[key]).toEqual(before[key]);
    }
    expect(after.barcodes.map((row) => row.value)).toEqual(before.barcodes.map((row) => row.value));
    expect(after.basePriceKgs).toEqual(before.basePriceKgs);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: f.product.id, action: "PRODUCT_UPDATE" },
    });
    expect(audit.before).toMatchObject({ baseUnitId: f.baseUnit.id });
    expect(audit.after).toMatchObject({ baseUnitId: f.target.id });
    await f.adjust(0.5);
    expect((await f.state()).inventorySnapshots[0].onHand).toBe(5.5);
  });

  it("allows another whole unit with movements, and narrowing when all recorded quantities are whole", async () => {
    const f = await setup(3);
    const before = await f.state();
    await f.change(f.whole.id);
    expect((await f.state()).stockMovements).toEqual(before.stockMovements);
    expect((await f.state()).inventorySnapshots).toEqual(before.inventorySnapshots);
    await f.change(f.baseUnit.id);
    expect((await f.state()).baseUnitId).toBe(f.baseUnit.id);
  });

  it("allows equal precision without imposing new rules on existing planning thresholds", async () => {
    const f = await setup();
    await prisma.reorderPolicy.create({
      data: {
        storeId: f.store.id,
        productId: f.product.id,
        minStock: 0.5,
        leadTimeDays: 1,
        reviewPeriodDays: 1,
        safetyStockDays: 0,
      },
    });
    await f.change(f.whole.id);
    expect((await f.state()).baseUnitId).toBe(f.whole.id);
    expect(
      (await prisma.reorderPolicy.findFirstOrThrow({ where: { productId: f.product.id } }))
        .minStock,
    ).toBe(0.5);
  });

  it("preserves fractional quantities when switching between measured units", async () => {
    const f = await setup(3);
    await f.adjust(0.5);
    const before = await f.state();
    await f.change(f.target.id);
    expect((await f.state()).inventorySnapshots).toEqual(before.inventorySnapshots);
    expect((await f.state()).stockMovements).toEqual(before.stockMovements);
  });

  it("keeps fractional history returnable even when the current balance is whole, and rolls back other edits", async () => {
    const f = await setup(3);
    for (const delta of [0.5, -0.5]) await f.adjust(delta);
    const before = await f.state();
    expect(before.inventorySnapshots[0].onHand).toBe(5);
    await expect(
      f.change(f.whole.id, { name: "Must roll back", basePriceKgs: 999 }),
    ).rejects.toMatchObject({ message: "unitChangeNotAllowed" });
    expect(await f.state()).toEqual(before);
    expect(
      await prisma.auditLog.count({ where: { entityId: f.product.id, action: "PRODUCT_UPDATE" } }),
    ).toBe(0);
  });

  it.each([
    "other-store variant",
    "on order",
    "held sale",
    "purchase order",
    "stock count",
    "bundle",
    "minimum stock",
  ] as const)(
    "rejects a whole unit when fractional quantity exists in %s without movements",
    async (kind) => {
      const f = await setup(3);
      if (kind === "other-store variant") {
        const store = await prisma.store.create({
          data: { organizationId: f.org.id, name: "Other", code: "OTHER" },
        });
        const variant = await prisma.productVariant.create({
          data: { productId: f.product.id, attributes: {} },
        });
        await prisma.inventorySnapshot.create({
          data: {
            storeId: store.id,
            productId: f.product.id,
            variantId: variant.id,
            variantKey: variant.id,
            onHand: 0.5,
          },
        });
      } else if (kind === "on order") {
        await prisma.inventorySnapshot.updateMany({
          where: { productId: f.product.id },
          data: { onOrder: 0.5 },
        });
      } else if (kind === "held sale") {
        const sale = await prisma.customerOrder.create({
          data: { organizationId: f.org.id, storeId: f.store.id, number: "DRAFT-UNIT" },
        });
        await prisma.customerOrderLine.create({
          data: {
            customerOrderId: sale.id,
            productId: f.product.id,
            qty: 0.5,
            unitPriceKgs: 100,
            lineTotalKgs: 50,
          },
        });
      } else if (kind === "purchase order") {
        const order = await prisma.purchaseOrder.create({
          data: { organizationId: f.org.id, storeId: f.store.id },
        });
        await prisma.purchaseOrderLine.create({
          data: { purchaseOrderId: order.id, productId: f.product.id, qtyOrdered: 0.5 },
        });
      } else if (kind === "stock count") {
        const count = await prisma.stockCount.create({
          data: { organizationId: f.org.id, storeId: f.store.id, code: "UNIT-COUNT" },
        });
        await prisma.stockCountLine.create({
          data: {
            stockCountId: count.id,
            storeId: f.store.id,
            productId: f.product.id,
            countedQty: 0.5,
          },
        });
      } else if (kind === "bundle") {
        await prisma.productBundleComponent.create({
          data: {
            organizationId: f.org.id,
            bundleProductId: f.product.id,
            componentProductId: f.product.id,
            qty: 0.5,
          },
        });
      } else {
        await prisma.reorderPolicy.create({
          data: {
            storeId: f.store.id,
            productId: f.product.id,
            minStock: 0.5,
            leadTimeDays: 1,
            reviewPeriodDays: 1,
            safetyStockDays: 0,
          },
        });
      }
      await expect(f.change(f.whole.id)).rejects.toMatchObject({ message: "unitChangeNotAllowed" });
      expect((await f.state()).baseUnitId).toBe(f.baseUnit.id);
    },
  );

  it("preserves product and store permissions when correcting units", async () => {
    const f = await setup();
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    await manager.products.update({
      productId: f.product.id,
      storeId: f.store.id,
      name: f.product.name,
      sku: f.product.sku,
      baseUnitId: f.target.id,
      barcodes: ["UNIT-CODE"],
    });
    const staff = createTestCaller({ ...f.staffUser, organizationId: f.org.id });
    await expect(
      staff.products.update({
        productId: f.product.id,
        name: f.product.name,
        sku: f.product.sku,
        baseUnitId: f.whole.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await prisma.organization.create({ data: { name: "Other tenant" } });
    const alien = await prisma.unit.create({
      data: { organizationId: other.id, code: "alien", labelRu: "alien", labelKg: "alien" },
    });
    await expect(f.change(alien.id)).rejects.toMatchObject({ message: "unitNotFound" });
  });

  it("waits for an in-flight fractional stock movement before narrowing precision", async () => {
    const f = await setup(3);
    let ready!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      release = resolve;
    });
    const movement = prisma.$transaction(
      async (tx) => {
        await applyStockMovement(tx, {
          organizationId: f.org.id,
          storeId: f.store.id,
          productId: f.product.id,
          actorId: f.adminUser.id,
          type: StockMovementType.ADJUSTMENT,
          qtyDelta: 0.5,
        });
        ready();
        await finish;
      },
      { timeout: 15_000 },
    );
    await started;
    const correction = f.change(f.whole.id).then(
      () => null,
      (error: unknown) => error,
    );
    try {
      let blocked = false;
      for (let i = 0; i < 80 && !blocked; i++) {
        const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE '%"baseUnitId" <>%') AS blocked
        `;
        blocked = row.blocked;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);
    } finally {
      release();
    }
    await movement;
    expect(await correction).toMatchObject({ message: "unitChangeNotAllowed" });
    const after = await f.state();
    expect(after.baseUnitId).toBe(f.baseUnit.id);
    expect(after.inventorySnapshots[0].onHand).toBe(5.5);
  });
});
