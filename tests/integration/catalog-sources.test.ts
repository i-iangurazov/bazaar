import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createProduct } from "@/server/services/products";
import { assignProductToStore } from "@/server/services/storeAccess";
import { syncProductCatalogAssignments } from "@/server/services/productCatalogs";
import * as audit from "@/server/services/audit";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";
import type { CatalogSettings } from "@/server/services/catalogSources";

(shouldRunDbTests ? describe : describe.skip)("recipient catalogue sources", () => {
  beforeEach(resetDatabase);
  async function fixture() {
    const f = await seedBase({ plan: "ENTERPRISE", allowNegativeStock: true });
    const a = f.store;
    const [b, c] = await Promise.all(
      ["B", "C"].map((name) =>
        prisma.store.create({
          data: { organizationId: f.org.id, name, code: name, allowNegativeStock: true },
        }),
      ),
    );
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const create = (storeId: string, name: string) =>
      createProduct({
        organizationId: f.org.id,
        actorId: f.adminUser.id,
        requestId: randomUUID(),
        storeId,
        name,
        sku: name,
        baseUnitId: f.baseUnit.id,
        basePriceKgs: 100,
        barcodes: [`SCAN-${name}`],
      });
    const a1 = await create(a.id, "a1"),
      a2 = await create(a.id, "a2"),
      b1 = await create(b.id, "b1"),
      c1 = await create(c.id, "c1");
    const visible = async (storeId: string) =>
      (
        await prisma.storeProduct.findMany({
          where: { storeId, isActive: true, product: { isDeleted: false } },
          select: { productId: true },
        })
      )
        .map((r) => r.productId)
        .sort();
    const settings = async (storeId: string) =>
      (await caller.stores.catalogSettings({ storeId })).settings!;
    const save = async (change: CatalogSettings) => {
      const p = await caller.stores.previewCatalogSettings(change);
      await caller.stores.saveCatalogSettings({
        change,
        token: p.token,
        idempotencyKey: randomUUID(),
      });
      return p;
    };
    const connect = async (target: string, key: string, enabled = true, productIds?: string[]) => {
      const d = await settings(target);
      const next = {
        key,
        enabled,
        scope: productIds ? ("SELECTED" as const) : ("ALL" as const),
        productIds: productIds ?? [],
      };
      d.connections = [...d.connections.filter((c) => c.key !== key), next];
      return save(d);
    };
    return { ...f, a, b, c, a1, a2, b1, c1, caller, create, visible, settings, save, connect };
  }
  it("enables, disables and reconnects the same identities across listing, scanner search and direct requests", async () => {
    const f = await fixture();
    await prisma.userStoreAccess.deleteMany({ where: { userId: f.cashierUser.id } });
    await prisma.userStoreAccess.create({
      data: { organizationId: f.org.id, userId: f.cashierUser.id, storeId: f.b.id },
    });
    const cashier = createTestCaller({ ...f.cashierUser, organizationId: f.org.id });
    await f.connect(f.b.id, `store:${f.a.id}`);
    expect(await f.visible(f.b.id)).toEqual([f.a1.id, f.a2.id, f.b1.id].sort());
    const sourceCatalog = await prisma.productCatalog.findUniqueOrThrow({
      where: { sourceKey: `store:${f.a.id}` },
    });
    await expect(
      f.caller.stores.create({
        name: "Illegal group",
        code: "NO",
        productCatalogId: sourceCatalog.id,
        allowNegativeStock: false,
        trackExpiryLots: false,
      }),
    ).rejects.toThrow("productCatalogNotFound");
    await expect(
      prisma.store.create({
        data: {
          organizationId: f.org.id,
          name: "Old writer",
          code: "OLD",
          productCatalogId: sourceCatalog.id,
        },
      }),
    ).rejects.toThrow("Source catalogues require");

    expect(
      (await cashier.products.searchQuick({ storeId: f.b.id, q: "SCAN-a1" })).map((p) => p.id),
    ).toContain(f.a1.id);
    await f.connect(f.b.id, `store:${f.a.id}`, false);
    expect(await f.visible(f.b.id)).toEqual([f.b1.id]);
    await expect(
      f.caller.products.assignToStore({ storeId: f.b.id, productIds: [f.a1.id] }),
    ).rejects.toThrow("assortmentUseSourceEditor");
    expect(await cashier.products.searchQuick({ storeId: f.b.id, q: "SCAN-a1" })).toEqual([]);
    expect(
      (await cashier.products.list({ storeId: f.b.id, page: 1, pageSize: 10 })).items.map(
        (p) => p.id,
      ),
    ).toEqual([f.b1.id]);
    expect(await cashier.products.getById({ productId: f.a1.id })).toBeNull();
    const reloaded = await f.caller.stores.catalogSettings({ storeId: f.b.id });
    expect(reloaded.total).toBe(1);
    expect(reloaded.settings!.connections[0].enabled).toBe(false);
    await f.connect(f.b.id, `store:${f.a.id}`);
    await f.connect(f.b.id, `store:${f.a.id}`);
    expect(await f.visible(f.b.id)).toEqual([f.a1.id, f.a2.id, f.b1.id].sort());
    expect(
      await prisma.storeProduct.count({ where: { storeId: f.b.id, productId: f.a1.id } }),
    ).toBe(1);
  });
  it("preserves inventory, movements, costs, prices and documents, but blocks a stale cart at completion", async () => {
    const f = await fixture();
    await f.connect(f.b.id, `store:${f.a.id}`);
    await prisma.inventorySnapshot.create({
      data: { storeId: f.b.id, productId: f.a1.id, onHand: 9, onOrder: 2 },
    });
    await prisma.productCost.create({
      data: { organizationId: f.org.id, productId: f.a1.id, avgCostKgs: 40, costBasisQty: 9 },
    });
    await prisma.storePrice.create({
      data: { organizationId: f.org.id, storeId: f.b.id, productId: f.a1.id, priceKgs: 100 },
    });
    await prisma.stockMovement.create({
      data: {
        storeId: f.b.id,
        productId: f.a1.id,
        type: "RECEIVE",
        qtyDelta: 9,
        unitCostKgs: 40,
        lineTotalKgs: 360,
        referenceType: "TEST",
        referenceId: "protected",
      },
    });
    const register = await prisma.posRegister.create({
      data: { organizationId: f.org.id, storeId: f.b.id, name: "B", code: "B" },
    });
    await f.caller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: randomUUID(),
    });
    const sale = await f.caller.pos.sales.createDraft({
      registerId: register.id,
      saleChannel: "ONLINE",
      lines: [{ productId: f.a1.id, qty: 1 }],
    });
    await f.caller.pos.sales.holdDraft({ saleId: sale.id, saleChannel: "ONLINE" });
    const snapshot = async () => ({
      products: await prisma.product.findMany({ orderBy: { id: "asc" } }),
      stock: await prisma.inventorySnapshot.findMany({ orderBy: { id: "asc" } }),
      movements: await prisma.stockMovement.findMany({ orderBy: { id: "asc" } }),
      costs: await prisma.productCost.findMany({ orderBy: { id: "asc" } }),
      prices: await prisma.storePrice.findMany({ orderBy: { id: "asc" } }),
      orders: await prisma.customerOrder.findMany({
        include: { lines: true },
        orderBy: { id: "asc" },
      }),
    });
    const before = await snapshot();
    const impact = await f.connect(f.b.id, `store:${f.a.id}`, false);
    expect(impact.stockPositions).toBe(1);
    expect(impact.documents.map((d) => d.id)).toContain(sale.id);
    expect(await snapshot()).toEqual(before);
    const inventory = await f.caller.inventory.list({
      storeId: f.b.id,
      stockFilter: "notInAssortment",
    });
    expect(inventory.items.map((i) => i.product.id)).toContain(f.a1.id);
    const sorted = await f.caller.inventory.list({
      storeId: f.b.id,
      stockFilter: "notInAssortment",
      sortKey: "minStock",
    });
    expect(sorted.items.map((i) => i.product.id)).toContain(f.a1.id);
    expect(
      (await f.caller.inventory.searchProducts({ storeId: f.b.id, productId: f.a1.id })).map(
        (i) => i.product.id,
      ),
    ).toContain(f.a1.id);
    await assignProductToStore(prisma, {
      organizationId: f.org.id,
      storeId: f.b.id,
      productId: f.a1.id,
    });
    expect(await f.visible(f.b.id)).not.toContain(f.a1.id);
    await f.caller.pos.sales.resumeHeldDraft({ saleId: sale.id, registerId: register.id });
    const request = {
      saleId: sale.id,
      idempotencyKey: randomUUID(),
      payments: [{ method: "CASH" as const, amountKgs: 100 }],
    };
    await expect(f.caller.pos.sales.complete(request)).rejects.toThrow(
      "productNotAvailableInStore",
    );
    await f.connect(f.b.id, `store:${f.a.id}`);
    await f.caller.pos.sales.complete(request);
    expect((await f.caller.pos.sales.get({ saleId: sale.id }))?.saleChannel).toBe("ONLINE");
    const completed = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: sale.id },
      include: { lines: true },
    });
    await f.connect(f.b.id, `store:${f.a.id}`, false);
    expect(
      await prisma.customerOrder.findUniqueOrThrow({
        where: { id: sale.id },
        include: { lines: true },
      }),
    ).toEqual(completed);
    expect((await f.caller.pos.sales.get({ saleId: sale.id }))?.status).toBe("COMPLETED");
  });
  it("counts overlapping IDs once, retains another enabled source and never cascades received products", async () => {
    const f = await fixture();
    await f.connect(f.b.id, `store:${f.a.id}`);
    await f.connect(f.c.id, `store:${f.b.id}`);
    expect(await f.visible(f.c.id)).toEqual([f.b1.id, f.c1.id].sort());
    const b2 = await f.create(f.b.id, "b2");
    expect(await f.visible(f.a.id)).not.toContain(b2.id);
    expect(await f.visible(f.c.id)).toContain(b2.id);
    const shared = await prisma.productCatalog.create({
      data: {
        organizationId: f.org.id,
        name: "Reviewed shared selection",
        products: { create: { productId: f.a1.id } },
      },
    });
    await f.connect(f.b.id, `catalog:${shared.id}`);
    expect((await f.caller.stores.catalogSettings({ storeId: f.b.id })).total).toBe(4);
    const off = await f.connect(f.b.id, `store:${f.a.id}`, false);
    expect(off.hidden).toBe(1);
    expect(await f.visible(f.b.id)).toContain(f.a1.id);
    await f.connect(f.b.id, `catalog:${shared.id}`, false);
    expect(await f.visible(f.b.id)).not.toContain(f.a1.id);
    expect(await f.visible(f.a.id)).toContain(f.a1.id);
    await f.connect(f.b.id, `store:${f.a.id}`, true, [f.a1.id]);
    const a3 = await f.create(f.a.id, "a3");
    expect(await f.visible(f.b.id)).not.toContain(a3.id);
    await f.connect(f.b.id, `store:${f.a.id}`);
    expect(await f.visible(f.b.id)).toContain(a3.id);
    const a4 = await f.create(f.a.id, "a4");
    expect(await f.visible(f.b.id)).toContain(a4.id);
    expect(await f.visible(f.c.id)).not.toContain(a4.id);
  });
  it("shows real legacy access, lets an admin review ownership, and removes every legacy fallback only on explicit save", async () => {
    const f = await fixture();
    const group = await prisma.productCatalog.create({
      data: { organizationId: f.org.id, name: "Real shared catalogue" },
    });
    await prisma.store.updateMany({
      where: { id: { in: [f.a.id, f.b.id, f.c.id] } },
      data: { productCatalogId: group.id },
    });
    await prisma.$transaction((tx) =>
      syncProductCatalogAssignments(tx, { organizationId: f.org.id, productCatalogId: group.id }),
    );
    const before = await f.visible(f.b.id);
    const read = await f.caller.stores.catalogSettings({ storeId: f.b.id });
    expect(read.settings!.connections).toContainEqual({
      key: `catalog:${group.id}`,
      enabled: true,
      scope: "ALL",
      productIds: [],
    });
    expect(read.sources.find((s) => s.key === `catalog:${group.id}`)).toMatchObject({
      name: "Real shared catalogue",
      sourceStoreId: null,
    });
    expect(
      (await prisma.store.findUniqueOrThrow({ where: { id: f.b.id } })).catalogSourcesConfigured,
    ).toBe(false);
    expect(await f.visible(f.b.id)).toEqual(before);
    const off = await f.connect(f.b.id, `catalog:${group.id}`, false);
    expect(off.legacyExit).toBe(true);
    expect(await f.visible(f.b.id)).toEqual([f.b1.id]);
    expect(
      (await prisma.store.findUniqueOrThrow({ where: { id: f.b.id } })).productCatalogId,
    ).toBeNull();
    const b2 = await f.create(f.b.id, "private-after-conversion");
    expect(await f.visible(f.a.id)).not.toContain(b2.id);
    expect(await f.visible(f.c.id)).not.toContain(b2.id);
    await prisma.$transaction((tx) =>
      syncProductCatalogAssignments(tx, { organizationId: f.org.id, productCatalogId: group.id }),
    );
    expect(await f.visible(f.b.id)).toEqual([f.b1.id, b2.id].sort());
    const draft = await f.settings(f.a.id);
    draft.confirmProductIds = [f.product.id];
    await f.save(draft);
    await f.connect(f.b.id, `store:${f.a.id}`);
    expect(await f.visible(f.b.id)).toContain(f.product.id);
    expect((await f.caller.stores.catalogSettings({ storeId: f.a.id })).ownCount).toBe(3);
  });
  it("converts previously retained paused grants to a visible switch with no historical escape hatch", async () => {
    const f = await fixture();
    const change = {
      action: "SHARE" as const,
      sourceStoreId: f.a.id,
      targetStoreIds: [f.b.id],
      scope: "ALL" as const,
      includeFuture: true,
      mutual: false,
      productIds: [],
    };
    const old = await f.caller.stores.previewAssortmentShare(change);
    await f.caller.stores.applyAssortmentShare({
      change,
      previewToken: old.previewToken,
      idempotencyKey: randomUUID(),
    });
    await prisma.assortmentRule.updateMany({
      where: { targetStoreId: f.b.id },
      data: { active: false },
    });
    const settings = await f.settings(f.b.id);
    expect(settings.connections).toHaveLength(1);
    expect(settings.connections[0].enabled).toBe(true);
    settings.connections[0].enabled = false;
    await f.save(settings);
    expect(await f.visible(f.b.id)).toEqual([f.b1.id]);
    const stale = await f.caller.stores.catalogSettings({ storeId: f.b.id });
    expect(stale.settings!.connections[0].enabled).toBe(false);
    await expect(f.caller.stores.previewAssortmentShare(change)).rejects.toThrow(
      "assortmentUseSourceEditor",
    );
  });
  it("rejects cross-tenant and unauthorized references and stale/concurrent previews; retries are atomic", async () => {
    const f = await fixture();
    const d = await f.settings(f.b.id);
    d.connections = [{ key: `store:${f.a.id}`, enabled: true, scope: "ALL", productIds: [] }];
    const old = await f.caller.stores.previewCatalogSettings(d);
    await f.create(f.a.id, "late");
    await expect(
      f.caller.stores.saveCatalogSettings({
        change: d,
        token: old.token,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow("assortmentPreviewStale");
    expect(await f.visible(f.b.id)).toEqual([f.b1.id]);
    const p = await f.caller.stores.previewCatalogSettings(d),
      payload = { change: d, token: p.token, idempotencyKey: randomUUID() };
    const spy = vi
      .spyOn(audit, "writeAuditLog")
      .mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(f.caller.stores.saveCatalogSettings(payload)).rejects.toThrow();
    spy.mockRestore();
    expect(await f.visible(f.b.id)).toEqual([f.b1.id]);
    await Promise.all([
      f.caller.stores.saveCatalogSettings(payload),
      f.caller.stores.saveCatalogSettings(payload),
    ]);
    expect(
      await prisma.auditLog.count({ where: { entity: "StoreCatalogSettings", entityId: f.b.id } }),
    ).toBe(1);
    const next = await f.settings(f.b.id);
    next.connections[0].enabled = false;
    const p1 = await f.caller.stores.previewCatalogSettings(next);
    const p2 = await f.caller.stores.previewCatalogSettings(next);
    const results = await Promise.allSettled(
      [p1, p2].map((p) =>
        f.caller.stores.saveCatalogSettings({
          change: next,
          token: p.token,
          idempotencyKey: randomUUID(),
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const foreign = await prisma.organization.create({ data: { name: "Foreign" } });
    const catalog = await prisma.productCatalog.create({
      data: { organizationId: foreign.id, name: "Foreign" },
    });
    await expect(
      f.caller.stores.previewCatalogSettings({
        ...d,
        connections: [{ ...d.connections[0], key: `catalog:${catalog.id}` }],
      }),
    ).rejects.toThrow("productCatalogNotFound");
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    await expect(manager.stores.catalogSettings({ storeId: f.b.id })).rejects.toThrow();
  });
  it("keeps archived membership through saves and restores the original IDs only when their source is enabled", async () => {
    const f = await fixture();
    await prisma.product.update({ where: { id: f.a2.id }, data: { isDeleted: true } });
    await f.connect(f.b.id, `store:${f.a.id}`);
    expect(await f.visible(f.b.id)).toEqual([f.a1.id, f.b1.id].sort());
    await prisma.product.update({ where: { id: f.a2.id }, data: { isDeleted: false } });
    expect(await f.visible(f.b.id)).toEqual([f.a1.id, f.a2.id, f.b1.id].sort());
    await f.connect(f.b.id, `store:${f.a.id}`, true, [f.a1.id]);
    await prisma.product.update({ where: { id: f.a1.id }, data: { isDeleted: true } });
    const settings = await f.settings(f.b.id);
    settings.connections[0].enabled = false;
    const off = await f.save(settings);
    expect(off.result).toBe(1);
    expect(off.hidden).toBe(0);
    settings.connections[0].enabled = true;
    const on = await f.save(settings);
    expect(on.result).toBe(1);
    await prisma.product.update({ where: { id: f.a1.id }, data: { isDeleted: false } });
    expect(await f.visible(f.b.id)).toEqual([f.a1.id, f.b1.id].sort());
    await f.connect(f.b.id, `store:${f.a.id}`, false, [f.a1.id]);
    await prisma.product.update({ where: { id: f.a1.id }, data: { isDeleted: true } });
    await prisma.product.update({ where: { id: f.a1.id }, data: { isDeleted: false } });
    expect(await f.visible(f.b.id)).toEqual([f.b1.id]);
  });
  it("paginates and bulk-selects thousands by source, shows availability reasons and respects fixed membership", async () => {
    const f = await fixture();
    const data = Array.from({ length: 2010 }, (_, i) => ({
      id: randomUUID(),
      organizationId: f.org.id,
      name: `Bulk ${String(i).padStart(3, "0")}`,
      sku: `BULK-${i}`,
      unit: "each",
      baseUnitId: f.baseUnit.id,
    }));
    await prisma.product.createMany({ data });
    await prisma.storeProduct.createMany({
      data: data.map((p) => ({
        organizationId: f.org.id,
        storeId: f.a.id,
        productId: p.id,
        isDirect: true,
        isHistorical: false,
      })),
    });
    const first = await f.caller.stores.catalogProducts({
      storeId: f.b.id,
      key: `store:${f.a.id}`,
      search: "Bulk",
      page: 1,
    });
    const third = await f.caller.stores.catalogProducts({
      storeId: f.b.id,
      key: `store:${f.a.id}`,
      search: "Bulk",
      page: 41,
    });
    expect(first.total).toBe(2010);
    expect(first.items).toHaveLength(50);
    expect(third.items).toHaveLength(10);
    const all = await f.caller.stores.catalogProducts({
      storeId: f.b.id,
      key: `store:${f.a.id}`,
      search: "Bulk",
      page: 1,
      allIds: true,
    });
    expect(all.items).toHaveLength(2010);
    await f.connect(
      f.b.id,
      `store:${f.a.id}`,
      true,
      all.items.map((p) => p.id),
    );
    expect(await f.visible(f.b.id)).toHaveLength(2011);
    const selected = await f.caller.stores.catalogProducts({
      storeId: f.b.id,
      key: `store:${f.a.id}`,
      search: "Bulk",
      page: 1,
    });
    expect(selected.items[0]).toMatchObject({ available: true, reasons: [`store:${f.a.id}`] });
  });
});
