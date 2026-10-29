import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { adjustStock } from "@/server/services/inventory";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("client catalog and quantity regressions", () => {
  beforeEach(resetDatabase);

  it("keeps ordinary retail 325 when adding wholesale 300 across reads, sort and POS", async () => {
    const f = await seedBase({ plan: "BUSINESS", allowNegativeStock: true });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { retailWholesaleEnabled: true },
    });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    await caller.storePrices.upsert({
      storeId: f.store.id,
      productId: f.product.id,
      priceKgs: 325,
    });
    await caller.storePrices.upsert({
      storeId: f.store.id,
      productId: f.product.id,
      wholesalePriceKgs: 300,
    });
    const pricing = await caller.products.storePricing({ productId: f.product.id });
    expect(pricing.stores[0]).toMatchObject({ effectivePriceKgs: 325, wholesalePriceKgs: 300 });
    const list = await caller.products.list({
      storeId: f.store.id,
      sortKey: "salePrice",
      sortDirection: "asc",
    });
    expect(list.items.find((p) => p.id === f.product.id)?.effectivePriceKgs).toBe(325);
    const register = await caller.pos.registers.create({
      storeId: f.store.id,
      name: "Pricing",
      code: "PRC",
    });
    await caller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "pricing-regression-shift",
    });
    for (const [priceMode, total] of [
      ["RETAIL", 325],
      ["WHOLESALE", 300],
    ] as const) {
      const sale = await caller.pos.sales.createDraft({
        registerId: register.id,
        priceMode,
        lines: [{ productId: f.product.id, qty: 1 }],
      });
      const saved = await prisma.customerOrder.findUniqueOrThrow({ where: { id: sale.id } });
      expect(Number(saved.totalKgs)).toBe(total);
      await caller.pos.sales.cancelDraft({ saleId: sale.id });
    }
    await caller.storePrices.upsert({
      storeId: f.store.id,
      productId: f.product.id,
      priceKgs: 350,
    });
    expect(
      (await caller.products.list({ storeId: f.store.id })).items.find((p) => p.id === f.product.id)
        ?.effectivePriceKgs,
    ).toBe(350);
    expect(
      (await caller.products.storePricing({ productId: f.product.id })).stores[0].effectivePriceKgs,
    ).toBe(350);
  });

  it("corrects an existing fractional balance, replays once and rejects stale or unauthorized writes", async () => {
    const f = await seedBase();
    await prisma.unit.update({ where: { id: f.baseUnit.id }, data: { quantityPrecision: 3 } });
    await adjustStock({
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      requestId: "fraction-start",
      storeId: f.store.id,
      productId: f.product.id,
      qtyDelta: 48.1,
      reason: "Initial quantity",
      idempotencyKey: "fraction-initial",
    });
    const initial = await prisma.inventorySnapshot.findFirstOrThrow({
      where: { storeId: f.store.id, productId: f.product.id },
    });
    const caller = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    const request = {
      storeId: f.store.id,
      productId: f.product.id,
      expectedOnHand: 48.1,
      expectedVersion: initial.version,
      targetOnHand: 120.1,
      reason: "Verified physical stock",
      idempotencyKey: "fraction-correction",
    };
    await caller.inventory.setOnHand(request);
    await caller.inventory.setOnHand(request);
    const snapshot = await prisma.inventorySnapshot.findUniqueOrThrow({
      where: { id: initial.id },
    });
    expect(snapshot.onHand).toBe(120.1);
    expect(
      await prisma.stockMovement.count({
        where: { productId: f.product.id, referenceId: request.idempotencyKey },
      }),
    ).toBe(1);
    await expect(
      caller.inventory.setOnHand({
        ...request,
        targetOnHand: 125,
        idempotencyKey: "fraction-stale",
      }),
    ).rejects.toMatchObject({ message: "inventoryStockConflict" });
    await expect(
      createTestCaller({ ...f.cashierUser, organizationId: f.org.id }).inventory.setOnHand({
        ...request,
        expectedOnHand: 120.1,
        expectedVersion: snapshot.version,
        idempotencyKey: "fraction-cashier",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller.inventory.adjust({
      storeId: f.store.id,
      productId: f.product.id,
      qtyDelta: -0.1,
      reason: "Fraction correction",
      idempotencyKey: "fraction-adjustment",
    });
    expect(
      (await prisma.inventorySnapshot.findUniqueOrThrow({ where: { id: initial.id } })).onHand,
    ).toBe(120);
    const ledger = await prisma.stockMovement.aggregate({
      where: { productId: f.product.id },
      _sum: { qtyDelta: true },
    });
    expect(ledger._sum.qtyDelta).toBeCloseTo(120);
  });

  it("continues to enforce whole-unit precision and organization/store isolation", async () => {
    const f = await seedBase();
    const snapshot = await prisma.inventorySnapshot.create({
      data: { storeId: f.store.id, productId: f.product.id, onHand: 0 },
    });
    const request = {
      storeId: f.store.id,
      productId: f.product.id,
      targetOnHand: 0.5,
      expectedOnHand: 0,
      expectedVersion: snapshot.version,
      reason: "Invalid fractional units",
      idempotencyKey: "whole-unit-correction",
    };
    await expect(
      createTestCaller({ ...f.adminUser, organizationId: f.org.id }).inventory.setOnHand(request),
    ).rejects.toMatchObject({ message: "wholeQuantityRequired" });
    const other = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Other", code: "OTH" },
    });
    await expect(
      createTestCaller({ ...f.managerUser, organizationId: f.org.id }).inventory.setOnHand({
        ...request,
        storeId: other.id,
        targetOnHand: 1,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it("repairs a legacy fractional balance of a whole-unit product without losing the ledger delta", async () => {
    const f = await seedBase();
    await prisma.inventorySnapshot.create({
      data: { storeId: f.store.id, productId: f.product.id, onHand: 48.1 },
    });
    await prisma.stockMovement.create({
      data: {
        storeId: f.store.id,
        productId: f.product.id,
        type: "ADJUSTMENT",
        qtyDelta: 48.1,
        createdById: f.adminUser.id,
      },
    });
    const snapshot = await prisma.inventorySnapshot.findFirstOrThrow({
      where: { productId: f.product.id },
    });
    await createTestCaller({ ...f.adminUser, organizationId: f.org.id }).inventory.setOnHand({
      storeId: f.store.id,
      productId: f.product.id,
      targetOnHand: 100,
      expectedOnHand: 48.1,
      expectedVersion: snapshot.version,
      reason: "Repair historical balance",
      idempotencyKey: "legacy-fraction-repair",
    });
    expect(
      (await prisma.inventorySnapshot.findUniqueOrThrow({ where: { id: snapshot.id } })).onHand,
    ).toBe(100);
    const ledger = await prisma.stockMovement.aggregate({
      where: { productId: f.product.id },
      _sum: { qtyDelta: true },
    });
    expect(ledger._sum.qtyDelta).toBeCloseTo(100);
    expect(await prisma.stockMovement.count()).toBe(2);
  });
});
