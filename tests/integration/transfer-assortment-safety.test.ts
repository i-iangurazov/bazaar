import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { transferStock } from "@/server/services/inventory";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

(shouldRunDbTests ? describe : describe.skip)("reviewed transfer assortment and identity", () => {
  beforeEach(resetDatabase);
  async function fixture() {
    const f = await seedBase({ plan: "ENTERPRISE" });
    await prisma.product.update({
      where: { id: f.product.id },
      data: { name: "Силикон герметик чёрный 995" },
    });
    await prisma.storeProduct.updateMany({
      where: { productId: f.product.id },
      data: { isDirect: true, isHistorical: false },
    });
    await prisma.inventorySnapshot.create({
      data: { storeId: f.store.id, productId: f.product.id, onHand: 100 },
    });
    const destination = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Recipient", code: "DST" },
    });
    const other = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        name: "Unselected product",
        sku: "OTHER",
        unit: f.baseUnit.code,
        baseUnitId: f.baseUnit.id,
      },
    });
    await prisma.storeProduct.create({
      data: { organizationId: f.org.id, storeId: f.store.id, productId: other.id, isDirect: true },
    });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const config = (await caller.stores.catalogSettings({ storeId: destination.id })).settings!;
    config.connections.push({
      key: `store:${f.store.id}`,
      enabled: false,
      scope: "ALL",
      productIds: [],
    });
    const p = await caller.stores.previewCatalogSettings(config);
    await caller.stores.saveCatalogSettings({
      change: config,
      token: p.token,
      idempotencyKey: randomUUID(),
    });
    const request = {
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      requestId: "reviewed-transfer",
      fromStoreId: f.store.id,
      toStoreId: destination.id,
      lines: [{ productId: f.product.id, qty: 15 }],
      idempotencyKey: randomUUID(),
    };
    const connect = async () => {
      const preview = await caller.stores.previewSelectedCatalogProducts({
        storeId: destination.id,
        selections: [{ productId: f.product.id, sourceKey: `store:${f.store.id}` }],
      });
      const apply = { change: preview.change, token: preview.token, idempotencyKey: randomUUID() };
      await caller.stores.saveCatalogSettings(apply);
      return { preview, apply };
    };
    return { ...f, destination, other, caller, request, connect };
  }
  it("rolls back both stock legs, lots and assignments when sale availability is required", async () => {
    const f = await fixture();
    await expect(
      transferStock({ ...f.request, destinationAssortment: "REQUIRE_SALE" }),
    ).rejects.toMatchObject({ message: "transferDestinationNotSellable" });
    expect(
      (
        await prisma.inventorySnapshot.findFirstOrThrow({
          where: { storeId: f.store.id, productId: f.product.id },
        })
      ).onHand,
    ).toBe(100);
    expect(await prisma.inventorySnapshot.count({ where: { storeId: f.destination.id } })).toBe(0);
    expect(await prisma.stockMovement.count()).toBe(0);
    expect(await prisma.stockLot.count()).toBe(0);
    expect(await prisma.storeProduct.count({ where: { storeId: f.destination.id } })).toBe(0);
  });
  it("posts inventory-only exactly once without exposing the excluded card or copying prices", async () => {
    const f = await fixture();
    const request = { ...f.request, destinationAssortment: "INVENTORY_ONLY" as const };
    const posted = await transferStock(request);
    expect(await transferStock(request)).toEqual(posted);
    expect(await prisma.stockMovement.count()).toBe(2);
    expect(
      (
        await prisma.inventorySnapshot.findFirstOrThrow({
          where: { storeId: f.destination.id, productId: f.product.id },
        })
      ).onHand,
    ).toBe(15);
    expect((await f.caller.products.list({ storeId: f.destination.id })).items).toHaveLength(0);
    expect(await prisma.storePrice.count()).toBe(0);
    await expect(
      transferStock({ ...request, destinationAssortment: "REQUIRE_SALE" }),
    ).rejects.toMatchObject({ message: "idempotencyKeyPayloadMismatch" });
  });
  it("activates an ordinary recipient on a checked transfer without changing the product identity", async () => {
    const f = await fixture();
    const ordinary = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Ordinary", code: "ORD" },
    });
    await transferStock({
      ...f.request,
      toStoreId: ordinary.id,
      destinationAssortment: "REQUIRE_SALE",
    });
    expect((await f.caller.products.list({ storeId: ordinary.id })).items.map((p) => p.id)).toEqual(
      [f.product.id],
    );
    expect(await prisma.product.count()).toBe(2);
  });
  it("does not serialize checked transfers behind an independent assortment reader", async () => {
    const f = await fixture();
    let acquired!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reader = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`assortment:${f.org.id}`}, 0))`;
        acquired();
        await released;
      },
      { timeout: 15000 },
    );
    await ready;
    try {
      await transferStock({ ...f.request, destinationAssortment: "INVENTORY_ONLY" });
      expect(await prisma.stockMovement.count()).toBe(2);
    } finally {
      release();
      await reader;
    }
  });
  it("preserves variant identity and pack conversion in a checked transfer", async () => {
    const f = await fixture();
    await f.connect();
    const variant = await prisma.productVariant.create({
      data: { productId: f.product.id, name: "995 · 600 ml", attributes: {} },
    });
    const pack = await prisma.productPack.create({
      data: {
        organizationId: f.org.id,
        productId: f.product.id,
        packName: "Box",
        multiplierToBase: 10,
      },
    });
    await prisma.inventorySnapshot.create({
      data: {
        storeId: f.store.id,
        productId: f.product.id,
        variantId: variant.id,
        variantKey: variant.id,
        onHand: 20,
      },
    });
    const request = {
      ...f.request,
      destinationAssortment: "REQUIRE_SALE" as const,
      lines: [{ productId: f.product.id, variantId: variant.id, packId: pack.id, qty: 0.5 }],
    };
    const posted = await transferStock(request);
    expect(await transferStock(request)).toEqual(posted);
    const [context] = await f.caller.inventory.transferLineContext({
      fromStoreId: f.store.id,
      toStoreId: f.destination.id,
      lines: [{ productId: f.product.id, variantId: variant.id }],
    });
    expect(context).toMatchObject({
      available: true,
      sourceStock: 15,
      destinationStock: 5,
      variantName: variant.name,
      destinationInAssortment: true,
    });
    expect(
      (
        await prisma.inventorySnapshot.findFirstOrThrow({
          where: { storeId: f.store.id, productId: f.product.id, variantKey: "BASE" },
        })
      ).onHand,
    ).toBe(100);
    expect((await prisma.stockMovement.findMany({ orderBy: { qtyDelta: "asc" } })).map((m) => [m.variantId, m.qtyDelta])).toEqual([
      [variant.id, -5],
      [variant.id, 5],
    ]);
  });
  it("reopens only explicitly selected products from a disabled ALL source and preserves zero prices", async () => {
    const f = await fixture();
    await prisma.storePrice.create({
      data: {
        organizationId: f.org.id,
        storeId: f.destination.id,
        productId: f.product.id,
        priceKgs: 0,
      },
    });
    const { preview, apply } = await f.connect();
    expect(preview).toMatchObject({ added: 1, hidden: 0, otherImpacts: [] });
    expect(preview.change.connections.find((c) => c.key === `store:${f.store.id}`)).toMatchObject({
      enabled: true,
      scope: "SELECTED",
      productIds: [f.product.id],
    });
    await f.caller.stores.saveCatalogSettings(apply);
    expect(
      (await f.caller.products.list({ storeId: f.destination.id })).items.map((p) => p.id),
    ).toEqual([f.product.id]);
    expect(await prisma.stockMovement.count()).toBe(0);
    expect((await prisma.storePrice.findFirstOrThrow()).priceKgs.toNumber()).toBe(0);
    expect(
      await prisma.storeProduct.findFirst({
        where: { storeId: f.destination.id, productId: f.other.id },
      }),
    ).toBeNull();
  });
  it("makes received inventory visible without a second movement or rewriting history", async () => {
    const f = await fixture();
    await transferStock({ ...f.request, destinationAssortment: "INVENTORY_ONLY" });
    const before = await prisma.stockMovement.findMany({ orderBy: { id: "asc" } });
    await f.connect();
    expect(await prisma.stockMovement.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    expect((await f.caller.products.list({ storeId: f.destination.id })).items[0]).toMatchObject({
      id: f.product.id,
      onHandQty: 15,
    });
  });
  it("keeps local hidden products hidden even with explicit source selection", async () => {
    const f = await fixture();
    await prisma.storeProduct.create({
      data: {
        organizationId: f.org.id,
        storeId: f.destination.id,
        productId: f.product.id,
        isActive: false,
        isHidden: true,
        isDirect: true,
      },
    });
    expect(
      (
        await f.caller.stores.catalogProductOptions({
          storeId: f.destination.id,
          productIds: [f.product.id],
        })
      )[0].hidden,
    ).toBe(true);
    await expect(f.connect()).rejects.toMatchObject({ message: "assortmentUseSourceEditor" });
    await expect(
      transferStock({ ...f.request, destinationAssortment: "REQUIRE_SALE" }),
    ).rejects.toMatchObject({ message: "transferDestinationNotSellable" });
    expect(await prisma.stockMovement.count()).toBe(0);
  });
  it("rejects stale reviewed source settings without dropping concurrent changes", async () => {
    const f = await fixture();
    const preview = await f.caller.stores.previewSelectedCatalogProducts({
      storeId: f.destination.id,
      selections: [{ productId: f.product.id, sourceKey: `store:${f.store.id}` }],
    });
    await prisma.product.update({
      where: { id: f.product.id },
      data: { name: "Changed after preview" },
    });
    await expect(
      f.caller.stores.saveCatalogSettings({
        change: preview.change,
        token: preview.token,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ message: "assortmentPreviewStale" });
    expect((await f.caller.products.list({ storeId: f.destination.id })).items).toHaveLength(0);
  });
  it("uses the original catalog for goods inherited by an intermediate warehouse", async () => {
    const f = await fixture();
    const warehouse = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Intermediate", code: "MID" },
    });
    const config = (await f.caller.stores.catalogSettings({ storeId: warehouse.id })).settings!;
    config.connections.push({
      key: `store:${f.store.id}`,
      enabled: true,
      scope: "ALL",
      productIds: [],
    });
    const p = await f.caller.stores.previewCatalogSettings(config);
    await f.caller.stores.saveCatalogSettings({
      change: config,
      token: p.token,
      idempotencyKey: randomUUID(),
    });
    const options = await f.caller.stores.catalogProductOptions({
      storeId: f.destination.id,
      productIds: [f.product.id],
    });
    expect(options[0].sources.map((s) => s.key)).toContain(`store:${f.store.id}`);
    expect(options[0].sources.map((s) => s.key)).not.toContain(`store:${warehouse.id}`);
    await expect(
      f.caller.stores.previewSelectedCatalogProducts({
        storeId: f.destination.id,
        selections: [{ productId: f.product.id, sourceKey: `store:${warehouse.id}` }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("identifies same-name cards and their independent balances without combining them", async () => {
    const f = await fixture();
    const copy = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        name: "Силикон герметик чёрный 995",
        sku: "SEPARATE-CARD",
        unit: f.baseUnit.code,
        baseUnitId: f.baseUnit.id,
      },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: f.org.id,
        storeId: f.destination.id,
        productId: copy.id,
        isDirect: true,
      },
    });
    await prisma.inventorySnapshot.create({
      data: { storeId: f.destination.id, productId: copy.id, onHand: 20 },
    });
    await transferStock({ ...f.request, destinationAssortment: "INVENTORY_ONLY" });
    const [context] = await f.caller.inventory.transferLineContext({
      fromStoreId: f.store.id,
      toStoreId: f.destination.id,
      lines: [{ productId: f.product.id }],
    });
    expect(context).toMatchObject({
      available: true,
      destinationStock: 15,
      destinationRequiresAssortment: true,
      destinationCandidates: [{ id: copy.id, sku: copy.sku, onHand: 20, inAssortment: true }],
    });
    expect(
      (
        await f.caller.inventory.productStockIdentity({
          storeId: f.destination.id,
          productId: copy.id,
        })
      )[0],
    ).toMatchObject({ id: f.product.id, onHand: 15, inAssortment: false });
    expect(
      (
        await prisma.inventorySnapshot.findFirstOrThrow({
          where: { storeId: f.destination.id, productId: copy.id },
        })
      ).onHand,
    ).toBe(20);
  });
  it("does not leak tenant/store candidates and does not give managers catalog configuration rights", async () => {
    const f = await fixture();
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    await expect(
      manager.inventory.productStockIdentity({
        storeId: f.destination.id,
        productId: f.product.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      manager.stores.catalogProductOptions({
        storeId: f.destination.id,
        productIds: [f.product.id],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const org = await prisma.organization.create({ data: { name: "Other org" } });
    const otherStore = await prisma.store.create({
      data: { organizationId: org.id, name: "Other", code: "OTH" },
    });
    await expect(
      f.caller.stores.catalogProductOptions({ storeId: otherStore.id, productIds: [f.product.id] }),
    ).rejects.toBeDefined();
    await expect(
      f.caller.inventory.productStockIdentity({ storeId: otherStore.id, productId: f.product.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      f.caller.stores.previewSelectedCatalogProducts({
        storeId: f.destination.id,
        selections: [{ productId: f.product.id, sourceKey: `store:${otherStore.id}` }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("checks the actual state at posting after a previously available card was hidden", async () => {
    const f = await fixture();
    await f.connect();
    const input = {
      fromStoreId: f.store.id,
      toStoreId: f.destination.id,
      lines: [{ productId: f.product.id }],
    };
    expect((await f.caller.inventory.transferLineContext(input))[0]).toMatchObject({
      destinationInAssortment: true,
    });
    await f.caller.products.setStoreVisibility({
      storeId: f.destination.id,
      productIds: [f.product.id],
      hidden: true,
    });
    await expect(
      f.caller.inventory.transfer({ ...f.request, destinationAssortment: "REQUIRE_SALE" }),
    ).rejects.toMatchObject({ message: "transferDestinationNotSellable" });
    expect(await prisma.stockMovement.count()).toBe(0);
  });
});
