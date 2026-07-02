import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("admin metrics", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("aggregates inventory valuation and filters product rows by warnings and search", async () => {
    const { org, store, supplier, baseUnit, adminUser } = await seedBase({
      plan: "BUSINESS",
      allowNegativeStock: true,
    });
    const secondStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Second Store",
        code: "S2",
      },
    });

    const createStockedProduct = async ({
      sku,
      name,
      category,
      storeId,
      stockQty,
      salePriceKgs,
      costPriceKgs,
      barcode,
      minStock,
      hasImage = true,
      assignToStore = true,
    }: {
      sku: string;
      name: string;
      category: string;
      storeId: string;
      stockQty: number;
      salePriceKgs?: number;
      costPriceKgs?: number;
      barcode?: string;
      minStock?: number;
      hasImage?: boolean;
      assignToStore?: boolean;
    }) => {
      const product = await prisma.product.create({
        data: {
          organizationId: org.id,
          supplierId: supplier.id,
          sku,
          name,
          unit: baseUnit.code,
          baseUnitId: baseUnit.id,
          category,
          categories: [category],
          basePriceKgs:
            salePriceKgs === undefined ? undefined : new Prisma.Decimal(salePriceKgs),
          photoUrl: hasImage ? `https://img.test/${sku}.png` : undefined,
        },
      });

      if (assignToStore) {
        await prisma.storeProduct.create({
          data: {
            organizationId: org.id,
            storeId,
            productId: product.id,
            isActive: true,
          },
        });
      }

      if (costPriceKgs !== undefined) {
        await prisma.productCost.create({
          data: {
            organizationId: org.id,
            productId: product.id,
            variantKey: "BASE",
            avgCostKgs: new Prisma.Decimal(costPriceKgs),
          },
        });
      }

      if (barcode) {
        await prisma.productBarcode.create({
          data: {
            organizationId: org.id,
            productId: product.id,
            value: barcode,
          },
        });
      }

      if (minStock !== undefined) {
        await prisma.reorderPolicy.create({
          data: {
            storeId,
            productId: product.id,
            minStock,
            leadTimeDays: 1,
            reviewPeriodDays: 1,
            safetyStockDays: 1,
          },
        });
      }

      await prisma.inventorySnapshot.create({
        data: {
          storeId,
          productId: product.id,
          variantKey: "BASE",
          onHand: stockQty,
          allowNegativeStock: stockQty < 0,
        },
      });

      return product;
    };

    await createStockedProduct({
      sku: "APPLE-1",
      name: "Apple Juice",
      category: "Food",
      storeId: store.id,
      stockQty: 10,
      costPriceKgs: 100,
      salePriceKgs: 150,
    });
    await createStockedProduct({
      sku: "BANANA-1",
      name: "Banana Chips",
      category: "Food",
      storeId: store.id,
      stockQty: 3,
      salePriceKgs: 40,
      barcode: "BAN-BC-001",
      hasImage: false,
    });
    await createStockedProduct({
      sku: "CHERRY-1",
      name: "Cherry Jam",
      category: "Food",
      storeId: secondStore.id,
      stockQty: 4,
      costPriceKgs: 10,
    });
    await createStockedProduct({
      sku: "DELTA-1",
      name: "Delta Negative",
      category: "Food",
      storeId: store.id,
      stockQty: -2,
      costPriceKgs: 5,
      salePriceKgs: 8,
    });
    await createStockedProduct({
      sku: "LIME-1",
      name: "Low Lime",
      category: "Food",
      storeId: store.id,
      stockQty: 2,
      costPriceKgs: 10,
      salePriceKgs: 20,
      minStock: 5,
    });
    await createStockedProduct({
      sku: "UNASSIGNED-1",
      name: "Unassigned Stock",
      category: "Food",
      storeId: store.id,
      stockQty: 1,
      costPriceKgs: 1,
      salePriceKgs: 2,
      assignToStore: false,
    });
    await createStockedProduct({
      sku: "DAIRY-1",
      name: "Dairy Product",
      category: "Dairy",
      storeId: store.id,
      stockQty: 7,
      costPriceKgs: 20,
      salePriceKgs: 30,
    });

    const adminCaller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: adminUser.organizationId!,
    });

    const foodAtMainStore = await adminCaller.adminMetrics.get({
      storeId: store.id,
      category: "Food",
      page: 1,
      pageSize: 25,
    });

    expect(foodAtMainStore.inventory.summary.totalStockQty).toBe(14);
    expect(foodAtMainStore.inventory.summary.costValueKgs).toBe(1011);
    expect(foodAtMainStore.inventory.summary.retailValueKgs).toBe(1646);
    expect(foodAtMainStore.inventory.summary.potentialGrossProfitKgs).toBe(515);
    expect(foodAtMainStore.inventory.summary.warningCounts).toMatchObject({
      noCost: 1,
      noPrice: 0,
      noImage: 1,
      negativeStock: 1,
      lowStock: 1,
      unassigned: 1,
    });
    expect(foodAtMainStore.inventory.storeSummaries).toHaveLength(1);
    expect(foodAtMainStore.inventory.categorySummaries).toHaveLength(1);
    expect(foodAtMainStore.inventory.products.rows.map((row) => row.productName)).not.toContain(
      "Dairy Product",
    );

    const noCost = await adminCaller.adminMetrics.get({
      storeId: store.id,
      category: "Food",
      warning: "noCost",
      page: 1,
      pageSize: 25,
    });
    expect(noCost.inventory.products.rows).toHaveLength(1);
    expect(noCost.inventory.products.rows[0]?.productName).toBe("Banana Chips");

    const byBarcode = await adminCaller.adminMetrics.get({
      storeId: store.id,
      search: "BC-001",
      page: 1,
      pageSize: 25,
    });
    expect(byBarcode.inventory.products.rows.map((row) => row.productName)).toEqual([
      "Banana Chips",
    ]);

    const allFood = await adminCaller.adminMetrics.get({
      category: "Food",
      page: 1,
      pageSize: 25,
    });
    expect(allFood.inventory.storeSummaries.map((row) => row.storeName).sort()).toEqual([
      "Second Store",
      "Test Store",
    ]);
    expect(allFood.inventory.summary.warningCounts.noPrice).toBe(1);
  });
});
