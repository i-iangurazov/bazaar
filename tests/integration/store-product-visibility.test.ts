import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { assignProductToStore } from "@/server/services/storeAccess";
import { assertSaleAssortment } from "@/server/services/assortmentPolicy";
import * as audit from "@/server/services/audit";
import { syncProductCatalogAssignments } from "@/server/services/productCatalogs";
import type { CatalogSettings } from "@/server/services/catalogSources";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

(shouldRunDbTests ? describe : describe.skip)("store product visibility", () => {
  beforeEach(resetDatabase);
  async function fixture() {
    const f = await seedBase({ plan: "ENTERPRISE" });
    const b = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Warehouse", code: "WH" },
    });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const product = await caller.products.create({
      idempotencyKey: randomUUID(),
      name: "Shared adapter",
      sku: "SHARED",
      storeId: f.store.id,
      baseUnitId: f.baseUnit.id,
      basePriceKgs: 100,
      avgCostKgs: 20,
      initialOnHand: 12,
      barcodes: ["SHARED-ADAPTER"],
    });
    const settings = async (storeId = b.id) =>
      (await caller.stores.catalogSettings({ storeId })).settings!;
    const save = async (change: CatalogSettings) => {
      const preview = await caller.stores.previewCatalogSettings(change);
      await caller.stores.saveCatalogSettings({
        change,
        token: preview.token,
        idempotencyKey: randomUUID(),
      });
      return preview;
    };
    const change = await settings();
    change.connections.push({
      key: `store:${f.store.id}`,
      enabled: true,
      scope: "ALL",
      productIds: [],
    });
    await save(change);
    const visibility = (storeId: string, hidden: boolean, ids = [product.id]) =>
      caller.products.setStoreVisibility({ storeId, productIds: ids, hidden });
    const visible = async (
      storeId: string,
      extra: { includeArchived?: boolean; sortKey?: "onHandQty" } = {},
    ) => (await caller.products.list({ storeId, page: 1, pageSize: 25, ...extra })).items;
    return { ...f, b, caller, product, settings, save, visibility, visible };
  }

  it("hides a received duplicate only locally, retains business records, and restores through the archived filter", async () => {
    const f = await fixture();
    const duplicate = await f.caller.products.create({
      idempotencyKey: randomUUID(),
      name: f.product.name,
      sku: "OTHER-CARD",
      storeId: f.b.id,
      baseUnitId: f.baseUnit.id,
      basePriceKgs: 120,
    });
    await f.caller.inventory.receive({
      storeId: f.b.id,
      productId: f.product.id,
      qtyReceived: 7,
      unitCost: 20,
      idempotencyKey: randomUUID(),
    });
    await f.caller.storePrices.upsert({ storeId: f.b.id, productId: f.product.id, priceKgs: 160 });
    const business = async () => ({
      products: await prisma.product.findMany({ orderBy: { id: "asc" } }),
      stock: await prisma.inventorySnapshot.findMany({ orderBy: { id: "asc" } }),
      movements: await prisma.stockMovement.findMany({ orderBy: { id: "asc" } }),
      lots: await prisma.stockLot.findMany({ orderBy: { id: "asc" } }),
      costs: await prisma.productCost.findMany({ orderBy: { id: "asc" } }),
      prices: await prisma.storePrice.findMany({ orderBy: { id: "asc" } }),
      catalogs: await prisma.productCatalogProduct.findMany({
        orderBy: [{ catalogId: "asc" }, { productId: "asc" }],
      }),
    });
    const before = await business();
    await f.visibility(f.b.id, true);
    expect(await business()).toEqual(before);
    expect((await f.visible(f.store.id)).map((p) => p.id)).toContain(f.product.id);
    expect((await f.visible(f.b.id)).map((p) => p.id)).toEqual([duplicate.id]);
    for (const sortKey of [undefined, "onHandQty"] as const) {
      const hidden = (await f.visible(f.b.id, { includeArchived: true, sortKey })).find(
        (p) => p.id === f.product.id,
      );
      expect(hidden?.hiddenInStore).toBe(true);
      expect(hidden?.isDeleted).toBe(false);
      expect(hidden?.onHandQty).toBe(7);
    }
    expect(await f.caller.products.listIds({ storeId: f.b.id })).not.toContain(f.product.id);
    expect(await f.caller.products.listIds({ storeId: f.b.id, includeArchived: true })).toContain(
      f.product.id,
    );
    expect(
      (await f.caller.products.searchQuick({ storeId: f.b.id, q: "SHARED-ADAPTER" })).map(
        (p) => p.id,
      ),
    ).not.toContain(f.product.id);
    expect(
      (await f.caller.products.lookupScan({ storeId: f.b.id, q: "SHARED-ADAPTER" })).exactMatch,
    ).toBe(false);
    expect(
      (await f.caller.inventory.list({ storeId: f.b.id, page: 1, pageSize: 25 })).items.some(
        (p) => p.product.id === f.product.id,
      ),
    ).toBe(true);
    await f.visibility(f.b.id, false);
    expect((await f.visible(f.b.id)).find((p) => p.id === f.product.id)?.hiddenInStore).toBe(false);
    expect(await business()).toEqual(before);
  });

  it("does not let source refreshes or stock and price upserts reactivate a hidden card", async () => {
    const f = await fixture();
    await f.visibility(f.b.id, true);
    await assignProductToStore(prisma, {
      organizationId: f.org.id,
      storeId: f.b.id,
      productId: f.product.id,
    });
    await f.caller.storePrices.upsert({ storeId: f.b.id, productId: f.product.id, priceKgs: 150 });
    await f.caller.inventory.receive({
      storeId: f.b.id,
      productId: f.product.id,
      qtyReceived: 2,
      unitCost: 20,
      idempotencyKey: randomUUID(),
    });
    await f.save(await f.settings());
    const next = await f.caller.products.create({
      idempotencyKey: randomUUID(),
      name: "New future product",
      sku: "FUTURE",
      storeId: f.store.id,
      baseUnitId: f.baseUnit.id,
      basePriceKgs: 100,
    });
    const ids = (await f.visible(f.b.id)).map((p) => p.id);
    expect(ids).not.toContain(f.product.id);
    expect(ids).toContain(next.id);
    const change = await f.settings();
    change.connections[0].enabled = false;
    await f.save(change);
    await expect(f.visibility(f.b.id, false)).rejects.toThrow("productNotAvailableInStore");
    change.connections[0].enabled = true;
    await f.save(change);
    expect((await f.visible(f.b.id)).map((p) => p.id)).not.toContain(f.product.id);
    await f.visibility(f.b.id, false);
    expect((await f.visible(f.b.id)).map((p) => p.id)).toContain(f.product.id);
  });

  it("keeps a locally hidden source card available to existing and newly configured recipients", async () => {
    const f = await fixture();
    await f.visibility(f.store.id, true);
    expect((await f.visible(f.store.id)).map((p) => p.id)).not.toContain(f.product.id);
    expect((await f.visible(f.b.id)).map((p) => p.id)).toContain(f.product.id);
    await f.save(await f.settings());
    expect((await f.visible(f.b.id)).map((p) => p.id)).toContain(f.product.id);
    const c = await prisma.store.create({
      data: { organizationId: f.org.id, name: "C", code: "C" },
    });
    const change = await f.settings(c.id);
    change.connections.push({
      key: `store:${f.store.id}`,
      enabled: true,
      scope: "ALL",
      productIds: [],
    });
    await f.save(change);
    expect((await f.visible(c.id)).map((p) => p.id)).toContain(f.product.id);
    await f.visibility(f.store.id, false);
    expect((await f.visible(f.store.id)).map((p) => p.id)).toContain(f.product.id);
  });

  it("enforces store and role access, including restoration by a manager restricted to one store", async () => {
    const f = await fixture();
    await prisma.userStoreAccess.deleteMany({ where: { userId: f.managerUser.id } });
    await prisma.userStoreAccess.create({
      data: { organizationId: f.org.id, userId: f.managerUser.id, storeId: f.b.id },
    });
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    await expect(
      manager.products.setStoreVisibility({
        storeId: f.store.id,
        productIds: [f.product.id],
        hidden: true,
      }),
    ).rejects.toThrow("storeAccessDenied");
    const cashier = createTestCaller({ ...f.cashierUser, organizationId: f.org.id });
    await expect(
      cashier.products.setStoreVisibility({
        storeId: f.store.id,
        productIds: [f.product.id],
        hidden: true,
      }),
    ).rejects.toThrow();
    await manager.products.setStoreVisibility({
      storeId: f.b.id,
      productIds: [f.product.id],
      hidden: true,
    });
    expect(
      (await manager.products.list({ storeId: f.b.id, includeArchived: true })).items[0]
        .hiddenInStore,
    ).toBe(true);
    await manager.products.setStoreVisibility({
      storeId: f.b.id,
      productIds: [f.product.id],
      hidden: false,
    });
    expect((await f.visible(f.b.id)).map((p) => p.id)).toContain(f.product.id);
    await expect(
      manager.products.setStoreVisibility({
        storeId: f.b.id,
        productIds: [f.product.id, "unassigned"],
        hidden: true,
      }),
    ).rejects.toThrow("productAccessDenied");
    expect((await f.visible(f.b.id)).map((p) => p.id)).toContain(f.product.id);
  });

  it("blocks stale carts in both configured and original stores and rolls back on audit failure", async () => {
    const f = await fixture();
    for (const storeId of [f.store.id, f.b.id]) {
      await f.visibility(storeId, true);
      await expect(
        prisma.$transaction((tx) => assertSaleAssortment(tx, f.org.id, storeId, [f.product.id])),
      ).rejects.toThrow("productNotAvailableInStore");
      await f.visibility(storeId, false);
    }
    const spy = vi
      .spyOn(audit, "writeAuditLog")
      .mockRejectedValueOnce(new Error("test audit unavailable"));
    try {
      await expect(f.visibility(f.b.id, true)).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect((await f.visible(f.b.id)).find((p) => p.id === f.product.id)?.hiddenInStore).toBe(false);
    await f.visibility(f.b.id, true);
    await f.caller.products.archive({ productId: f.product.id });
    expect((await f.visible(f.store.id)).map((p) => p.id)).not.toContain(f.product.id);
    await f.caller.products.restore({ productId: f.product.id });
    expect((await f.visible(f.store.id)).map((p) => p.id)).toContain(f.product.id);
    expect((await f.visible(f.b.id)).map((p) => p.id)).not.toContain(f.product.id);
  });

  it("does not promise to reactivate a hidden recipient when source ownership is confirmed", async () => {
    const f = await fixture();
    await f.visibility(f.b.id, true);
    await prisma.storeProduct.updateMany({
      where: { storeId: f.store.id, productId: f.product.id },
      data: { isDirect: false, isHistorical: true },
    });
    const change = await f.settings(f.store.id);
    change.confirmProductIds = [f.product.id];
    const preview = await f.save(change);
    expect(preview.confirmed).toBe(1);
    expect(preview.otherImpacts).toEqual([]);
    expect((await f.visible(f.b.id)).map((p) => p.id)).not.toContain(f.product.id);
  });

  it("preserves local exclusions when an older shared group gains a new store", async () => {
    const f = await seedBase({ plan: "ENTERPRISE" });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const catalog = await prisma.productCatalog.create({
      data: { organizationId: f.org.id, name: "Legacy group" },
    });
    await prisma.store.update({
      where: { id: f.store.id },
      data: { productCatalogId: catalog.id },
    });
    const b = await prisma.store.create({
      data: { organizationId: f.org.id, name: "B", code: "B", productCatalogId: catalog.id },
    });
    const sync = () =>
      prisma.$transaction((tx) =>
        syncProductCatalogAssignments(tx, {
          organizationId: f.org.id,
          productCatalogId: catalog.id,
        }),
      );
    await sync();
    for (const storeId of [f.store.id, b.id])
      await caller.products.setStoreVisibility({
        storeId,
        productIds: [f.product.id],
        hidden: true,
      });
    const c = await prisma.store.create({
      data: { organizationId: f.org.id, name: "C", code: "C", productCatalogId: catalog.id },
    });
    await sync();
    const rows = await prisma.storeProduct.findMany({ where: { productId: f.product.id } });
    expect(rows.find((r) => r.storeId === c.id)?.isActive).toBe(true);
    expect(rows.filter((r) => r.storeId !== c.id).every((r) => r.isHidden && !r.isActive)).toBe(
      true,
    );
  });
});
