import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("HARD-A2-014 bounded history lists", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("paginates stock counts in stable order within the authorized store", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const baseTime = Date.UTC(2026, 7, 1, 0, 0, 0);
    await prisma.stockCount.createMany({
      data: Array.from({ length: 61 }, (_, index) => ({
        organizationId: org.id,
        storeId: store.id,
        code: `SC-${String(index).padStart(3, "0")}`,
        createdById: adminUser.id,
        createdAt: new Date(baseTime + index * 1_000),
        updatedAt: new Date(baseTime + index * 1_000),
      })),
    });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const page = await caller.stockCounts.list({ storeId: store.id, page: 2, pageSize: 10 });

    expect(page).toMatchObject({ total: 61, page: 2, pageSize: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.items.map((item) => item.code)).toEqual(
      Array.from({ length: 10 }, (_, offset) => `SC-${String(50 - offset).padStart(3, "0")}`),
    );
  });

  it("paginates only the requested import type and never transfers other organizations", async () => {
    const { org, adminUser } = await seedBase({ plan: "BUSINESS" });
    const otherOrg = await prisma.organization.create({ data: { name: "Other import org" } });
    const baseTime = Date.UTC(2026, 7, 2, 0, 0, 0);
    await prisma.importBatch.createMany({
      data: [
        ...Array.from({ length: 63 }, (_, index) => ({
          id: randomUUID(),
          organizationId: org.id,
          type: "products",
          createdById: adminUser.id,
          createdAt: new Date(baseTime + index * 1_000),
          summary: { rows: index + 1 },
        })),
        ...Array.from({ length: 7 }, (_, index) => ({
          id: randomUUID(),
          organizationId: org.id,
          type: "customers",
          createdById: adminUser.id,
          createdAt: new Date(baseTime + index * 1_000),
        })),
        ...Array.from({ length: 5 }, (_, index) => ({
          id: randomUUID(),
          organizationId: otherOrg.id,
          type: "products",
          createdAt: new Date(baseTime + index * 1_000),
        })),
      ],
    });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const page = await caller.imports.list({ type: "products", page: 3, pageSize: 20 });
    const lastPage = await caller.imports.list({ type: "products", page: 4, pageSize: 20 });

    expect(page).toMatchObject({ total: 63, page: 3, pageSize: 20 });
    expect(page.items).toHaveLength(20);
    expect(
      page.items.every((item) => item.organizationId === org.id && item.type === "products"),
    ).toBe(true);
    expect(lastPage.items).toHaveLength(3);
  });

  it("paginates computed product stock without loading the full matching catalog", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase({ plan: "BUSINESS" });
    const productRows = Array.from({ length: 600 }, (_, index) => ({
      id: randomUUID(),
      organizationId: org.id,
      sku: `BOUND-${String(index).padStart(3, "0")}`,
      name: `Bounded product ${String(index).padStart(3, "0")}`,
      unit: baseUnit.code,
      baseUnitId: baseUnit.id,
      basePriceKgs: index + 1,
    }));
    await prisma.product.createMany({ data: productRows });
    await prisma.storeProduct.createMany({
      data: productRows.map((product) => ({
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        isActive: true,
      })),
    });
    await prisma.inventorySnapshot.createMany({
      data: productRows.map((product, index) => ({
        storeId: store.id,
        productId: product.id,
        variantKey: "BASE",
        onHand: index,
        onOrder: 0,
      })),
    });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const startedAt = performance.now();
    const page = await caller.products.list({
      storeId: store.id,
      page: 3,
      pageSize: 10,
      sortKey: "onHandQty",
      sortDirection: "desc",
    });
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;

    expect(page).toMatchObject({ total: 601, page: 3, pageSize: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.items.map((item) => item.onHandQty)).toEqual(
      Array.from({ length: 10 }, (_, offset) => 579 - offset),
    );
    for (const sortKey of ["category", "unit", "avgCost", "barcodes", "stores"] as const) {
      const advancedPage = await caller.products.list({
        page: 2,
        pageSize: 10,
        sortKey,
        sortDirection: "asc",
      });
      expect(advancedPage).toMatchObject({ total: 601, page: 2, pageSize: 10 });
      expect(advancedPage.items).toHaveLength(10);
    }
    console.info(
      JSON.stringify({
        evidence: "HARD-A2-014-products",
        matchingRows: page.total,
        transferredRows: page.items.length,
        durationMs,
      }),
    );
  });

  it("sorts store prices by the same active discount-effective values returned to the UI", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase({ plan: "BUSINESS" });
    const products = [
      {
        id: randomUUID(),
        organizationId: org.id,
        sku: "DISCOUNT-SORT-A",
        name: "Discount Sort A",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: 100,
      },
      {
        id: randomUUID(),
        organizationId: org.id,
        sku: "DISCOUNT-SORT-B",
        name: "Discount Sort B",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: 60,
      },
    ];
    await prisma.product.createMany({ data: products });
    await prisma.storeProduct.createMany({
      data: products.map((product) => ({
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        isActive: true,
      })),
    });
    await prisma.storePrice.createMany({
      data: [
        {
          organizationId: org.id,
          storeId: store.id,
          productId: products[0]!.id,
          variantKey: "BASE",
          priceKgs: 100,
          discountType: "PERCENTAGE",
          discountPercentage: 50,
          discountStartsAt: new Date(Date.now() - 60_000),
          discountEndsAt: new Date(Date.now() + 60_000),
        },
        {
          organizationId: org.id,
          storeId: store.id,
          productId: products[1]!.id,
          variantKey: "BASE",
          priceKgs: 60,
        },
      ],
    });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const page = await caller.products.list({
      storeId: store.id,
      search: "Discount Sort",
      page: 1,
      pageSize: 10,
      sortKey: "salePrice",
      sortDirection: "asc",
    });

    expect(page.items.map((item) => [item.sku, item.effectivePriceKgs])).toEqual([
      ["DISCOUNT-SORT-A", 50],
      ["DISCOUNT-SORT-B", 60],
    ]);
  });

  it("paginates inventory policy and forecast sorts before enrichment", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase({ plan: "BUSINESS" });
    const productRows = Array.from({ length: 650 }, (_, index) => ({
      id: randomUUID(),
      organizationId: org.id,
      sku: `INV-BOUND-${String(index).padStart(3, "0")}`,
      name: `Inventory bounded ${String(index).padStart(3, "0")}`,
      unit: baseUnit.code,
      baseUnitId: baseUnit.id,
    }));
    await prisma.product.createMany({ data: productRows });
    await prisma.storeProduct.createMany({
      data: productRows.map((product) => ({
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        isActive: true,
      })),
    });
    await prisma.inventorySnapshot.createMany({
      data: productRows.map((product) => ({
        storeId: store.id,
        productId: product.id,
        variantKey: "BASE",
        onHand: 0,
        onOrder: 0,
      })),
    });
    await prisma.reorderPolicy.createMany({
      data: productRows.map((product, index) => ({
        storeId: store.id,
        productId: product.id,
        minStock: index,
        leadTimeDays: 1,
        reviewPeriodDays: 0,
        safetyStockDays: 0,
      })),
    });
    await prisma.forecastSnapshot.createMany({
      data: productRows.map((product, index) => ({
        storeId: store.id,
        productId: product.id,
        p50Daily: index + 1,
        p90Daily: index + 1,
        horizonDays: 30,
      })),
    });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const minStockStartedAt = performance.now();
    const minStockPage = await caller.inventory.list({
      storeId: store.id,
      page: 2,
      pageSize: 10,
      sortKey: "minStock",
      sortDirection: "desc",
    });
    const minStockDurationMs = Math.round((performance.now() - minStockStartedAt) * 100) / 100;
    const suggestionStartedAt = performance.now();
    const suggestionPage = await caller.inventory.list({
      storeId: store.id,
      page: 2,
      pageSize: 10,
      sortKey: "suggestedOrder",
      sortDirection: "desc",
    });
    const suggestionDurationMs = Math.round((performance.now() - suggestionStartedAt) * 100) / 100;

    expect(minStockPage).toMatchObject({ total: 650, page: 2, pageSize: 10 });
    expect(minStockPage.items).toHaveLength(10);
    expect(minStockPage.items.map((item) => item.minStock)).toEqual(
      Array.from({ length: 10 }, (_, offset) => 639 - offset),
    );
    expect(suggestionPage.items).toHaveLength(10);
    expect(suggestionPage.items.map((item) => item.reorder?.suggestedOrderQty)).toEqual(
      Array.from({ length: 10 }, (_, offset) => 640 - offset),
    );
    console.info(
      JSON.stringify({
        evidence: "HARD-A2-014-inventory",
        matchingRows: minStockPage.total,
        transferredRows: minStockPage.items.length,
        minStockDurationMs,
        suggestionDurationMs,
      }),
    );
  });
});
