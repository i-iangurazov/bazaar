import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createProduct } from "@/server/services/products";
import { adjustStock } from "@/server/services/inventory";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";
import type { PriceBookChangeInput } from "@/lib/priceBookContract";

(shouldRunDbTests ? describe : describe.skip)("10,000 products / 10 stores", () => {
  beforeEach(resetDatabase);
  it("keeps full/selected/future assortment and stock independent, publishes 100,000 prices atomically and rolls back", async () => {
    const measurements: Record<string, number> = {};
    const memorySamples: Array<{ stage: string; heapMiB: number; rssMiB: number }> = [];
    async function measure<T>(name: string, run: () => Promise<T>) {
      const start = performance.now();
      const result = await run();
      measurements[name] = Math.round(performance.now() - start);
      const memory = process.memoryUsage();
      memorySamples.push({
        stage: name,
        heapMiB: Math.round(memory.heapUsed / 1024 ** 2),
        rssMiB: Math.round(memory.rss / 1024 ** 2),
      });
      console.log(
        JSON.stringify({ stage: name, milliseconds: measurements[name], ...memorySamples.at(-1) }),
      );
      return result;
    }
    const f = await seedBase({ plan: "ENTERPRISE", allowNegativeStock: true });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { retailWholesaleEnabled: true },
    });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const stores = [f.store];
    for (let i = 1; i < 10; i++)
      stores.push(
        await prisma.store.create({
          data: {
            organizationId: f.org.id,
            code: `S${i}`,
            name: `Store ${i}`,
            allowNegativeStock: true,
          },
        }),
      );
    const productIds = [f.product.id, ...Array.from({ length: 9999 }, () => randomUUID())];
    await measure("seedProductsMs", async () => {
      for (let start = 1; start < productIds.length; start += 1000)
        await prisma.product.createMany({
          data: productIds.slice(start, start + 1000).map((id, i) => ({
            id,
            organizationId: f.org.id,
            name: `Scale ${start + i}`,
            sku: `SCALE-${start + i}`,
            unit: f.baseUnit.code,
            baseUnitId: f.baseUnit.id,
            basePriceKgs: 100,
          })),
        });
      await prisma.storeProduct.updateMany({
        where: { storeId: f.store.id },
        data: { isDirect: true, isHistorical: false },
      });
      for (let start = 1; start < productIds.length; start += 1000)
        await prisma.storeProduct.createMany({
          data: productIds.slice(start, start + 1000).map((productId) => ({
            organizationId: f.org.id,
            storeId: f.store.id,
            productId,
            isDirect: true,
            isActive: true,
          })),
        });
    });
    // Fresh synthetic bulk inserts need planner statistics; real stores retain theirs.
    await prisma.$executeRawUnsafe('ANALYZE "Product", "StoreProduct"');
    await measure("fullAssortmentNineRecipientsMs", async () => {
      for (const store of stores.slice(1)) {
        const data = await caller.stores.catalogSettings({ storeId: store.id });
        const change = {
          ...data.settings!,
          connections: [
            { key: `store:${f.store.id}`, enabled: true, scope: "ALL" as const, productIds: [] },
          ],
        };
        const preview = await caller.stores.previewCatalogSettings(change);
        await caller.stores.saveCatalogSettings({
          change,
          token: preview.token,
          idempotencyKey: randomUUID(),
        });
      }
    });
    expect(
      await prisma.storeProduct.count({ where: { organizationId: f.org.id, isActive: true } }),
    ).toBe(100_000);
    const book = await caller.priceBooks.create({ name: "Scale shared prices" });
    async function apply(change: PriceBookChangeInput, label: string) {
      const preview = await measure(`${label}PreviewMs`, () =>
        caller.priceBooks.preview({ bookId: book.id, change }),
      );
      const request = {
        bookId: book.id,
        change,
        token: preview.token,
        idempotencyKey: randomUUID(),
      };
      const result = await measure(`${label}ApplyMs`, () => caller.priceBooks.publish(request));
      return { preview, request, result };
    }
    await apply(
      {
        kind: "PRICES",
        entries: productIds.map((productId) => ({
          productId,
          retailPriceKgs: 100,
          wholesalePriceKgs: 80,
        })),
      },
      "initialList",
    );
    const connected = await apply(
      { kind: "CONNECT", storeIds: stores.map((s) => s.id), preserveLocal: true },
      "connectTenStores",
    );
    expect(connected.preview.changedPositions).toBe(100_000);
    expect(await prisma.storePrice.count()).toBe(100_000);
    expect(await prisma.priceBookStoreItem.count()).toBe(100_000);
    expect(await prisma.inventorySnapshot.count()).toBe(0);
    await adjustStock({
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      requestId: randomUUID(),
      storeId: f.store.id,
      productId: f.product.id,
      qtyDelta: 7,
      reason: "Scale stock isolation",
      idempotencyKey: randomUUID(),
    });
    const beforeStock = await prisma.inventorySnapshot.findMany({ orderBy: { id: "asc" } });
    await caller.storePrices.upsert({
      storeId: stores[1].id,
      productId: productIds[1],
      priceKgs: 0,
    });
    const bulk = await caller.priceBooks.prepareBulk({
      bookId: book.id,
      kind: "RETAIL",
      mode: "PERCENT",
      value: 10,
    });
    const changed = await apply(bulk, "bulkTenThousand");
    expect(changed.preview.changedPositions).toBe(99_999);
    expect(changed.preview.listChangedPositions).toBe(10_000);
    expect(await prisma.storePrice.count({ where: { priceKgs: 110 } })).toBe(99_999);
    expect(await prisma.storePrice.count({ where: { priceKgs: 0 } })).toBe(1);
    expect(await caller.priceBooks.publish(changed.request)).toEqual(changed.result);
    expect(await prisma.inventorySnapshot.findMany({ orderBy: { id: "asc" } })).toEqual(
      beforeStock,
    );
    await apply({ kind: "ROLLBACK", changeId: changed.result.changeId }, "bulkRollback");
    expect(await prisma.storePrice.count({ where: { priceKgs: 100 } })).toBe(99_999);
    expect(await prisma.storePrice.count({ where: { priceKgs: 0 } })).toBe(1);
    await measure("oneProductPreviewMs", () =>
      caller.priceBooks.preview({
        bookId: book.id,
        change: {
          kind: "PRICES",
          entries: [{ productId: productIds[2], retailPriceKgs: 101, wholesalePriceKgs: 80 }],
        },
      }),
    );
    await measure("productPageMs", () =>
      caller.products.list({
        storeId: stores[1].id,
        page: 1,
        pageSize: 50,
        sortKey: "salePrice",
        sortDirection: "asc",
      }),
    );
    const selectedStore = stores[9];
    const selectedData = await caller.stores.catalogSettings({ storeId: selectedStore.id });
    const selection = {
      ...selectedData.settings!,
      connections: [
        {
          key: `store:${f.store.id}`,
          enabled: true,
          scope: "SELECTED" as const,
          productIds: productIds.slice(0, 5),
        },
      ],
    };
    const preview = await caller.stores.previewCatalogSettings(selection);
    await caller.stores.saveCatalogSettings({
      change: selection,
      token: preview.token,
      idempotencyKey: randomUUID(),
    });
    const future = await measure("futureProductMs", () =>
      createProduct({
        organizationId: f.org.id,
        actorId: f.adminUser.id,
        requestId: randomUUID(),
        storeId: f.store.id,
        name: "Future scale product",
        sku: "FUTURE-SCALE",
        baseUnitId: f.baseUnit.id,
        basePriceKgs: 150,
        barcodes: [],
      }),
    );
    expect(
      await prisma.storeProduct.count({ where: { productId: future.id, isActive: true } }),
    ).toBe(9);
    expect(
      await prisma.storeProduct.count({
        where: { productId: future.id, storeId: selectedStore.id, isActive: true },
      }),
    ).toBe(0);
    expect(
      await prisma.storeProduct.count({ where: { storeId: selectedStore.id, isActive: true } }),
    ).toBe(5);
    const afterFuture = await prisma.inventorySnapshot.findMany({ orderBy: { id: "asc" } });
    expect(afterFuture.filter((s) => s.productId !== future.id)).toEqual(beforeStock);
    // Creation initializes only the source product with a zero snapshot; sharing creates no recipient stock.
    expect(
      afterFuture
        .filter((s) => s.productId === future.id)
        .every(
          (s) => s.storeId === f.store.id && Number(s.onHand) === 0 && Number(s.onOrder) === 0,
        ),
    ).toBe(true);
    expect(await prisma.priceBookEntry.count({ where: { productId: future.id } })).toBe(0); // Explicit price publication, independent of assortment.
    await mkdir("artifacts/catalog-pricing-20261029", { recursive: true });
    await writeFile(
      "artifacts/catalog-pricing-20261029/price-book-scale-measurements.json",
      JSON.stringify(
        {
          products: 10_000,
          stores: 10,
          measurements,
          memorySamples,
          nodeOptions: process.env.NODE_OPTIONS ?? "default",
          providerCalls: 0,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(measurements));
  }, 600_000);
});
