import { AttributeType, CustomerOrderStatus, StockMovementType } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { POST as createBazaarApiCustomerPost } from "@/app/api/bazaar/v1/customers/route";
import { prisma } from "@/server/db/prisma";
import {
  authenticateBazaarApiRequest,
  createBazaarApiKey,
  createBazaarApiOrder,
  listBazaarApiProducts,
} from "@/server/services/bazaarApi";
import { adjustStock } from "@/server/services/inventory";
import { cancelCustomerOrder } from "@/server/services/salesOrders";

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
    expect(item?.pcs).toBe(7);
    expect(item?.stockByVariant).toEqual(
      expect.arrayContaining([
        { variantKey: "BASE", stockQty: 7, pcs: 7 },
        { variantKey: variant.id, stockQty: 3, pcs: 3 },
      ]),
    );
    expect(item?.variants[0]).toMatchObject({
      id: variant.id,
      sku: "COFFEE-1KG",
      attributes: { size: "1 kg" },
      attributeValues: [{ key: "size", value: "1 kg" }],
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      stockQty: 3,
      pcs: 3,
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
      customerAddress: "Bishkek, Manas 10",
      externalId: "EXT-1",
      lines: [{ productId: product.id, qty: 2 }],
    });

    const dbOrder = await prisma.customerOrder.findUnique({
      where: { id: order.id },
      include: { lines: true },
    });

    expect(order.totalKgs).toBe(500);
    expect(dbOrder?.source).toBe("API");
    expect(dbOrder?.customerAddress).toBe("Bishkek, Manas 10");
    expect(dbOrder?.notes).toContain("EXT-1");
    expect(dbOrder?.lines[0]).toMatchObject({
      productId: product.id,
      variantKey: "BASE",
      qty: 2,
    });
  });

  it("applies stock movements for API orders and restores stock once on cancellation", async () => {
    const { org, store, product, supplier, baseUnit, adminUser } = await seedBase();
    const secondProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        baseUnitId: baseUnit.id,
        unit: baseUnit.code,
        sku: "API-STOCK-2",
        name: "API Stock Product 2",
        basePriceKgs: 400,
        storeProducts: {
          create: {
            organizationId: org.id,
            storeId: store.id,
            isActive: true,
          },
        },
      },
    });
    const otherStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Other Store",
        code: "OTH",
      },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: otherStore.id,
        productId: product.id,
        isActive: true,
      },
    });

    await adjustStock({
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 10,
      reason: "seed API stock product 1",
      actorId: adminUser.id,
      requestId: "seed-api-stock-1",
      idempotencyKey: "seed-api-stock-1",
    });
    await adjustStock({
      organizationId: org.id,
      storeId: store.id,
      productId: secondProduct.id,
      qtyDelta: 8,
      reason: "seed API stock product 2",
      actorId: adminUser.id,
      requestId: "seed-api-stock-2",
      idempotencyKey: "seed-api-stock-2",
    });
    await adjustStock({
      organizationId: org.id,
      storeId: otherStore.id,
      productId: product.id,
      qtyDelta: 20,
      reason: "seed other store stock",
      actorId: adminUser.id,
      requestId: "seed-api-stock-other-store",
      idempotencyKey: "seed-api-stock-other-store",
    });

    const order = await createBazaarApiOrder({
      organizationId: org.id,
      storeId: store.id,
      externalId: "API-STOCK-ORDER-1",
      lines: [
        { productId: product.id, qty: 3 },
        { productId: secondProduct.id, qty: 2 },
      ],
    });

    const stockAfterCreate = await prisma.inventorySnapshot.findMany({
      where: { storeId: { in: [store.id, otherStore.id] }, productId: { in: [product.id, secondProduct.id] } },
      orderBy: [{ storeId: "asc" }, { productId: "asc" }],
    });
    const onHand = (storeId: string, productId: string) =>
      stockAfterCreate.find((snapshot) => snapshot.storeId === storeId && snapshot.productId === productId)?.onHand;
    expect(onHand(store.id, product.id)).toBe(7);
    expect(onHand(store.id, secondProduct.id)).toBe(6);
    expect(onHand(otherStore.id, product.id)).toBe(20);

    const saleMovements = await prisma.stockMovement.findMany({
      where: {
        referenceType: "CustomerOrder",
        referenceId: order.id,
        type: StockMovementType.SALE,
      },
      orderBy: { linePosition: "asc" },
    });
    expect(saleMovements.map((movement) => movement.qtyDelta)).toEqual([-3, -2]);
    expect(saleMovements.every((movement) => movement.storeId === store.id)).toBe(true);

    const duplicate = await createBazaarApiOrder({
      organizationId: org.id,
      storeId: store.id,
      externalId: "API-STOCK-ORDER-1",
      lines: [
        { productId: product.id, qty: 3 },
        { productId: secondProduct.id, qty: 2 },
      ],
    });
    expect(duplicate.id).toBe(order.id);
    await expect(
      prisma.stockMovement.count({
        where: {
          referenceType: "CustomerOrder",
          referenceId: order.id,
          type: StockMovementType.SALE,
        },
      }),
    ).resolves.toBe(2);
    await expect(
      prisma.inventorySnapshot.findUnique({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
    ).resolves.toMatchObject({ onHand: 7 });

    const cancellation = await cancelCustomerOrder({
      customerOrderId: order.id,
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "cancel-api-stock-order",
    });
    expect(cancellation.order.status).toBe(CustomerOrderStatus.CANCELED);

    await expect(
      prisma.inventorySnapshot.findUnique({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
    ).resolves.toMatchObject({ onHand: 10 });
    await expect(
      prisma.inventorySnapshot.findUnique({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: secondProduct.id,
            variantKey: "BASE",
          },
        },
      }),
    ).resolves.toMatchObject({ onHand: 8 });
    const returnMovements = await prisma.stockMovement.findMany({
      where: {
        referenceType: "CustomerOrder",
        referenceId: order.id,
        type: StockMovementType.RETURN,
      },
      orderBy: { linePosition: "asc" },
    });
    expect(returnMovements.map((movement) => movement.qtyDelta)).toEqual([3, 2]);

    await expect(
      cancelCustomerOrder({
        customerOrderId: order.id,
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "cancel-api-stock-order-again",
      }),
    ).rejects.toMatchObject({ message: "invalidTransition" });
    await expect(
      prisma.stockMovement.count({
        where: {
          referenceType: "CustomerOrder",
          referenceId: order.id,
          type: StockMovementType.RETURN,
        },
      }),
    ).resolves.toBe(2);
  });

  it("throttles API key last-used writes during request bursts", async () => {
    const { org, store, adminUser } = await seedBase();
    const { apiKey, token } = await createBazaarApiKey({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "bazaar-api-last-used-key",
      name: "bursting-storefront",
    });
    const request = () =>
      new Request("http://localhost/api/bazaar/v1/products", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });

    await authenticateBazaarApiRequest(request());
    const first = await prisma.bazaarApiKey.findUniqueOrThrow({
      where: { id: apiKey.id },
      select: { lastUsedAt: true },
    });

    await authenticateBazaarApiRequest(request());
    const second = await prisma.bazaarApiKey.findUniqueOrThrow({
      where: { id: apiKey.id },
      select: { lastUsedAt: true },
    });

    expect(first.lastUsedAt).toBeInstanceOf(Date);

    const oldLastUsedAt = new Date(first.lastUsedAt!.getTime() - 11 * 60 * 1000);
    await prisma.bazaarApiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: oldLastUsedAt },
    });

    await authenticateBazaarApiRequest(request());
    const refreshed = await prisma.bazaarApiKey.findUniqueOrThrow({
      where: { id: apiKey.id },
      select: { lastUsedAt: true },
    });

    expect(second.lastUsedAt?.getTime()).toBe(first.lastUsedAt?.getTime());
    expect(refreshed.lastUsedAt?.getTime()).toBeGreaterThan(oldLastUsedAt.getTime());
  });

  it("creates and upserts customer database records through POST customers", async () => {
    const { org, store, adminUser } = await seedBase();
    const { token } = await createBazaarApiKey({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "bazaar-api-customer-key",
      name: "customer-sync",
    });

    const createResponse = await createBazaarApiCustomerPost(
      new Request("http://localhost/api/bazaar/v1/customers", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "API Customer",
          email: "API.Customer@Example.COM",
          phone: "+996 555 111 222",
          address: "Bishkek, Manas 10",
        }),
      }),
    );
    const createPayload = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createPayload).toMatchObject({
      action: "created",
      customer: {
        name: "API Customer",
        email: "api.customer@example.com",
        phone: "+996555111222",
        address: "Bishkek, Manas 10",
        source: "INTEGRATION",
      },
    });

    const updateResponse = await createBazaarApiCustomerPost(
      new Request("http://localhost/api/bazaar/v1/customers", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "API Customer Updated",
          email: "api.customer@example.com",
          phone: "+996555111222",
          address: "Bishkek, Chui 20",
        }),
      }),
    );
    const updatePayload = await updateResponse.json();
    const customers = await prisma.customer.findMany({
      where: { organizationId: org.id, storeId: store.id, email: "api.customer@example.com" },
    });

    expect(updateResponse.status).toBe(200);
    expect(updatePayload).toMatchObject({
      action: "updated",
      customer: {
        id: createPayload.customer.id,
        name: "API Customer Updated",
        phone: "+996555111222",
      },
    });
    expect(customers).toHaveLength(1);
  });

  it("requires name, phone and email for POST customers", async () => {
    const response = await createBazaarApiCustomerPost(
      new Request("http://localhost/api/bazaar/v1/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Missing Phone", email: "missing@example.com" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ message: "invalidInput" });
  });
});
