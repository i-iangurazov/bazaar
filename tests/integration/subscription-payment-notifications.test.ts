import { randomUUID } from "node:crypto";
import type { BillingPaymentProvider } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { EMPTY_SUBSCRIPTION_EXTRAS } from "@/lib/billing/subscriptionPricing";
import { calculateSubscriptionQuote } from "@/server/billing/subscriptionQuotes";
import { applySubscriptionReceipt } from "@/server/billing/subscriptionPayments";
import {
  handleSubscriptionPaymentEmailEvent,
  processSubscriptionPaymentNotifications,
} from "@/server/billing/paymentNotifications";
import { EmailProviderError } from "@/server/services/email";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const sender = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/email", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendTransactionalEmail: sender,
}));

(shouldRunDbTests ? describe : describe.skip)(
  "atomic real-payment owner notification outbox",
  () => {
    let f: Awaited<ReturnType<typeof seedBase>>;
    let now: Date;
    beforeEach(async () => {
      await resetDatabase();
      now = new Date();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now);
      for (const [name, value] of Object.entries({
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "synthetic-payment-notice-key",
        EMAIL_FROM: "Bazaar <no-reply@example.invalid>",
        HARDENING_EXTERNAL_PROVIDER_MODE: "sandbox",
        VERCEL_ENV: "development",
      }))
        vi.stubEnv(name, value);
      sender.mockReset();
      sender.mockImplementation(async () => ({
        provider: "resend",
        id: `synthetic-email-${randomUUID()}`,
      }));
      f = await seedBase({ plan: "STARTER" });
      await prisma.user.updateMany({
        where: { organizationId: f.org.id, id: { not: f.adminUser.id } },
        data: { isActive: false },
      });
      await prisma.user.update({
        where: { id: f.adminUser.id },
        data: { email: "synthetic-owner@example.invalid", preferredLocale: "en" },
      });
      await prisma.subscriptionContract.create({
        data: { organizationId: f.org.id, catalogVersion: "2026-11" },
      });
      await prisma.organization.update({
        where: { id: f.org.id },
        data: {
          subscriptionBillingMode: "SELF_SERVE",
          trialEndsAt: null,
          currentPeriodEndsAt: null,
        },
      });
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      sender.mockReset();
    });

    async function preparedInvoice(
      options: { isTest?: boolean; provider?: BillingPaymentProvider } = {},
    ) {
      const purchase = await calculateSubscriptionQuote(f.org.id, {
        plan: "BUSINESS",
        months: 1,
        extras: EMPTY_SUBSCRIPTION_EXTRAS,
        action: "RENEW",
      });
      // A pre-existing invoice fixture represents the boundary after authenticated
      // provider reconciliation. It does not create a provider checkout, including
      // the historical FreedomPay case, or perform any external request.
      const invoice = await prisma.subscriptionInvoice.create({
        data: {
          organizationId: f.org.id,
          pendingSlot: f.org.id,
          createdById: f.adminUser.id,
          idempotencyKey: randomUUID(),
          provider: options.provider ?? "GOPAY",
          providerOrderId: randomUUID().replaceAll("-", ""),
          plan: "BUSINESS",
          amountMinor: purchase.amountMinor,
          purchaseSnapshot: purchase,
          currency: "KGS",
          merchantId: "synthetic-notice-merchant",
          isTest: options.isTest ?? false,
          status: "PENDING",
          termsVersion: "synthetic-v1",
          termsUrl: "https://example.invalid/terms",
          sellerName: "Synthetic seller",
          expiresAt: new Date(purchase.expiresAt),
        },
      });
      return {
        invoice,
        purchase,
        receipt: {
          provider: invoice.provider,
          merchantId: invoice.merchantId,
          orderId: invoice.providerOrderId!,
          paymentId: randomUUID(),
          amountMinor: invoice.amountMinor,
          currency: "KGS" as const,
          isTest: invoice.isTest,
          state: "PAID" as const,
          eventKey: `synthetic:${invoice.id}:paid`,
          payloadDigest: "synthetic-verified-payment",
        },
      };
    }
    async function settle(value: Awaited<ReturnType<typeof preparedInvoice>>) {
      return applySubscriptionReceipt({
        invoiceId: value.invoice.id,
        receipt: value.receipt,
        source: "RECONCILIATION",
      });
    }
    async function notice() {
      return prisma.subscriptionPaymentNotification.findFirstOrThrow();
    }
    async function event(
      emailId: string,
      type: string,
      rowId?: string,
      to = "synthetic-owner@example.invalid",
    ) {
      return handleSubscriptionPaymentEmailEvent({
        webhookEventId: `${emailId}:${type}`,
        event: {
          type,
          created_at: new Date().toISOString(),
          data: {
            email_id: emailId,
            to: [to],
            tags: rowId ? { subscription_notification: rowId } : {},
          },
        },
      });
    }

    it.each(["GOPAY", "FREEDOMPAY"] as const)(
      "queues exactly one notice and one period across duplicate %s confirmations",
      async (provider) => {
        const value = await preparedInvoice({ provider });
        await Promise.all([settle(value), settle(value)]);
        expect(
          await prisma.subscriptionPeriod.count({ where: { invoiceId: value.invoice.id } }),
        ).toBe(1);
        expect(await prisma.subscriptionPaymentNotification.count()).toBe(1);
        expect(sender).not.toHaveBeenCalled();
        expect(await notice()).toMatchObject({
          invoiceId: value.invoice.id,
          ownerId: f.adminUser.id,
          status: "QUEUED",
          kind: "ACCESS_RESTORED",
          recipientLocale: "en",
        });
        await Promise.all([
          processSubscriptionPaymentNotifications(),
          processSubscriptionPaymentNotifications(),
        ]);
        expect(sender).toHaveBeenCalledOnce();
        expect(await notice()).toMatchObject({
          status: "ACCEPTED",
          deliveryStatus: "ACCEPTED",
          deliveredAt: null,
        });
        expect(await prisma.subscriptionUsageBucket.count()).toBe(0);
      },
    );

    it("keeps a remaining trial intact and does not claim the future paid tier is already active", async () => {
      const trialEnd = new Date(now.getTime() + 3 * 86_400_000);
      await prisma.organization.update({
        where: { id: f.org.id },
        data: { trialEndsAt: trialEnd, currentPeriodEndsAt: trialEnd },
      });
      const value = await preparedInvoice();
      await settle(value);
      const row = await notice();
      expect(row.kind).toBe("PAYMENT_CONFIRMED");
      expect(row.text).toContain(
        "Your current access conditions remain in effect until that period starts.",
      );
      expect(
        (
          await prisma.subscriptionPeriod.findUniqueOrThrow({
            where: { invoiceId: value.invoice.id },
          })
        ).startsAt,
      ).toEqual(trialEnd);
      expect(
        (await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).trialEndsAt,
      ).toEqual(trialEnd);
    });

    it("confirms restored access after an expired trial", async () => {
      const trialEnd = new Date(now.getTime() - 86_400_000);
      await prisma.organization.update({
        where: { id: f.org.id },
        data: { trialEndsAt: trialEnd, currentPeriodEndsAt: trialEnd },
      });
      const value = await preparedInvoice();
      await settle(value);
      expect(await notice()).toMatchObject({ kind: "ACCESS_RESTORED" });
      expect((await notice()).text).toContain("You can create and edit records again.");
    });

    it.each(["MANUAL", "LIFETIME"] as const)(
      "never queues email for Test success or %s access moved to REVIEW",
      async (mode) => {
        const test = await preparedInvoice({ isTest: true });
        await settle(test);
        expect(await prisma.subscriptionPaymentNotification.count()).toBe(0);
        const value = await preparedInvoice();
        if (mode === "MANUAL")
          await prisma.organization.update({
            where: { id: f.org.id },
            data: { subscriptionBillingMode: "MANUAL" },
          });
        else
          await prisma.subscriptionContract.update({
            where: { organizationId: f.org.id },
            data: { lifetimeAccess: true },
          });
        expect((await settle(value)).status).toBe("REVIEW");
        expect(await prisma.subscriptionPaymentNotification.count()).toBe(0);
        expect(sender).not.toHaveBeenCalled();
      },
    );

    it("includes each verified owner once while excluding staff and non-owner administrators", async () => {
      // Three active accounts require the Business capacity even before the
      // payment fixture is prepared; Starter deliberately allows only two.
      await prisma.organization.update({ where: { id: f.org.id }, data: { plan: "BUSINESS" } });
      await prisma.user.update({
        where: { id: f.managerUser.id },
        data: {
          isActive: true,
          role: "ADMIN",
          isOrgOwner: true,
          email: "second-owner@example.invalid",
        },
      });
      await prisma.user.update({
        where: { id: f.staffUser.id },
        data: { isActive: true, role: "ADMIN", isOrgOwner: false },
      });
      const value = await preparedInvoice();
      await settle(value);
      const rows = await prisma.subscriptionPaymentNotification.findMany();
      expect(rows.map((row) => row.ownerId).sort()).toEqual(
        [f.adminUser.id, f.managerUser.id].sort(),
      );
      expect(new Set(rows.map((row) => row.operationKey)).size).toBe(2);
    });

    it("cancels queued confirmation after recipient, ownership or payment review changes", async () => {
      const value = await preparedInvoice();
      await settle(value);
      await prisma.user.update({
        where: { id: f.adminUser.id },
        data: { email: "changed@example.invalid" },
      });
      await processSubscriptionPaymentNotifications();
      expect(await notice()).toMatchObject({
        status: "CANCELED",
        lastIssue: "PAYMENT_OR_OWNER_CHANGED",
      });
      expect(sender).not.toHaveBeenCalled();
    });

    it("rechecks payment review before sending an already queued confirmation", async () => {
      const value = await preparedInvoice();
      await settle(value);
      await prisma.subscriptionInvoice.update({
        where: { id: value.invoice.id },
        data: { status: "REVIEW", lastIssue: "REFUND_REVIEW" },
      });
      await processSubscriptionPaymentNotifications();
      expect((await notice()).status).toBe("CANCELED");
      expect(sender).not.toHaveBeenCalled();
    });

    it("recovers an unknown send with the same immutable message and key", async () => {
      const value = await preparedInvoice();
      await settle(value);
      sender.mockRejectedValueOnce(new Error("synthetic lost acknowledgement"));
      await processSubscriptionPaymentNotifications();
      const first = await notice();
      expect(first.status).toBe("QUEUED");
      vi.setSystemTime(new Date(now.getTime() + 61_000));
      await processSubscriptionPaymentNotifications();
      expect(sender).toHaveBeenCalledTimes(2);
      expect(sender.mock.calls[0][0]).toEqual(sender.mock.calls[1][0]);
      expect(await notice()).toMatchObject({
        status: "ACCEPTED",
        firstAttemptAt: first.firstAttemptAt,
      });
    });

    it("recovers a crashed lease without changing the provider deduplication identity", async () => {
      const value = await preparedInvoice();
      await settle(value);
      const row = await notice();
      await prisma.subscriptionPaymentNotification.update({
        where: { id: row.id },
        data: {
          status: "PROCESSING",
          deliveryStatus: "SENDING",
          attemptCount: 1,
          firstAttemptAt: now,
          leaseToken: "synthetic-crashed-lease",
          leaseExpiresAt: new Date(now.getTime() - 1),
        },
      });
      await processSubscriptionPaymentNotifications();
      expect(sender.mock.calls[0][0].idempotencyKey).toBe(row.operationKey);
      expect(await notice()).toMatchObject({
        status: "ACCEPTED",
        attemptCount: 2,
        firstAttemptAt: now,
      });
    });

    it("stops old uncertain sends before provider retention expires and reports missing config", async () => {
      const value = await preparedInvoice();
      await settle(value);
      const row = await notice();
      vi.stubEnv("EMAIL_PROVIDER", "log");
      expect(await processSubscriptionPaymentNotifications()).toMatchObject({
        status: "skipped",
        details: { reason: "failed", accepted: 0 },
      });
      expect((await notice()).status).toBe("QUEUED");
      vi.stubEnv("EMAIL_PROVIDER", "resend");
      await prisma.subscriptionPaymentNotification.update({
        where: { id: row.id },
        data: { firstAttemptAt: new Date(now.getTime() - 23 * 3_600_000), attemptCount: 1 },
      });
      await processSubscriptionPaymentNotifications();
      expect(await notice()).toMatchObject({
        status: "FAILED",
        lastIssue: "IDEMPOTENCY_WINDOW_EXPIRED",
      });
      expect(sender).not.toHaveBeenCalled();
    });

    it("never requeues a permanent provider rejection", async () => {
      const value = await preparedInvoice();
      await settle(value);
      sender.mockRejectedValueOnce(
        new EmailProviderError({
          provider: "resend",
          status: 422,
          responseText: "synthetic invalid recipient",
        }),
      );
      await processSubscriptionPaymentNotifications();
      vi.setSystemTime(new Date(now.getTime() + 61_000));
      await processSubscriptionPaymentNotifications();
      expect(sender).toHaveBeenCalledOnce();
      expect(await notice()).toMatchObject({ status: "FAILED", lastIssue: "PROVIDER_PERMANENT" });
    });

    it("records delivery before a send acknowledgement without downgrading or resending it", async () => {
      const value = await preparedInvoice();
      await settle(value);
      const row = await notice();
      sender.mockImplementationOnce(async () => {
        expect(await event("early-callback", "email.delivered", row.id)).toMatchObject({
          processed: true,
          status: "DELIVERED",
        });
        return { provider: "resend", id: "early-callback" };
      });
      await processSubscriptionPaymentNotifications();
      expect(await notice()).toMatchObject({
        status: "ACCEPTED",
        deliveryStatus: "DELIVERED",
        providerMessageId: "early-callback",
        deliveredAt: now,
      });
      await event("early-callback", "email.sent", row.id);
      await processSubscriptionPaymentNotifications();
      expect((await notice()).deliveryStatus).toBe("DELIVERED");
      expect(sender).toHaveBeenCalledOnce();
    });

    it("rejects mismatched delivery identities and retains a bounce without resending", async () => {
      const value = await preparedInvoice();
      await settle(value);
      await processSubscriptionPaymentNotifications();
      const row = await notice();
      expect(await event("unrelated-email", "email.delivered", row.id)).toMatchObject({
        processed: false,
      });
      expect(
        await event(row.providerMessageId!, "email.delivered", row.id, "another@example.invalid"),
      ).toMatchObject({ processed: false });
      expect((await notice()).deliveryStatus).toBe("ACCEPTED");
      await event(row.providerMessageId!, "email.bounced", row.id);
      await processSubscriptionPaymentNotifications();
      expect(await notice()).toMatchObject({
        status: "ACCEPTED",
        deliveryStatus: "BOUNCED",
        lastIssue: "PROVIDER_DELIVERY_FAILED",
        deliveredAt: null,
      });
      expect(sender).toHaveBeenCalledOnce();
    });

    it("protects the frozen payload and first submission window in PostgreSQL", async () => {
      const value = await preparedInvoice();
      await settle(value);
      const row = await notice();
      await expect(
        prisma.subscriptionPaymentNotification.update({
          where: { id: row.id },
          data: { text: "tampered" },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.subscriptionPaymentNotification.update({
          where: { id: row.id },
          data: { recipientEmail: "other@example.invalid" },
        }),
      ).rejects.toThrow();
      await processSubscriptionPaymentNotifications();
      await expect(
        prisma.subscriptionPaymentNotification.update({
          where: { id: row.id },
          data: { firstAttemptAt: new Date(now.getTime() + 1) },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.subscriptionPaymentNotification.update({
          where: { id: row.id },
          data: { providerMessageId: "another" },
        }),
      ).rejects.toThrow();
    });
  },
);
