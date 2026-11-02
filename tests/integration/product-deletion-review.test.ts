import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import * as audit from "@/server/services/audit";
import { eventBus } from "@/server/events/eventBus";

(shouldRunDbTests ? describe : describe.skip)("reviewed permanent product deletion", () => {
  beforeEach(resetDatabase);
  async function fixture() {
    const f = await seedBase({ plan: "ENTERPRISE" });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const review = () => caller.products.deletionPreview({ productId: f.product.id });
    const request = async () => ({
      productId: f.product.id,
      reviewToken: (await review()).token,
      idempotencyKey: randomUUID(),
    });
    return { ...f, caller, review, request };
  }
  it("reviews all linked stores without mutation and makes a lost-response retry safe", async () => {
    const f = await fixture();
    const other = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Second shop", code: "SECOND" },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: f.org.id,
        productId: f.product.id,
        storeId: other.id,
        isDirect: true,
      },
    });
    const p = await f.review();
    expect(p).toMatchObject({ canDelete: true, reasons: [] });
    expect(p.stores).toHaveLength(2);
    expect(await prisma.product.count()).toBe(1);
    const request = await f.request();
    expect(await f.caller.products.deletePermanent(request)).toEqual({ id: f.product.id });
    expect(await f.caller.products.deletePermanent(request)).toEqual({ id: f.product.id });
    expect(await prisma.product.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "PRODUCT_DELETE" } })).toBe(1);
  });

  it("deletes an unused card from configured catalogs and fixed selections without touching another product", async () => {
    const f = await fixture();
    await prisma.storeProduct.updateMany({
      where: { productId: f.product.id },
      data: { isDirect: true, isHistorical: false },
    });
    const keep = await f.caller.products.create({
      name: "Keep this card",
      sku: "KEEP",
      storeId: f.store.id,
      baseUnitId: f.baseUnit.id,
      basePriceKgs: 25,
      idempotencyKey: randomUUID(),
    });
    const target = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Configured shop", code: "CONFIGURED" },
    });
    const config = (await f.caller.stores.catalogSettings({ storeId: target.id })).settings!;
    config.connections.push({
      key: `store:${f.store.id}`,
      enabled: true,
      scope: "SELECTED",
      productIds: [f.product.id, keep.id],
    });
    const preview = await f.caller.stores.previewCatalogSettings(config);
    await f.caller.stores.saveCatalogSettings({
      change: config,
      token: preview.token,
      idempotencyKey: randomUUID(),
    });
    const rule = await prisma.assortmentRule.create({
      data: {
        organizationId: f.org.id,
        sourceStoreId: f.store.id,
        targetStoreId: target.id,
        scope: "SELECTED",
        includeFuture: false,
        active: false,
        selectedProductIds: [f.product.id, keep.id],
      },
    });
    await prisma.assortmentGrant.createMany({
      data: [f.product.id, keep.id].map((productId) => ({ ruleId: rule.id, productId })),
    });
    expect(
      await prisma.productCatalogProduct.count({ where: { productId: f.product.id } }),
    ).toBeGreaterThan(0);
    await f.caller.products.archive({ productId: f.product.id });
    expect((await f.review()).canDelete).toBe(true);
    await f.caller.products.deletePermanent(await f.request());
    expect(await prisma.product.findUnique({ where: { id: f.product.id } })).toBeNull();
    expect(await prisma.product.findUnique({ where: { id: keep.id } })).not.toBeNull();
    expect(
      (await prisma.storeCatalog.findFirstOrThrow({ where: { storeId: target.id } }))
        .selectedProductIds,
    ).toEqual([keep.id]);
    expect(
      (await prisma.assortmentRule.findUniqueOrThrow({ where: { id: rule.id } }))
        .selectedProductIds,
    ).toEqual([keep.id]);
    expect(await prisma.assortmentGrant.count({ where: { productId: f.product.id } })).toBe(0);
    expect(await prisma.assortmentGrant.count({ where: { productId: keep.id } })).toBe(1);
    expect(await prisma.stockMovement.count()).toBe(0);
  });
  it("explains nonzero stock and blocks history even after the balance returns to zero", async () => {
    const f = await fixture();
    await f.caller.inventory.receive({
      productId: f.product.id,
      storeId: f.store.id,
      qtyReceived: 4,
      unitCost: 10,
      idempotencyKey: randomUUID(),
    });
    const p = await f.review();
    expect(p.canDelete).toBe(false);
    expect(p.reasons).toEqual(
      expect.arrayContaining([
        { key: "stockMovements", count: 1 },
        { key: "balances", count: 1 },
      ]),
    );
    await expect(f.caller.products.deletePermanent(await f.request())).rejects.toThrow(
      "productDeleteBlockedByHistory",
    );
    await prisma.inventorySnapshot.updateMany({
      where: { productId: f.product.id },
      data: { onHand: 0 },
    });
    expect((await f.review()).canDelete).toBe(false);
  });
  it("rejects a stale review after adding a store or recording stock", async () => {
    const f = await fixture(),
      request = await f.request();
    await prisma.storeProduct.updateMany({
      where: { productId: f.product.id },
      data: { isHidden: true, isActive: false },
    });
    await expect(f.caller.products.deletePermanent(request)).rejects.toThrow(
      "productDeletionStale",
    );
    expect(await prisma.product.count()).toBe(1);
    const next = await f.request();
    await prisma.inventorySnapshot.create({
      data: { storeId: f.store.id, productId: f.product.id, onHand: 3 },
    });
    await expect(f.caller.products.deletePermanent(next)).rejects.toThrow("productDeletionStale");
  });
  it("rejects another actor, foreign organization, changed target, expired token and a demoted admin", async () => {
    const f = await fixture(),
      request = await f.request();
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    await expect(manager.products.deletionPreview({ productId: f.product.id })).rejects.toThrow();
    await expect(manager.products.deletePermanent(request)).rejects.toThrow();
    const other = await prisma.organization.create({ data: { name: "Foreign" } });
    const foreign = createTestCaller({ ...f.adminUser, organizationId: other.id });
    await expect(foreign.products.deletionPreview({ productId: f.product.id })).rejects.toThrow();
    await expect(
      f.caller.products.deletePermanent({ ...request, productId: "wrong-product" }),
    ).rejects.toThrow();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 601_000);
    try {
      await expect(f.caller.products.deletePermanent(request)).rejects.toThrow(
        "productDeletionStale",
      );
    } finally {
      clock.mockRestore();
    }
    await prisma.user.update({ where: { id: f.adminUser.id }, data: { role: "MANAGER" } });
    await expect(f.caller.products.deletePermanent(request)).rejects.toThrow();
    expect(await prisma.product.count()).toBe(1);
  });
  it("rolls back deletion and its operation receipt when auditing fails", async () => {
    const f = await fixture(),
      request = await f.request();
    const fail = vi
      .spyOn(audit, "writeAuditLog")
      .mockRejectedValueOnce(new Error("audit unavailable"));
    try {
      await expect(f.caller.products.deletePermanent(request)).rejects.toThrow();
    } finally {
      fail.mockRestore();
    }
    expect(await prisma.product.count()).toBe(1);
    expect(await prisma.idempotencyKey.count()).toBe(0);
  });

  it("notifies the affected stores after deletion and retains the commit if notifications fail", async () => {
    const f = await fixture(),
      request = await f.request();
    const publish = vi.spyOn(eventBus, "publish");
    try {
      await f.caller.products.deletePermanent(request);
      expect(publish.mock.calls.map((c) => c[0])).toContainEqual({
        type: "products.updated",
        payload: { storeId: f.store.id, productId: f.product.id },
      });
      publish.mockImplementation(() => {
        throw new Error("notification unavailable");
      });
      expect(await f.caller.products.deletePermanent(request)).toEqual({ id: f.product.id });
      expect(await prisma.product.count()).toBe(0);
    } finally {
      publish.mockRestore();
    }
  });
});
