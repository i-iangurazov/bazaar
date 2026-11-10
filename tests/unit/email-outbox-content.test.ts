import type * as EmailService from "@/server/services/email";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  notifications: { findMany: vi.fn(), updateMany: vi.fn() },
  reminders: { findMany: vi.fn(), updateMany: vi.fn() },
  invoice: vi.fn(),
  organization: vi.fn(),
  owner: vi.fn(),
  dueOwners: vi.fn(),
}));
vi.mock("@/server/db/prisma", () => ({
  prisma: {
    subscriptionPaymentNotification: mocks.notifications,
    subscriptionReminder: mocks.reminders,
    subscriptionInvoice: { findUnique: mocks.invoice },
    organization: { findUnique: mocks.organization },
    user: { findFirst: mocks.owner },
    $queryRaw: mocks.dueOwners,
  },
}));
vi.mock("@/server/services/email", async (importOriginal) => ({
  ...(await importOriginal<typeof EmailService>()),
  sendTransactionalEmail: mocks.send,
}));

import { processSubscriptionPaymentNotifications } from "@/server/billing/paymentNotifications";
import { processSubscriptionReminders } from "@/server/billing/reminders";
import {
  subscriptionReminderKey,
  subscriptionReminderState,
} from "@/server/billing/reminderPolicy";

const now = new Date("2026-11-11T12:00:00Z");
const end = new Date("2026-11-13T12:00:00Z");
const organization = {
  id: "synthetic-frozen-email",
  name: "Renamed organization after the email was queued",
  subscriptionBillingMode: "SELF_SERVE",
  subscriptionStatus: "ACTIVE",
  currentPeriodEndsAt: null,
  trialEndsAt: end,
  subscriptionContract: { catalogVersion: "2026-11", lifetimeAccess: false },
  subscriptionPeriods: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.stubEnv("EMAIL_PROVIDER", "resend");
  vi.stubEnv("RESEND_API_KEY", "synthetic-not-a-provider-key");
  vi.stubEnv("EMAIL_FROM", "new-sender@example.invalid");
  vi.stubEnv("HARDENING_EXTERNAL_PROVIDER_MODE", "mock");
  mocks.notifications.updateMany.mockResolvedValue({ count: 1 });
  mocks.reminders.updateMany.mockResolvedValue({ count: 1 });
  mocks.dueOwners.mockResolvedValue([]);
  mocks.organization.mockResolvedValue(organization);
  mocks.owner.mockResolvedValue({ email: "owner@example.invalid", preferredLocale: "en" });
  mocks.invoice.mockResolvedValue({
    organization,
    period: { startsAt: now, endsAt: end },
    events: [{ state: "PAID", source: "CALLBACK" }],
    status: "PAID",
    isTest: false,
    currency: "KGS",
    paidAt: now,
    providerPaymentId: "synthetic-confirmed-payment",
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("stored subscription email content across a template rollout", () => {
  it.each(["payment", "reminder"] as const)(
    "retries a pre-existing %s body and operation key verbatim despite new branding and recipient preferences",
    async (family) => {
      const operationKey =
        family === "payment"
          ? "synthetic-existing-payment-email"
          : subscriptionReminderKey(
              organization.id,
              "synthetic-owner",
              subscriptionReminderState(organization, now)!,
            );
      const frozen = Object.freeze({
        subject: "Сохранённая тема до смены шаблона",
        text: "Сохранённый текст\nhttps://example.invalid/original",
        html: '<p data-legacy-email="original">Сохранённый HTML &amp; старая ссылка</p>',
        senderEmail: "original-sender@example.invalid",
        recipientEmail: "owner@example.invalid",
        operationKey,
      });
      const row = {
        ...frozen,
        id: "synthetic-existing-outbox-row",
        organizationId: organization.id,
        invoiceId: "synthetic-invoice",
        ownerId: "synthetic-owner",
        attemptCount: 0,
        firstAttemptAt: null as Date | null,
      };
      const delegate = family === "payment" ? mocks.notifications : mocks.reminders;
      delegate.findMany.mockResolvedValue([row]);
      const drain =
        family === "payment"
          ? processSubscriptionPaymentNotifications
          : processSubscriptionReminders;
      mocks.send
        .mockRejectedValueOnce(new Error("synthetic lost provider acknowledgement"))
        .mockResolvedValueOnce({ provider: "resend", id: "synthetic-accepted" });

      const failed = await drain(now);
      expect(failed.details).toMatchObject({ accepted: 0, failed: 1 });
      row.attemptCount = 1;
      row.firstAttemptAt = now;
      vi.setSystemTime(new Date(now.getTime() + 60_000));
      vi.stubEnv("EMAIL_LOGO_URL", "https://example.invalid/new-logo.svg");
      const recovered = await drain(new Date());
      expect(recovered.details).toMatchObject({ accepted: 1, failed: 0 });
      expect(mocks.send).toHaveBeenCalledTimes(2);
      expect(mocks.send.mock.calls[1][0]).toEqual(mocks.send.mock.calls[0][0]);
      expect(mocks.send.mock.calls[0][0]).toMatchObject({
        to: frozen.recipientEmail,
        from: frozen.senderEmail,
        subject: frozen.subject,
        text: frozen.text,
        html: frozen.html,
        idempotencyKey: frozen.operationKey,
      });
      expect(mocks.send.mock.calls[0][0].html).not.toContain("data-bazaar-email-template");
      for (const [write] of delegate.updateMany.mock.calls) {
        expect(write.data).not.toHaveProperty("html");
        expect(write.data).not.toHaveProperty("text");
        expect(write.data).not.toHaveProperty("subject");
        expect(write.data).not.toHaveProperty("operationKey");
      }
    },
  );
});
