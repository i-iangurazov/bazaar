import { randomUUID } from "node:crypto";
import { StockMovementType } from "@prisma/client";
import type { Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const callerFor = (user: {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
  isOrgOwner?: boolean;
}) => {
  if (!user.organizationId) {
    throw new Error("Agent 2 reproduction user must belong to an organization");
  }
  return createTestCaller({
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    isOrgOwner: user.isOrgOwner,
  });
};

const seedTwoStoreScope = async () => {
  const base = await seedBase({ plan: "BUSINESS" });
  const storeB = await prisma.store.create({
    data: {
      organizationId: base.org.id,
      name: "Restricted Store B",
      code: `B-${randomUUID().slice(0, 8)}`,
      trackExpiryLots: true,
    },
  });
  const productB = await prisma.product.create({
    data: {
      organizationId: base.org.id,
      sku: `B-${randomUUID().slice(0, 10)}`,
      name: "Restricted Product B",
      unit: base.baseUnit.code,
      baseUnitId: base.baseUnit.id,
      basePriceKgs: 9876,
    },
  });
  await prisma.storeProduct.create({
    data: {
      organizationId: base.org.id,
      storeId: storeB.id,
      productId: productB.id,
      isActive: true,
      assignedById: base.adminUser.id,
    },
  });
  const barcodeB = `29${Date.now().toString().slice(-10)}`;
  await prisma.productBarcode.create({
    data: {
      organizationId: base.org.id,
      productId: productB.id,
      value: barcodeB,
    },
  });
  await prisma.productCost.create({
    data: {
      organizationId: base.org.id,
      productId: productB.id,
      variantKey: "BASE",
      avgCostKgs: 5432,
    },
  });
  const snapshotB = await prisma.inventorySnapshot.create({
    data: {
      storeId: storeB.id,
      productId: productB.id,
      variantKey: "BASE",
      onHand: 5,
    },
  });

  return { ...base, storeB, productB, barcodeB, snapshotB };
};

describeDb("Agent 2 P0 runtime reproductions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("HARD-A2-001 rejects Store B count, lot, and snapshot access without side effects", async () => {
    const { org, storeB, productB, managerUser, snapshotB } = await seedTwoStoreScope();
    const countB = await prisma.stockCount.create({
      data: {
        organizationId: org.id,
        storeId: storeB.id,
        code: `SC-${randomUUID().slice(0, 8)}`,
        status: "IN_PROGRESS",
        createdById: managerUser.id,
      },
    });
    const lineB = await prisma.stockCountLine.create({
      data: {
        stockCountId: countB.id,
        storeId: storeB.id,
        productId: productB.id,
        variantKey: "BASE",
        expectedOnHand: 5,
        countedQty: 7,
        deltaQty: 2,
      },
    });
    const lotB = await prisma.stockLot.create({
      data: {
        organizationId: org.id,
        storeId: storeB.id,
        productId: productB.id,
        variantKey: "BASE",
        expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        onHandQty: 5,
      },
    });
    const caller = callerFor(managerUser);

    await expect(caller.stockCounts.list({ storeId: storeB.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "storeAccessDenied",
    });
    await expect(caller.stockCounts.get({ stockCountId: countB.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "storeAccessDenied",
    });
    await expect(
      caller.stockLots.byProduct({ storeId: storeB.id, productId: productB.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    await expect(caller.stockLots.expiringSoon({ storeId: storeB.id, days: 30 })).rejects.toMatchObject(
      { code: "FORBIDDEN", message: "storeAccessDenied" },
    );
    await expect(
      caller.inventory.productIdsBySnapshotIds({ snapshotIds: [snapshotB.id] }),
    ).resolves.toEqual([]);
    await expect(
      caller.stockCounts.setLineCountedQty({ lineId: lineB.id, countedQty: 8 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    await expect(
      caller.stockCounts.removeLine({ lineId: lineB.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });
    await expect(
      caller.stockCounts.applyCount({
        stockCountId: countB.id,
        idempotencyKey: `a2-001-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });

    const [afterLine, afterCount, afterSnapshot, movements] = await Promise.all([
      prisma.stockCountLine.findUniqueOrThrow({ where: { id: lineB.id } }),
      prisma.stockCount.findUniqueOrThrow({ where: { id: countB.id } }),
      prisma.inventorySnapshot.findUniqueOrThrow({ where: { id: snapshotB.id } }),
      prisma.stockMovement.findMany({
        where: { referenceType: "STOCK_COUNT", referenceId: countB.id },
      }),
    ]);
    expect(afterLine.countedQty).toBe(7);
    expect(afterCount.status).toBe("IN_PROGRESS");
    expect(afterSnapshot.onHand).toBe(5);
    expect(movements).toHaveLength(0);
    expect(await prisma.stockLot.findUnique({ where: { id: lotB.id } })).not.toBeNull();
  });

  it("HARD-A2-001 preserves count and lot access in an assigned store and hides cross-org IDs", async () => {
    const { org, store, product, managerUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.store.update({ where: { id: store.id }, data: { trackExpiryLots: true } });
    const snapshot = await prisma.inventorySnapshot.create({
      data: { storeId: store.id, productId: product.id, variantKey: "BASE", onHand: 4 },
    });
    const lot = await prisma.stockLot.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        variantKey: "BASE",
        expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        onHandQty: 4,
      },
    });
    const caller = callerFor(managerUser);
    const count = await caller.stockCounts.create({ storeId: store.id, notes: "allowed" });
    const line = await caller.stockCounts.addOrUpdateLineByScan({
      stockCountId: count.id,
      storeId: store.id,
      barcodeOrQuery: product.sku,
      mode: "set",
      countedQty: 4,
    });

    await expect(caller.stockCounts.list({ storeId: store.id })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: count.id })]),
    );
    await expect(caller.stockCounts.get({ stockCountId: count.id })).resolves.toMatchObject({
      id: count.id,
    });
    await expect(
      caller.stockLots.byProduct({ storeId: store.id, productId: product.id }),
    ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: lot.id })]));
    await expect(
      caller.inventory.productIdsBySnapshotIds({ snapshotIds: [snapshot.id] }),
    ).resolves.toEqual([product.id]);
    await expect(
      caller.stockCounts.setLineCountedQty({ lineId: line.id, countedQty: 5 }),
    ).resolves.toMatchObject({ countedQty: 5 });

    const betaOrg = await prisma.organization.create({ data: { name: "Count Beta" } });
    const betaStore = await prisma.store.create({
      data: { organizationId: betaOrg.id, name: "Beta Store", code: "COUNT-BETA" },
    });
    const betaCount = await prisma.stockCount.create({
      data: { organizationId: betaOrg.id, storeId: betaStore.id, code: "SC-BETA" },
    });
    await expect(caller.stockCounts.get({ stockCountId: betaCount.id })).resolves.toBeNull();
  });

  it("HARD-A2-002 lets a Store-A-only manager mutate a Store-B-only product and price", async () => {
    const { org, storeB, productB, managerUser } = await seedTwoStoreScope();
    const caller = callerFor(managerUser);

    const updated = await caller.products.inlineUpdate({
      productId: productB.id,
      patch: { name: "Unauthorized Store B rename" },
    });
    const price = await caller.storePrices.upsert({
      storeId: storeB.id,
      productId: productB.id,
      priceKgs: 3210,
    });

    expect(updated.name).toBe("Unauthorized Store B rename");
    expect(Number(price.priceKgs)).toBe(3210);
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: productB.id } }),
    ).resolves.toMatchObject({ name: "Unauthorized Store B rename" });
    await expect(
      prisma.storePrice.findUniqueOrThrow({
        where: {
          organizationId_storeId_productId_variantKey: {
            organizationId: org.id,
            storeId: storeB.id,
            productId: productB.id,
            variantKey: "BASE",
          },
        },
      }),
    ).resolves.toMatchObject({ updatedById: managerUser.id });
  });

  it("HARD-A2-003 returns Store-B-only prices and costs to a Store-A-only staff user", async () => {
    const { productB, staffUser } = await seedTwoStoreScope();
    const caller = callerFor(staffUser);

    const pricing = await caller.products.pricing({ productId: productB.id });
    const storePricing = await caller.products.storePricing({ productId: productB.id });

    expect(pricing).toMatchObject({
      basePriceKgs: 9876,
      effectivePriceKgs: 9876,
      avgCostKgs: 5432,
    });
    expect(storePricing).toMatchObject({
      basePriceKgs: 9876,
      avgCostKgs: 5432,
      stores: [],
    });
  });

  it("HARD-A2-004 lets a manager create admin-only stock through a nested variant", async () => {
    const { org, store, baseUnit, managerUser } = await seedBase({ plan: "BUSINESS" });
    const caller = callerFor(managerUser);

    const created = await caller.products.create({
      name: "Nested stock authorization probe",
      storeId: store.id,
      baseUnitId: baseUnit.id,
      initialOnHand: 0,
      variants: [
        {
          name: "S",
          sku: `NESTED-${randomUUID().slice(0, 8)}`,
          attributes: { size: "S" },
          initialOnHand: 10,
        },
      ],
    });
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { productId: created.id },
    });
    const [snapshot, movements] = await Promise.all([
      prisma.inventorySnapshot.findUniqueOrThrow({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: created.id,
            variantKey: variant.id,
          },
        },
      }),
      prisma.stockMovement.findMany({
        where: {
          storeId: store.id,
          productId: created.id,
          variantId: variant.id,
          type: StockMovementType.ADJUSTMENT,
        },
      }),
    ]);

    expect(created.organizationId).toBe(org.id);
    expect(snapshot.onHand).toBe(10);
    expect(movements.map((movement) => movement.qtyDelta)).toEqual([10]);
    expect(movements[0]?.createdById).toBe(managerUser.id);
  });

  it("HARD-A2-005 applies identical create and percentage-price requests twice", async () => {
    const { org, store, baseUnit, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = callerFor(adminUser);
    const marker = `Replay ${randomUUID()}`;
    const createInput = {
      name: marker,
      storeId: store.id,
      baseUnitId: baseUnit.id,
      initialOnHand: 3,
    };

    const firstCreate = await caller.products.create(createInput);
    const secondCreate = await caller.products.create(createInput);
    const createdRows = await prisma.product.findMany({ where: { organizationId: org.id, name: marker } });
    const createdMovements = await prisma.stockMovement.findMany({
      where: { productId: { in: [firstCreate.id, secondCreate.id] }, type: "ADJUSTMENT" },
    });

    expect(firstCreate.id).not.toBe(secondCreate.id);
    expect(createdRows).toHaveLength(2);
    expect(createdMovements.map((movement) => movement.qtyDelta).sort()).toEqual([3, 3]);

    await prisma.storePrice.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        variantKey: "BASE",
        priceKgs: 100,
        updatedById: adminUser.id,
      },
    });
    const priceInput = {
      storeId: store.id,
      filter: { search: product.sku },
      mode: "increasePct" as const,
      value: 10,
    };
    await caller.storePrices.bulkUpdate(priceInput);
    await caller.storePrices.bulkUpdate(priceInput);

    const afterPrice = await prisma.storePrice.findUniqueOrThrow({
      where: {
        organizationId_storeId_productId_variantKey: {
          organizationId: org.id,
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    expect(Number(afterPrice.priceKgs)).toBe(121);
    expect(
      await prisma.idempotencyKey.count({
        where: { userId: adminUser.id, route: { in: ["products.create", "storePrices.bulkUpdate"] } },
      }),
    ).toBe(0);
  });

  it("HARD-A2-006 increments one stock-count scan twice when the request is replayed", async () => {
    const { store, product, managerUser } = await seedBase({ plan: "BUSINESS" });
    const caller = callerFor(managerUser);
    const count = await caller.stockCounts.create({ storeId: store.id, notes: "replay probe" });
    const scan = {
      stockCountId: count.id,
      storeId: store.id,
      barcodeOrQuery: product.sku,
      mode: "increment" as const,
      countedDelta: 1,
    };

    const first = await caller.stockCounts.addOrUpdateLineByScan(scan);
    const second = await caller.stockCounts.addOrUpdateLineByScan(scan);
    const durable = await prisma.stockCountLine.findUniqueOrThrow({
      where: {
        stockCountId_productId_variantKey: {
          stockCountId: count.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });

    expect(first.countedQty).toBe(1);
    expect(second.countedQty).toBe(2);
    expect(durable.countedQty).toBe(2);
    expect(await prisma.idempotencyKey.count({ where: { userId: managerUser.id } })).toBe(0);
  });

  it("HARD-A2-007 commits the first ten bulk stock updates before an invalid later chunk fails", async () => {
    const { org, store, baseUnit, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = callerFor(adminUser);
    const snapshotIds: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const product = await prisma.product.create({
        data: {
          organizationId: org.id,
          sku: `ATOMIC-${index}-${randomUUID().slice(0, 6)}`,
          name: `Atomicity product ${index}`,
          unit: baseUnit.code,
          baseUnitId: baseUnit.id,
          storeProducts: {
            create: {
              organizationId: org.id,
              storeId: store.id,
              isActive: true,
              assignedById: adminUser.id,
            },
          },
        },
      });
      const snapshot = await prisma.inventorySnapshot.create({
        data: { storeId: store.id, productId: product.id, variantKey: "BASE", onHand: index + 1 },
      });
      snapshotIds.push(snapshot.id);
    }
    const invalidEleventhId = randomUUID();
    const reason = `atomicity-${randomUUID()}`;

    await expect(
      caller.inventory.bulkSetOnHand({
        storeId: store.id,
        snapshotIds: [...snapshotIds, invalidEleventhId],
        targetOnHand: 77,
        reason,
        idempotencyKey: `a2-007-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "inventorySelectionInvalid" });

    const [afterSnapshots, movements, idempotencyRows] = await Promise.all([
      prisma.inventorySnapshot.findMany({
        where: { id: { in: snapshotIds } },
        orderBy: { id: "asc" },
      }),
      prisma.stockMovement.findMany({ where: { storeId: store.id, note: reason } }),
      prisma.idempotencyKey.findMany({
        where: { userId: adminUser.id, route: "inventory.bulkSetOnHand" },
      }),
    ]);
    expect(afterSnapshots).toHaveLength(10);
    expect(afterSnapshots.every((snapshot) => snapshot.onHand === 77)).toBe(true);
    expect(movements).toHaveLength(10);
    expect(idempotencyRows).toHaveLength(1);
    expect(idempotencyRows[0]?.key).toMatch(/:0$/);
  });

  it("HARD-A2-008 removes Store B preferences and the global category from a Store-A manager command", async () => {
    const { org, store, storeB, managerUser } = await seedTwoStoreScope();
    const marker = `Unused ${randomUUID()}`;
    const normalized = marker.toLocaleLowerCase();
    const category = await prisma.productCategory.create({
      data: { organizationId: org.id, name: marker },
    });
    await prisma.storeCategoryPreference.createMany({
      data: [store.id, storeB.id].map((storeId) => ({
        organizationId: org.id,
        storeId,
        name: marker,
        normalizedName: normalized,
      })),
    });
    const before = await prisma.storeCategoryPreference.count({
      where: { organizationId: org.id, normalizedName: normalized },
    });

    await callerFor(managerUser).productCategories.remove({ name: marker, storeId: store.id });

    expect(before).toBe(2);
    expect(
      await prisma.storeCategoryPreference.count({
        where: { organizationId: org.id, normalizedName: normalized },
      }),
    ).toBe(0);
    expect(await prisma.productCategory.findUnique({ where: { id: category.id } })).toBeNull();
  });
});
