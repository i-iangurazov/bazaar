import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { calculateSubscriptionQuote } from "@/server/billing/subscriptionQuotes";
import {
  findDueSubscriptionReminderOwners,
  processSubscriptionReminders,
  queueSubscriptionReminders,
} from "@/server/billing/reminders";
import { EmailProviderError } from "@/server/services/email";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const sender = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/email", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendTransactionalEmail: sender,
}));
const describeDb = shouldRunDbTests ? describe : describe.skip;
const now = new Date("2027-01-29T10:00:00.000Z");
const end = new Date("2027-01-31T10:00:00.000Z");
describeDb("durable owner-only subscription reminder outbox", () => {
  let fixture: Awaited<ReturnType<typeof seedBase>>;
  let payment = 1;
  beforeEach(async () => {
    await resetDatabase();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    for (const [key, value] of Object.entries({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "synthetic-reminder-key",
      EMAIL_FROM: "Bazaar <no-reply@example.invalid>",
      HARDENING_EXTERNAL_PROVIDER_MODE: "sandbox",
    }))
      vi.stubEnv(key, value);
    sender.mockReset();
    sender.mockResolvedValue({ provider: "resend", id: "synthetic-email" });
    fixture = await seedBase({ plan: "BUSINESS" });
    await prisma.subscriptionContract.create({
      data: { organizationId: fixture.org.id, catalogVersion: "2026-11" },
    });
    await prisma.organization.update({
      where: { id: fixture.org.id },
      data: { subscriptionBillingMode: "SELF_SERVE", trialEndsAt: end, currentPeriodEndsAt: end },
    });
    payment = 1;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    sender.mockReset();
  });
  const paid = async (initial = true) => {
    if (initial)
      await prisma.organization.update({
        where: { id: fixture.org.id },
        data: { trialEndsAt: null, currentPeriodEndsAt: null },
      });
    const purchase = await calculateSubscriptionQuote(
      fixture.org.id,
      {
        plan: "BUSINESS",
        months: 1,
        extras: { stores: 0, productPacks: 0, userPacks: 0 },
        action: "RENEW",
      },
      prisma,
      initial ? new Date("2026-12-31T10:00:00.000Z") : new Date(),
    );
    const invoice = await prisma.subscriptionInvoice.create({
      data: {
        organizationId: fixture.org.id,
        createdById: fixture.adminUser.id,
        idempotencyKey: randomUUID(),
        plan: "BUSINESS",
        amountMinor: purchase.amountMinor,
        purchaseSnapshot: purchase,
        merchantId: "synthetic-reminder-merchant",
        isTest: false,
        providerPaymentId: String(payment++),
        status: "PAID",
        paidAt: new Date(purchase.issuedAt),
        termsVersion: "synthetic-reminder-terms",
        termsUrl: "https://example.invalid/legal/offer",
        sellerName: "Synthetic seller",
        expiresAt: new Date(purchase.expiresAt),
        createdAt: new Date(purchase.issuedAt),
        events: {
          create: {
            deduplicationKey: randomUUID(),
            source: "RECONCILIATION",
            state: "PAID",
            payloadDigest: "synthetic",
          },
        },
      },
    });
    await prisma.subscriptionPeriod.create({
      data: {
        invoiceId: invoice.id,
        organizationId: fixture.org.id,
        plan: "BUSINESS",
        startsAt: new Date(purchase.startsAt),
        endsAt: new Date(purchase.endsAt),
        purchaseSnapshot: purchase,
      },
    });
    await prisma.organization.update({
      where: { id: fixture.org.id },
      data: { currentPeriodEndsAt: new Date(purchase.endsAt) },
    });
    return invoice;
  };
  it("queues and submits exactly once under competing producers/workers, only to the verified owner", async () => {
    await paid();
    await prisma.user.update({
      where: { id: fixture.adminUser.id },
      data: { preferredLocale: "en" },
    });
    await Promise.all([processSubscriptionReminders(), processSubscriptionReminders()]);
    expect(sender).toHaveBeenCalledOnce();
    expect(sender.mock.calls[0][0]).toMatchObject({
      to: fixture.adminUser.email,
      subject: "Bazaar: access period and renewal",
    });
    expect((await prisma.subscriptionReminder.findFirstOrThrow()).status).toBe("ACCEPTED");
    expect(await prisma.subscriptionReminder.count()).toBe(1);
    expect(await prisma.subscriptionUsageBucket.count()).toBe(0);
  });
  it("cancels a queued reminder when a confirmed early renewal extends the actual paid end", async () => {
    await paid();
    await queueSubscriptionReminders();
    await paid(false);
    await processSubscriptionReminders();
    expect(sender).not.toHaveBeenCalled();
    expect((await prisma.subscriptionReminder.findFirstOrThrow()).status).toBe("CANCELED");
  });
  it("rechecks payment review state immediately before sending", async () => {
    const invoice = await paid();
    await queueSubscriptionReminders();
    await prisma.subscriptionInvoice.update({
      where: { id: invoice.id },
      data: { status: "REVIEW", lastIssue: "REFUND_REVIEW" },
    });
    await processSubscriptionReminders();
    expect(sender).not.toHaveBeenCalled();
    expect((await prisma.subscriptionReminder.findFirstOrThrow()).status).toBe("CANCELED");
  });
  it("never sends to the old address after owner email changes", async () => {
    await paid();
    await queueSubscriptionReminders();
    await prisma.user.update({
      where: { id: fixture.adminUser.id },
      data: { email: "new-owner@example.invalid" },
    });
    await processSubscriptionReminders();
    expect(sender).not.toHaveBeenCalled();
    expect((await prisma.subscriptionReminder.findFirstOrThrow()).status).toBe("CANCELED");
  });
  it("excludes staff, non-owner administrators, manual access and legacy contracts", async () => {
    await paid();
    expect(await findDueSubscriptionReminderOwners()).toEqual([
      { organizationId: fixture.org.id, ownerId: fixture.adminUser.id },
    ]);
    await prisma.organization.update({
      where: { id: fixture.org.id },
      data: { subscriptionBillingMode: "MANUAL" },
    });
    const legacy = await prisma.organization.create({
      data: {
        name: "Legacy trial",
        subscriptionBillingMode: "SELF_SERVE",
        trialEndsAt: end,
        currentPeriodEndsAt: end,
        subscriptionContract: { create: { catalogVersion: "2026-10" } },
      },
    });
    await prisma.user.create({
      data: {
        organizationId: legacy.id,
        role: "ADMIN",
        isOrgOwner: true,
        name: "Legacy owner",
        email: "legacy-owner@example.invalid",
        emailVerifiedAt: now,
        passwordHash: "hash",
      },
    });
    expect(await findDueSubscriptionReminderOwners()).toEqual([]);
    expect(await queueSubscriptionReminders()).toBe(0);
    expect(sender).not.toHaveBeenCalled();
  });
  it("retries a transient unknown result with the same immutable provider key and message", async () => {
    await paid();
    sender.mockRejectedValueOnce(new Error("synthetic timeout"));
    await processSubscriptionReminders();
    const first = await prisma.subscriptionReminder.findFirstOrThrow();
    expect(first.status).toBe("QUEUED");
    vi.setSystemTime(new Date(now.getTime() + 61000));
    await processSubscriptionReminders();
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[1][0]).toEqual(sender.mock.calls[0][0]);
    const final = await prisma.subscriptionReminder.findFirstOrThrow();
    expect(final.status).toBe("ACCEPTED");
    expect(final.firstAttemptAt).toEqual(first.firstAttemptAt);
  });
  it("stops explicit permanent provider rejection instead of mailing repeatedly", async () => {
    await paid();
    sender.mockRejectedValueOnce(
      new EmailProviderError({
        provider: "resend",
        status: 422,
        responseText: "synthetic permanent error",
      }),
    );
    await processSubscriptionReminders();
    expect((await prisma.subscriptionReminder.findFirstOrThrow()).status).toBe("FAILED");
    vi.setSystemTime(new Date(now.getTime() + 61000));
    await processSubscriptionReminders();
    expect(sender).toHaveBeenCalledOnce();
  });
  it("retries a provider's known concurrent-idempotency conflict with the unchanged key", async () => {
    await paid();
    sender.mockRejectedValueOnce(
      new EmailProviderError({
        provider: "resend",
        status: 409,
        responseText: JSON.stringify({ name: "concurrent_idempotent_requests" }),
      }),
    );
    await processSubscriptionReminders();
    expect((await prisma.subscriptionReminder.findFirstOrThrow()).status).toBe("QUEUED");
    vi.setSystemTime(new Date(now.getTime() + 61000));
    await processSubscriptionReminders();
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[0][0].idempotencyKey).toBe(sender.mock.calls[1][0].idempotencyKey);
  });
  it("does not resend an uncertain old delivery after the idempotency safety window", async () => {
    await paid();
    await queueSubscriptionReminders();
    const row = await prisma.subscriptionReminder.findFirstOrThrow();
    await prisma.subscriptionReminder.update({
      where: { id: row.id },
      data: {
        status: "PROCESSING",
        attemptCount: 1,
        firstAttemptAt: new Date(now.getTime() - 23 * 3600000),
        leaseToken: "synthetic-old-lease",
        leaseExpiresAt: new Date(now.getTime() - 1),
      },
    });
    await processSubscriptionReminders();
    expect(sender).not.toHaveBeenCalled();
    expect((await prisma.subscriptionReminder.findFirstOrThrow()).lastIssue).toBe(
      "IDEMPOTENCY_WINDOW_EXPIRED",
    );
  });
  it("protects address and body snapshots in PostgreSQL", async () => {
    await paid();
    await queueSubscriptionReminders();
    const row = await prisma.subscriptionReminder.findFirstOrThrow();
    await expect(
      prisma.subscriptionReminder.update({
        where: { id: row.id },
        data: { recipientEmail: "other@example.invalid" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.subscriptionReminder.update({
        where: { id: row.id },
        data: { text: "different message" },
      }),
    ).rejects.toThrow();
  });
  it("handles unpaid trial expiry once, without a paid grace period", async () => {
    await processSubscriptionReminders();
    vi.setSystemTime(end);
    await processSubscriptionReminders();
    const rows = await prisma.subscriptionReminder.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((row) => [row.source, row.kind])).toEqual([
      ["TRIAL", "BEFORE_3"],
      ["TRIAL", "READ_ONLY"],
    ]);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(rows.some((row) => row.kind === "GRACE")).toBe(false);
  });
  it("reports missing delivery configuration rather than claiming log output is sent mail", async () => {
    await paid();
    vi.stubEnv("EMAIL_PROVIDER", "log");
    expect(await processSubscriptionReminders()).toMatchObject({
      status: "skipped",
      details: { reason: "failed", accepted: 0 },
    });
    expect(sender).not.toHaveBeenCalled();
    expect(await prisma.subscriptionReminder.count()).toBe(0);
  });
});
