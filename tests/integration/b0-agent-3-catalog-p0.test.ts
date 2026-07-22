import { BazaarCatalogStatus, CustomerOrderSource } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sideEffects = vi.hoisted(() => ({
  publish: vi.fn(),
  sendOrderConfirmationEmail: vi.fn(async () => ({
    status: "sent" as const,
    recipientEmail: "catalog.runtime@example.com",
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

import { GET as getPublicCatalog } from "@/app/api/public/catalog/[slug]/route";
import { POST as postPublicCheckout } from "@/app/api/public/catalog/[slug]/checkout/route";
import { prisma } from "@/server/db/prisma";
import { upsertBazaarCatalogSettings } from "@/server/services/bazaarCatalog";
import { upsertStorePrice } from "@/server/services/storePrices";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const evidence = (issueId: string, payload: Record<string, unknown>) => {
  console.info(`[B0-EVIDENCE] ${issueId} ${JSON.stringify(payload)}`);
};

const checkoutRequest = (slug: string, productId: string, operationKey: string) =>
  new Request(`http://localhost/api/public/catalog/${slug}/checkout`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": operationKey,
    },
    body: JSON.stringify({
      customerName: "Catalog Runtime Customer",
      customerEmail: "catalog.runtime@example.com",
      customerPhone: "+996555100200",
      comment: "B0 runtime verification",
      lines: [{ productId, qty: 1 }],
    }),
  });

describeDb("B0 Agent 3 public catalogue P0 runtime verification", () => {
  beforeEach(async () => {
    await resetDatabase();
    sideEffects.publish.mockClear();
    sideEffects.sendOrderConfirmationEmail.mockClear();
  });

  it("reproduces HARD-A3-021: the same public checkout operation creates two orders and side effects", async () => {
    const { org, store, product, adminUser } = await seedBase();
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    const saved = await upsertBazaarCatalogSettings({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      status: BazaarCatalogStatus.PUBLISHED,
    });
    sideEffects.publish.mockClear();
    sideEffects.sendOrderConfirmationEmail.mockClear();

    const operationKey = "b0-a3-021-same-operation";
    const firstResponse = await postPublicCheckout(
      checkoutRequest(saved.catalog.slug, product.id, operationKey),
      { params: { slug: saved.catalog.slug } },
    );
    const secondResponse = await postPublicCheckout(
      checkoutRequest(saved.catalog.slug, product.id, operationKey),
      { params: { slug: saved.catalog.slug } },
    );
    const firstBody = (await firstResponse.json()) as { order: { id: string; number: string } };
    const secondBody = (await secondResponse.json()) as { order: { id: string; number: string } };
    const orders = await prisma.customerOrder.findMany({
      where: {
        organizationId: org.id,
        storeId: store.id,
        source: CustomerOrderSource.CATALOG,
      },
      orderBy: { number: "asc" },
    });
    const customers = await prisma.customer.findMany({
      where: { organizationId: org.id, storeId: store.id, email: "catalog.runtime@example.com" },
    });

    evidence("HARD-A3-021", {
      suppliedOperationKey: operationKey,
      responseStatuses: [firstResponse.status, secondResponse.status],
      responseOrderIds: [firstBody.order.id, secondBody.order.id],
      persistedOrderIds: orders.map((order) => order.id),
      customerOrderCounts: customers.map((customer) => customer.orderCount),
      orderCreatedEventCalls: sideEffects.publish.mock.calls.length,
      mockedEmailCalls: sideEffects.sendOrderConfirmationEmail.mock.calls.length,
      liveProviderCalls: 0,
    });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(firstBody.order.id).not.toBe(secondBody.order.id);
    expect(orders).toHaveLength(2);
    expect(customers).toHaveLength(1);
    expect(customers[0]?.orderCount).toBe(2);
    expect(sideEffects.publish).toHaveBeenCalledTimes(2);
    expect(sideEffects.sendOrderConfirmationEmail).toHaveBeenCalledTimes(2);
  });

  it("reproduces HARD-A3-022: cached displayed price remains 100 while checkout persists 120", async () => {
    const { org, store, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 80 } });
    await upsertStorePrice({
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      priceKgs: 100,
      actorId: adminUser.id,
      requestId: "b0-a3-022-price-100",
    });
    const saved = await upsertBazaarCatalogSettings({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      status: BazaarCatalogStatus.PUBLISHED,
    });

    const firstResponse = await getPublicCatalog(
      new Request(`http://localhost/api/public/catalog/${saved.catalog.slug}`),
      { params: { slug: saved.catalog.slug } },
    );
    const firstPayload = (await firstResponse.json()) as {
      products: Array<{ id: string; priceKgs: number }>;
    };
    await upsertStorePrice({
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      priceKgs: 120,
      actorId: adminUser.id,
      requestId: "b0-a3-022-price-120",
    });
    const secondResponse = await getPublicCatalog(
      new Request(`http://localhost/api/public/catalog/${saved.catalog.slug}`),
      { params: { slug: saved.catalog.slug } },
    );
    const secondPayload = (await secondResponse.json()) as {
      products: Array<{ id: string; priceKgs: number }>;
    };
    const checkoutResponse = await postPublicCheckout(
      checkoutRequest(saved.catalog.slug, product.id, "b0-a3-022-checkout"),
      { params: { slug: saved.catalog.slug } },
    );
    const checkoutBody = (await checkoutResponse.json()) as { order: { id: string } };
    const persistedOrder = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: checkoutBody.order.id },
      include: { lines: true },
    });
    const databasePrice = await prisma.storePrice.findUniqueOrThrow({
      where: {
        organizationId_storeId_productId_variantKey: {
          organizationId: org.id,
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    const firstPrice = firstPayload.products.find((item) => item.id === product.id)?.priceKgs;
    const secondPrice = secondPayload.products.find((item) => item.id === product.id)?.priceKgs;
    const orderPrice = Number(persistedOrder.lines[0]?.unitPriceKgs);

    evidence("HARD-A3-022", {
      catalogSlug: saved.catalog.slug,
      firstDisplayedPriceKgs: firstPrice,
      secondDisplayedPriceKgs: secondPrice,
      databasePriceKgs: Number(databasePrice.priceKgs),
      checkoutOrderId: persistedOrder.id,
      checkoutOrderPriceKgs: orderPrice,
      mockedEmailCalls: sideEffects.sendOrderConfirmationEmail.mock.calls.length,
      liveProviderCalls: 0,
    });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(checkoutResponse.status).toBe(200);
    expect(firstPrice).toBe(100);
    expect(secondPrice).toBe(100);
    expect(Number(databasePrice.priceKgs)).toBe(120);
    expect(orderPrice).toBe(120);
  });
});
