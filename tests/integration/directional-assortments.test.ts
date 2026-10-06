import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as audit from "@/server/services/audit";
import { prisma } from "@/server/db/prisma";
import { createProduct, importProducts } from "@/server/services/products";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";
import type { AssortmentChange } from "@/server/services/storeAssortments";

const suite = shouldRunDbTests ? describe : describe.skip;
suite("directional assortment policy", () => {
  beforeEach(resetDatabase);
  async function fixture() {
    const base = await seedBase({ plan: "ENTERPRISE", allowNegativeStock: true });
    const { org, store: a, adminUser, baseUnit } = base;
    const [b, c] = await Promise.all(
      ["B", "C"].map((code) =>
        prisma.store.create({ data: { organizationId: org.id, name: code, code } }),
      ),
    );
    const caller = createTestCaller({ ...adminUser, organizationId: org.id });
    const create = (storeId: string, name: string) =>
      createProduct({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: randomUUID(),
        storeId,
        name,
        sku: name,
        baseUnitId: baseUnit.id,
      });
    const [a1, a2, b1, c1] = await Promise.all([
      create(a.id, "a1"),
      create(a.id, "a2"),
      create(b.id, "b1"),
      create(c.id, "c1"),
    ]);
    const visible = async (storeId: string) =>
      (
        await prisma.storeProduct.findMany({
          where: { storeId, isActive: true },
          select: { productId: true },
        })
      )
        .map((r) => r.productId)
        .sort();
    const share = (
      sourceStoreId: string,
      targetStoreIds: string[],
      extra: Partial<Extract<AssortmentChange, { action: "SHARE" }>> = {},
    ): AssortmentChange => ({
      action: "SHARE",
      sourceStoreId,
      targetStoreIds,
      scope: "ALL",
      includeFuture: true,
      productIds: [],
      mutual: false,
      ...extra,
    });
    const apply = async (change: AssortmentChange) => {
      const preview = await caller.stores.previewAssortmentShare(change);
      return caller.stores.applyAssortmentShare({
        change,
        previewToken: preview.previewToken,
        idempotencyKey: randomUUID(),
      });
    };
    return { ...base, a, b, c, a1, a2, b1, c1, caller, create, visible, share, apply };
  }

  it("shares identities one way, never cascades received products, and keeps exact inventory/product/price records", async () => {
    const f = await fixture();
    await prisma.inventorySnapshot.updateMany({
      where: { productId: f.a1.id },
      data: { onHand: 17, onOrder: 3 },
    });
    await prisma.stockMovement.create({
      data: {
        storeId: f.a.id,
        productId: f.a1.id,
        type: "RECEIVE",
        qtyDelta: 17,
        unitCostKgs: 25,
        lineTotalKgs: 425,
        referenceType: "TEST",
        referenceId: "protected-history",
      },
    });
    await prisma.storePrice.create({
      data: { organizationId: f.org.id, storeId: f.b.id, productId: f.b1.id, priceKgs: 77 },
    });
    const snapshot = async () => ({
      products: await prisma.product.findMany({ orderBy: { id: "asc" } }),
      inventory: await prisma.inventorySnapshot.findMany({ orderBy: { id: "asc" } }),
      movements: await prisma.stockMovement.findMany({ orderBy: { id: "asc" } }),
      prices: await prisma.storePrice.findMany({ orderBy: { id: "asc" } }),
      costs: await prisma.productCost.findMany({ orderBy: { id: "asc" } }),
      policies: await prisma.reorderPolicy.findMany({ orderBy: { id: "asc" } }),
    });
    const before = await snapshot(),
      sourceBefore = await f.visible(f.a.id);
    await f.apply(f.share(f.a.id, [f.b.id]));
    expect(await f.visible(f.b.id)).toEqual([f.a1.id, f.a2.id, f.b1.id].sort());
    expect(await f.visible(f.a.id)).toEqual(sourceBefore);
    expect(await f.visible(f.c.id)).toEqual([f.c1.id]);
    expect(await snapshot()).toEqual(before);
    await f.apply(f.share(f.b.id, [f.c.id]));
    expect(await f.visible(f.c.id)).toEqual([f.b1.id, f.c1.id].sort());
    const b2 = await f.create(f.b.id, "b2");
    expect(await f.visible(f.a.id)).not.toContain(b2.id);
    expect(await f.visible(f.c.id)).toContain(b2.id);
    expect(await f.visible(f.c.id)).not.toContain(f.a1.id);
    await f.apply(f.share(f.a.id, [f.c.id]));
    await f.apply(f.share(f.a.id, [f.c.id]));
    expect(await f.visible(f.c.id)).toEqual([f.a1.id, f.a2.id, f.b1.id, b2.id, f.c1.id].sort());
    expect(await prisma.assortmentGrant.count({ where: { productId: f.a1.id } })).toBe(2);
  });

  it("supports fixed/current-only scope and retained pause/resume without duplicate grants", async () => {
    const f = await fixture();
    await f.apply(
      f.share(f.a.id, [f.b.id], { scope: "SELECTED", productIds: [f.a1.id], includeFuture: false }),
    );
    await f.apply(f.share(f.a.id, [f.c.id], { includeFuture: false }));
    const a3 = await f.create(f.a.id, "a3");
    expect(await f.visible(f.b.id)).toEqual([f.a1.id, f.b1.id].sort());
    expect(await f.visible(f.c.id)).not.toContain(a3.id);
    await f.apply(f.share(f.a.id, [f.b.id]));
    const rule = await prisma.assortmentRule.findUniqueOrThrow({
      where: { sourceStoreId_targetStoreId: { sourceStoreId: f.a.id, targetStoreId: f.b.id } },
    });
    const beforePause = await f.visible(f.b.id);
    await f.apply({ action: "PAUSE", ruleIds: [rule.id] });
    const a4 = await f.create(f.a.id, "a4");
    expect(await f.visible(f.b.id)).toEqual(beforePause);
    await f.apply({ action: "RESUME", ruleIds: [rule.id] });
    await f.apply({ action: "RESUME", ruleIds: [rule.id] });
    expect(await f.visible(f.b.id)).toContain(a4.id);
    expect(await prisma.assortmentGrant.count({ where: { ruleId: rule.id } })).toBe(4);
  });

  it("exits legacy membership without guessing historical ownership and blocks legacy imports from exporting new recipient products", async () => {
    const f = await fixture();
    const group = await prisma.productCatalog.create({
      data: { organizationId: f.org.id, name: "Original group" },
    });
    await prisma.store.updateMany({
      where: { organizationId: f.org.id },
      data: { productCatalogId: group.id },
    });
    // The original fixture product predates provenance and is deliberately unresolved.
    const change = f.share(f.a.id, [f.b.id]);
    const preview = await f.caller.stores.previewAssortmentShare(change);
    expect(preview.sourceReview[0]).toMatchObject({ unresolved: 1, eligible: 2 });
    expect(preview.legacyExits[0].peers).toEqual(expect.arrayContaining([f.a.name, f.c.name]));
    await f.caller.stores.applyAssortmentShare({
      change,
      previewToken: preview.previewToken,
      idempotencyKey: "convert",
    });
    expect(await f.visible(f.b.id)).not.toContain(f.product.id);
    const b2 = await f.create(f.b.id, "b2");
    await importProducts({
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      requestId: "import-b",
      storeId: f.b.id,
      rows: [{ sku: "b-import", name: "B import", unit: "each" }],
    });
    const imported = await prisma.product.findFirstOrThrow({ where: { sku: "b-import" } });
    for (const storeId of [f.a.id, f.c.id]) {
      expect(await f.visible(storeId)).not.toContain(b2.id);
      expect(await f.visible(storeId)).not.toContain(imported.id);
    }
    const a3 = await f.create(f.a.id, "a3");
    expect(await f.visible(f.c.id)).toContain(a3.id); // Unaffected legacy peers still share.
    expect(await f.visible(f.b.id)).toContain(a3.id); // Explicit A → B remains active.
    await expect(
      f.caller.stores.updateProductCatalog({ storeId: f.b.id, productCatalogId: group.id }),
    ).rejects.toThrow("assortmentUseDirectedEditor");
    await f.apply(
      f.share(f.a.id, [f.b.id], {
        scope: "SELECTED",
        includeFuture: false,
        productIds: [f.product.id],
        label: "Reviewed source",
      }),
    );
    expect(await f.visible(f.b.id)).toContain(f.product.id);
    expect((await prisma.productCatalog.findUniqueOrThrow({ where: { id: group.id } })).name).toBe(
      "Original group",
    );
    expect(
      (
        await prisma.storeProduct.findUniqueOrThrow({
          where: { storeId_productId: { storeId: f.b.id, productId: f.product.id } },
        })
      ).isDirect,
    ).toBe(false);
  });

  it("rejects stale/cross-tenant previews, retries atomically, and permits only one concurrent configuration", async () => {
    const f = await fixture();
    const change = f.share(f.a.id, [f.b.id, f.c.id]);
    const old = await f.caller.stores.previewAssortmentShare(change);
    await f.create(f.a.id, "new-after-preview");
    await expect(
      f.caller.stores.applyAssortmentShare({
        change,
        previewToken: old.previewToken,
        idempotencyKey: "old",
      }),
    ).rejects.toThrow("assortmentPreviewStale");
    expect(await prisma.assortmentRule.count()).toBe(0);
    const current = await f.caller.stores.previewAssortmentShare(change);
    const payload = { change, previewToken: current.previewToken, idempotencyKey: "same-request" };
    const [first, replay] = await Promise.all([
      f.caller.stores.applyAssortmentShare(payload),
      f.caller.stores.applyAssortmentShare(payload),
    ]);
    expect(replay).toEqual(first);
    expect(await prisma.assortmentRule.count()).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "ASSORTMENT_SHARE" } })).toBe(1);
    const c1 = f.share(f.a.id, [f.b.id], { label: "first" }),
      c2 = f.share(f.a.id, [f.b.id], { label: "second" });
    const [p1, p2] = await Promise.all([
      f.caller.stores.previewAssortmentShare(c1),
      f.caller.stores.previewAssortmentShare(c2),
    ]);
    const results = await Promise.allSettled([
      f.caller.stores.applyAssortmentShare({
        change: c1,
        previewToken: p1.previewToken,
        idempotencyKey: "one",
      }),
      f.caller.stores.applyAssortmentShare({
        change: c2,
        previewToken: p2.previewToken,
        idempotencyKey: "two",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const foreign = await prisma.organization.create({ data: { name: "Foreign" } });
    const foreignStore = await prisma.store.create({
      data: { organizationId: foreign.id, name: "Foreign", code: "F" },
    });
    await expect(
      f.caller.stores.previewAssortmentShare(f.share(f.a.id, [f.b.id, foreignStore.id])),
    ).rejects.toThrow("storeNotFound");
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    await expect(manager.stores.previewAssortmentShare(change)).rejects.toThrow();
  });

  it("allows shared card edits while keeping unrelated products and ownership operations protected", async () => {
    const f = await fixture();
    await f.apply(f.share(f.a.id, [f.b.id]));
    await prisma.userStoreAccess.deleteMany({ where: { userId: f.managerUser.id } });
    await prisma.userStoreAccess.create({
      data: { organizationId: f.org.id, userId: f.managerUser.id, storeId: f.b.id },
    });
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    const oldImage = await prisma.productImage.create({
      data: { organizationId: f.org.id, productId: f.a1.id, url: "https://photos.example.com/old.webp" },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: f.a1.id, name: "Original variant", attributes: {} },
    });
    const imageFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No redownload"));
    try {
      await manager.products.update({
        productId: f.a1.id, imagesOnly: true,
        sku: f.a1.sku, name: "Ignored media-save name", baseUnitId: f.baseUnit.id,
        images: [
          { url: `/uploads/product-images/${f.org.id}/shared-photo.webp` },
          { id: oldImage.id, url: oldImage.url },
        ],
        variants: [{ id: variant.id, name: "Ignored variant edit", imageId: oldImage.id }],
      });
      expect(imageFetch).not.toHaveBeenCalled();
    } finally {
      imageFetch.mockRestore();
    }
    const photographedVariant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(photographedVariant.name).toBe("Original variant");
    expect(photographedVariant.imageId).toBe(oldImage.id);
    const photographed = await prisma.product.findUniqueOrThrow({ where: { id: f.a1.id } });
    expect(photographed.name).toBe(f.a1.name);
    expect(photographed.photoUrl).toContain("shared-photo.webp");
    await expect(manager.products.update({
      productId: f.c1.id, imagesOnly: true,
      sku: f.c1.sku, name: f.c1.name, baseUnitId: f.baseUnit.id,
      images: [{ url: `/uploads/product-images/${f.org.id}/forbidden-photo.webp` }],
    })).rejects.toThrow("productAccessDenied");
    await manager.products.inlineUpdate({ productId: f.a1.id, patch: { name: "Shared edit" } });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: f.a1.id } })).name).toBe("Shared edit");
    await manager.products.update({
      productId: f.a1.id, storeId: f.b.id, sku: f.a1.sku,
      name: "Shared complete edit", baseUnitId: f.baseUnit.id,
      description: "Visible in both stores", barcodes: ["SHARED-EDIT-123"],
      variants: [{ id: variant.id, name: "Edited variant", attributes: {} }],
    });
    expect((await f.caller.products.getById({ productId: f.a1.id }))?.name).toBe("Shared complete edit");
    expect((await manager.products.getById({ productId: f.a1.id }))?.name).toBe("Shared complete edit");
    expect(await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).toMatchObject({ name: "Edited variant" });
    await expect(manager.products.inlineUpdate({ productId: f.c1.id, patch: { name: "Forbidden" } })).rejects.toThrow("productAccessDenied");
    await expect(manager.products.archive({ productId: f.a1.id })).rejects.toThrow("productAccessDenied");
    await expect(
      manager.products.bulkGenerateBarcodes({ mode: "CODE128", filter: { productIds: [f.a1.id] } }),
    ).rejects.toThrow("productAccessDenied");
    const bulk = await manager.products.bulkGenerateBarcodes({
      mode: "CODE128",
      filter: { storeId: f.b.id },
    });
    expect(bulk.generatedCount).toBe(1);
    expect(await prisma.productBarcode.count({ where: { productId: f.a1.id, value: "SHARED-EDIT-123" } })).toBe(1);
    const quickCopy = await manager.products.duplicate({
      productId: f.a1.id, idempotencyKey: "quick-local-copy",
    });
    expect(await f.visible(f.b.id)).toContain(quickCopy.productId);
    expect(await f.visible(f.a.id)).not.toContain(quickCopy.productId);
    expect(await f.visible(f.c.id)).not.toContain(quickCopy.productId);
    const copy = await manager.products.duplicate({
      productId: f.a1.id,
      storeId: f.b.id,
      idempotencyKey: "local-copy",
      copyInventory: false,
    });
    expect(await f.visible(f.b.id)).toContain(copy.productId);
    expect(await f.visible(f.a.id)).not.toContain(copy.productId);
    expect(await f.visible(f.c.id)).not.toContain(copy.productId);
  });

  it("previews barcode collisions without merging identities and makes reverse sharing explicit", async () => {
    const f = await fixture();
    await prisma.productBarcode.create({
      data: { organizationId: f.org.id, productId: f.a1.id, value: "SHARED-COLLISION" },
    });
    await prisma.productPack.create({
      data: {
        organizationId: f.org.id,
        productId: f.b1.id,
        packBarcode: "SHARED-COLLISION",
        packName: "Box",
        multiplierToBase: 2,
      },
    });
    const change = f.share(f.a.id, [f.b.id], { mutual: true });
    const preview = await f.caller.stores.previewAssortmentShare(change);
    expect(preview.directions).toHaveLength(2);
    expect(preview.impacts.every((row) => row.barcodeConflictCount === 1)).toBe(true);
    await f.apply(change);
    const lookup = await f.caller.products.lookupScan({ q: "SHARED-COLLISION" });
    expect(lookup.items.map(row => row.id).sort()).toEqual([f.a1.id, f.b1.id].sort());
    expect(await f.visible(f.b.id)).toEqual([f.a1.id, f.a2.id, f.b1.id].sort());
    expect(await f.visible(f.a.id)).toContain(f.b1.id);
    const b2 = await f.create(f.b.id, "mutual-b2");
    expect(await f.visible(f.a.id)).toContain(b2.id);
    expect(await f.visible(f.c.id)).not.toContain(b2.id);
  });

  it("rolls back every recipient and rule if the final audit write fails", async () => {
    const f = await fixture();
    const change = f.share(f.a.id, [f.b.id, f.c.id]);
    const preview = await f.caller.stores.previewAssortmentShare(change);
    const failure = vi
      .spyOn(audit, "writeAuditLog")
      .mockRejectedValueOnce(new Error("Simulated audit failure"));
    try {
      await expect(
        f.caller.stores.applyAssortmentShare({
          change,
          previewToken: preview.previewToken,
          idempotencyKey: "failed-multi-target",
        }),
      ).rejects.toThrow();
    } finally {
      failure.mockRestore();
    }
    expect(await prisma.assortmentRule.count()).toBe(0);
    expect(await prisma.assortmentGrant.count()).toBe(0);
    expect(await f.visible(f.b.id)).toEqual([f.b1.id]);
    expect(await f.visible(f.c.id)).toEqual([f.c1.id]);
    expect(
      (await prisma.store.findUniqueOrThrow({ where: { id: f.b.id } })).directedAssortment,
    ).toBe(false);
    await f.caller.stores.applyAssortmentShare({
      change,
      previewToken: preview.previewToken,
      idempotencyKey: "failed-multi-target",
    });
    expect(await prisma.assortmentRule.count()).toBe(2);
  });
});
