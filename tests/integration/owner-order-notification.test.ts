import {
  CustomerOrderEmailStatus,
  CustomerOrderEmailType,
  CustomerOrderSource,
  Role,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/prisma";
import { ORDER_CONFIRMATION_EMAIL_JOB_NAME } from "@/server/jobs/orderConfirmationEmails";
import { runJob } from "@/server/jobs";
import { createBazaarApiKey, createBazaarApiOrderOperation } from "@/server/services/bazaarApi";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("external order owner notifications", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("EMAIL_FROM", "orders@example.test");
    vi.stubEnv("RESEND_API_KEY", "resend-test-key");
    vi.stubEnv("NEXTAUTH_URL", "https://www.bazaar.kg");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("queues the deterministic verified owner once and never leaks customer PII", async () => {
    const { org, store, product, adminUser } = await seedBase({ allowNegativeStock: true });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 125 } });
    const olderOwner = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: "verified.owner@example.test",
        name: "Verified Owner",
        passwordHash: "hash",
        role: Role.ADMIN,
        isOrgOwner: true,
        emailVerifiedAt: new Date(),
        createdAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        email: "unverified.owner@example.test",
        name: "Unverified Owner",
        passwordHash: "hash",
        role: Role.ADMIN,
        isOrgOwner: true,
        emailVerifiedAt: null,
        createdAt: new Date("2019-01-01T00:00:00.000Z"),
      },
    });
    const otherOrg = await prisma.organization.create({ data: { name: "Other Org" } });
    await prisma.user.create({
      data: {
        organizationId: otherOrg.id,
        email: "wrong.owner@example.test",
        name: "Wrong Owner",
        passwordHash: "hash",
        role: Role.ADMIN,
        isOrgOwner: true,
        emailVerifiedAt: new Date(),
      },
    });
    const { apiKey } = await createBazaarApiKey({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "owner-notification-api-key",
      name: "owner-notification",
    });
    const sentBodies: string[] = [];
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sentBodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ id: `resend-${sentBodies.length}` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      organizationId: org.id,
      storeId: store.id,
      apiKeyId: apiKey.id,
      idempotencyKey: "owner-notification-order-0001",
      customerName: "Private Customer",
      customerEmail: "private.customer@example.test",
      customerPhone: "+996555123456",
      customerAddress: "Private Address 42",
      lines: [{ productId: product.id, qty: 1 }],
    };

    const first = await createBazaarApiOrderOperation(input);
    const replay = await createBazaarApiOrderOperation(input);
    const ownerLog = await prisma.customerOrderEmailLog.findFirstOrThrow({
      where: {
        customerOrderId: first.response.order.id,
        type: CustomerOrderEmailType.OWNER_NOTIFICATION,
      },
    });

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(ownerLog).toMatchObject({
      status: CustomerOrderEmailStatus.QUEUED,
      recipientEmail: olderOwner.email,
      attemptCount: 0,
    });
    expect(ownerLog.operationKey).toBe(`owner-new-order:${first.response.order.id}:${olderOwner.id}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const drained = await runJob(ORDER_CONFIRMATION_EMAIL_JOB_NAME, { logId: ownerLog.id });
    const sentLog = await prisma.customerOrderEmailLog.findUniqueOrThrow({
      where: { id: ownerLog.id },
    });
    const ownerPayload = sentBodies.at(-1) ?? "";

    expect(drained).toMatchObject({ status: "ok", details: { processed: 1, sent: 1 } });
    expect(sentLog).toMatchObject({
      status: CustomerOrderEmailStatus.SENT,
      recipientEmail: olderOwner.email,
      attemptCount: 1,
    });
    expect(ownerPayload).toContain(olderOwner.email);
    expect(ownerPayload).toContain(first.response.order.number);
    expect(ownerPayload).toContain(`/sales/orders/${first.response.order.id}`);
    expect(ownerPayload).not.toContain("Private Customer");
    expect(ownerPayload).not.toContain("private.customer@example.test");
    expect(ownerPayload).not.toContain("+996555123456");
    expect(ownerPayload).not.toContain("Private Address 42");
    expect(ownerPayload).not.toContain("wrong.owner@example.test");
    await expect(
      prisma.customerOrderEmailLog.count({
        where: {
          customerOrderId: first.response.order.id,
          type: CustomerOrderEmailType.OWNER_NOTIFICATION,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.customerOrder.count({
        where: { organizationId: org.id, source: CustomerOrderSource.API },
      }),
    ).resolves.toBe(1);
  });

  it("keeps the order and retryable outbox when owner delivery fails", async () => {
    const { org, store, product, adminUser } = await seedBase({ allowNegativeStock: true });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 125 } });
    const { apiKey } = await createBazaarApiKey({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "owner-notification-failure-key",
      name: "owner-notification-failure",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "customer-confirmation" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "owner-recovered" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const created = await createBazaarApiOrderOperation({
      organizationId: org.id,
      storeId: store.id,
      apiKeyId: apiKey.id,
      idempotencyKey: "owner-notification-failure-0001",
      customerName: "Customer",
      customerEmail: "customer@example.test",
      customerPhone: "+996555765432",
      lines: [{ productId: product.id, qty: 1 }],
    });
    const ownerLog = await prisma.customerOrderEmailLog.findFirstOrThrow({
      where: {
        customerOrderId: created.response.order.id,
        type: CustomerOrderEmailType.OWNER_NOTIFICATION,
      },
    });
    const failed = await runJob(ORDER_CONFIRMATION_EMAIL_JOB_NAME, { logId: ownerLog.id });
    const failedLog = await prisma.customerOrderEmailLog.findUniqueOrThrow({
      where: { id: ownerLog.id },
    });

    expect(failed).toMatchObject({ status: "ok", details: { failed: 1 } });
    expect(failedLog.status).toBe(CustomerOrderEmailStatus.FAILED);
    expect(failedLog.nextAttemptAt).toBeInstanceOf(Date);
    await expect(
      prisma.customerOrder.findUnique({ where: { id: created.response.order.id } }),
    ).resolves.not.toBeNull();

    await prisma.customerOrderEmailLog.update({
      where: { id: ownerLog.id },
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
    });
    const recovered = await runJob(ORDER_CONFIRMATION_EMAIL_JOB_NAME, { logId: ownerLog.id });
    const sentLog = await prisma.customerOrderEmailLog.findUniqueOrThrow({
      where: { id: ownerLog.id },
    });
    expect(recovered).toMatchObject({ status: "ok", details: { sent: 1, failed: 0 } });
    expect(sentLog).toMatchObject({
      status: CustomerOrderEmailStatus.SENT,
      providerMessageId: "owner-recovered",
      attemptCount: 2,
    });
  });
});
