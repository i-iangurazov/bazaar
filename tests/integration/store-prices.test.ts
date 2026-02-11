import { beforeEach, describe, expect, it } from "vitest";

import { createProduct } from "@/server/services/products";
import { bulkUpdateStorePrices, upsertStorePrice } from "@/server/services/storePrices";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("store prices", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns effective price with store overrides", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase();

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-store-price-product",
      sku: "PRICE-1",
      name: "Price Product",
      baseUnitId: baseUnit.id,
      basePriceKgs: 100,
    });

    await upsertStorePrice({
      storeId: store.id,
      productId: product.id,
      priceKgs: 120,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-store-price-upsert",
    });

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const list = await caller.products.list({ storeId: store.id });
    const row = list.items.find((item) => item.id === product.id);

    expect(row?.effectivePriceKgs).toBe(120);
    expect(row?.priceOverridden).toBe(true);
  });

  it("bulk updates store prices based on base price", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase();

    const productA = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-bulk-price-a",
      sku: "BULK-1",
      name: "Bulk Product A",
      baseUnitId: baseUnit.id,
      basePriceKgs: 50,
    });

    const productB = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-bulk-price-b",
      sku: "BULK-2",
      name: "Bulk Product B",
      baseUnitId: baseUnit.id,
      basePriceKgs: 100,
    });

    const result = await bulkUpdateStorePrices({
      storeId: store.id,
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-bulk-price",
      mode: "increasePct",
      value: 10,
    });

    expect(result.updated).toBeGreaterThanOrEqual(2);

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const list = await caller.products.list({ storeId: store.id });
    const rowA = list.items.find((item) => item.id === productA.id);
    const rowB = list.items.find((item) => item.id === productB.id);

    expect(rowA?.effectivePriceKgs).toBeCloseTo(55, 2);
    expect(rowB?.effectivePriceKgs).toBeCloseTo(110, 2);
  });
});
