import {
  CustomerOrderSource,
  OperationRequestPrincipalType,
  OperationRequestStatus,
  StockMovementType,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sideEffects = vi.hoisted(() => ({
  publish: vi.fn(),
  sendOrderConfirmationEmail: vi.fn(async () => ({
    status: "sent" as const,
    recipientEmail: "operation.customer@example.com",
  })),
}));

vi.mock("@/server/events/eventBus", () => ({
  eventBus: { publish: sideEffects.publish },
}));

vi.mock("@/server/services/orderEmails", () => ({
  sendOrderConfirmationEmail: sideEffects.sendOrderConfirmationEmail,
}));

import { POST as postBazaarApiOrder } from "@/app/api/bazaar/v1/orders/route";
import { prisma } from "@/server/db/prisma";
import { createBazaarApiKey } from "@/server/services/bazaarApi";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const orderBody = (productId: string, overrides: Record<string, unknown> = {}) => ({
  customerName: "Operation Customer",
  customerEmail: "operation.customer@example.com",
  customerPhone: "+996555700800",
  customerAddress: "Bishkek",
  comment: "Operation request checkout",
  lines: [{ productId, qty: 1 }],
  ...overrides,
});

const orderRequest = (input: {
  token: string;
  body: Record<string, unknown>;
  idempotencyKey?: string;
}) =>
  new Request("http://localhost/api/bazaar/v1/orders", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
      ...(input.idempotencyKey ? { "idempotency-key": input.idempotencyKey } : {}),
    },
    body: JSON.stringify(input.body),
  });

const setup = async () => {
  const seeded = await seedBase({ allowNegativeStock: true });
  await prisma.product.update({
    where: { id: seeded.product.id },
    data: { basePriceKgs: 125 },
  });
  const apiKey = await createBazaarApiKey({
    organizationId: seeded.org.id,
    storeId: seeded.store.id,
    actorId: seeded.adminUser.id,
    requestId: "bazaar-api-operation-key",
    name: "operation-key",
  });
  sideEffects.publish.mockClear();
  sideEffects.sendOrderConfirmationEmail.mockClear();
  return { ...seeded, ...apiKey };
};

describeDb("Bazaar API order OperationRequest consumer", () => {
  beforeEach(async () => {
    await resetDatabase();
    sideEffects.publish.mockClear();
    sideEffects.sendOrderConfirmationEmail.mockClear();
  });

  it("replays a no-externalId request and rejects a changed material payload", async () => {
    const { org, store, product, apiKey, token } = await setup();
    const idempotencyKey = "api-order-no-external-0001";
    const body = orderBody(product.id);

    const firstResponse = await postBazaarApiOrder(orderRequest({ token, body, idempotencyKey }));
    const replayResponse = await postBazaarApiOrder(orderRequest({ token, body, idempotencyKey }));
    const firstPayload = (await firstResponse.json()) as { order: { id: string } };
    const replayPayload = (await replayResponse.json()) as { order: { id: string } };

    expect(firstResponse.status).toBe(201);
    expect(replayResponse.status).toBe(201);
    expect(firstResponse.headers.get("idempotency-replayed")).toBe("false");
    expect(replayResponse.headers.get("idempotency-replayed")).toBe("true");
    expect(replayResponse.headers.get("operation-request-id")).toBe(
      firstResponse.headers.get("operation-request-id"),
    );
    expect(replayPayload).toEqual(firstPayload);

    const changedResponse = await postBazaarApiOrder(
      orderRequest({
        token,
        idempotencyKey,
        body: orderBody(product.id, { lines: [{ productId: product.id, qty: 2 }] }),
      }),
    );
    await expect(changedResponse.json()).resolves.toEqual({
      message: "operationRequestPayloadMismatch",
    });
    expect(changedResponse.status).toBe(409);

    const [orders, operation, saleMovements, snapshot, customers] = await Promise.all([
      prisma.customerOrder.findMany({
        where: {
          organizationId: org.id,
          storeId: store.id,
          source: CustomerOrderSource.API,
        },
      }),
      prisma.operationRequest.findUniqueOrThrow({
        where: {
          organizationId_scope_principalKey_idempotencyKey: {
            organizationId: org.id,
            scope: "bazaar-api.order.create.v1",
            principalKey: `api-key:${apiKey.id}`,
            idempotencyKey,
          },
        },
      }),
      prisma.stockMovement.findMany({
        where: {
          referenceType: "CustomerOrder",
          referenceId: firstPayload.order.id,
          type: StockMovementType.SALE,
        },
      }),
      prisma.inventorySnapshot.findUnique({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
      prisma.customer.findMany({
        where: {
          organizationId: org.id,
          storeId: store.id,
          email: "operation.customer@example.com",
        },
      }),
    ]);

    expect(orders).toHaveLength(1);
    expect(saleMovements).toHaveLength(1);
    expect(snapshot?.onHand).toBe(-1);
    expect(customers).toHaveLength(1);
    expect(customers[0]?.orderCount).toBe(1);
    expect(operation).toMatchObject({
      storeId: store.id,
      principalType: OperationRequestPrincipalType.API_KEY,
      principalKey: `api-key:${apiKey.id}`,
      status: OperationRequestStatus.COMPLETED,
      responseStatus: 201,
      responseCode: "created",
      resourceType: "CustomerOrder",
      resourceId: firstPayload.order.id,
      attemptCount: 1,
    });
    expect(operation.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(operation.expiresAt?.getTime()).toBeGreaterThan(Date.now() + 89 * 24 * 60 * 60 * 1000);
    expect(sideEffects.publish).toHaveBeenCalledTimes(1);
    expect(sideEffects.publish).toHaveBeenCalledWith({
      type: "customerOrder.created",
      payload: {
        customerOrderId: firstPayload.order.id,
        storeId: store.id,
        source: CustomerOrderSource.API,
      },
    });
    expect(sideEffects.sendOrderConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  it("uses exact external identity as the stable key and requires a key when it is absent", async () => {
    const { product, token } = await setup();
    const body = orderBody(product.id, { externalId: "EXTERNAL-STABLE-1" });

    const firstResponse = await postBazaarApiOrder(orderRequest({ token, body }));
    const replayResponse = await postBazaarApiOrder(orderRequest({ token, body }));
    const firstPayload = (await firstResponse.json()) as { order: { id: string } };
    const replayPayload = (await replayResponse.json()) as { order: { id: string } };
    expect(firstResponse.status).toBe(201);
    expect(replayResponse.status).toBe(201);
    expect(replayPayload).toEqual(firstPayload);
    expect(replayResponse.headers.get("idempotency-replayed")).toBe("true");

    const changedResponse = await postBazaarApiOrder(
      orderRequest({
        token,
        body: orderBody(product.id, {
          externalId: "EXTERNAL-STABLE-1",
          comment: "changed payload",
        }),
      }),
    );
    expect(changedResponse.status).toBe(409);
    await expect(changedResponse.json()).resolves.toEqual({
      message: "operationRequestPayloadMismatch",
    });

    const missingKeyResponse = await postBazaarApiOrder(
      orderRequest({ token, body: orderBody(product.id) }),
    );
    expect(missingKeyResponse.status).toBe(400);
    await expect(missingKeyResponse.json()).resolves.toEqual({
      message: "idempotencyKeyRequired",
    });
    expect(sideEffects.publish).toHaveBeenCalledTimes(1);
    expect(sideEffects.sendOrderConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  it("allows concurrent retries to create at most one order and one side-effect set", async () => {
    const { org, store, product, token } = await setup();
    const idempotencyKey = "api-order-concurrent-0001";
    const body = orderBody(product.id);

    const concurrentResponses = await Promise.all([
      postBazaarApiOrder(orderRequest({ token, body, idempotencyKey })),
      postBazaarApiOrder(orderRequest({ token, body, idempotencyKey })),
    ]);
    expect(concurrentResponses.some((response) => response.status === 201)).toBe(true);
    expect(concurrentResponses.every((response) => [201, 409].includes(response.status))).toBe(
      true,
    );

    const replayResponse = await postBazaarApiOrder(orderRequest({ token, body, idempotencyKey }));
    expect(replayResponse.status).toBe(201);
    expect(replayResponse.headers.get("idempotency-replayed")).toBe("true");

    await expect(
      prisma.customerOrder.count({
        where: {
          organizationId: org.id,
          storeId: store.id,
          source: CustomerOrderSource.API,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.operationRequest.count({
        where: {
          organizationId: org.id,
          scope: "bazaar-api.order.create.v1",
          idempotencyKey,
        },
      }),
    ).resolves.toBe(1);
    expect(sideEffects.publish).toHaveBeenCalledTimes(1);
    expect(sideEffects.sendOrderConfirmationEmail).toHaveBeenCalledTimes(1);
  });
});
