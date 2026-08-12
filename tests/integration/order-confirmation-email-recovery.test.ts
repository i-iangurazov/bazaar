import {
  CustomerOrderEmailStatus,
  CustomerOrderEmailType,
  CustomerOrderSource,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/prisma";
import { ORDER_CONFIRMATION_EMAIL_JOB_NAME } from "@/server/jobs/orderConfirmationEmails";
import { runJob } from "@/server/jobs";
import { createBazaarApiKey, createBazaarApiOrderOperation } from "@/server/services/bazaarApi";
import { sendOrderConfirmationEmail } from "@/server/services/orderEmails";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const waitFor = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition not reached");
};

describeDb("API order confirmation email recovery", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("EMAIL_FROM", "orders@example.test");
    vi.stubEnv("RESEND_API_KEY", "resend-test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("persists provider failure, retries once, and replays without a duplicate email", async () => {
    const { org, store, product, adminUser } = await seedBase({ allowNegativeStock: true });
    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 125 },
    });
    const { apiKey } = await createBazaarApiKey({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "email-recovery-api-key",
      name: "email-recovery",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("provider unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "resend-recovered-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      organizationId: org.id,
      storeId: store.id,
      apiKeyId: apiKey.id,
      idempotencyKey: "api-order-email-recovery-0001",
      customerName: "Recovery Customer",
      customerEmail: "recovery.customer@example.test",
      customerPhone: "+996555000111",
      lines: [{ productId: product.id, qty: 1 }],
    };

    const created = await createBazaarApiOrderOperation(input);
    const orderId = created.response.order.id;
    const failedLog = await prisma.customerOrderEmailLog.findFirstOrThrow({
      where: {
        customerOrderId: orderId,
        type: CustomerOrderEmailType.CONFIRMATION,
      },
    });

    expect(created.replayed).toBe(false);
    expect(failedLog.status).toBe(CustomerOrderEmailStatus.FAILED);
    expect(failedLog.attemptCount).toBe(1);
    expect(failedLog.nextAttemptAt).toBeInstanceOf(Date);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await prisma.customerOrderEmailLog.update({
      where: { id: failedLog.id },
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
    });
    const workerResult = await runJob(ORDER_CONFIRMATION_EMAIL_JOB_NAME, {
      logId: failedLog.id,
    });
    const [sentLog, order] = await Promise.all([
      prisma.customerOrderEmailLog.findUniqueOrThrow({ where: { id: failedLog.id } }),
      prisma.customerOrder.findUniqueOrThrow({ where: { id: orderId } }),
    ]);

    expect(workerResult).toMatchObject({
      status: "ok",
      details: { processed: 1, sent: 1, failed: 0 },
    });
    expect(sentLog.status).toBe(CustomerOrderEmailStatus.SENT);
    expect(sentLog.attemptCount).toBe(2);
    expect(sentLog.providerMessageId).toBe("resend-recovered-1");
    expect(order.confirmationEmailSentAt).toBeInstanceOf(Date);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const replay = await createBazaarApiOrderOperation(input);
    expect(replay.replayed).toBe(true);
    await expect(
      prisma.customerOrderEmailLog.count({
        where: { customerOrderId: orderId, type: CustomerOrderEmailType.CONFIRMATION },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.customerOrder.count({
        where: { organizationId: org.id, source: CustomerOrderSource.API },
      }),
    ).resolves.toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await prisma.customerOrderEmailLog.update({
      where: { id: sentLog.id },
      data: {
        status: CustomerOrderEmailStatus.PROCESSING,
        updatedAt: new Date(Date.now() - 11 * 60 * 1000),
      },
    });
    const staleRecovery = await runJob(ORDER_CONFIRMATION_EMAIL_JOB_NAME, {
      logId: sentLog.id,
    });
    const recoveredLog = await prisma.customerOrderEmailLog.findUniqueOrThrow({
      where: { id: sentLog.id },
    });

    expect(staleRecovery).toMatchObject({
      status: "ok",
      details: { processed: 1, sent: 0, skipped: 1, failed: 0 },
    });
    expect(recoveredLog.status).toBe(CustomerOrderEmailStatus.SENT);
    expect(recoveredLog.attemptCount).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("claims one retry under concurrent delivery attempts", async () => {
    const { org, store, product, adminUser } = await seedBase({ allowNegativeStock: true });
    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: 125 },
    });
    const { apiKey } = await createBazaarApiKey({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "email-concurrency-api-key",
      name: "email-concurrency",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("provider unavailable", { status: 503 }))
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "resend-concurrent-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const created = await createBazaarApiOrderOperation({
      organizationId: org.id,
      storeId: store.id,
      apiKeyId: apiKey.id,
      idempotencyKey: "api-order-email-concurrent-0001",
      customerName: "Concurrent Customer",
      customerEmail: "concurrent.customer@example.test",
      lines: [{ productId: product.id, qty: 1 }],
    });
    const emailLog = await prisma.customerOrderEmailLog.findFirstOrThrow({
      where: { customerOrderId: created.response.order.id },
    });
    await prisma.customerOrderEmailLog.update({
      where: { id: emailLog.id },
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
    });

    const results = await Promise.all([
      sendOrderConfirmationEmail({
        organizationId: org.id,
        customerOrderId: created.response.order.id,
        deliveryLogId: emailLog.id,
        throwOnMissingEmail: false,
      }),
      sendOrderConfirmationEmail({
        organizationId: org.id,
        customerOrderId: created.response.order.id,
        deliveryLogId: emailLog.id,
        throwOnMissingEmail: false,
      }),
    ]);
    const sentLog = await prisma.customerOrderEmailLog.findUniqueOrThrow({
      where: { id: emailLog.id },
    });

    expect(results.filter((result) => result.status === "sent")).toHaveLength(1);
    expect(results.filter((result) => result.status === "skipped")).toHaveLength(1);
    expect(sentLog.status).toBe(CustomerOrderEmailStatus.SENT);
    expect(sentLog.attemptCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      newerOutcome: "sent" as const,
      newerResponse: new Response(JSON.stringify({ id: "newer-sent" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      staleResponse: new Response("stale failed", { status: 503 }),
    },
    {
      newerOutcome: "failed" as const,
      newerResponse: new Response("newer failed", { status: 503 }),
      staleResponse: new Response(JSON.stringify({ id: "stale-sent" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    },
  ])(
    "fences a stale provider attempt after recovery leaves the newer attempt $newerOutcome",
    async ({ newerOutcome, newerResponse, staleResponse }) => {
      const { org, store, product, adminUser } = await seedBase({ allowNegativeStock: true });
      await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 125 } });
      const { apiKey } = await createBazaarApiKey({
        organizationId: org.id,
        storeId: store.id,
        actorId: adminUser.id,
        requestId: `email-fence-api-key-${newerOutcome}`,
        name: `email-fence-${newerOutcome}`,
      });
      const heldAttempt = deferred<Response>();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("initial failure", { status: 503 }))
        .mockImplementationOnce(() => heldAttempt.promise)
        .mockResolvedValueOnce(newerResponse);
      vi.stubGlobal("fetch", fetchMock);

      const created = await createBazaarApiOrderOperation({
        organizationId: org.id,
        storeId: store.id,
        apiKeyId: apiKey.id,
        idempotencyKey: `api-order-email-fence-${newerOutcome}`,
        customerName: "Fenced Customer",
        customerEmail: "fenced.customer@example.test",
        lines: [{ productId: product.id, qty: 1 }],
      });
      const emailLog = await prisma.customerOrderEmailLog.findFirstOrThrow({
        where: { customerOrderId: created.response.order.id },
      });
      await prisma.customerOrderEmailLog.update({
        where: { id: emailLog.id },
        data: { nextAttemptAt: new Date(Date.now() - 1_000) },
      });

      const staleAttempt = sendOrderConfirmationEmail({
        organizationId: org.id,
        customerOrderId: created.response.order.id,
        deliveryLogId: emailLog.id,
        throwOnMissingEmail: false,
      });
      await waitFor(() => fetchMock.mock.calls.length === 2);
      await prisma.customerOrderEmailLog.update({
        where: { id: emailLog.id },
        data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
      });

      const recovered = await runJob(ORDER_CONFIRMATION_EMAIL_JOB_NAME, { logId: emailLog.id });
      heldAttempt.resolve(staleResponse);
      const staleResult = await staleAttempt;
      const [finalLog, order] = await Promise.all([
        prisma.customerOrderEmailLog.findUniqueOrThrow({ where: { id: emailLog.id } }),
        prisma.customerOrder.findUniqueOrThrow({ where: { id: created.response.order.id } }),
      ]);

      expect(staleResult).toMatchObject({ status: "skipped", reason: "inProgress" });
      expect(finalLog.attemptCount).toBe(3);
      expect(finalLog.leaseToken).toBeNull();
      expect(finalLog.leaseExpiresAt).toBeNull();
      if (newerOutcome === "sent") {
        expect(recovered).toMatchObject({ details: { sent: 1, failed: 0 } });
        expect(finalLog.status).toBe(CustomerOrderEmailStatus.SENT);
        expect(finalLog.providerMessageId).toBe("newer-sent");
        expect(order.confirmationEmailSentAt).toBeInstanceOf(Date);
      } else {
        expect(recovered).toMatchObject({ details: { sent: 0, failed: 1 } });
        expect(finalLog.status).toBe(CustomerOrderEmailStatus.FAILED);
        expect(finalLog.providerMessageId).toBeNull();
        expect(order.confirmationEmailSentAt).toBeNull();
      }
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );
});
