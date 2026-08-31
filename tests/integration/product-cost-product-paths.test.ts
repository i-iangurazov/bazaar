import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createProduct, duplicateProduct, importProducts } from "@/server/services/products";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const baseCostKey = (organizationId: string, productId: string) => ({
  organizationId_productId_variantKey: {
    organizationId,
    productId,
    variantKey: "BASE",
  },
});

describeDb("product-service cost paths", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("values initial variant stock and atomically rejects opening stock without an explicit cost", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase({ plan: "BUSINESS" });
    const valued = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "product-cost-variant-initial-valued",
      sku: "COST-VARIANT-VALUED",
      name: "Costed variants",
      baseUnitId: baseUnit.id,
      storeId: store.id,
      avgCostKgs: 80.46,
      variants: [
        { name: "Large", attributes: { size: "L" }, initialOnHand: 5 },
        { name: "Small", attributes: { size: "S" }, initialOnHand: 2 },
      ],
    });
    const valuedVariants = await prisma.productVariant.findMany({
      where: { productId: valued.id },
      orderBy: { name: "asc" },
    });
    const valuedCosts = await prisma.productCost.findMany({
      where: { productId: valued.id, variantId: { not: null } },
    });
    const valuedMovements = await prisma.stockMovement.findMany({
      where: { productId: valued.id, variantId: { not: null } },
    });
    const costByVariantId = new Map(valuedCosts.map((cost) => [cost.variantId, cost]));
    const movementByVariantId = new Map(
      valuedMovements.map((movement) => [movement.variantId, movement]),
    );

    for (const variant of valuedVariants) {
      const expectedQuantity = variant.name === "Large" ? 5 : 2;
      const expectedValue = expectedQuantity * 80.46;
      const cost = costByVariantId.get(variant.id);
      const movement = movementByVariantId.get(variant.id);
      expect(cost).toMatchObject({
        preciseCostBasisQty: expectedQuantity,
        valuationStatus: "PRECISE",
      });
      expect(Number(cost?.preciseAvgCostKgs)).toBe(80.46);
      expect(Number(cost?.costBasisValueKgs)).toBeCloseTo(expectedValue, 6);
      expect(movement).toMatchObject({ qtyDelta: expectedQuantity });
      expect(Number(movement?.unitCostKgs)).toBe(80.46);
      expect(Number(movement?.inventoryValueDeltaKgs)).toBeCloseTo(expectedValue, 6);
    }

    await expect(
      createProduct({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "product-cost-variant-initial-costless",
        sku: "COST-VARIANT-COSTLESS",
        name: "Costless variant",
        baseUnitId: baseUnit.id,
        storeId: store.id,
        variants: [{ name: "Only", initialOnHand: 3 }],
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "openingStockUnitCostRequired",
    });
    await expect(
      prisma.product.findUnique({
        where: {
          organizationId_sku: {
            organizationId: org.id,
            sku: "COST-VARIANT-COSTLESS",
          },
        },
      }),
    ).resolves.toBeNull();
  });

  it("keeps import add and set movements signed and reconciled to the product cost basis", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase({ plan: "BUSINESS" });
    const row = {
      sku: "COST-IMPORT-1",
      name: "Cost import",
      unit: baseUnit.code,
    };

    await importProducts({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "product-cost-import-create",
      storeId: store.id,
      stockBehavior: "set",
      rows: [{ ...row, stockQty: 10, avgCostKgs: 12.34 }],
    });
    const product = await prisma.product.findUniqueOrThrow({
      where: { organizationId_sku: { organizationId: org.id, sku: row.sku } },
    });

    await importProducts({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "product-cost-import-add",
      storeId: store.id,
      stockBehavior: "add",
      rows: [{ ...row, stockQty: 4, avgCostKgs: 20 }],
    });
    await importProducts({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "product-cost-import-set-lower",
      storeId: store.id,
      stockBehavior: "set",
      rows: [{ ...row, stockQty: 6, avgCostKgs: 15 }],
    });
    await importProducts({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "product-cost-import-add-current-wac",
      storeId: store.id,
      stockBehavior: "add",
      rows: [{ ...row, stockQty: 2 }],
    });

    const [snapshot, cost, movements] = await Promise.all([
      prisma.inventorySnapshot.findUniqueOrThrow({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
      prisma.productCost.findUniqueOrThrow({ where: baseCostKey(org.id, product.id) }),
      prisma.stockMovement.findMany({
        where: { productId: product.id, referenceType: "IMPORT" },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    expect(snapshot.onHand).toBe(8);
    expect({
      quantity: cost.preciseCostBasisQty,
      valueKgs: Number(cost.costBasisValueKgs),
      averageKgs: Number(cost.preciseAvgCostKgs),
    }).toEqual({ quantity: 8, valueKgs: 120, averageKgs: 15 });
    expect(
      movements
        .map((movement) => ({
          quantity: movement.qtyDelta,
          valueKgs: Number(movement.inventoryValueDeltaKgs),
        }))
        .sort((left, right) => left.quantity - right.quantity),
    ).toEqual([
      { quantity: -8, valueKgs: -120 },
      { quantity: 2, valueKgs: 30 },
      { quantity: 4, valueKgs: 80 },
      { quantity: 10, valueKgs: 123.4 },
    ]);

    await expect(
      importProducts({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "product-cost-import-costless",
        storeId: store.id,
        stockBehavior: "set",
        rows: [
          {
            sku: "COST-IMPORT-COSTLESS",
            name: "Costless import",
            unit: baseUnit.code,
            stockQty: 3,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "positiveStockUnitCostRequired",
    });
    await expect(
      prisma.product.findUnique({
        where: {
          organizationId_sku: { organizationId: org.id, sku: "COST-IMPORT-COSTLESS" },
        },
      }),
    ).resolves.toBeNull();
  });

  it("bases duplicated costs on copied snapshots and retains only display cost without inventory", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase({ plan: "BUSINESS" });
    const secondStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Duplicate cost branch",
        code: "DUP-COST-BRANCH",
      },
    });
    const source = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "product-cost-duplicate-source",
      sku: "COST-DUPLICATE-SOURCE",
      name: "Duplicate cost source",
      baseUnitId: baseUnit.id,
      storeId: store.id,
      avgCostKgs: 10.25,
      initialOnHand: 3,
      variants: [
        { name: "Large", initialOnHand: 5 },
        { name: "Small", initialOnHand: 2 },
      ],
    });
    const sourceVariants = await prisma.productVariant.findMany({
      where: { productId: source.id },
      orderBy: { name: "asc" },
    });
    const sourceLarge = sourceVariants.find((variant) => variant.name === "Large")!;
    const sourceSmall = sourceVariants.find((variant) => variant.name === "Small")!;
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: secondStore.id,
        productId: source.id,
        assignedById: adminUser.id,
      },
    });
    await prisma.inventorySnapshot.createMany({
      data: [
        { storeId: secondStore.id, productId: source.id, variantKey: "BASE", onHand: 4 },
        {
          storeId: secondStore.id,
          productId: source.id,
          variantId: sourceLarge.id,
          variantKey: sourceLarge.id,
          onHand: 11,
        },
        {
          storeId: secondStore.id,
          productId: source.id,
          variantId: sourceSmall.id,
          variantKey: sourceSmall.id,
          onHand: 7,
        },
      ],
    });

    const duplicate = await duplicateProduct({
      idempotencyKey: "product-cost-duplicate-valued",
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "product-cost-duplicate-valued",
      productId: source.id,
      name: "Duplicate cost target",
      copyInventory: true,
      copyCost: true,
      copyVariants: true,
    });
    const targetVariants = await prisma.productVariant.findMany({
      where: { productId: duplicate.productId },
    });
    const targetVariantByName = new Map(targetVariants.map((variant) => [variant.name, variant]));
    const targetCosts = await prisma.productCost.findMany({
      where: { productId: duplicate.productId },
    });
    const targetCostByKey = new Map(targetCosts.map((cost) => [cost.variantKey, cost]));
    const targetLarge = targetVariantByName.get("Large")!;
    const targetSmall = targetVariantByName.get("Small")!;

    expect({
      quantity: targetCostByKey.get("BASE")?.preciseCostBasisQty,
      valueKgs: Number(targetCostByKey.get("BASE")?.costBasisValueKgs),
    }).toEqual({ quantity: 7, valueKgs: 71.75 });
    expect({
      quantity: targetCostByKey.get(targetLarge.id)?.preciseCostBasisQty,
      valueKgs: Number(targetCostByKey.get(targetLarge.id)?.costBasisValueKgs),
    }).toEqual({ quantity: 16, valueKgs: 164 });
    expect({
      quantity: targetCostByKey.get(targetSmall.id)?.preciseCostBasisQty,
      valueKgs: Number(targetCostByKey.get(targetSmall.id)?.costBasisValueKgs),
    }).toEqual({ quantity: 9, valueKgs: 92.25 });

    const targetMovements = await prisma.stockMovement.findMany({
      where: { productId: duplicate.productId, referenceType: "PRODUCT_DUPLICATE" },
    });
    expect(targetMovements).toHaveLength(6);
    expect(
      targetMovements.every(
        (movement) => Number(movement.inventoryValueDeltaKgs) === movement.qtyDelta * 10.25,
      ),
    ).toBe(true);

    const costOnly = await duplicateProduct({
      idempotencyKey: "product-cost-duplicate-cost-only",
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "product-cost-duplicate-cost-only",
      productId: source.id,
      name: "Duplicate cost only",
      copyInventory: false,
      copyCost: true,
      copyVariants: true,
    });
    const costOnlyRows = await prisma.productCost.findMany({
      where: { productId: costOnly.productId },
    });
    expect(costOnlyRows).toHaveLength(3);
    expect(
      costOnlyRows.every(
        (cost) =>
          cost.preciseCostBasisQty === 0 &&
          Number(cost.costBasisValueKgs) === 0 &&
          Number(cost.preciseAvgCostKgs) === 10.25,
      ),
    ).toBe(true);
  });
});
