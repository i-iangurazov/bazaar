import {
  BazaarCatalogStatus,
  CustomerOrderSource,
  OperationRequestPrincipalType,
  OperationRequestStatus,
} from "@prisma/client";
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
import { getRedisPublisher } from "@/server/redis";
import {
  createCatalogCheckoutOrderOperationForTrustedScope,
  upsertBazaarCatalogSettings,
} from "@/server/services/bazaarCatalog";
import { bulkUpdateStorePrices, upsertStorePrice } from "@/server/services/storePrices";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const evidence = (issueId: string, payload: Record<string, unknown>) => {
  console.info(`[B0-EVIDENCE] ${issueId} ${JSON.stringify(payload)}`);
};

const checkoutRequest = (
  slug: string,
  productId: string,
  operationKey: string,
  overrides: Record<string, unknown> = {},
) => {
  const { quotedUnitPriceKgs = 0, ...bodyOverrides } = overrides;
  return new Request(`http://localhost/api/public/catalog/${slug}/checkout`, {
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
      lines: [{ productId, qty: 1, quotedUnitPriceKgs }],
      ...bodyOverrides,
    }),
  });
};

describeDb("B0 Agent 3 public catalogue P0 runtime verification", () => {
  beforeEach(async () => {
    await resetDatabase();
    sideEffects.publish.mockClear();
    sideEffects.sendOrderConfirmationEmail.mockClear();
  });

  it("regresses HARD-A3-021: public checkout replays one durable operation", async () => {
    const { org, store, product, adminUser } = await seedBase();
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    const saved = await upsertBazaarCatalogSettings({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "b0-catalog-stock",
      status: BazaarCatalogStatus.PUBLISHED,
    });
    sideEffects.publish.mockClear();
    sideEffects.sendOrderConfirmationEmail.mockClear();

    const operationKey = "b0-a3-021-same-operation";
    const firstResponse = await postPublicCheckout(
      checkoutRequest(saved.catalog.slug, product.id, operationKey, { quotedUnitPriceKgs: 100 }),
      { params: Promise.resolve({ slug: saved.catalog.slug }) },
    );
    const secondResponse = await postPublicCheckout(
      checkoutRequest(saved.catalog.slug, product.id, operationKey, { quotedUnitPriceKgs: 100 }),
      { params: Promise.resolve({ slug: saved.catalog.slug }) },
    );
    const changedResponse = await postPublicCheckout(
      checkoutRequest(saved.catalog.slug, product.id, operationKey, {
        comment: "changed material payload",
        quotedUnitPriceKgs: 100,
      }),
      { params: Promise.resolve({ slug: saved.catalog.slug }) },
    );
    const changedQuoteResponse = await postPublicCheckout(
      checkoutRequest(saved.catalog.slug, product.id, operationKey, {
        quotedUnitPriceKgs: 101,
      }),
      { params: Promise.resolve({ slug: saved.catalog.slug }) },
    );
    const missingKeyResponse = await postPublicCheckout(
      checkoutRequest(saved.catalog.slug, product.id, "", { quotedUnitPriceKgs: 100 }),
      { params: Promise.resolve({ slug: saved.catalog.slug }) },
    );
    const firstBody = (await firstResponse.json()) as { order: { id: string; number: string } };
    const secondBody = (await secondResponse.json()) as { order: { id: string; number: string } };
    const changedBody = (await changedResponse.json()) as { message: string };
    const changedQuoteBody = (await changedQuoteResponse.json()) as { message: string };
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
    const operation = await prisma.operationRequest.findUniqueOrThrow({
      where: {
        organizationId_scope_principalKey_idempotencyKey: {
          organizationId: org.id,
          scope: "catalog.checkout.create.v1",
          principalKey: `catalog:${saved.catalog.id}`,
          idempotencyKey: operationKey,
        },
      },
    });

    evidence("HARD-A3-021", {
      suppliedOperationKey: operationKey,
      responseStatuses: [
        firstResponse.status,
        secondResponse.status,
        changedResponse.status,
        changedQuoteResponse.status,
        missingKeyResponse.status,
      ],
      responseOrderIds: [firstBody.order.id, secondBody.order.id],
      persistedOrderIds: orders.map((order) => order.id),
      customerOrderCounts: customers.map((customer) => customer.orderCount),
      orderCreatedEventCalls: sideEffects.publish.mock.calls.length,
      mockedEmailCalls: sideEffects.sendOrderConfirmationEmail.mock.calls.length,
      liveProviderCalls: 0,
    });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(changedResponse.status).toBe(409);
    expect(changedBody).toEqual({ message: "operationRequestPayloadMismatch" });
    expect(changedQuoteResponse.status).toBe(409);
    expect(changedQuoteBody).toEqual({ message: "operationRequestPayloadMismatch" });
    expect(missingKeyResponse.status).toBe(400);
    await expect(missingKeyResponse.json()).resolves.toEqual({
      message: "idempotencyKeyRequired",
    });
    expect(firstResponse.headers.get("idempotency-replayed")).toBe("false");
    expect(secondResponse.headers.get("idempotency-replayed")).toBe("true");
    expect(secondResponse.headers.get("operation-request-id")).toBe(
      firstResponse.headers.get("operation-request-id"),
    );
    expect(firstBody).toEqual(secondBody);
    expect(orders).toHaveLength(1);
    expect(customers).toHaveLength(1);
    expect(customers[0]?.orderCount).toBe(1);
    expect(operation).toMatchObject({
      organizationId: org.id,
      storeId: store.id,
      principalType: OperationRequestPrincipalType.ANONYMOUS_CATALOG,
      principalKey: `catalog:${saved.catalog.id}`,
      status: OperationRequestStatus.COMPLETED,
      responseStatus: 200,
      responseCode: "created",
      resourceType: "CustomerOrder",
      resourceId: firstBody.order.id,
      attemptCount: 1,
    });
    expect(operation.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(sideEffects.publish).toHaveBeenCalledTimes(1);
    expect(sideEffects.sendOrderConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  it("regresses HARD-A3-021: concurrent public checkout retries create at most one order", async () => {
    const { org, store, product, adminUser } = await seedBase();
    const saved = await upsertBazaarCatalogSettings({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "b0-catalog-payment",
      status: BazaarCatalogStatus.PUBLISHED,
    });
    sideEffects.publish.mockClear();
    sideEffects.sendOrderConfirmationEmail.mockClear();
    const operationKey = "b0-a3-021-concurrent-operation";

    const responses = await Promise.all([
      postPublicCheckout(checkoutRequest(saved.catalog.slug, product.id, operationKey), {
        params: Promise.resolve({ slug: saved.catalog.slug }),
      }),
      postPublicCheckout(checkoutRequest(saved.catalog.slug, product.id, operationKey), {
        params: Promise.resolve({ slug: saved.catalog.slug }),
      }),
    ]);
    expect(responses.some((response) => response.status === 200)).toBe(true);
    expect(responses.every((response) => [200, 409].includes(response.status))).toBe(true);

    const replayResponse = await postPublicCheckout(
      checkoutRequest(saved.catalog.slug, product.id, operationKey),
      { params: Promise.resolve({ slug: saved.catalog.slug }) },
    );
    expect(replayResponse.status).toBe(200);
    expect(replayResponse.headers.get("idempotency-replayed")).toBe("true");
    await expect(
      prisma.customerOrder.count({
        where: {
          organizationId: org.id,
          storeId: store.id,
          source: CustomerOrderSource.CATALOG,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.operationRequest.count({
        where: {
          organizationId: org.id,
          scope: "catalog.checkout.create.v1",
          principalKey: `catalog:${saved.catalog.id}`,
          idempotencyKey: operationKey,
        },
      }),
    ).resolves.toBe(1);
    expect(sideEffects.publish).toHaveBeenCalledTimes(1);
    expect(sideEffects.sendOrderConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale trusted catalog scope before writing checkout effects", async () => {
    const { org, store, product, adminUser } = await seedBase();
    const saved = await upsertBazaarCatalogSettings({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "b0-catalog-forged-org",
      status: BazaarCatalogStatus.PUBLISHED,
    });
    const forgedOrganization = await prisma.organization.create({
      data: { name: "Forged stale checkout scope" },
    });
    const forgedStore = await prisma.store.create({
      data: {
        organizationId: forgedOrganization.id,
        name: "Forged stale store",
        code: "FORGED",
      },
    });
    sideEffects.publish.mockClear();
    sideEffects.sendOrderConfirmationEmail.mockClear();

    await expect(
      createCatalogCheckoutOrderOperationForTrustedScope(
        {
          slug: saved.catalog.slug,
          idempotencyKey: "b0-a3-021-stale-scope",
          customerName: "Stale Scope Customer",
          customerEmail: "stale.scope@example.com",
          customerPhone: "+996555100201",
          lines: [{ productId: product.id, qty: 1, quotedUnitPriceKgs: 0 }],
        },
        {
          catalogId: "forged-stale-catalog-id",
          organizationId: forgedOrganization.id,
          storeId: forgedStore.id,
        },
      ),
    ).rejects.toMatchObject({ message: "catalogScopeChanged", status: 409 });

    await expect(prisma.customerOrder.count()).resolves.toBe(0);
    await expect(prisma.customer.count()).resolves.toBe(0);
    const operation = await prisma.operationRequest.findFirstOrThrow({
      where: {
        organizationId: forgedOrganization.id,
        storeId: forgedStore.id,
        scope: "catalog.checkout.create.v1",
        principalKey: "catalog:forged-stale-catalog-id",
        idempotencyKey: "b0-a3-021-stale-scope",
      },
    });
    expect(operation.status).toBe(OperationRequestStatus.FAILED);
    expect(operation.status).not.toBe(OperationRequestStatus.COMPLETED);
    expect(operation.resourceId).toBeNull();
    expect(sideEffects.publish).not.toHaveBeenCalled();
    expect(sideEffects.sendOrderConfirmationEmail).not.toHaveBeenCalled();
  });

  it("regresses HARD-A3-022: public GET stays fresh after price and product mutations", async () => {
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
      requestId: "b0-catalog-replay",
      status: BazaarCatalogStatus.PUBLISHED,
    });
    const firstResponse = await getPublicCatalog(
      new Request(`http://localhost/api/public/catalog/${saved.catalog.slug}`),
      { params: Promise.resolve({ slug: saved.catalog.slug }) },
    );
    const firstPayload = (await firstResponse.json()) as {
      products: Array<{ id: string; name: string; priceKgs: number; quotedUnitPriceKgs: number }>;
    };
    await prisma.$transaction([
      prisma.storePrice.updateMany({
        where: { organizationId: org.id, storeId: store.id, productId: product.id },
        data: { priceKgs: 120 },
      }),
      prisma.product.update({
        where: { id: product.id },
        data: { name: "Fresh catalog product" },
      }),
    ]);
    const secondResponse = await getPublicCatalog(
      new Request(`http://localhost/api/public/catalog/${saved.catalog.slug}`),
      { params: Promise.resolve({ slug: saved.catalog.slug }) },
    );
    const secondPayload = (await secondResponse.json()) as {
      products: Array<{ id: string; name: string; priceKgs: number; quotedUnitPriceKgs: number }>;
    };
    await prisma.product.update({ where: { id: product.id }, data: { isDeleted: true } });
    const archivedResponse = await getPublicCatalog(
      new Request(`http://localhost/api/public/catalog/${saved.catalog.slug}`),
      { params: Promise.resolve({ slug: saved.catalog.slug }) },
    );
    const archivedPayload = (await archivedResponse.json()) as {
      products: Array<{ id: string }>;
    };
    const firstProduct = firstPayload.products.find((item) => item.id === product.id);
    const secondProduct = secondPayload.products.find((item) => item.id === product.id);

    evidence("HARD-A3-022-fixed", {
      catalogSlug: saved.catalog.slug,
      firstProduct,
      secondProduct,
      archivedProductVisible: archivedPayload.products.some((item) => item.id === product.id),
      cacheMode: "fail-fresh-database",
    });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(archivedResponse.status).toBe(200);
    expect(firstProduct).toMatchObject({ priceKgs: 100, quotedUnitPriceKgs: 100 });
    expect(secondProduct).toMatchObject({
      name: "Fresh catalog product",
      priceKgs: 120,
      quotedUnitPriceKgs: 120,
    });
    expect(archivedPayload.products).not.toContainEqual(
      expect.objectContaining({ id: product.id }),
    );
  });

  it("regresses HARD-A3-022: stale price quote conflicts before effects, then a new key replays once", async () => {
    const { org, store, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    await upsertStorePrice({
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      priceKgs: 100,
      actorId: adminUser.id,
      requestId: "b3-a3-022-price-100",
    });
    const saved = await upsertBazaarCatalogSettings({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "b0-catalog-cache",
      status: BazaarCatalogStatus.PUBLISHED,
    });
    const warmedResponse = await getPublicCatalog(
      new Request(`http://localhost/api/public/catalog/${saved.catalog.slug}`),
      { params: Promise.resolve({ slug: saved.catalog.slug }) },
    );
    const warmedPayload = (await warmedResponse.json()) as {
      products: Array<{ id: string; quotedUnitPriceKgs: number }>;
    };
    const staleQuote = warmedPayload.products.find(
      (item) => item.id === product.id,
    )?.quotedUnitPriceKgs;
    expect(staleQuote).toBe(100);
    await prisma.storePrice.updateMany({
      where: { organizationId: org.id, storeId: store.id, productId: product.id },
      data: { priceKgs: 120 },
    });
    sideEffects.publish.mockClear();
    sideEffects.sendOrderConfirmationEmail.mockClear();

    const staleKey = "b3-a3-022-stale-quote";
    const staleResponse = await postPublicCheckout(
      checkoutRequest(saved.catalog.slug, product.id, staleKey, {
        quotedUnitPriceKgs: staleQuote,
      }),
      { params: Promise.resolve({ slug: saved.catalog.slug }) },
    );
    const staleBody = (await staleResponse.json()) as { message: string };
    const [ordersAfterConflict, customersAfterConflict, completedAfterConflict, failedOperation] =
      await Promise.all([
        prisma.customerOrder.count(),
        prisma.customer.count(),
        prisma.operationRequest.count({
          where: { scope: "catalog.checkout.create.v1", status: OperationRequestStatus.COMPLETED },
        }),
        prisma.operationRequest.findFirstOrThrow({
          where: {
            organizationId: org.id,
            scope: "catalog.checkout.create.v1",
            principalKey: `catalog:${saved.catalog.id}`,
            idempotencyKey: staleKey,
          },
        }),
      ]);

    expect(staleResponse.status).toBe(409);
    expect(staleBody).toEqual({ message: "catalogPriceChanged" });
    expect(ordersAfterConflict).toBe(0);
    expect(customersAfterConflict).toBe(0);
    expect(completedAfterConflict).toBe(0);
    expect(failedOperation).toMatchObject({
      status: OperationRequestStatus.FAILED,
      responseStatus: 409,
      responseCode: "catalogPriceChanged",
      errorClassification: "SAFE_BEFORE_EFFECTS",
      resourceId: null,
    });
    expect(sideEffects.publish).not.toHaveBeenCalled();
    expect(sideEffects.sendOrderConfirmationEmail).not.toHaveBeenCalled();

    const refreshedResponse = await getPublicCatalog(
      new Request(`http://localhost/api/public/catalog/${saved.catalog.slug}`),
      { params: Promise.resolve({ slug: saved.catalog.slug }) },
    );
    const refreshedPayload = (await refreshedResponse.json()) as {
      products: Array<{ id: string; quotedUnitPriceKgs: number }>;
    };
    const refreshedQuote = refreshedPayload.products.find(
      (item) => item.id === product.id,
    )?.quotedUnitPriceKgs;
    const successKey = "b3-a3-022-refreshed-quote";
    const successRequest = () =>
      checkoutRequest(saved.catalog.slug, product.id, successKey, {
        quotedUnitPriceKgs: refreshedQuote,
      });
    const successResponse = await postPublicCheckout(successRequest(), {
      params: Promise.resolve({ slug: saved.catalog.slug }),
    });
    const replayResponse = await postPublicCheckout(successRequest(), {
      params: Promise.resolve({ slug: saved.catalog.slug }),
    });
    const successBody = (await successResponse.json()) as { order: { id: string } };
    const replayBody = (await replayResponse.json()) as { order: { id: string } };
    const [persistedOrder, orderCount, customerCount] = await Promise.all([
      prisma.customerOrder.findUniqueOrThrow({
        where: { id: successBody.order.id },
        include: { lines: true },
      }),
      prisma.customerOrder.count(),
      prisma.customer.count(),
    ]);

    evidence("HARD-A3-022-quote-fixed", {
      staleQuote,
      currentQuote: refreshedQuote,
      conflictStatus: staleResponse.status,
      failedOperationStatus: failedOperation.status,
      successOrderId: persistedOrder.id,
      persistedUnitPriceKgs: Number(persistedOrder.lines[0]?.unitPriceKgs),
      replayed: replayResponse.headers.get("idempotency-replayed"),
      orderCount,
      customerCount,
      eventCalls: sideEffects.publish.mock.calls.length,
      emailCalls: sideEffects.sendOrderConfirmationEmail.mock.calls.length,
    });

    expect(refreshedQuote).toBe(120);
    expect(successResponse.status).toBe(200);
    expect(replayResponse.status).toBe(200);
    expect(replayResponse.headers.get("idempotency-replayed")).toBe("true");
    expect(replayBody).toEqual(successBody);
    expect(Number(persistedOrder.lines[0]?.unitPriceKgs)).toBe(120);
    expect(orderCount).toBe(1);
    expect(customerCount).toBe(1);
    expect(sideEffects.publish).toHaveBeenCalledTimes(1);
    expect(sideEffects.sendOrderConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  it("regresses HARD-A3-022: stale archived and disabled-variant carts have zero effects", async () => {
    const { org, store, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, name: "Stale variant", attributes: {}, isActive: true },
    });
    await prisma.storePrice.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        variantId: variant.id,
        variantKey: variant.id,
        priceKgs: 150,
      },
    });
    const saved = await upsertBazaarCatalogSettings({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "b0-catalog-price-conflict",
      status: BazaarCatalogStatus.PUBLISHED,
    });
    sideEffects.publish.mockClear();
    sideEffects.sendOrderConfirmationEmail.mockClear();

    await prisma.product.update({ where: { id: product.id }, data: { isDeleted: true } });
    const archivedResponse = await postPublicCheckout(
      checkoutRequest(saved.catalog.slug, product.id, "b3-a3-022-archived", {
        quotedUnitPriceKgs: 100,
      }),
      { params: Promise.resolve({ slug: saved.catalog.slug }) },
    );
    await prisma.product.update({ where: { id: product.id }, data: { isDeleted: false } });
    await prisma.productVariant.update({ where: { id: variant.id }, data: { isActive: false } });
    const variantResponse = await postPublicCheckout(
      checkoutRequest(saved.catalog.slug, product.id, "b3-a3-022-disabled-variant", {
        lines: [
          {
            productId: product.id,
            variantId: variant.id,
            qty: 1,
            quotedUnitPriceKgs: 150,
          },
        ],
      }),
      { params: Promise.resolve({ slug: saved.catalog.slug }) },
    );
    const missingQuoteResponse = await postPublicCheckout(
      checkoutRequest(saved.catalog.slug, product.id, "b3-a3-022-missing-quote", {
        lines: [{ productId: product.id, qty: 1 }],
      }),
      { params: Promise.resolve({ slug: saved.catalog.slug }) },
    );
    const [archivedBody, variantBody, missingQuoteBody, orderCount, customerCount, operations] =
      await Promise.all([
        archivedResponse.json() as Promise<{ message: string }>,
        variantResponse.json() as Promise<{ message: string }>,
        missingQuoteResponse.json() as Promise<{ message: string }>,
        prisma.customerOrder.count(),
        prisma.customer.count(),
        prisma.operationRequest.findMany({
          where: { scope: "catalog.checkout.create.v1" },
          orderBy: { idempotencyKey: "asc" },
        }),
      ]);

    expect(archivedResponse.status).toBe(404);
    expect(archivedBody).toEqual({ message: "productNotFound" });
    expect(variantResponse.status).toBe(404);
    expect(variantBody).toEqual({ message: "variantNotFound" });
    expect(missingQuoteResponse.status).toBe(400);
    expect(missingQuoteBody).toEqual({ message: "invalidInput" });
    expect(orderCount).toBe(0);
    expect(customerCount).toBe(0);
    expect(operations).toHaveLength(2);
    expect(
      operations.every((operation) => operation.status === OperationRequestStatus.FAILED),
    ).toBe(true);
    expect(operations.every((operation) => operation.resourceId === null)).toBe(true);
    expect(sideEffects.publish).not.toHaveBeenCalled();
    expect(sideEffects.sendOrderConfirmationEmail).not.toHaveBeenCalled();
  });

  it("regresses HARD-A3-022: public GET stays fresh while Redis is unavailable", async () => {
    const { org, store, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 80 } });
    await upsertStorePrice({
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      priceKgs: 100,
      actorId: adminUser.id,
      requestId: "b2-a3-022-retry-seed",
    });
    const saved = await upsertBazaarCatalogSettings({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "b0-catalog-redis-outage",
      status: BazaarCatalogStatus.PUBLISHED,
    });
    const publicUrl = `http://localhost/api/public/catalog/${saved.catalog.slug}`;
    const warmedResponse = await getPublicCatalog(new Request(publicUrl), {
      params: Promise.resolve({ slug: saved.catalog.slug }),
    });
    const warmedPrice = (
      (await warmedResponse.json()) as {
        products: Array<{ id: string; priceKgs: number }>;
      }
    ).products.find((item) => item.id === product.id)?.priceKgs;
    expect(warmedPrice).toBe(100);

    const redis = getRedisPublisher();
    expect(redis).toBeNull();

    const input = {
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "b2-a3-022-retry-request",
      idempotencyKey: "b2-a3-022-retry-operation",
      filter: { search: product.sku },
      mode: "increaseAbs" as const,
      value: 20,
    };

    await expect(bulkUpdateStorePrices(input)).resolves.toEqual({ updated: 1 });
    const freshAfterFailureResponse = await getPublicCatalog(new Request(publicUrl), {
      params: Promise.resolve({ slug: saved.catalog.slug }),
    });
    const freshAfterFailurePrice = (
      (await freshAfterFailureResponse.json()) as {
        products: Array<{ id: string; priceKgs: number }>;
      }
    ).products.find((item) => item.id === product.id)?.priceKgs;

    const replay = await bulkUpdateStorePrices(input);
    const refreshedResponse = await getPublicCatalog(new Request(publicUrl), {
      params: Promise.resolve({ slug: saved.catalog.slug }),
    });
    const refreshedPrice = (
      (await refreshedResponse.json()) as {
        products: Array<{ id: string; priceKgs: number }>;
      }
    ).products.find((item) => item.id === product.id)?.priceKgs;
    const [databasePrice, auditCount, operation] = await Promise.all([
      prisma.storePrice.findUniqueOrThrow({
        where: {
          organizationId_storeId_productId_variantKey: {
            organizationId: org.id,
            storeId: store.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
      prisma.auditLog.count({
        where: {
          organizationId: org.id,
          action: "STORE_PRICE_BULK_UPDATE",
          requestId: input.requestId,
        },
      }),
      prisma.operationRequest.findUniqueOrThrow({
        where: {
          organizationId_scope_principalKey_idempotencyKey: {
            organizationId: org.id,
            scope: "storePrices.bulkUpdate",
            principalKey: `user:${adminUser.id}`,
            idempotencyKey: input.idempotencyKey,
          },
        },
      }),
    ]);

    evidence("HARD-A3-022-cache-retry-fixed", {
      redisOutage: "disabled-by-deterministic-test-lane",
      priceAfterFailedRedisEvictionKgs: freshAfterFailurePrice,
      refreshedPriceAfterReplayKgs: refreshedPrice,
      databasePriceKgs: Number(databasePrice.priceKgs),
      persistedAuditCount: auditCount,
      operationStatus: operation.status,
      operationAttemptCount: operation.attemptCount,
      redisReadCalls: 0,
      redisWriteCalls: 0,
    });

    expect(replay).toEqual({ updated: 1 });
    expect(freshAfterFailurePrice).toBe(120);
    expect(refreshedPrice).toBe(120);
    expect(Number(databasePrice.priceKgs)).toBe(120);
    expect(auditCount).toBe(1);
    expect(operation).toMatchObject({ status: "COMPLETED", attemptCount: 1 });
  });
});
