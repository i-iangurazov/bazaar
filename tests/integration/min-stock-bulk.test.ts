import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("minimum stock bulk updates", () => {
  beforeEach(resetDatabase);

  it("saves 20,001 thresholds within the transaction budget without changing real stock or other planning settings", async () => {
    // Statistics describe an older, small tenant when a new tenant imports its catalog.
    const previousOrg = await prisma.organization.create({ data: { name: "Previous catalog" } });
    const previousUnit = await prisma.unit.create({
      data: { organizationId: previousOrg.id, code: "each", labelRu: "шт", labelKg: "даана" },
    });
    const previousStore = await prisma.store.create({
      data: { organizationId: previousOrg.id, name: "Previous store", code: "PREVIOUS-MIN" },
    });
    const previousProducts = Array.from({ length: 100 }, (_, index) => ({
      id: randomUUID(),
      organizationId: previousOrg.id,
      sku: `PREVIOUS-MIN-${index}`,
      name: `Previous ${index}`,
      unit: previousUnit.code,
      baseUnitId: previousUnit.id,
    }));
    await prisma.product.createMany({ data: previousProducts });
    await prisma.storeProduct.createMany({
      data: previousProducts.map((product) => ({
        organizationId: previousOrg.id,
        storeId: previousStore.id,
        productId: product.id,
      })),
    });
    await prisma.$executeRaw`ANALYZE "Product"`;
    await prisma.$executeRaw`ANALYZE "StoreProduct"`;
    const f = await seedBase();
    const products = Array.from({ length: 20_000 }, (_, index) => ({
      id: randomUUID(),
      organizationId: f.org.id,
      sku: `MIN-BULK-${index}`,
      name: `Minimum stock ${index}`,
      unit: f.baseUnit.code,
      baseUnitId: f.baseUnit.id,
    }));
    await prisma.product.createMany({ data: products });
    await prisma.storeProduct.createMany({
      data: products.map((product) => ({
        organizationId: f.org.id,
        storeId: f.store.id,
        productId: product.id,
        isActive: true,
      })),
    });
    const variant = await prisma.productVariant.create({
      data: { productId: f.product.id, name: "Variant", attributes: {} },
    });
    await prisma.inventorySnapshot.create({
      data: {
        storeId: f.store.id,
        productId: f.product.id,
        variantKey: "BASE",
        onHand: 7.5,
        onOrder: 3,
      },
    });
    await prisma.inventorySnapshot.create({
      data: {
        storeId: f.store.id,
        productId: f.product.id,
        variantId: variant.id,
        variantKey: variant.id,
        onHand: 2.25,
        onOrder: 0.5,
      },
    });
    await prisma.stockMovement.create({
      data: {
        storeId: f.store.id,
        productId: f.product.id,
        type: "RECEIVE",
        qtyDelta: 7.5,
        createdById: f.adminUser.id,
      },
    });
    await prisma.productCost.create({
      data: {
        organizationId: f.org.id,
        productId: f.product.id,
        variantKey: "BASE",
        avgCostKgs: 22.75,
        costBasisQty: 7.5,
      },
    });
    const beforeStock = await prisma.inventorySnapshot.findMany();
    const beforeMovements = await prisma.stockMovement.findMany();
    const beforeCosts = await prisma.productCost.findMany();
    const policy = await prisma.reorderPolicy.create({
      data: {
        storeId: f.store.id,
        productId: f.product.id,
        minStock: 2,
        minOrderQty: 4,
        leadTimeDays: 12,
        reviewPeriodDays: 6,
        safetyStockDays: 2,
      },
    });
    const caller = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    const startedAt = performance.now();
    const result = await caller.inventory.setDefaultMinStock({ storeId: f.store.id, minStock: 10 });
    const durationMs = Math.round(performance.now() - startedAt);
    console.info(`[MIN-STOCK-BULK] ${JSON.stringify({ count: result.count, durationMs })}`);
    expect(result.count).toBe(20_001);
    expect(durationMs).toBeLessThan(5_000);
    expect(await prisma.reorderPolicy.count({ where: { storeId: f.store.id, minStock: 10 } })).toBe(
      20_001,
    );
    expect(await prisma.inventorySnapshot.findMany()).toEqual(beforeStock);
    expect(await prisma.stockMovement.findMany()).toEqual(beforeMovements);
    expect(await prisma.productCost.findMany()).toEqual(beforeCosts);
    expect(
      await prisma.reorderPolicy.findUniqueOrThrow({ where: { id: policy.id } }),
    ).toMatchObject({
      minStock: 10,
      minOrderQty: 4,
      leadTimeDays: 12,
      reviewPeriodDays: 6,
      safetyStockDays: 2,
      createdAt: policy.createdAt,
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "REORDER_POLICY_BULK_SET" },
    });
    expect(audit.after).toMatchObject({ storeId: f.store.id, minStock: 10, count: 20_001 });
  }, 30_000);

  it("includes shared assortment, excludes archived and other-store products, and preserves other stores", async () => {
    const f = await seedBase();
    const otherStore = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Other store", code: "OTHER-MIN" },
    });
    const createProduct = (sku: string, storeId: string, isActive = true, isDeleted = false) =>
      prisma.product.create({
        data: {
          organizationId: f.org.id,
          sku,
          name: sku,
          unit: f.baseUnit.code,
          baseUnitId: f.baseUnit.id,
          isDeleted,
          storeProducts: { create: { organizationId: f.org.id, storeId, isActive } },
        },
      });
    const shared = await createProduct("SHARED-MIN", otherStore.id);
    await prisma.storeProduct.create({
      data: { organizationId: f.org.id, storeId: f.store.id, productId: shared.id, isActive: true },
    });
    const other = await createProduct("OTHER-MIN", otherStore.id);
    const inactive = await createProduct("INACTIVE-MIN", f.store.id, false);
    const archived = await createProduct("ARCHIVED-MIN", f.store.id, true, true);
    await prisma.reorderPolicy.createMany({
      data: [
        { productId: shared.id, storeId: otherStore.id },
        { productId: archived.id, storeId: f.store.id },
      ].map((row) => ({
        ...row,
        minStock: 3,
        leadTimeDays: 1,
        reviewPeriodDays: 2,
        safetyStockDays: 3,
      })),
    });
    const preserved = await prisma.reorderPolicy.findMany({ orderBy: { id: "asc" } });
    const caller = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    for (const minStock of [10, 0.5, 0]) {
      expect(await caller.inventory.setDefaultMinStock({ storeId: f.store.id, minStock })).toEqual({
        count: 2,
      });
      expect(
        await prisma.reorderPolicy.findMany({
          where: { storeId: f.store.id, productId: { in: [f.product.id, shared.id] } },
          select: { minStock: true },
        }),
      ).toEqual([{ minStock }, { minStock }]);
    }
    expect(
      await prisma.reorderPolicy.findMany({
        where: { id: { in: preserved.map((policy) => policy.id) } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(preserved);
    expect(
      await prisma.reorderPolicy.count({ where: { productId: { in: [other.id, inactive.id] } } }),
    ).toBe(0);
    expect(await prisma.reorderPolicy.count({ where: { storeId: f.store.id } })).toBe(3);
    expect(await prisma.inventorySnapshot.count()).toBe(0);
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it("rejects staff, inaccessible or foreign stores and invalid values without writes", async () => {
    const f = await seedBase();
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    const staff = createTestCaller({ ...f.staffUser, organizationId: f.org.id });
    const otherStore = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Restricted", code: "RESTRICTED-MIN" },
    });
    const foreignOrg = await prisma.organization.create({
      data: { name: "Foreign minimum stock" },
    });
    const foreignStore = await prisma.store.create({
      data: { organizationId: foreignOrg.id, name: "Foreign", code: "FOREIGN-MIN" },
    });
    for (const [caller, storeId] of [
      [staff, f.store.id],
      [manager, otherStore.id],
      [manager, foreignStore.id],
    ] as const) {
      await expect(
        caller.inventory.setDefaultMinStock({ storeId, minStock: 10 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    for (const minStock of [-1, 0.0001]) {
      await expect(
        manager.inventory.setDefaultMinStock({ storeId: f.store.id, minStock }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(await prisma.reorderPolicy.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "REORDER_POLICY_BULK_SET" } })).toBe(0);
    expect(await prisma.inventorySnapshot.count()).toBe(0);
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it("handles an empty assortment and individual fractional or zero thresholds without changing stock", async () => {
    const f = await seedBase();
    const caller = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    await prisma.inventorySnapshot.create({
      data: {
        storeId: f.store.id,
        productId: f.product.id,
        variantKey: "BASE",
        onHand: 8,
        onOrder: 3,
      },
    });
    const beforeStock = await prisma.inventorySnapshot.findMany();
    for (const minStock of [0.5, 0]) {
      await caller.inventory.setMinStock({
        storeId: f.store.id,
        productId: f.product.id,
        minStock,
      });
      expect((await prisma.reorderPolicy.findFirstOrThrow()).minStock).toBe(minStock);
    }
    await prisma.storeProduct.update({
      where: { storeId_productId: { storeId: f.store.id, productId: f.product.id } },
      data: { isActive: false },
    });
    expect(
      await caller.inventory.setDefaultMinStock({ storeId: f.store.id, minStock: 10 }),
    ).toEqual({ count: 0 });
    expect((await prisma.reorderPolicy.findFirstOrThrow()).minStock).toBe(0);
    expect(await prisma.inventorySnapshot.findMany()).toEqual(beforeStock);
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it("keeps concurrent bulk saves atomic without duplicate policies", async () => {
    const f = await seedBase();
    const products = Array.from({ length: 50 }, (_, index) => ({
      id: randomUUID(),
      organizationId: f.org.id,
      sku: `MIN-CONCURRENT-${index}`,
      name: `Concurrent ${index}`,
      unit: f.baseUnit.code,
      baseUnitId: f.baseUnit.id,
    }));
    await prisma.product.createMany({ data: products });
    await prisma.storeProduct.createMany({
      data: products.map((product) => ({
        organizationId: f.org.id,
        productId: product.id,
        storeId: f.store.id,
      })),
    });
    const caller = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    const results = await Promise.allSettled(
      [10, 20].map((minStock) =>
        caller.inventory.setDefaultMinStock({ storeId: f.store.id, minStock }),
      ),
    );
    for (const result of results) {
      expect(result.status).toBe("fulfilled");
      if (result.status === "fulfilled") expect(result.value.count).toBe(51);
    }
    const policies = await prisma.reorderPolicy.findMany({ where: { storeId: f.store.id } });
    expect(policies).toHaveLength(51);
    expect(new Set(policies.map((policy) => policy.minStock)).size).toBe(1);
    expect([10, 20]).toContain(policies[0].minStock);
    expect(await prisma.stockMovement.count()).toBe(0);
    expect(await prisma.inventorySnapshot.count()).toBe(0);
  });
});
