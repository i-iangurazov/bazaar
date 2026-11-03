import { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { getProductsBootstrap } from "@/server/services/products/read";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("product search context and result isolation", () => {
  beforeEach(resetDatabase);

  it("keeps legacy results, prices, costs and stock identical without repeating metadata reads", async () => {
    const f = await seedBase({ plan: "ENTERPRISE" });
    await prisma.product.update({
      where: { id: f.product.id },
      data: { name: "Кран фланцевый", category: "Краны", basePriceKgs: 123 },
    });
    await prisma.storePrice.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        productId: f.product.id,
        priceKgs: 139.5,
      },
    });
    await prisma.productCost.create({
      data: {
        organizationId: f.org.id,
        productId: f.product.id,
        avgCostKgs: 52.75,
        costBasisQty: 12,
      },
    });
    await prisma.inventorySnapshot.create({
      data: { storeId: f.store.id, productId: f.product.id, onHand: 12, version: 3 },
    });
    const state = async () =>
      JSON.stringify(
        await Promise.all([
          prisma.product.findMany(),
          prisma.storeProduct.findMany(),
          prisma.storePrice.findMany(),
          prisma.productCost.findMany(),
          prisma.inventorySnapshot.findMany(),
          prisma.stockMovement.findMany(),
        ]),
      );
    const before = await state();
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const input = {
      storeId: f.store.id,
      search: "кран фланцевый",
      pageSize: 25,
      sortKey: "name" as const,
      sortDirection: "asc" as const,
    };
    const legacy = await caller.products.bootstrap(input);
    const context = await caller.products.listContext({ storeId: f.store.id });
    expect(context).toEqual({
      selectedStoreId: legacy.selectedStoreId,
      stores: legacy.stores,
      categories: legacy.categories,
    });
    const tracing = new PrismaClient({
      datasourceUrl: process.env.DATABASE_TEST_URL,
      log: [{ emit: "event", level: "query" }],
    });
    const queries: string[] = [];
    tracing.$on("query", (event) => queries.push(event.query));
    try {
      const lean = await getProductsBootstrap({
        prisma: tracing,
        organizationId: f.org.id,
        user: { ...f.adminUser, organizationId: f.org.id },
        input: { ...input, includeContext: false },
      });
      expect(lean.list).toEqual(legacy.list);
      expect(lean.list.items.map((p) => p.id)).toEqual([f.product.id]);
      expect(lean).toMatchObject({ stores: [], categories: [], selectedStoreId: f.store.id });
      expect(queries.length).toBeGreaterThan(0);
      expect(queries.some((q) => q.includes('FROM "public"."ProductCategory"'))).toBe(false);
      expect(queries.some((q) => q.includes('FROM "public"."CategoryAttributeTemplate"'))).toBe(
        false,
      );
      expect(
        queries.some(
          (q) =>
            q.includes('"Store"."printerSettings"') ||
            q.includes('"Store"."enableSimilarProductCheck"'),
        ),
      ).toBe(false);
    } finally {
      await tracing.$disconnect();
    }
    expect(await state()).toBe(before);
  });

  it("preserves accessible-store fallback, all-store scope and organization boundaries for each role", async () => {
    const f = await seedBase({ plan: "ENTERPRISE" });
    const hidden = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Hidden", code: "HID" },
    });
    const hiddenProduct = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        sku: "HIDDEN",
        name: "Hidden product",
        unit: f.baseUnit.code,
        baseUnitId: f.baseUnit.id,
        storeProducts: { create: { organizationId: f.org.id, storeId: hidden.id, isActive: true } },
      },
    });
    const foreignOrg = await prisma.organization.create({ data: { name: "Foreign" } });
    const foreignStore = await prisma.store.create({
      data: { organizationId: foreignOrg.id, name: "Foreign", code: "F" },
    });
    for (const user of [f.managerUser, f.staffUser, f.cashierUser]) {
      const caller = createTestCaller({ ...user, organizationId: f.org.id });
      const context = await caller.products.listContext({ storeId: hidden.id });
      expect(context.stores.map((s) => s.id)).toEqual([f.store.id]);
      expect(context.selectedStoreId).toBe(f.store.id);
      expect((await caller.products.bootstrap()).selectedStoreId).toBe(f.store.id);
      const all = await caller.products.bootstrap({ storeId: "all", includeContext: false });
      expect(all.selectedStoreId).toBeNull();
      expect(all.list.items.map((p) => p.id)).toEqual([f.product.id]);
      await expect(
        caller.products.bootstrap({ storeId: hidden.id, includeContext: false }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.products.bootstrap({ storeId: foreignStore.id, includeContext: false }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const admin = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    expect((await admin.products.listContext({ storeId: "all" })).selectedStoreId).toBeNull();
    expect(
      (await admin.products.bootstrap({ storeId: "all", includeContext: false })).list.items
        .map((p) => p.id)
        .sort(),
    ).toEqual([f.product.id, hiddenProduct.id].sort());
    await expect(
      admin.products.bootstrap({ storeId: foreignStore.id, includeContext: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(admin.products.bootstrap({ includeContext: false })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(createTestCaller().products.listContext()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("reloads metadata changes independently and retains the legacy default contract", async () => {
    const f = await seedBase({ plan: "ENTERPRISE" });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const before = await caller.products.listContext();
    expect(before.selectedStoreId).toBe(f.store.id);
    await prisma.store.update({
      where: { id: f.store.id },
      data: { enableBarcode: false, currencyCode: "USD", currencyRateKgsPerUnit: 87.5 },
    });
    await caller.productCategories.create({ name: "Новая категория", storeId: f.store.id });
    const after = await caller.products.listContext();
    expect(after.categories).toContain("Новая категория");
    expect(after.stores[0]).toMatchObject({
      enableBarcode: false,
      currencyCode: "USD",
      currencyRateKgsPerUnit: 87.5,
    });
    const legacy = await caller.products.bootstrap();
    expect(legacy.stores).toEqual(after.stores);
    expect(legacy.categories).toEqual(after.categories);
    expect(legacy.list.items.map((p) => p.id)).toEqual([f.product.id]);
  });
});
