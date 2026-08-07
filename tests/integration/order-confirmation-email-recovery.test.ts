import {
  CustomerOrderEmailStatus,
  CustomerOrderEmailType,
  CustomerOrderSource,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/prisma";
import { ORDER_CONFIRMATION_EMAIL_JOB_NAME } from "@/server/jobs/orderConfirmationEmails";
import { runJob } from "@/server/jobs";
import {
  createBazaarApiKey,
  createBazaarApiOrderOperation,
} from "@/server/services/bazaarApi";
import { sendOrderConfirmationEmail } from "@/server/services/orderEmails";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

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
      prisma.customerOrderEmailLog.count({ where: { customerOrderId: orderId } }),
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
});
