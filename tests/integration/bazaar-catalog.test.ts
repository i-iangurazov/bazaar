import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BazaarCatalogStatus,
  CustomerOrderSource,
  CustomerOrderStatus,
  Role,
} from "@prisma/client";

const sideEffects = vi.hoisted(() => ({
  publish: vi.fn(),
  sendOrderConfirmationEmail: vi.fn(async () => ({
    status: "sent" as const,
    recipientEmail: "catalog.integration@example.com",
  })),
}));

vi.mock("@/server/events/eventBus", () => ({
  eventBus: {
    publish: sideEffects.publish,
  },
}));

vi.mock("@/server/services/orderEmails", () => ({
  sendOrderConfirmationEmail: sideEffects.sendOrderConfirmationEmail,
}));

import { prisma } from "@/server/db/prisma";
import {
  createBazaarCatalogLogoImage,
  createCatalogCheckoutOrder,
  getPublicBazaarCatalog,
  listBazaarCatalogProducts,
  updateBazaarCatalogProductVisibility,
  upsertBazaarCatalogSettings,
} from "@/server/services/bazaarCatalog";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("bazaar catalog integration", () => {
  beforeEach(async () => {
    await resetDatabase();
    sideEffects.publish.mockClear();
    sideEffects.sendOrderConfirmationEmail.mockClear();
  });

  it("publishes store catalog and serves public payload by slug", async () => {
    const { org, store, product, adminUser } = await seedBase();

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 180 },
    });

    const saved = await upsertBazaarCatalogSettings({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "catalog-publish",
      title: "Прайс-лист магазина",
      accentColor: "#1166dd",
      status: BazaarCatalogStatus.PUBLISHED,
    });

    const payload = await getPublicBazaarCatalog(saved.catalog.slug);

    expect(payload).not.toBeNull();
    expect(payload?.slug).toBe(saved.catalog.slug);
    expect(payload?.storeId).toBe(store.id);
    expect(payload?.title).toBe("Прайс-лист магазина");
    expect(payload?.products.some((row) => row.id === product.id)).toBe(true);
  });

  it("records scoped request audits for catalog settings and logo creation", async () => {
    const { org, store, adminUser } = await seedBase();
    const logo = await createBazaarCatalogLogoImage({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "catalog-logo-request",
      imageUrl: "/uploads/imported-products/catalog-logo.png",
    });
    const created = await upsertBazaarCatalogSettings({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "catalog-settings-create",
      title: "Catalog draft",
      accentColor: "#2255aa",
      logoImageId: logo.id,
      status: BazaarCatalogStatus.DRAFT,
    });
    await upsertBazaarCatalogSettings({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "catalog-settings-update",
      title: "Published catalog",
      accentColor: "#3366bb",
      logoImageId: logo.id,
      status: BazaarCatalogStatus.PUBLISHED,
    });

    const [logoAudit, createAudit, updateAudit] = await Promise.all([
      prisma.auditLog.findFirstOrThrow({
        where: { organizationId: org.id, requestId: "catalog-logo-request" },
      }),
      prisma.auditLog.findFirstOrThrow({
        where: { organizationId: org.id, requestId: "catalog-settings-create" },
      }),
      prisma.auditLog.findFirstOrThrow({
        where: { organizationId: org.id, requestId: "catalog-settings-update" },
      }),
    ]);

    expect(logoAudit).toMatchObject({
      actorId: adminUser.id,
      action: "BAZAAR_CATALOG_LOGO_CREATED",
      entity: "BazaarCatalogImage",
      entityId: logo.id,
      before: null,
      after: { storeId: store.id, imageId: logo.id },
    });
    expect(createAudit).toMatchObject({
      actorId: adminUser.id,
      action: "BAZAAR_CATALOG_SETTINGS_CREATED",
      entity: "BazaarCatalog",
      entityId: created.catalog.id,
      before: null,
      after: {
        storeId: store.id,
        status: BazaarCatalogStatus.DRAFT,
        title: "Catalog draft",
        accentColor: "#2255aa",
        logoImageId: logo.id,
      },
    });
    expect(updateAudit).toMatchObject({
      actorId: adminUser.id,
      action: "BAZAAR_CATALOG_SETTINGS_UPDATED",
      entity: "BazaarCatalog",
      entityId: created.catalog.id,
      before: {
        storeId: store.id,
        status: BazaarCatalogStatus.DRAFT,
        title: "Catalog draft",
        accentColor: "#2255aa",
        logoImageId: logo.id,
      },
      after: {
        storeId: store.id,
        status: BazaarCatalogStatus.PUBLISHED,
        title: "Published catalog",
        accentColor: "#3366bb",
        logoImageId: logo.id,
      },
    });
  });

  it("rejects cross-organization catalog mutations without records or audits", async () => {
    const { store } = await seedBase();
    const otherOrg = await prisma.organization.create({
      data: { name: "Catalog audit other org" },
    });
    const otherAdmin = await prisma.user.create({
      data: {
        organizationId: otherOrg.id,
        email: "catalog-audit-other@test.local",
        name: "Catalog Audit Other",
        passwordHash: "hash",
        role: Role.ADMIN,
        emailVerifiedAt: new Date(),
      },
    });

    await expect(
      createBazaarCatalogLogoImage({
        organizationId: otherOrg.id,
        storeId: store.id,
        actorId: otherAdmin.id,
        requestId: "foreign-catalog-logo",
        imageUrl: "/uploads/imported-products/foreign-logo.png",
      }),
    ).rejects.toMatchObject({ message: "storeNotFound" });
    await expect(
      upsertBazaarCatalogSettings({
        organizationId: otherOrg.id,
        storeId: store.id,
        actorId: otherAdmin.id,
        requestId: "foreign-catalog-settings",
        status: BazaarCatalogStatus.PUBLISHED,
      }),
    ).rejects.toMatchObject({ message: "storeNotFound" });

    await expect(
      prisma.bazaarCatalogImage.count({ where: { organizationId: otherOrg.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({
        where: {
          organizationId: otherOrg.id,
          requestId: { in: ["foreign-catalog-logo", "foreign-catalog-settings"] },
        },
      }),
    ).resolves.toBe(0);
  });

  it("creates confirmed customer order from public checkout with source=CATALOG", async () => {
    const { org, store, product, adminUser } = await seedBase();

    await prisma.store.update({
      where: { id: store.id },
      data: { currencyCode: "USD", currencyRateKgsPerUnit: 89.5 },
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 1_200 },
    });
    await prisma.storePrice.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        variantKey: "BASE",
        priceKgs: 950,
        discountType: "PERCENTAGE",
        discountPercentage: 20,
      },
    });

    const saved = await upsertBazaarCatalogSettings({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "catalog-checkout",
      status: BazaarCatalogStatus.PUBLISHED,
    });

    const publicCatalog = await getPublicBazaarCatalog(saved.catalog.slug);
    const publicProduct = publicCatalog?.products.find((row) => row.id === product.id);

    expect(publicCatalog?.currencyCode).toBe("USD");
    expect(publicProduct?.priceKgs).toBe(10);
    expect(publicProduct?.compareAtPriceKgs).toBe(20);
    expect(publicProduct?.hasDiscount).toBe(true);
    expect(publicProduct?.quotedUnitPriceKgs).toBe(760);

    const order = await createCatalogCheckoutOrder({
      slug: saved.catalog.slug,
      customerName: "Catalog Customer",
      customerEmail: "catalog.customer@example.com",
      customerPhone: "+996555100200",
      comment: "Доставка вечером",
      lines: [{ productId: product.id, qty: 3, quotedUnitPriceKgs: 760 }],
    });

    const dbOrder = await prisma.customerOrder.findUnique({
      where: { id: order.id },
      include: { lines: true },
    });

    expect(dbOrder).not.toBeNull();
    expect(dbOrder?.status).toBe(CustomerOrderStatus.CONFIRMED);
    expect(dbOrder?.source).toBe(CustomerOrderSource.CATALOG);
    expect(dbOrder?.storeId).toBe(store.id);
    expect(dbOrder?.currencyCode).toBe("USD");
    expect(Number(dbOrder?.currencyRateKgsPerUnit ?? 0)).toBe(89.5);
    expect(dbOrder?.customerEmail).toBe("catalog.customer@example.com");
    expect(Number(dbOrder?.totalKgs ?? 0)).toBe(2_280);
    expect(dbOrder?.lines).toHaveLength(1);
    expect(Number(dbOrder?.lines[0]?.baseUnitPriceKgs ?? 0)).toBe(950);
    expect(Number(dbOrder?.lines[0]?.unitPriceKgs ?? 0)).toBe(760);
    expect(dbOrder?.lines[0]?.appliedDiscountType).toBe("PERCENTAGE");
    expect(Number(dbOrder?.lines[0]?.appliedDiscountPercentage ?? 0)).toBe(20);
    expect(Number(dbOrder?.lines[0]?.appliedDiscountAmountKgs ?? 0)).toBe(190);
    expect(Number(dbOrder?.lines[0]?.lineTotalKgs ?? 0)).toBe(2_280);
  });

  it("creates customer order line with variant when checkout specifies variantId", async () => {
    const { org, store, product, adminUser } = await seedBase();

    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        name: "1 л",
        attributes: {},
        isActive: true,
      },
    });

    await prisma.storePrice.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        variantId: variant.id,
        variantKey: variant.id,
        priceKgs: 210,
      },
    });

    const saved = await upsertBazaarCatalogSettings({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "catalog-variant-checkout",
      status: BazaarCatalogStatus.PUBLISHED,
    });

    const order = await createCatalogCheckoutOrder({
      slug: saved.catalog.slug,
      customerName: "Variant Customer",
      customerEmail: "variant.customer@example.com",
      customerPhone: "+996555888111",
      lines: [{ productId: product.id, variantId: variant.id, qty: 2, quotedUnitPriceKgs: 210 }],
    });

    const dbOrder = await prisma.customerOrder.findUnique({
      where: { id: order.id },
      include: { lines: true },
    });

    expect(dbOrder).not.toBeNull();
    expect(dbOrder?.lines).toHaveLength(1);
    expect(dbOrder?.lines[0]?.variantId).toBe(variant.id);
    expect(dbOrder?.lines[0]?.variantKey).toBe(variant.id);
    expect(Number(dbOrder?.lines[0]?.unitPriceKgs ?? 0)).toBe(210);
    expect(Number(dbOrder?.lines[0]?.lineTotalKgs ?? 0)).toBe(420);
  });

  it("hides selected products from the public catalog and checkout", async () => {
    const { org, store, product, adminUser } = await seedBase();

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 180 },
    });

    const saved = await upsertBazaarCatalogSettings({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "catalog-hidden-product",
      status: BazaarCatalogStatus.PUBLISHED,
    });

    await updateBazaarCatalogProductVisibility({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "hide-product",
      productIds: [product.id],
      hidden: true,
    });

    const payload = await getPublicBazaarCatalog(saved.catalog.slug);

    expect(payload?.products.some((row) => row.id === product.id)).toBe(false);
    await expect(
      createCatalogCheckoutOrder({
        slug: saved.catalog.slug,
        customerName: "Hidden Product Customer",
        customerEmail: "hidden.customer@example.com",
        customerPhone: "+996555000100",
        lines: [{ productId: product.id, qty: 1, quotedUnitPriceKgs: 180 }],
      }),
    ).rejects.toMatchObject({
      message: "productNotFound",
    });
  });

  it("returns product preview images for the catalog products table", async () => {
    const { org, store, product } = await seedBase();

    await prisma.product.update({
      where: { id: product.id },
      data: { photoUrl: "https://cdn.example.com/images/catalog-product.jpg" },
    });

    const list = await listBazaarCatalogProducts({
      organizationId: org.id,
      storeId: store.id,
      page: 1,
      pageSize: 10,
    });

    expect(list.items.find((row) => row.id === product.id)?.imageUrl).toBe(
      "https://cdn.example.com/images/catalog-product.jpg",
    );
  });

  it("keeps relative R2 /retails product images in the public catalog payload", async () => {
    const { org, store, product, adminUser } = await seedBase();
    const relativeImageUrl = `/retails/${org.id}/products/${product.id}/catalog-product.jpg`;
    await prisma.product.update({
      where: { id: product.id },
      data: { photoUrl: relativeImageUrl },
    });
    const saved = await upsertBazaarCatalogSettings({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "catalog-relative-r2-image",
      status: BazaarCatalogStatus.PUBLISHED,
    });

    const payload = await getPublicBazaarCatalog(saved.catalog.slug);

    expect(payload?.products.find((row) => row.id === product.id)?.imageUrl).toBe(
      relativeImageUrl,
    );
  });

  it("does not leak products across orgs when resolving by slug", async () => {
    const { org: orgA, store: storeA, product: productA, adminUser: adminA } = await seedBase();
    await prisma.product.update({
      where: { id: productA.id },
      data: { basePriceKgs: 50 },
    });
    const catalogA = await upsertBazaarCatalogSettings({
      organizationId: orgA.id,
      storeId: storeA.id,
      actorId: adminA.id,
      requestId: "catalog-org-a",
      status: BazaarCatalogStatus.PUBLISHED,
    });

    const orgB = await prisma.organization.create({ data: { name: "Other Org" } });
    const unitB = await prisma.unit.create({
      data: {
        organizationId: orgB.id,
        code: "pcs",
        labelRu: "шт",
        labelKg: "даана",
      },
    });
    const storeB = await prisma.store.create({
      data: {
        organizationId: orgB.id,
        name: "Store B",
        code: "SB",
      },
    });
    const supplierB = await prisma.supplier.create({
      data: {
        organizationId: orgB.id,
        name: "Supplier B",
      },
    });
    const productB = await prisma.product.create({
      data: {
        organizationId: orgB.id,
        supplierId: supplierB.id,
        sku: "B-PROD-1",
        name: "B Product",
        unit: unitB.code,
        baseUnitId: unitB.id,
        basePriceKgs: 75,
      },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        productId: productB.id,
      },
    });
    const managerB = await prisma.user.create({
      data: {
        organizationId: orgB.id,
        email: "manager-b@test.local",
        name: "Manager B",
        passwordHash: "hash",
        role: Role.MANAGER,
        emailVerifiedAt: new Date(),
      },
    });

    const catalogB = await upsertBazaarCatalogSettings({
      organizationId: orgB.id,
      storeId: storeB.id,
      actorId: managerB.id,
      requestId: "catalog-org-b",
      status: BazaarCatalogStatus.PUBLISHED,
    });

    const payloadA = await getPublicBazaarCatalog(catalogA.catalog.slug);
    const payloadB = await getPublicBazaarCatalog(catalogB.catalog.slug);
    const unknown = await getPublicBazaarCatalog(`${catalogA.catalog.slug}x`);

    expect(payloadA?.products.some((row) => row.id === productA.id)).toBe(true);
    expect(payloadA?.products.some((row) => row.id === productB.id)).toBe(false);
    expect(payloadB?.products.some((row) => row.id === productB.id)).toBe(true);
    expect(payloadB?.products.some((row) => row.id === productA.id)).toBe(false);
    expect(unknown).toBeNull();
  });
});
