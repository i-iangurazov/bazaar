import { AttributeType } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createBazaarApiOrder, listBazaarApiProducts } from "@/server/services/bazaarApi";
import { adjustStock } from "@/server/services/inventory";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("bazaar api integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns rich product payloads with categories, product metadata and variant stock", async () => {
    const { org, store, product, supplier, baseUnit, adminUser } = await seedBase();

    await prisma.product.update({
      where: { id: product.id },
      data: {
        category: "Coffee",
        categories: ["Coffee", "Beans"],
        description: "Single-origin whole bean coffee",
        basePriceKgs: 895,
        photoUrl: "https://cdn.example.com/products/coffee-main.jpg",
      },
    });
    await prisma.productBarcode.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        value: "1234567890123",
      },
    });
    await prisma.productPack.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        packName: "Box",
        packBarcode: "BOX-123",
        multiplierToBase: 6,
      },
    });
    await prisma.productImage.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        url: "https://cdn.example.com/products/coffee-gallery.webp",
        position: 1,
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        name: "1 kg",
        sku: "COFFEE-1KG",
        attributes: { size: "1 kg" },
      },
    });
    await prisma.attributeDefinition.create({
      data: {
        organizationId: org.id,
        key: "size",
        labelRu: "Размер",
        labelKg: "Өлчөм",
        type: AttributeType.TEXT,
      },
    });
    await prisma.variantAttributeValue.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        variantId: variant.id,
        key: "size",
        value: "1 kg",
      },
    });
    await prisma.storePrice.createMany({
      data: [
        {
          organizationId: org.id,
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
          priceKgs: 900,
        },
        {
          organizationId: org.id,
          storeId: store.id,
          productId: product.id,
          variantId: variant.id,
          variantKey: variant.id,
          priceKgs: 1200,
        },
      ],
    });
    await adjustStock({
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 7,
      reason: "API base stock",
      actorId: adminUser.id,
      requestId: "bazaar-api-stock-base",
      idempotencyKey: "bazaar-api-stock-base",
    });
    await adjustStock({
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      variantId: variant.id,
      qtyDelta: 3,
      reason: "API variant stock",
      actorId: adminUser.id,
      requestId: "bazaar-api-stock-variant",
      idempotencyKey: "bazaar-api-stock-variant",
    });

    const result = await listBazaarApiProducts({
      organizationId: org.id,
      storeId: store.id,
      page: 1,
      pageSize: 10,
    });
    const item = result.items.find((row) => row.id === product.id);

    expect(item).toBeDefined();
    expect(item?.category).toBe("Coffee");
    expect(item?.categories).toEqual(["Coffee", "Beans"]);
    expect(item?.description).toBe("Single-origin whole bean coffee");
    expect(item?.unit).toBe(baseUnit.code);
    expect(item?.baseUnit).toMatchObject({ id: baseUnit.id, code: baseUnit.code });
    expect(item?.supplier).toMatchObject({ id: supplier.id, name: supplier.name });
    expect(item?.barcodes).toEqual(["1234567890123"]);
    expect(item?.packs[0]).toMatchObject({
      packName: "Box",
      packBarcode: "BOX-123",
      multiplierToBase: 6,
    });
    expect(item?.images).toEqual([
      "https://cdn.example.com/products/coffee-main.jpg",
      "https://cdn.example.com/products/coffee-gallery.webp",
    ]);
    expect(item?.imageObjects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://cdn.example.com/products/coffee-main.jpg",
          isPrimary: true,
        }),
        expect.objectContaining({
          url: "https://cdn.example.com/products/coffee-gallery.webp",
          isPrimary: false,
        }),
      ]),
    );
    expect(item?.stockQty).toBe(7);
    expect(item?.stockByVariant).toEqual(
      expect.arrayContaining([
        { variantKey: "BASE", stockQty: 7 },
        { variantKey: variant.id, stockQty: 3 },
      ]),
    );
    expect(item?.variants[0]).toMatchObject({
      id: variant.id,
      sku: "COFFEE-1KG",
      attributes: { size: "1 kg" },
      attributeValues: [{ key: "size", value: "1 kg" }],
      stockQty: 3,
      priceKgs: 1200,
    });
    expect(item?.createdAt).toEqual(expect.any(String));
    expect(item?.updatedAt).toEqual(expect.any(String));
    expect(result.currencyRateKgsPerUnit).toBe(1);
  });

  it("creates API orders from the same product identifiers exposed by GET products", async () => {
    const { org, store, product } = await seedBase();

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 250 },
    });

    const order = await createBazaarApiOrder({
      organizationId: org.id,
      storeId: store.id,
      customerName: "API Customer",
      customerEmail: "api.customer@example.com",
      customerPhone: "+996555111222",
      externalId: "EXT-1",
      lines: [{ productId: product.id, qty: 2 }],
    });

    const dbOrder = await prisma.customerOrder.findUnique({
      where: { id: order.id },
      include: { lines: true },
    });

    expect(order.totalKgs).toBe(500);
    expect(dbOrder?.source).toBe("API");
    expect(dbOrder?.notes).toContain("EXT-1");
    expect(dbOrder?.lines[0]).toMatchObject({
      productId: product.id,
      variantKey: "BASE",
      qty: 2,
    });
  });
});
