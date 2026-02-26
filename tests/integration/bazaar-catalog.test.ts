import { beforeEach, describe, expect, it } from "vitest";
import {
  BazaarCatalogStatus,
  CustomerOrderSource,
  CustomerOrderStatus,
  Role,
} from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import {
  createCatalogCheckoutOrder,
  getPublicBazaarCatalog,
  upsertBazaarCatalogSettings,
} from "@/server/services/bazaarCatalog";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("bazaar catalog integration", () => {
  beforeEach(async () => {
    await resetDatabase();
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

  it("creates confirmed customer order from public checkout with source=CATALOG", async () => {
    const { org, store, product, adminUser } = await seedBase();

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 120 },
    });
    await prisma.storePrice.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        variantKey: "BASE",
        priceKgs: 95,
      },
    });

    const saved = await upsertBazaarCatalogSettings({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      status: BazaarCatalogStatus.PUBLISHED,
    });

    const order = await createCatalogCheckoutOrder({
      slug: saved.catalog.slug,
      customerName: "Catalog Customer",
      customerPhone: "+996555100200",
      comment: "Доставка вечером",
      lines: [{ productId: product.id, qty: 3 }],
    });

    const dbOrder = await prisma.customerOrder.findUnique({
      where: { id: order.id },
      include: { lines: true },
    });

    expect(dbOrder).not.toBeNull();
    expect(dbOrder?.status).toBe(CustomerOrderStatus.CONFIRMED);
    expect(dbOrder?.source).toBe(CustomerOrderSource.CATALOG);
    expect(dbOrder?.storeId).toBe(store.id);
    expect(Number(dbOrder?.totalKgs ?? 0)).toBe(285);
    expect(dbOrder?.lines).toHaveLength(1);
    expect(Number(dbOrder?.lines[0]?.unitPriceKgs ?? 0)).toBe(95);
    expect(Number(dbOrder?.lines[0]?.lineTotalKgs ?? 0)).toBe(285);
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
      status: BazaarCatalogStatus.PUBLISHED,
    });

    const order = await createCatalogCheckoutOrder({
      slug: saved.catalog.slug,
      customerName: "Variant Customer",
      customerPhone: "+996555888111",
      lines: [{ productId: product.id, variantId: variant.id, qty: 2 }],
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
