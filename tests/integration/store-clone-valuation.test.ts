import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createStore } from "@/server/services/stores";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("store clone inventory valuation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects an unvalued source atomically, then copies only valued positive stock", async () => {
    const { org, store, product, supplier, baseUnit, adminUser } = await seedBase({
      plan: "BUSINESS",
    });
    const unvaluedProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "STORE-CLONE-UNVALUED",
        name: "Unvalued clone product",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
      },
    });
    const zeroStockProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "STORE-CLONE-ZERO",
        name: "Zero-stock clone product",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
      },
    });

    await prisma.inventorySnapshot.createMany({
      data: [
        {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
          onHand: 3,
          onOrder: 0,
        },
        {
          storeId: store.id,
          productId: unvaluedProduct.id,
          variantKey: "BASE",
          onHand: 2,
          onOrder: 0,
        },
        {
          storeId: store.id,
          productId: zeroStockProduct.id,
          variantKey: "BASE",
          onHand: 0,
          onOrder: 4,
        },
      ],
    });
    const valuationTimestamp = new Date();
    await prisma.productCost.createMany({
      data: [
        {
          organizationId: org.id,
          productId: product.id,
          variantKey: "BASE",
          avgCostKgs: 3.33,
          costBasisQty: 3,
          preciseAvgCostKgs: 3.33,
          preciseCostBasisQty: 3,
          costBasisValueKgs: 10,
          valuationStatus: "PRECISE",
          valuationUpdatedAt: valuationTimestamp,
          valuationLegacyUpdatedAt: valuationTimestamp,
          updatedAt: valuationTimestamp,
        },
        {
          organizationId: org.id,
          productId: zeroStockProduct.id,
          variantKey: "BASE",
          avgCostKgs: 7,
          costBasisQty: 4,
          costBasisValueKgs: 28,
        },
      ],
    });

    await expect(
      createStore({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "store-clone-reject-unvalued-inventory",
        name: "Rejected Unvalued Clone",
        code: "REJECTED-UNVALUED-CLONE",
        allowNegativeStock: false,
        trackExpiryLots: false,
        cloneFromStoreId: store.id,
        copyInventory: true,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "positiveStockUnitCostRequired",
    });
    await expect(
      prisma.store.findUnique({
        where: { organizationId_code: { organizationId: org.id, code: "REJECTED-UNVALUED-CLONE" } },
      }),
    ).resolves.toBeNull();

    await prisma.inventorySnapshot.delete({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: unvaluedProduct.id,
          variantKey: "BASE",
        },
      },
    });

    const cloned = await createStore({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "store-clone-valued-inventory",
      name: "Valued Clone",
      code: "VALUED-CLONE",
      allowNegativeStock: false,
      trackExpiryLots: false,
      cloneFromStoreId: store.id,
      copyInventory: true,
    });

    const [valuedCost, unvaluedCost, zeroStockCost, snapshots, movements] = await Promise.all([
      prisma.productCost.findUniqueOrThrow({
        where: {
          organizationId_productId_variantKey: {
            organizationId: org.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
      prisma.productCost.findUnique({
        where: {
          organizationId_productId_variantKey: {
            organizationId: org.id,
            productId: unvaluedProduct.id,
            variantKey: "BASE",
          },
        },
      }),
      prisma.productCost.findUniqueOrThrow({
        where: {
          organizationId_productId_variantKey: {
            organizationId: org.id,
            productId: zeroStockProduct.id,
            variantKey: "BASE",
          },
        },
      }),
      prisma.inventorySnapshot.findMany({
        where: { storeId: cloned.id },
        orderBy: { productId: "asc" },
      }),
      prisma.stockMovement.findMany({
        where: { referenceType: "STORE_CLONE", referenceId: cloned.id },
        orderBy: { productId: "asc" },
      }),
    ]);
    const movementByProductId = new Map(
      movements.map((movement) => [movement.productId, movement]),
    );

    expect(cloned.cloneSummary).toMatchObject({
      inventorySnapshots: 2,
      stockMovements: 1,
    });
    expect(snapshots).toHaveLength(2);
    expect(valuedCost).toMatchObject({
      preciseCostBasisQty: 6,
      valuationStatus: "PRECISE",
    });
    expect(Number(valuedCost.preciseAvgCostKgs)).toBe(3.33);
    expect(Number(valuedCost.costBasisValueKgs)).toBe(20);
    expect(unvaluedCost).toBeNull();
    expect(zeroStockCost).toMatchObject({ costBasisQty: 4 });
    expect(Number(zeroStockCost.costBasisValueKgs)).toBe(28);

    const valuedMovement = movementByProductId.get(product.id);
    expect(valuedMovement?.qtyDelta).toBe(3);
    expect(Number(valuedMovement?.unitCostKgs)).toBe(3.33);
    expect(Number(valuedMovement?.inventoryValueDeltaKgs)).toBe(10);

    expect(movementByProductId.has(unvaluedProduct.id)).toBe(false);
    expect(movementByProductId.has(zeroStockProduct.id)).toBe(false);
  });
});
