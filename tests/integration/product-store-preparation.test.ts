import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import * as audit from "@/server/services/audit";
import { updateProduct } from "@/server/services/products";
import { eventBus } from "@/server/events/eventBus";
import type { ProductStorePreparation } from "@/lib/productStorePreparation";

(shouldRunDbTests ? describe : describe.skip)("reviewed existing product preparation", () => {
  beforeEach(resetDatabase);
  async function fixture() {
    const f = await seedBase({ plan: "ENTERPRISE" });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { retailWholesaleEnabled: true },
    });
    await prisma.storeProduct.updateMany({
      where: { productId: f.product.id },
      data: { isDirect: true, isHistorical: false },
    });
    const stores = await Promise.all(
      ["B", "C", "Unselected"].map((code) =>
        prisma.store.create({ data: { organizationId: f.org.id, name: code, code } }),
      ),
    );
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    await prisma.storePrice.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        productId: f.product.id,
        priceKgs: 120,
      },
    });
    await prisma.storePriceTypes.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        productId: f.product.id,
        retailPriceKgs: 120,
        wholesalePriceKgs: 90,
      },
    });
    await prisma.productBarcode.create({
      data: { organizationId: f.org.id, productId: f.product.id, value: "1234567890123" },
    });
    const change: ProductStorePreparation = {
      productId: f.product.id,
      sourceStoreId: f.store.id,
      targetStoreIds: stores.slice(0, 2).map((s) => s.id),
      addToAssortment: true,
      prices: "MISSING",
    };
    const review = (c = change) => caller.products.previewStorePreparation(c);
    const apply = async (c = change) => {
      const p = await review(c);
      const request = { change: c, token: p.token, idempotencyKey: randomUUID() };
      return { result: await caller.products.applyStorePreparation(request), request };
    };
    return { ...f, stores, caller, change, review, apply };
  }

  it("previews without creating cards, prices, assignments, inventory or operation records", async () => {
    const f = await fixture();
    const before = await Promise.all([
      prisma.product.count(),
      prisma.storeProduct.count(),
      prisma.storePrice.count(),
      prisma.inventorySnapshot.count(),
      prisma.stockMovement.count(),
      prisma.idempotencyKey.count(),
    ]);
    const p = await f.review();
    expect(p).toMatchObject({ canApply: true, additions: 2, priceChanges: 2 });
    expect(p.rows[0].prices[0]).toMatchObject({
      before: { retail: null, wholesale: null },
      after: { retail: 120, wholesale: 90 },
    });
    expect(
      await Promise.all([
        prisma.product.count(),
        prisma.storeProduct.count(),
        prisma.storePrice.count(),
        prisma.inventorySnapshot.count(),
        prisma.stockMovement.count(),
        prisma.idempotencyKey.count(),
      ]),
    ).toEqual(before);
  });

  it("keeps price preparation behind the existing tariff gate without blocking ordinary card reuse", async () => {
    const f = await fixture();
    await prisma.organization.update({ where: { id: f.org.id }, data: { plan: "STARTER" } });
    await expect(f.review()).rejects.toThrow("featureLockedStorePrices");
    expect(await f.review({ ...f.change, prices: "NONE" })).toMatchObject({
      canApply: true,
      additions: 2,
      priceChanges: 0,
    });
  });

  it("uses one identity in several stores, copies variants and preserves explicit zero and unselected stores", async () => {
    const f = await fixture(),
      [b, c, untouched] = f.stores;
    await prisma.storeProduct.create({
      data: { organizationId: f.org.id, storeId: b.id, productId: f.product.id, isDirect: true },
    });
    await prisma.storePrice.create({
      data: { organizationId: f.org.id, storeId: b.id, productId: f.product.id, priceKgs: 0 },
    });
    await prisma.storePriceTypes.create({
      data: {
        organizationId: f.org.id,
        storeId: b.id,
        productId: f.product.id,
        retailPriceKgs: 0,
        wholesalePriceKgs: 0,
      },
    });
    const v = await prisma.productVariant.create({
      data: { productId: f.product.id, name: "Blue", attributes: { color: "blue" } },
    });
    await prisma.storePriceTypes.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        productId: f.product.id,
        variantId: v.id,
        variantKey: v.id,
        retailPriceKgs: 150,
        wholesalePriceKgs: 100,
      },
    });
    const snapshots = await prisma.inventorySnapshot.findMany();
    await f.apply();
    expect(await prisma.product.count()).toBe(1);
    expect(await prisma.productBarcode.count()).toBe(1);
    expect(
      await prisma.storeProduct.count({ where: { productId: f.product.id, isActive: true } }),
    ).toBe(3);
    const types = await prisma.storePriceTypes.findMany();
    expect(
      types.find((p) => p.storeId === b.id && p.variantKey === "BASE")?.retailPriceKgs?.toNumber(),
    ).toBe(0);
    expect(
      types
        .find((p) => p.storeId === b.id && p.variantKey === "BASE")
        ?.wholesalePriceKgs?.toNumber(),
    ).toBe(0);
    expect(
      types.find((p) => p.storeId === c.id && p.variantKey === "BASE")?.retailPriceKgs?.toNumber(),
    ).toBe(120);
    expect(
      types.find((p) => p.storeId === c.id && p.variantKey === v.id)?.retailPriceKgs?.toNumber(),
    ).toBe(150);
    expect(types.some((p) => p.storeId === untouched.id)).toBe(false);
    expect(await prisma.inventorySnapshot.findMany()).toEqual(snapshots);
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it("prepares a bounded fifty-store selection with variants without multiplying product identities", async () => {
    const f = await fixture();
    const stores = Array.from({ length: 50 }, (_, i) => ({
      id: randomUUID(),
      organizationId: f.org.id,
      name: `Destination ${i}`,
      code: `DST-${i}`,
    }));
    await prisma.store.createMany({ data: stores });
    const variants = Array.from({ length: 5 }, (_, i) => ({
      id: randomUUID(),
      productId: f.product.id,
      name: `Size ${i}`,
      attributes: {},
    }));
    await prisma.productVariant.createMany({ data: variants });
    await prisma.storePriceTypes.createMany({
      data: variants.map((v, i) => ({
        organizationId: f.org.id,
        storeId: f.store.id,
        productId: f.product.id,
        variantId: v.id,
        variantKey: v.id,
        retailPriceKgs: 150 + i,
        wholesalePriceKgs: 100 + i,
      })),
    });
    const { result } = await f.apply({ ...f.change, targetStoreIds: stores.map((s) => s.id) });
    expect(result).toMatchObject({ additions: 50, priceChanges: 300 });
    expect(await prisma.product.count()).toBe(1);
    expect(
      await prisma.storePrice.count({ where: { storeId: { in: stores.map((s) => s.id) } } }),
    ).toBe(300);
    expect(await prisma.stockMovement.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "PRODUCT_STORE_PREPARE" } })).toBe(1);
  }, 20_000);

  it("replaces only reviewed store prices, keeps discounts and never clears a value missing at source", async () => {
    const f = await fixture(),
      target = f.stores[0];
    await prisma.storeProduct.create({
      data: {
        organizationId: f.org.id,
        storeId: target.id,
        productId: f.product.id,
        isDirect: true,
      },
    });
    const discountStartsAt = new Date("2026-01-01T00:00:00Z");
    await prisma.storePrice.create({
      data: {
        organizationId: f.org.id,
        storeId: target.id,
        productId: f.product.id,
        priceKgs: 200,
        discountType: "PERCENTAGE",
        discountPercentage: 10,
        discountStartsAt,
        discountEndsAt: new Date("2027-01-01T00:00:00Z"),
      },
    });
    await prisma.storePriceTypes.create({
      data: {
        organizationId: f.org.id,
        storeId: target.id,
        productId: f.product.id,
        retailPriceKgs: 200,
        wholesalePriceKgs: 77,
      },
    });
    await prisma.storePriceTypes.updateMany({
      where: { storeId: f.store.id },
      data: { wholesalePriceKgs: null },
    });
    await f.apply({
      ...f.change,
      targetStoreIds: [target.id],
      prices: "REPLACE",
      addToAssortment: false,
    });
    const p = await prisma.storePrice.findFirstOrThrow({ where: { storeId: target.id } });
    expect(p.priceKgs.toNumber()).toBe(120);
    expect(p.discountPercentage?.toNumber()).toBe(10);
    expect(p.discountStartsAt).toEqual(discountStartsAt);
    expect(
      (
        await prisma.storePriceTypes.findFirstOrThrow({ where: { storeId: target.id } })
      ).wholesalePriceKgs?.toNumber(),
    ).toBe(77);
  });

  it("does not bypass hidden products or disabled catalog sources", async () => {
    const f = await fixture(),
      [hidden, excluded] = f.stores;
    await prisma.storeProduct.create({
      data: {
        organizationId: f.org.id,
        storeId: hidden.id,
        productId: f.product.id,
        isHidden: true,
        isActive: false,
        isDirect: true,
      },
    });
    const change = (await f.caller.stores.catalogSettings({ storeId: excluded.id })).settings!;
    change.connections.push({
      key: `store:${f.store.id}`,
      enabled: false,
      scope: "ALL",
      productIds: [],
    });
    const p = await f.caller.stores.previewCatalogSettings(change);
    await f.caller.stores.saveCatalogSettings({
      change,
      token: p.token,
      idempotencyKey: randomUUID(),
    });
    const preview = await f.review();
    expect(preview.canApply).toBe(false);
    expect(preview.rows.find((r) => r.storeId === hidden.id)?.blocked).toBe("hidden");
    expect(preview.rows.find((r) => r.storeId === excluded.id)?.blocked).toBe("catalog");
    await expect(
      f.caller.products.applyStorePreparation({
        change: f.change,
        token: preview.token,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow("assortmentUseSourceEditor");
    expect(
      await prisma.storePrice.count({ where: { storeId: { in: [hidden.id, excluded.id] } } }),
    ).toBe(0);
  });

  it("rejects a stale preview atomically after a source price changes", async () => {
    const f = await fixture(),
      p = await f.review();
    await prisma.storePriceTypes.updateMany({
      where: { storeId: f.store.id },
      data: { retailPriceKgs: 555 },
    });
    await expect(
      f.caller.products.applyStorePreparation({
        change: f.change,
        token: p.token,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow("productPreparationStale");
    expect(await prisma.storeProduct.count()).toBe(1);
    expect(await prisma.storePrice.count()).toBe(1);
  });

  it("recovers a lost response even after source prices change and closes a late original safely", async () => {
    const f = await fixture(),
      { request, result } = await f.apply();
    await prisma.storePriceTypes.updateMany({
      where: { storeId: f.store.id },
      data: { retailPriceKgs: 999 },
    });
    expect(await f.caller.products.applyStorePreparation(request)).toEqual(result);
    expect(await f.caller.products.reconcileStorePreparation(request)).toMatchObject({
      status: "APPLIED",
      ...result,
    });
    const p = await f.review({ ...f.change, prices: "REPLACE" });
    const canceled = {
      change: { ...f.change, prices: "REPLACE" as const },
      token: p.token,
      idempotencyKey: randomUUID(),
    };
    expect(await f.caller.products.reconcileStorePreparation(canceled)).toEqual({
      status: "CANCELED",
    });
    await expect(f.caller.products.applyStorePreparation(canceled)).rejects.toThrow(
      "productPreparationAttemptClosed",
    );
    expect(await prisma.auditLog.count({ where: { action: "PRODUCT_STORE_PREPARE" } })).toBe(1);
  });

  it("serializes reconciliation racing with the original request without a late double application", async () => {
    const f = await fixture(),
      p = await f.review();
    const request = { change: f.change, token: p.token, idempotencyKey: randomUUID() };
    await Promise.allSettled([
      f.caller.products.applyStorePreparation(request),
      f.caller.products.reconcileStorePreparation(request),
    ]);
    const outcome = await f.caller.products.reconcileStorePreparation(request);
    const audits = await prisma.auditLog.count({ where: { action: "PRODUCT_STORE_PREPARE" } });
    expect(audits).toBe(outcome.status === "APPLIED" ? 1 : 0);
    if (outcome.status === "CANCELED")
      await expect(f.caller.products.applyStorePreparation(request)).rejects.toThrow(
        "productPreparationAttemptClosed",
      );
    else expect((await f.caller.products.applyStorePreparation(request)).additions).toBe(2);
    expect(await prisma.product.count()).toBe(1);
  });

  it("rolls back all stores and prices when audit persistence fails", async () => {
    const f = await fixture(),
      p = await f.review();
    const fail = vi
      .spyOn(audit, "writeAuditLog")
      .mockRejectedValueOnce(new Error("audit unavailable"));
    try {
      await expect(
        f.caller.products.applyStorePreparation({
          change: f.change,
          token: p.token,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toThrow("genericMessage");
    } finally {
      fail.mockRestore();
    }
    expect(await prisma.storeProduct.count()).toBe(1);
    expect(await prisma.storePrice.count()).toBe(1);
    expect(await prisma.idempotencyKey.count()).toBe(0);
  });

  it("rechecks roles, store access and organization scope; a signed token cannot change targets", async () => {
    const f = await fixture(),
      p = await f.review();
    await expect(
      f.caller.products.applyStorePreparation({
        change: { ...f.change, targetStoreIds: [f.stores[2].id] },
        token: p.token,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow("productPreparationStale");
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    await expect(manager.products.previewStorePreparation(f.change)).rejects.toThrow(
      "storeAccessDenied",
    );
    const cashier = createTestCaller({ ...f.cashierUser, organizationId: f.org.id });
    await expect(cashier.products.previewStorePreparation(f.change)).rejects.toThrow();
    await prisma.user.update({ where: { id: f.adminUser.id }, data: { role: "CASHIER" } });
    await expect(
      f.caller.products.applyStorePreparation({
        change: f.change,
        token: p.token,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow();
    expect(await prisma.storeProduct.count()).toBe(1);
  });

  it("preserves correct shared-price inheritance for untouched kinds", async () => {
    const f = await fixture(),
      target = f.stores[0];
    await prisma.storeProduct.create({
      data: {
        organizationId: f.org.id,
        storeId: target.id,
        productId: f.product.id,
        isDirect: true,
      },
    });
    const book = await f.caller.priceBooks.create({ name: "Shared" });
    for (const change of [
      {
        kind: "PRICES" as const,
        entries: [{ productId: f.product.id, retailPriceKgs: 200, wholesalePriceKgs: 90 }],
      },
      { kind: "CONNECT" as const, storeIds: [target.id], preserveLocal: false },
    ]) {
      const p = await f.caller.priceBooks.preview({ bookId: book.id, change });
      await f.caller.priceBooks.publish({
        bookId: book.id,
        change,
        token: p.token,
        idempotencyKey: randomUUID(),
      });
    }
    await f.apply({
      ...f.change,
      targetStoreIds: [target.id],
      addToAssortment: false,
      prices: "REPLACE",
    });
    const binding = await prisma.priceBookStoreItem.findFirstOrThrow({
      where: { storeId: target.id },
    });
    expect(binding.retailShared).toBe(false);
    expect(binding.wholesaleShared).toBe(true);
  });

  it("revalidates a manager's destination access between preview and apply", async () => {
    const f = await fixture();
    await f.apply();
    const target = f.stores[0];
    await prisma.userStoreAccess.create({
      data: { organizationId: f.org.id, userId: f.managerUser.id, storeId: target.id },
    });
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    const change = {
      ...f.change,
      targetStoreIds: [target.id],
      addToAssortment: false,
      prices: "REPLACE" as const,
    };
    const p = await manager.products.previewStorePreparation(change);
    await prisma.userStoreAccess.deleteMany({
      where: { userId: f.managerUser.id, storeId: target.id },
    });
    await expect(
      manager.products.applyStorePreparation({
        change,
        token: p.token,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow("storeAccessDenied");
    expect(await prisma.auditLog.count({ where: { action: "PRODUCT_STORE_PREPARE" } })).toBe(1);
  });

  it("copies canonical KGS values without multiplying a recipient's currency conversion rate", async () => {
    const f = await fixture();
    await prisma.store.update({
      where: { id: f.stores[0].id },
      data: { currencyCode: "USD", currencyRateKgsPerUnit: 87 },
    });
    await f.apply();
    expect(
      (
        await prisma.storePrice.findFirstOrThrow({ where: { storeId: f.stores[0].id } })
      ).priceKgs.toNumber(),
    ).toBe(120);
  });

  it("prevents replay into another organization or modified payload and rejects expired previews", async () => {
    const f = await fixture(),
      p = await f.review();
    const other = await prisma.organization.create({ data: { name: "Other" } });
    const store = await prisma.store.create({
      data: { organizationId: other.id, name: "Foreign", code: "FOR" },
    });
    await expect(f.review({ ...f.change, targetStoreIds: [store.id] })).rejects.toThrow();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 601_000);
    try {
      await expect(
        f.caller.products.applyStorePreparation({
          change: f.change,
          token: p.token,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toThrow("productPreparationStale");
    } finally {
      clock.mockRestore();
    }
    expect(await prisma.storeProduct.count()).toBe(1);
  });

  it("protects concurrent card edits and sends only scoped committed metadata notifications", async () => {
    const f = await fixture();
    await f.apply();
    const before = await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } });
    const publish = vi.spyOn(eventBus, "publish");
    const input = {
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      productId: f.product.id,
      sku: f.product.sku,
      baseUnitId: f.baseUnit.id,
      expectedUpdatedAt: before.updatedAt.toISOString(),
    };
    try {
      const results = await Promise.allSettled(
        ["First", "Second"].map((name) =>
          updateProduct({ ...input, name, requestId: randomUUID() }),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason.message).toBe("productChangedElsewhere");
      const events = publish.mock.calls
        .map((c) => c[0])
        .filter((e) => e.type === "products.updated");
      expect(events).toHaveLength(3);
      expect(
        events.every((e) => e.type === "products.updated" && e.payload.productId === f.product.id),
      ).toBe(true);
      expect(events.map((e) => ("storeId" in e.payload ? e.payload.storeId : ""))).not.toContain(
        f.stores[2].id,
      );
    } finally {
      publish.mockRestore();
    }
  });

  it("does not overwrite newer store prices when an older product form is saved", async () => {
    const f = await fixture();
    const pricing = await f.caller.products.storePricing({ productId: f.product.id });
    const version = pricing.stores.find((s) => s.storeId === f.store.id)!.priceVersion;
    await f.caller.storePrices.upsert({
      productId: f.product.id,
      storeId: f.store.id,
      retailPriceKgs: 321,
    });
    await expect(
      f.caller.products.update({
        productId: f.product.id,
        storeId: f.store.id,
        sku: f.product.sku,
        name: f.product.name,
        baseUnitId: f.baseUnit.id,
        expectedStorePriceVersion: version,
        retailPriceKgs: 120,
      }),
    ).rejects.toThrow("productChangedElsewhere");
    expect(
      (
        await prisma.storePrice.findFirstOrThrow({ where: { storeId: f.store.id } })
      ).priceKgs.toNumber(),
    ).toBe(321);
  });

  it("retains a committed save when notifications fail and protects stale photo-only edits", async () => {
    const f = await fixture();
    const old = await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } });
    const fail = vi.spyOn(eventBus, "publish").mockImplementation(() => {
      throw new Error("notification unavailable");
    });
    try {
      await updateProduct({
        organizationId: f.org.id,
        actorId: f.adminUser.id,
        requestId: randomUUID(),
        productId: f.product.id,
        sku: f.product.sku,
        name: "Committed",
        baseUnitId: f.baseUnit.id,
      });
    } finally {
      fail.mockRestore();
    }
    expect((await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } })).name).toBe(
      "Committed",
    );
    await expect(
      f.caller.products.update({
        productId: f.product.id,
        sku: f.product.sku,
        name: "Ignored",
        baseUnitId: f.baseUnit.id,
        imagesOnly: true,
        expectedUpdatedAt: old.updatedAt.toISOString(),
        images: [],
      }),
    ).rejects.toThrow("productChangedElsewhere");
  });

  it("lists candidates only for this organization and leaves every business record intact", async () => {
    const f = await fixture();
    const duplicate = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        name: f.product.name,
        sku: "DISTINCT",
        unit: f.baseUnit.code,
        baseUnitId: f.baseUnit.id,
      },
    });
    const before = await Promise.all([
      prisma.product.count(),
      prisma.storeProduct.count(),
      prisma.inventorySnapshot.count(),
      prisma.stockMovement.count(),
    ]);
    const review = await f.caller.products.duplicateReview({ page: 1 });
    expect(review.total).toBe(1);
    expect(review.groups[0].products.map((p) => p.id).sort()).toEqual(
      [f.product.id, duplicate.id].sort(),
    );
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    await expect(manager.products.duplicateReview({ page: 1 })).rejects.toThrow();
    expect(
      await Promise.all([
        prisma.product.count(),
        prisma.storeProduct.count(),
        prisma.inventorySnapshot.count(),
        prisma.stockMovement.count(),
      ]),
    ).toEqual(before);
  });
});
