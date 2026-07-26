import { Prisma, type Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createBazaarApiOrder, listBazaarApiProducts } from "@/server/services/bazaarApi";
import {
  applyCatalogDiscount,
  removeCatalogDiscount,
} from "@/server/services/catalogDiscounts";
import {
  addCustomerOrderLine,
  createCustomerOrderDraft,
} from "@/server/services/salesOrders";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const caller = (user: {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
  isOrgOwner?: boolean | null;
}) => ({
  id: user.id,
  email: user.email,
  role: user.role,
  organizationId: user.organizationId!,
  isOrgOwner: Boolean(user.isOrgOwner),
});

describeDb("store/variant catalog discounts", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("applies and removes atomically, keeps variant/store scope, exposes API pricing, and snapshots checkout", async () => {
    const { org, store, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    const otherStore = await prisma.store.create({
      data: { organizationId: org.id, name: "Other Store", code: "OTHER-DISCOUNT" },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: otherStore.id,
        productId: product.id,
        isActive: true,
      },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, name: "Large", sku: "TEST-L", attributes: {} },
    });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 1_000 } });
    await prisma.storePrice.createMany({
      data: [
        {
          organizationId: org.id,
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
          priceKgs: 1_000,
        },
        {
          organizationId: org.id,
          storeId: store.id,
          productId: product.id,
          variantId: variant.id,
          variantKey: variant.id,
          priceKgs: 1_500,
        },
        {
          organizationId: org.id,
          storeId: otherStore.id,
          productId: product.id,
          variantKey: "BASE",
          priceKgs: 2_000,
        },
      ],
    });

    const discount = {
      idempotencyKey: "catalog-discount-apply-1",
      storeId: store.id,
      productIds: [product.id],
      variantPolicy: "ALL_VARIANTS" as const,
      variantIds: [],
      percentage: 20,
      startsAt: null,
      endsAt: null,
    };
    await expect(
      applyCatalogDiscount({
        user: caller(adminUser),
        actorId: adminUser.id,
        requestId: "catalog-discount-apply",
        discount,
      }),
    ).resolves.toMatchObject({
      status: "COMPLETED",
      replayed: false,
      affectedProductCount: 1,
      affectedPriceRowCount: 2,
    });
    await expect(
      applyCatalogDiscount({
        user: caller(adminUser),
        actorId: adminUser.id,
        requestId: "catalog-discount-replay",
        discount,
      }),
    ).resolves.toMatchObject({ replayed: true, affectedPriceRowCount: 2 });
    await expect(
      applyCatalogDiscount({
        user: caller(adminUser),
        actorId: adminUser.id,
        requestId: "catalog-discount-reused-key-with-different-payload",
        discount: { ...discount, percentage: 25 },
      }),
    ).rejects.toMatchObject({ message: "idempotencyKeyPayloadMismatch" });

    const prices = await prisma.storePrice.findMany({
      where: { productId: product.id },
      orderBy: [{ storeId: "asc" }, { variantKey: "asc" }],
    });
    expect(prices.filter((price) => price.storeId === store.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variantKey: "BASE",
          priceKgs: new Prisma.Decimal(1_000),
          discountPercentage: new Prisma.Decimal(20),
        }),
        expect.objectContaining({
          variantKey: variant.id,
          priceKgs: new Prisma.Decimal(1_500),
          discountPercentage: new Prisma.Decimal(20),
        }),
      ]),
    );
    expect(prices.find((price) => price.storeId === otherStore.id)).toMatchObject({
      priceKgs: new Prisma.Decimal(2_000),
      discountType: null,
    });

    const catalog = await listBazaarApiProducts({
      organizationId: org.id,
      storeId: store.id,
      page: 1,
      pageSize: 10,
    });
    const item = catalog.items.find((candidate) => candidate.id === product.id)!;
    expect(item).toMatchObject({
      price: 800,
      priceKgs: 800,
      pricing: {
        currency: "KGS",
        basePrice: 1_000,
        effectivePrice: 800,
        compareAtPrice: 1_000,
        hasDiscount: true,
        discount: { type: "PERCENTAGE", value: 20 },
      },
    });
    expect(item.variants[0]).toMatchObject({
      id: variant.id,
      price: 1_200,
      priceKgs: 1_200,
      pricing: {
        basePrice: 1_500,
        effectivePrice: 1_200,
        compareAtPrice: 1_500,
        hasDiscount: true,
      },
    });

    const order = await createBazaarApiOrder({
      organizationId: org.id,
      storeId: store.id,
      externalId: "discount-checkout-1",
      lines: [{ productId: product.id, variantId: variant.id, qty: 2 }],
    });
    expect(order.totalKgs).toBe(2_400);
    const orderLine = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: order.id },
    });
    expect(orderLine).toMatchObject({
      baseUnitPriceKgs: new Prisma.Decimal(1_500),
      unitPriceKgs: new Prisma.Decimal(1_200),
      appliedDiscountType: "PERCENTAGE",
      appliedDiscountPercentage: new Prisma.Decimal(20),
      appliedDiscountAmountKgs: new Prisma.Decimal(300),
      lineTotalKgs: new Prisma.Decimal(2_400),
    });

    const manualOrder = await createCustomerOrderDraft({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "discount-manual-order",
      lines: [{ productId: product.id, variantId: variant.id, qty: 1 }],
    });
    const manualOrderLine = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: manualOrder.id },
    });
    expect(manualOrderLine).toMatchObject({
      baseUnitPriceKgs: new Prisma.Decimal(1_500),
      unitPriceKgs: new Prisma.Decimal(1_200),
      appliedDiscountType: "PERCENTAGE",
      appliedDiscountPercentage: new Prisma.Decimal(20),
      appliedDiscountAmountKgs: new Prisma.Decimal(300),
    });
    const emptyManualOrder = await createCustomerOrderDraft({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "discount-empty-manual-order",
    });
    const addedManualLine = await addCustomerOrderLine({
      organizationId: org.id,
      customerOrderId: emptyManualOrder.id,
      productId: product.id,
      variantId: variant.id,
      qty: 1,
      actorId: adminUser.id,
      requestId: "discount-manual-order-add-line",
    });
    expect(addedManualLine).toMatchObject({
      baseUnitPriceKgs: new Prisma.Decimal(1_500),
      unitPriceKgs: 1_200,
      appliedDiscountType: "PERCENTAGE",
      appliedDiscountPercentage: new Prisma.Decimal(20),
      appliedDiscountAmountKgs: new Prisma.Decimal(300),
    });

    await removeCatalogDiscount({
      user: caller(adminUser),
      actorId: adminUser.id,
      requestId: "catalog-discount-remove",
      discount: {
        idempotencyKey: "catalog-discount-remove-1",
        storeId: store.id,
        productIds: [product.id],
        variantPolicy: "ALL_VARIANTS",
        variantIds: [],
      },
    });
    await expect(
      prisma.storePrice.count({
        where: { storeId: store.id, productId: product.id, discountType: { not: null } },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.customerOrderLine.findUniqueOrThrow({ where: { id: orderLine.id } }),
    ).resolves.toMatchObject({
      baseUnitPriceKgs: new Prisma.Decimal(1_500),
      unitPriceKgs: new Prisma.Decimal(1_200),
      appliedDiscountPercentage: new Prisma.Decimal(20),
    });
    await expect(
      prisma.customerOrderLine.findUniqueOrThrow({ where: { id: manualOrderLine.id } }),
    ).resolves.toMatchObject({
      baseUnitPriceKgs: new Prisma.Decimal(1_500),
      unitPriceKgs: new Prisma.Decimal(1_200),
      appliedDiscountPercentage: new Prisma.Decimal(20),
    });
    const restoredCatalog = await listBazaarApiProducts({
      organizationId: org.id,
      storeId: store.id,
      page: 1,
      pageSize: 10,
    });
    expect(restoredCatalog.items.find((candidate) => candidate.id === product.id)).toMatchObject({
      price: 1_000,
      pricing: {
        basePrice: 1_000,
        effectivePrice: 1_000,
        compareAtPrice: null,
        hasDiscount: false,
      },
    });
  }, 20_000);

  it("honors selected variants and inactive schedules without leaking across stores", async () => {
    const { org, store, product, adminUser, managerUser } = await seedBase({ plan: "BUSINESS" });
    const variantA = await prisma.productVariant.create({
      data: { productId: product.id, name: "A", attributes: {} },
    });
    const variantB = await prisma.productVariant.create({
      data: { productId: product.id, name: "B", attributes: {} },
    });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 500 } });
    await prisma.storePrice.createMany({
      data: [variantA, variantB].map((variant, index) => ({
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        variantId: variant.id,
        variantKey: variant.id,
        priceKgs: index === 0 ? 600 : 700,
      })),
    });

    await applyCatalogDiscount({
      user: caller(adminUser),
      actorId: adminUser.id,
      requestId: "catalog-discount-scheduled",
      discount: {
        idempotencyKey: "catalog-discount-scheduled-1",
        storeId: store.id,
        productIds: [product.id],
        variantPolicy: "SELECTED_VARIANTS",
        variantIds: [variantA.id],
        percentage: 10,
        startsAt: new Date(Date.now() + 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    });

    const catalog = await listBazaarApiProducts({
      organizationId: org.id,
      storeId: store.id,
    });
    const variants = catalog.items.find((item) => item.id === product.id)!.variants;
    expect(variants.find((variant) => variant.id === variantA.id)?.pricing).toMatchObject({
      basePrice: 600,
      effectivePrice: 600,
      compareAtPrice: null,
      hasDiscount: false,
      discount: { type: "PERCENTAGE", value: 10 },
    });
    expect(variants.find((variant) => variant.id === variantB.id)?.pricing).toMatchObject({
      basePrice: 700,
      effectivePrice: 700,
      hasDiscount: false,
      discount: null,
    });

    const restrictedStore = await prisma.store.create({
      data: { organizationId: org.id, name: "Restricted", code: "RESTRICTED-DISCOUNT" },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: restrictedStore.id,
        productId: product.id,
        isActive: true,
      },
    });
    await expect(
      applyCatalogDiscount({
        user: caller(managerUser),
        actorId: managerUser.id,
        requestId: "catalog-discount-forbidden",
        discount: {
          idempotencyKey: "catalog-discount-forbidden-1",
          storeId: restrictedStore.id,
          productIds: [product.id],
          variantPolicy: "ALL_VARIANTS",
          variantIds: [],
          percentage: 15,
          startsAt: null,
          endsAt: null,
        },
      }),
    ).rejects.toMatchObject({ message: "storeAccessDenied" });
  }, 20_000);
});
