import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import * as audit from "@/server/services/audit";
import type { ProductPricePatch } from "@/lib/productPriceAutosave";
(shouldRunDbTests ? describe : describe.skip)("guarded product price autosave", () => {
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
    await prisma.storePrice.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        productId: f.product.id,
        priceKgs: 900,
        discountType: "PERCENTAGE",
        discountPercentage: 5,
      },
    });
    await prisma.storePriceTypes.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        productId: f.product.id,
        retailPriceKgs: 900,
        wholesalePriceKgs: 750,
      },
    });
    await prisma.productCost.create({
      data: { organizationId: f.org.id, productId: f.product.id, avgCostKgs: 400 },
    });
    await prisma.productBarcode.create({
      data: { organizationId: f.org.id, productId: f.product.id, value: "1234567890123" },
    });
    await prisma.inventorySnapshot.create({
      data: { storeId: f.store.id, productId: f.product.id, onHand: 23 },
    });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const request = async (prices: ProductPricePatch[] = [{ wholesalePriceKgs: 800 }]) => ({
      productId: f.product.id,
      storeId: f.store.id,
      unitId: f.baseUnit.id,
      currencyCode: "KGS" as const,
      currencyRateKgsPerUnit: 1,
      expectedVersion: (
        await caller.products.storePricing({ productId: f.product.id })
      ).stores.find((s) => s.storeId === f.store.id)!.priceVersion,
      idempotencyKey: randomUUID(),
      prices,
    });
    const read = () =>
      prisma.storePriceTypes.findFirstOrThrow({
        where: { storeId: f.store.id, productId: f.product.id, variantKey: "BASE" },
      });
    const untouched = () =>
      Promise.all([
        prisma.product.findMany(),
        prisma.productCost.findMany(),
        prisma.productBarcode.findMany(),
        prisma.inventorySnapshot.findMany(),
        prisma.stockMovement.findMany(),
        prisma.storeProduct.findMany(),
      ]);
    return { ...f, caller, request, read, untouched };
  }
  it("saves only requested price fields and keeps all product, cost, stock, barcode and assortment records", async () => {
    const f = await fixture(),
      before = await f.untouched(),
      standard = await prisma.storePrice.findFirstOrThrow();
    const r = await f.caller.storePrices.autosave(await f.request());
    expect(r.status).toBe("SAVED");
    expect(r.changed).toBe(true);
    expect(Number((await f.read()).wholesalePriceKgs)).toBe(800);
    expect(Number((await f.read()).retailPriceKgs)).toBe(900);
    expect(await prisma.storePrice.findFirstOrThrow()).toEqual(standard);
    expect(await f.untouched()).toEqual(before);
    expect(await prisma.auditLog.count({ where: { action: "PRODUCT_PRICE_AUTOSAVE" } })).toBe(1);
  });
  it("replays a lost response without another write or audit and rejects changed payloads on the same key", async () => {
    const f = await fixture(),
      request = await f.request(),
      r = await f.caller.storePrices.autosave(request);
    expect(await f.caller.storePrices.autosave(request)).toEqual(r);
    expect(await f.caller.storePrices.reconcileAutosave(request)).toEqual(r);
    expect(await prisma.auditLog.count({ where: { action: "PRODUCT_PRICE_AUTOSAVE" } })).toBe(1);
    await expect(
      f.caller.storePrices.autosave({ ...request, prices: [{ wholesalePriceKgs: 850 }] }),
    ).rejects.toMatchObject({ message: "idempotencyKeyPayloadMismatch" });
  });
  it("rejects the late stale edit that the previous quick endpoint accepted", async () => {
    const f = await fixture(),
      first = await f.request(),
      late = await f.request([{ wholesalePriceKgs: 760 }]);
    await f.caller.storePrices.autosave(first);
    await expect(f.caller.storePrices.autosave(late)).rejects.toMatchObject({
      message: "priceAutosaveConflict",
    });
    expect(Number((await f.read()).wholesalePriceKgs)).toBe(800);
  });
  it("serializes competing tabs: one writes and the other gets a conflict", async () => {
    const f = await fixture(),
      a = await f.request(),
      b = await f.request([{ wholesalePriceKgs: 760 }]);
    const r = await Promise.allSettled([
      f.caller.storePrices.autosave(a),
      f.caller.storePrices.autosave(b),
    ]);
    expect(r.filter((v) => v.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((v) => v.status === "rejected")).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: "PRODUCT_PRICE_AUTOSAVE" } })).toBe(1);
  });
  it("closes uncommitted requests so late originals cannot overwrite the next edit", async () => {
    const f = await fixture(),
      request = await f.request();
    expect(await f.caller.storePrices.reconcileAutosave(request)).toEqual({ status: "CANCELED" });
    await expect(f.caller.storePrices.autosave(request)).rejects.toMatchObject({
      message: "priceAutosaveAttemptClosed",
    });
    expect(Number((await f.read()).wholesalePriceKgs)).toBe(750);
  });
  it("makes applying and reconciling the same request race safely", async () => {
    const f = await fixture(),
      request = await f.request();
    const [saved, checked] = await Promise.allSettled([
      f.caller.storePrices.autosave(request),
      f.caller.storePrices.reconcileAutosave(request),
    ]);
    expect(checked.status).toBe("fulfilled");
    if (checked.status === "fulfilled" && checked.value.status === "CANCELED") {
      expect(saved.status).toBe("rejected");
      expect(Number((await f.read()).wholesalePriceKgs)).toBe(750);
    } else {
      expect(saved.status).toBe("fulfilled");
      expect(Number((await f.read()).wholesalePriceKgs)).toBe(800);
    }
  });
  it("rolls back both prices and the idempotency receipt if auditing fails", async () => {
    const f = await fixture(),
      request = await f.request([{ retailPriceKgs: 1000, wholesalePriceKgs: 800 }]);
    const spy = vi.spyOn(audit, "writeAuditLog").mockRejectedValue(new Error("audit unavailable"));
    try {
      await expect(f.caller.storePrices.autosave(request)).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(Number((await f.read()).retailPriceKgs)).toBe(900);
    expect(Number((await f.read()).wholesalePriceKgs)).toBe(750);
    await f.caller.storePrices.autosave(request);
    expect(Number((await f.read()).retailPriceKgs)).toBe(1000);
  });
  it("preserves zero, clears only optional wholesale, and forbids empty base retail", async () => {
    const f = await fixture();
    await f.caller.storePrices.autosave(
      await f.request([{ retailPriceKgs: 0, wholesalePriceKgs: null }]),
    );
    expect(Number((await f.read()).retailPriceKgs)).toBe(0);
    expect((await f.read()).wholesalePriceKgs).toBeNull();
    await expect(
      f.caller.storePrices.autosave(await f.request([{ retailPriceKgs: null }])),
    ).rejects.toMatchObject({ message: "retailPriceRequired" });
  });
  it("does not materialize a same-value fallback or detach shared prices on a no-op", async () => {
    const f = await fixture(),
      book = await f.caller.priceBooks.create({ name: "Common" });
    for (const change of [
      {
        kind: "PRICES" as const,
        entries: [{ productId: f.product.id, retailPriceKgs: 900, wholesalePriceKgs: 750 }],
      },
      { kind: "CONNECT" as const, storeIds: [f.store.id], preserveLocal: false },
    ]) {
      const p = await f.caller.priceBooks.preview({ bookId: book.id, change });
      await f.caller.priceBooks.publish({
        bookId: book.id,
        change,
        token: p.token,
        idempotencyKey: randomUUID(),
      });
    }
    const binding = await prisma.priceBookStoreItem.findMany(),
      before = await prisma.storePriceTypes.findMany();
    expect(
      (
        await f.caller.storePrices.autosave(
          await f.request([{ retailPriceKgs: 900, wholesalePriceKgs: 750 }]),
        )
      ).changed,
    ).toBe(false);
    expect(await prisma.priceBookStoreItem.findMany()).toEqual(binding);
    expect(await prisma.storePriceTypes.findMany()).toEqual(before);
    await f.caller.storePrices.autosave(await f.request([{ wholesalePriceKgs: 800 }]));
    expect(await prisma.priceBookStoreItem.findFirstOrThrow()).toMatchObject({
      retailShared: true,
      wholesaleShared: false,
    });
  });
  it("uses the saved base fallback without creating a retail override", async () => {
    const f = await fixture();
    await prisma.storePrice.deleteMany();
    await prisma.storePriceTypes.deleteMany();
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 900 } });
    const r = await f.caller.storePrices.autosave(await f.request([{ retailPriceKgs: 900 }]));
    expect(r.changed).toBe(false);
    expect(await prisma.storePrice.count()).toBe(0);
    expect(await prisma.storePriceTypes.count()).toBe(0);
  });
  it("changes only the specified persisted variant and clears its retail override correctly", async () => {
    const f = await fixture(),
      v = await prisma.productVariant.create({
        data: { productId: f.product.id, name: "Selected", attributes: {} },
      });
    await f.caller.storePrices.autosave(
      await f.request([{ variantId: v.id, retailPriceKgs: 50, wholesalePriceKgs: 40 }]),
    );
    expect(Number((await f.read()).retailPriceKgs)).toBe(900);
    await f.caller.storePrices.autosave(
      await f.request([{ variantId: v.id, retailPriceKgs: null }]),
    );
    expect(await prisma.storePrice.count({ where: { variantId: v.id } })).toBe(0);
    expect(
      (await prisma.storePriceTypes.findFirstOrThrow({ where: { variantId: v.id } }))
        .retailPriceKgs,
    ).toBeNull();
    await expect(
      f.caller.storePrices.autosave(await f.request([{ variantId: "unknown", retailPriceKgs: 4 }])),
    ).rejects.toMatchObject({ message: "variantMismatch" });
  });
  it("checks currency and unit snapshots and retains canonical KGS for a USD editor", async () => {
    const f = await fixture(),
      old = await f.request();
    await prisma.store.update({
      where: { id: f.store.id },
      data: { currencyCode: "USD", currencyRateKgsPerUnit: 87 },
    });
    await expect(f.caller.storePrices.autosave(old)).rejects.toMatchObject({
      message: "priceAutosaveConflict",
    });
    await f.caller.storePrices.autosave({
      ...(await f.request([{ retailPriceKgs: 870 }])),
      currencyCode: "USD",
      currencyRateKgsPerUnit: 87,
    });
    expect(Number((await f.read()).retailPriceKgs)).toBe(870);
    await expect(
      f.caller.storePrices.autosave({
        ...(await f.request()),
        currencyCode: "USD",
        currencyRateKgsPerUnit: 87,
        unitId: "wrong",
      }),
    ).rejects.toMatchObject({ message: "priceAutosaveConflict" });
  });
  it("freshly enforces roles, access, organization, plan and disabled price modes", async () => {
    const f = await fixture(),
      request = await f.request();
    const staff = createTestCaller({ ...f.staffUser, organizationId: f.org.id });
    await expect(staff.storePrices.autosave(request)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const org = await prisma.organization.create({ data: { name: "Other" } }),
      store = await prisma.store.create({
        data: { organizationId: org.id, name: "Other", code: "OTH" },
      });
    await expect(
      f.caller.storePrices.autosave({ ...request, storeId: store.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.user.update({
      where: { id: f.adminUser.id },
      data: { role: "STAFF", isOrgOwner: false },
    });
    await expect(f.caller.storePrices.autosave(request)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await prisma.user.update({
      where: { id: f.adminUser.id },
      data: { role: "ADMIN", isOrgOwner: true },
    });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { retailWholesaleEnabled: false },
    });
    await expect(f.caller.storePrices.autosave(request)).rejects.toMatchObject({
      message: "retailWholesaleDisabled",
    });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { retailWholesaleEnabled: true, plan: "STARTER" },
    });
    await expect(f.caller.storePrices.autosave(request)).rejects.toMatchObject({
      message: "featureLockedStorePrices",
    });
  });
  it("uses the acknowledged price version for a later full metadata save", async () => {
    const f = await fixture(),
      request = await f.request(),
      receipt = await f.caller.storePrices.autosave(request);
    await f.caller.products.update({
      productId: f.product.id,
      storeId: f.store.id,
      name: "Saved metadata",
      sku: f.product.sku,
      baseUnitId: f.baseUnit.id,
      barcodes: ["1234567890123"],
      expectedUpdatedAt: f.product.updatedAt.toISOString(),
      expectedStorePriceVersion: receipt.version,
    });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } })).name).toBe(
      "Saved metadata",
    );
    expect(Number((await f.read()).wholesalePriceKgs)).toBe(800);
  });
  it("rejects a replay after store access is revoked and cannot grant a hidden assortment", async () => {
    const f = await fixture(),
      manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id }),
      request = await f.request();
    await manager.storePrices.autosave(request);
    await prisma.userStoreAccess.deleteMany({ where: { userId: f.managerUser.id } });
    await expect(manager.storePrices.autosave(request)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await prisma.storeProduct.updateMany({
      where: { productId: f.product.id, storeId: f.store.id },
      data: { isHidden: true },
    });
    await expect(
      f.caller.storePrices.autosave({ ...request, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(Number((await f.read()).wholesalePriceKgs)).toBe(800);
  });
  it("cannot change metadata, balances, another product's variant or omit the version guard", async () => {
    const f = await fixture(),
      request = await f.request(),
      before = await f.untouched();
    for (const change of [
      { ...request, name: "Injected" },
      { ...request, onHand: 999 },
      { ...request, expectedVersion: undefined },
      { ...request, prices: [{ retailPriceKgs: -1 }] },
      { ...request, prices: [{ retailPriceKgs: 1 }, { variantId: null, retailPriceKgs: 2 }] },
    ]) {
      await expect(f.caller.storePrices.autosave(change as typeof request)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    expect(await f.untouched()).toEqual(before);
  });
});
