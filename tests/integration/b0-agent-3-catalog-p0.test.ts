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
) =>
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
      ...overrides,
    }),
  });

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
    const changedResponse = await postPublicCheckout(
      checkoutRequest(saved.catalog.slug, product.id, operationKey, {
        comment: "changed material payload",
      }),
      { params: { slug: saved.catalog.slug } },
    );
    const missingKeyResponse = await postPublicCheckout(
      checkoutRequest(saved.catalog.slug, product.id, ""),
      { params: { slug: saved.catalog.slug } },
    );
    const firstBody = (await firstResponse.json()) as { order: { id: string; number: string } };
    const secondBody = (await secondResponse.json()) as { order: { id: string; number: string } };
    const changedBody = (await changedResponse.json()) as { message: string };
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
      status: BazaarCatalogStatus.PUBLISHED,
    });
    sideEffects.publish.mockClear();
    sideEffects.sendOrderConfirmationEmail.mockClear();
    const operationKey = "b0-a3-021-concurrent-operation";

    const responses = await Promise.all([
      postPublicCheckout(checkoutRequest(saved.catalog.slug, product.id, operationKey), {
        params: { slug: saved.catalog.slug },
      }),
      postPublicCheckout(checkoutRequest(saved.catalog.slug, product.id, operationKey), {
        params: { slug: saved.catalog.slug },
      }),
    ]);
    expect(responses.some((response) => response.status === 200)).toBe(true);
    expect(responses.every((response) => [200, 409].includes(response.status))).toBe(true);

    const replayResponse = await postPublicCheckout(
      checkoutRequest(saved.catalog.slug, product.id, operationKey),
      { params: { slug: saved.catalog.slug } },
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
          lines: [{ productId: product.id, qty: 1 }],
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

  it("verifies HARD-A3-022: price writes evict only the affected public catalog cache", async () => {
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
    const scopedStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Catalog Cache Scope Store",
        code: "CACHE-SCOPE",
      },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: scopedStore.id,
        productId: product.id,
        isActive: true,
        assignedById: adminUser.id,
      },
    });
    const scopedPrice = await prisma.storePrice.create({
      data: {
        organizationId: org.id,
        storeId: scopedStore.id,
        productId: product.id,
        variantKey: "BASE",
        priceKgs: 300,
        updatedById: adminUser.id,
      },
    });
    const scopedCatalog = await upsertBazaarCatalogSettings({
      organizationId: org.id,
      storeId: scopedStore.id,
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
    const scopedFirstResponse = await getPublicCatalog(
      new Request(`http://localhost/api/public/catalog/${scopedCatalog.catalog.slug}`),
      { params: { slug: scopedCatalog.catalog.slug } },
    );
    const scopedFirstPayload = (await scopedFirstResponse.json()) as {
      products: Array<{ id: string; priceKgs: number }>;
    };
    await prisma.storePrice.update({
      where: { id: scopedPrice.id },
      data: { priceKgs: 330 },
    });
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
    const scopedSecondResponse = await getPublicCatalog(
      new Request(`http://localhost/api/public/catalog/${scopedCatalog.catalog.slug}`),
      { params: { slug: scopedCatalog.catalog.slug } },
    );
    const scopedSecondPayload = (await scopedSecondResponse.json()) as {
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
    const scopedDatabasePrice = await prisma.storePrice.findUniqueOrThrow({
      where: { id: scopedPrice.id },
    });
    const firstPrice = firstPayload.products.find((item) => item.id === product.id)?.priceKgs;
    const secondPrice = secondPayload.products.find((item) => item.id === product.id)?.priceKgs;
    const scopedFirstPrice = scopedFirstPayload.products.find(
      (item) => item.id === product.id,
    )?.priceKgs;
    const scopedSecondPrice = scopedSecondPayload.products.find(
      (item) => item.id === product.id,
    )?.priceKgs;
    const orderPrice = Number(persistedOrder.lines[0]?.unitPriceKgs);

    evidence("HARD-A3-022-fixed", {
      catalogSlug: saved.catalog.slug,
      firstDisplayedPriceKgs: firstPrice,
      secondDisplayedPriceKgs: secondPrice,
      databasePriceKgs: Number(databasePrice.priceKgs),
      checkoutOrderId: persistedOrder.id,
      checkoutOrderPriceKgs: orderPrice,
      unaffectedCatalogSlug: scopedCatalog.catalog.slug,
      unaffectedCachedPriceKgs: [scopedFirstPrice, scopedSecondPrice],
      unaffectedDatabasePriceKgs: Number(scopedDatabasePrice.priceKgs),
      mockedEmailCalls: sideEffects.sendOrderConfirmationEmail.mock.calls.length,
      liveProviderCalls: 0,
    });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(scopedFirstResponse.status).toBe(200);
    expect(scopedSecondResponse.status).toBe(200);
    expect(checkoutResponse.status).toBe(200);
    expect(firstPrice).toBe(100);
    expect(secondPrice).toBe(120);
    expect(Number(databasePrice.priceKgs)).toBe(120);
    expect(orderPrice).toBe(120);
    expect(scopedFirstPrice).toBe(300);
    expect(scopedSecondPrice).toBe(300);
    expect(Number(scopedDatabasePrice.priceKgs)).toBe(330);
  });

  it("verifies HARD-A3-022: a replay retries failed cache eviction without another price effect", async () => {
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
      status: BazaarCatalogStatus.PUBLISHED,
    });
    const publicUrl = `http://localhost/api/public/catalog/${saved.catalog.slug}`;
    const warmedResponse = await getPublicCatalog(new Request(publicUrl), {
      params: { slug: saved.catalog.slug },
    });
    const warmedPrice = (
      (await warmedResponse.json()) as {
        products: Array<{ id: string; priceKgs: number }>;
      }
    ).products.find((item) => item.id === product.id)?.priceKgs;
    expect(warmedPrice).toBe(100);

    const redis = getRedisPublisher();
    if (!redis) {
      throw new Error("HARD-A3-022 cache retry test requires real Redis");
    }
    const originalDel = redis.del.bind(redis);
    const delSpy = vi.spyOn(redis, "del");
    delSpy.mockRejectedValueOnce(new Error("syntheticRedisDelFailure"));
    delSpy.mockImplementation((...args) => originalDel(...args));

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

    try {
      await expect(bulkUpdateStorePrices(input)).rejects.toThrow("syntheticRedisDelFailure");
      const staleResponse = await getPublicCatalog(new Request(publicUrl), {
        params: { slug: saved.catalog.slug },
      });
      const stalePrice = (
        (await staleResponse.json()) as {
          products: Array<{ id: string; priceKgs: number }>;
        }
      ).products.find((item) => item.id === product.id)?.priceKgs;

      const replay = await bulkUpdateStorePrices(input);
      const refreshedResponse = await getPublicCatalog(new Request(publicUrl), {
        params: { slug: saved.catalog.slug },
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
        firstEvictionError: "syntheticRedisDelFailure",
        stalePriceAfterCommittedWriteKgs: stalePrice,
        refreshedPriceAfterReplayKgs: refreshedPrice,
        databasePriceKgs: Number(databasePrice.priceKgs),
        persistedAuditCount: auditCount,
        operationStatus: operation.status,
        operationAttemptCount: operation.attemptCount,
        redisDeleteCalls: delSpy.mock.calls.length,
      });

      expect(replay).toEqual({ updated: 1 });
      expect(stalePrice).toBe(100);
      expect(refreshedPrice).toBe(120);
      expect(Number(databasePrice.priceKgs)).toBe(120);
      expect(auditCount).toBe(1);
      expect(operation).toMatchObject({ status: "COMPLETED", attemptCount: 1 });
      expect(delSpy).toHaveBeenCalledTimes(2);
    } finally {
      delSpy.mockRestore();
    }
  });
});
