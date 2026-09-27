import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import {
  planAssortmentRecovery,
  applyAssortmentRecovery,
  recoveryBusinessDigest,
} from "@/server/services/assortmentRecovery";
import { syncProductCatalogAssignments } from "@/server/services/productCatalogs";
import { createProduct } from "@/server/services/products";
import { assertUserCanAccessProducts } from "@/server/services/productAccess";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

(shouldRunDbTests ? describe : describe.skip)("recorded assortment recovery", () => {
  beforeEach(resetDatabase);
  async function fixture() {
    const f = await seedBase({ plan: "ENTERPRISE" });
    const [b, c] = await Promise.all(
      ["B", "C"].map((name) =>
        prisma.store.create({ data: { organizationId: f.org.id, name, code: name } }),
      ),
    );
    const stores = [f.store, b, c],
      old = new Date(Date.now() - 60_000),
      boundary = new Date(Date.now() + 1_000);
    const cat = await prisma.productCatalog.create({
      data: { organizationId: f.org.id, name: "Incorrect merged name" },
    });
    const products = [
      f.product,
      ...(await Promise.all(
        ["a2", "b1", "c1"].map((name) =>
          prisma.product.create({
            data: {
              organizationId: f.org.id,
              name,
              sku: name,
              unit: "each",
              baseUnitId: f.baseUnit.id,
            },
          }),
        ),
      )),
    ];
    await prisma.storeProduct.updateMany({
      where: { organizationId: f.org.id },
      data: { createdAt: old, updatedAt: old },
    });
    const originals = [[products[0].id, products[1].id], [products[2].id], [products[3].id]];
    for (let i = 0; i < stores.length; i++) {
      await prisma.storeProduct.createMany({
        data: originals[i].map((productId) => ({
          organizationId: f.org.id,
          storeId: stores[i].id,
          productId,
          createdAt: old,
          updatedAt: old,
        })),
        skipDuplicates: true,
      });
      await prisma.store.update({
        where: { id: stores[i].id },
        data: { productCatalogId: cat.id },
      });
    }
    await prisma.$transaction((tx) =>
      syncProductCatalogAssignments(tx, {
        organizationId: f.org.id,
        productCatalogId: cat.id,
        actorId: f.adminUser.id,
      }),
    );
    const added = await prisma.storeProduct.findMany({
      where: { organizationId: f.org.id, createdAt: { gt: old } },
    });
    await prisma.storeProduct.updateMany({
      where: { id: { in: added.map((a) => a.id) } },
      data: { createdAt: boundary, updatedAt: boundary },
    });
    // Emulate the pre-source schema: membership rows did not exist at merge time.
    await prisma.productCatalogProduct.deleteMany({ where: { catalogId: cat.id } });
    const audit = await prisma.auditLog.create({
      data: {
        organizationId: f.org.id,
        actorId: f.adminUser.id,
        action: "STORE_ASSORTMENT_SHARE",
        entity: "ProductCatalog",
        entityId: cat.id,
        requestId: randomUUID(),
        createdAt: new Date(boundary.getTime() + 3_000),
        before: {
          sourceStore: {
            id: f.store.id,
            currentCatalogId: cat.id,
            currentCatalogName: "Earlier shared assortment",
          },
          groupStoreImpacts: stores.map((s, i) => ({
            storeId: s.id,
            productsToAdd: 4 - originals[i].length,
          })),
          totalProductsToAssign: 8,
          totalSharedProductCount: 4,
          sourceProductCount: 2,
        },
      },
    });
    const plan = () => prisma.$transaction((tx) => planAssortmentRecovery(tx, f.org.id, audit.id));
    const apply = (p: Awaited<ReturnType<typeof plan>>) =>
      prisma.$transaction((tx) => applyAssortmentRecovery(tx, p), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const connect = async (target: string, source: string, enabled = true) => {
      const change = (await caller.stores.catalogSettings({ storeId: target })).settings!;
      change.connections = [
        ...change.connections.filter((c) => c.key !== `store:${source}`),
        { key: `store:${source}`, enabled, scope: "ALL", productIds: [] },
      ];
      const preview = await caller.stores.previewCatalogSettings(change);
      await caller.stores.saveCatalogSettings({
        change,
        token: preview.token,
        idempotencyKey: randomUUID(),
      });
    };
    const visible = async (storeId: string) =>
      (
        await prisma.storeProduct.findMany({
          where: { storeId, isActive: true, product: { isDeleted: false } },
          select: { productId: true },
        })
      )
        .map((p) => p.productId)
        .sort();
    return {
      ...f,
      stores,
      products,
      originals,
      added,
      audit,
      plan,
      apply,
      caller,
      connect,
      visible,
    };
  }
  it("restores exact pre-share IDs, retains every business record and exports only each reviewed baseline plus later local products", async () => {
    const f = await fixture(),
      p = await f.plan();
    const before = await prisma.$transaction((tx) => recoveryBusinessDigest(tx, f.org.id));
    expect(p.baselines.map((b) => b.visible).sort()).toEqual([1, 1, 2]);
    expect((await f.apply(p)).replayed).toBe(false);
    expect(await prisma.$transaction((tx) => recoveryBusinessDigest(tx, f.org.id))).toEqual(before);
    expect((await f.apply(p)).replayed).toBe(true);
    expect(await prisma.storeProduct.count()).toBe(12);
    for (let i = 0; i < 3; i++)
      expect(await f.visible(f.stores[i].id)).toEqual([...f.originals[i]].sort());
    expect(await prisma.storeProduct.count({ where: { isDirect: true } })).toBe(0);
    const [a, b, c] = f.stores;
    await prisma.userStoreAccess.updateMany({
      where: { userId: f.managerUser.id },
      data: { storeId: b.id },
    });
    const manager = { ...f.managerUser, organizationId: f.org.id };
    const writableBaseline = () =>
      assertUserCanAccessProducts(prisma, manager, f.originals[1], { writable: true });
    await expect(writableBaseline()).resolves.toBeUndefined();
    const overview = await f.caller.stores.catalogSettings({ storeId: b.id });
    expect(overview.sources.find((s) => s.key === `store:${a.id}`)?.total).toBe(2);
    expect(overview.stores.find((s) => s.id === b.id)).toMatchObject({
      baseCount: 1,
      availableCount: 1,
      hasBaseline: true,
    });
    await f.connect(b.id, a.id);
    await expect(writableBaseline()).resolves.toBeUndefined();
    await expect(
      assertUserCanAccessProducts(prisma, manager, f.originals[0], { writable: true }),
    ).rejects.toThrow("productAccessDenied");
    await f.connect(c.id, b.id);
    expect(await f.visible(b.id)).toEqual([...f.originals[0], ...f.originals[1]].sort());
    expect(await f.visible(c.id)).toEqual([...f.originals[1], ...f.originals[2]].sort());
    const next = await createProduct({
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      requestId: randomUUID(),
      storeId: b.id,
      name: "Later B",
      sku: "Later-B",
      baseUnitId: f.baseUnit.id,
    });
    expect(await f.visible(a.id)).not.toContain(next.id);
    expect(await f.visible(c.id)).toContain(next.id);
    await f.connect(b.id, a.id, false);
    await expect(writableBaseline()).resolves.toBeUndefined();
    expect(await f.visible(b.id)).toEqual([...f.originals[1], next.id].sort());
    expect((await f.caller.stores.catalogSettings({ storeId: b.id })).total).toBe(2);
    const invalid = (await f.caller.stores.catalogSettings({ storeId: b.id })).settings!;
    invalid.connections = invalid.connections.filter((c) => !c.key.startsWith("baseline:"));
    await expect(f.caller.stores.previewCatalogSettings(invalid)).rejects.toThrow(
      "assortmentBaselineRequired",
    );
  });
  it("refuses stale metadata, another tenant and stock on a newly shared position without partial changes", async () => {
    const f = await fixture(),
      p = await f.plan();
    await expect(
      prisma.$transaction((tx) => planAssortmentRecovery(tx, "foreign", f.audit.id)),
    ).rejects.toThrow("not found");
    await prisma.store.update({ where: { id: f.store.id }, data: { name: "Concurrent change" } });
    await expect(f.apply(p)).rejects.toThrow("stale");
    expect(await prisma.storeCatalog.count()).toBe(0);
    const added = f.added[0];
    await prisma.inventorySnapshot.updateMany({
      where: { storeId: added.storeId, productId: added.productId },
      data: { onHand: 1 },
    });
    await expect(f.plan()).rejects.toThrow("stock, movements or documents");
    expect(await prisma.storeProduct.count({ where: { isActive: true } })).toBe(12);
  });
  it("rolls back the entire recovery after a failure following baseline creation", async () => {
    const f = await fixture(),
      plan = await f.plan();
    await expect(
      prisma.$transaction(async (tx) => {
        const update = vi
          .spyOn(tx.store, "updateMany")
          .mockRejectedValueOnce(new Error("Injected recovery failure"));
        try {
          return await applyAssortmentRecovery(tx, plan);
        } finally {
          update.mockRestore();
        }
      }),
    ).rejects.toThrow("Injected recovery failure");
    expect(await prisma.storeCatalog.count()).toBe(0);
    expect(await prisma.productCatalog.count({ where: { sourceKey: { not: null } } })).toBe(0);
    expect(await prisma.storeProduct.count({ where: { isActive: true } })).toBe(12);
    expect((await f.plan()).fingerprint).toBe(plan.fingerprint);
  });
});
