import { beforeEach, describe, expect, it } from "vitest";
import { BazaarCatalogStatus } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import {
  getPublicBazaarCatalog,
  listBazaarCatalogProducts,
  upsertBazaarCatalogSettings,
  createCatalogCheckoutOrder,
} from "@/server/services/bazaarCatalog";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
describeDb("catalog publishing rules and variant labels", () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  const publish = (
    base: Awaited<ReturnType<typeof seedBase>>,
    extra: { hideOutOfStock?: boolean; hideWithoutPhoto?: boolean } = {},
  ) =>
    upsertBazaarCatalogSettings({
      organizationId: base.org.id,
      storeId: base.store.id,
      actorId: base.adminUser.id,
      requestId: "catalog-rules",
      status: BazaarCatalogStatus.PUBLISHED,
      ...extra,
    });

  it("preserves existing publication defaults and settings when optional rules are omitted", async () => {
    const b = await seedBase();
    const first = await publish(b);
    expect(first.catalog).toMatchObject({ hideOutOfStock: false, hideWithoutPhoto: false });
    expect((await getPublicBazaarCatalog(first.catalog.slug))?.products.map((p) => p.id)).toContain(
      b.product.id,
    );
    await publish(b, { hideOutOfStock: true, hideWithoutPhoto: true });
    const saved = await publish(b);
    expect(saved.catalog).toMatchObject({ hideOutOfStock: true, hideWithoutPhoto: true });
  });

  it("filters the selected store before pagination, categories and targeted cart recovery", async () => {
    const b = await seedBase({ allowNegativeStock: true });
    const otherStore = await prisma.store.create({
      data: { organizationId: b.org.id, name: "Other", code: "OTHER" },
    });
    const make = async (sku: string, onHand: number | null, photoUrl: string | null) => {
      const p = await prisma.product.create({
        data: {
          organizationId: b.org.id,
          sku,
          name: sku,
          category: sku,
          unit: b.baseUnit.code,
          baseUnitId: b.baseUnit.id,
          photoUrl,
        },
      });
      await prisma.storeProduct.create({
        data: { organizationId: b.org.id, storeId: b.store.id, productId: p.id },
      });
      if (onHand !== null)
        await prisma.inventorySnapshot.create({
          data: { storeId: b.store.id, productId: p.id, onHand, allowNegativeStock: true },
        });
      return p;
    };
    const visible = await make("AVAILABLE", 2, "/uploads/imported-products/photo.jpg");
    const noPhoto = await make("NO-PHOTO", 8, null);
    const zero = await make("ZERO", 0, "/uploads/imported-products/photo.jpg");
    const negative = await make("NEGATIVE", -1, "/uploads/imported-products/photo.jpg");
    const missing = await make("OTHER-STORE-ONLY", null, "/uploads/imported-products/photo.jpg");
    await prisma.inventorySnapshot.create({
      data: { storeId: otherStore.id, productId: missing.id, onHand: 100 },
    });
    const inline = await make("INLINE", 5, "data:image/jpeg;base64,AAAA");
    const saved = await publish(b, { hideOutOfStock: true, hideWithoutPhoto: true });
    const payload = await getPublicBazaarCatalog(saved.catalog.slug, { pageSize: 1 });
    expect(payload?.pagination).toMatchObject({ total: 1, totalPages: 1 });
    expect(payload?.products.map((p) => p.id)).toEqual([visible.id]);
    expect(payload?.categories.map((c) => c.name)).toEqual(["AVAILABLE"]);
    const adminVisible = await listBazaarCatalogProducts({
      organizationId: b.org.id,
      storeId: b.store.id,
      visibility: "visible",
    });
    const adminHidden = await listBazaarCatalogProducts({
      organizationId: b.org.id,
      storeId: b.store.id,
      visibility: "hidden",
    });
    expect(adminVisible.summary).toMatchObject({
      totalProducts: 7,
      visibleProducts: 1,
      hiddenProducts: 6,
    });
    expect(adminVisible.items.map((product) => product.id)).toEqual([visible.id]);
    expect(adminHidden.total).toBe(6);
    expect(adminHidden.items.every((product) => product.excludedByRules)).toBe(true);

    expect(
      (
        await getPublicBazaarCatalog(saved.catalog.slug, {
          productIds: [zero.id, negative.id, missing.id, noPhoto.id, inline.id],
        })
      )?.products,
    ).toEqual([]);
    expect(
      (await getPublicBazaarCatalog(saved.catalog.slug, { search: "ZERO" }))?.pagination.total,
    ).toBe(0);
    await publish(b, { hideOutOfStock: false, hideWithoutPhoto: false });
    expect((await getPublicBazaarCatalog(saved.catalog.slug))?.pagination.total).toBe(7);
  });

  it("uses active variant stock and photos, and exposes attributes instead of internal IDs", async () => {
    const b = await seedBase();
    const image = await prisma.productImage.create({
      data: {
        organizationId: b.org.id,
        productId: b.product.id,
        url: "/uploads/imported-products/variant.jpg",
        position: 0,
      },
    });
    const v = await prisma.productVariant.create({
      data: {
        productId: b.product.id,
        name: null,
        attributes: { color: "Красный", size: "XL" },
        imageId: image.id,
      },
    });
    const empty = await prisma.productVariant.create({
      data: { productId: b.product.id, name: "No stock", attributes: {} },
    });
    const inactive = await prisma.productVariant.create({
      data: { productId: b.product.id, name: "Inactive", attributes: {}, isActive: false },
    });
    await prisma.inventorySnapshot.createMany({
      data: [
        {
          storeId: b.store.id,
          productId: b.product.id,
          variantId: v.id,
          variantKey: v.id,
          onHand: 2,
        },
        {
          storeId: b.store.id,
          productId: b.product.id,
          variantId: inactive.id,
          variantKey: inactive.id,
          onHand: 99,
        },
      ],
    });
    const saved = await publish(b, { hideOutOfStock: true, hideWithoutPhoto: true });
    const payload = await getPublicBazaarCatalog(saved.catalog.slug);
    expect(payload?.products).toHaveLength(1);
    expect(payload?.products[0].variants).toMatchObject([{ id: v.id, name: "Красный · XL" }]);
    expect(payload?.products[0].variants.map((v) => v.id)).not.toContain(empty.id);
    await prisma.inventorySnapshot.updateMany({ where: { variantId: v.id }, data: { onHand: 0 } });
    expect((await getPublicBazaarCatalog(saved.catalog.slug))?.products).toEqual([]);
  });

  it("calculates bundle availability from the required component quantities", async () => {
    const b = await seedBase();
    const bundle = await prisma.product.create({
      data: {
        organizationId: b.org.id,
        sku: "KIT",
        name: "Kit",
        isBundle: true,
        unit: b.baseUnit.code,
        baseUnitId: b.baseUnit.id,
      },
    });
    await prisma.storeProduct.create({
      data: { organizationId: b.org.id, storeId: b.store.id, productId: bundle.id },
    });
    await prisma.productBundleComponent.create({
      data: {
        organizationId: b.org.id,
        bundleProductId: bundle.id,
        componentProductId: b.product.id,
        qty: 3,
      },
    });
    await prisma.inventorySnapshot.create({
      data: { storeId: b.store.id, productId: b.product.id, onHand: 2 },
    });
    const saved = await publish(b, { hideOutOfStock: true });
    expect(
      (await getPublicBazaarCatalog(saved.catalog.slug))?.products.map((p) => p.id),
    ).not.toContain(bundle.id);
    await prisma.inventorySnapshot.updateMany({
      where: { productId: b.product.id },
      data: { onHand: 3 },
    });
    expect((await getPublicBazaarCatalog(saved.catalog.slug))?.products.map((p) => p.id)).toContain(
      bundle.id,
    );
  });

  it("rejects checkout of a product hidden by current publication rules", async () => {
    const b = await seedBase({ plan: "BUSINESS" });
    const saved = await publish(b, { hideOutOfStock: true });
    await expect(
      createCatalogCheckoutOrder({
        slug: saved.catalog.slug,
        customerName: "Test",
        customerEmail: "test@example.invalid",
        customerPhone: "+996555000111",
        lines: [{ productId: b.product.id, qty: 1, quotedUnitPriceKgs: 0 }],
      }),
    ).rejects.toMatchObject({ message: "productNotFound" });
    expect(await prisma.customerOrder.count()).toBe(0);
  });

  it("enforces role, organization and store permissions on publishing", async () => {
    const b = await seedBase();
    const staff = createTestCaller({ ...b.staffUser, organizationId: b.org.id });
    const manager = createTestCaller({ ...b.managerUser, organizationId: b.org.id });
    await expect(
      staff.bazaarCatalog.upsert({
        storeId: b.store.id,
        status: "PUBLISHED",
        hideOutOfStock: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await prisma.store.create({
      data: { organizationId: b.org.id, name: "Restricted", code: "REST" },
    });
    await expect(
      manager.bazaarCatalog.upsert({
        storeId: other.id,
        status: "PUBLISHED",
        hideOutOfStock: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      upsertBazaarCatalogSettings({
        organizationId: "foreign-organization",
        storeId: b.store.id,
        actorId: b.adminUser.id,
        requestId: "cross-org",
        status: "PUBLISHED",
      }),
    ).rejects.toMatchObject({ message: "storeNotFound" });
  });
});
