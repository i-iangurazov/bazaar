import { describe, expect, it } from "vitest";
import ruMessages from "../../messages/ru.json";
import kgMessages from "../../messages/kg.json";
import enMessages from "../../messages/en.json";
import { LIFETIME_ORGANIZATION_IDS } from "@/server/billing/lifetimeOrganizations";
import { subscriptionPaymentNotificationContent } from "@/server/billing/paymentNotificationContent";
import {
  canNotifySubscriptionPayment,
  canRetrySubscriptionPaymentNotification,
  subscriptionPaymentNotificationRetry,
} from "@/server/billing/paymentNotificationPolicy";
import { EmailProviderError } from "@/server/services/email";

const now = new Date("2027-02-01T10:00:00Z");
const organization = {
  id: "synthetic-payment-notice",
  subscriptionBillingMode: "SELF_SERVE",
  subscriptionStatus: "ACTIVE",
  subscriptionContract: { lifetimeAccess: false },
};
const invoice = {
  status: "PAID",
  isTest: false,
  currency: "KGS",
  paidAt: now,
  providerPaymentId: "synthetic-payment",
};
const error = (status: number, name = "synthetic", retryAfterMs?: number) =>
  new EmailProviderError({
    provider: "resend",
    status,
    responseText: JSON.stringify({ name }),
    retryAfterMs,
  });

describe("transactional subscription payment confirmation policy", () => {
  it.each(["ru", "kg", "en"] as const)(
    "keeps %s email plan names identical to the billing UI",
    (language) => {
      const messages = { ru: ruMessages, kg: kgMessages, en: enMessages }[language];
      for (const [plan, planKey] of [
        ["STARTER", "starter"],
        ["BUSINESS", "business"],
        ["ENTERPRISE", "enterprise"],
      ] as const) {
        for (const kind of ["PAYMENT_CONFIRMED", "ACCESS_RESTORED"] as const) {
          for (const startOffset of [0, 3 * 86_400_000]) {
            const message = subscriptionPaymentNotificationContent({
              kind,
              language,
              organizationName: "Synthetic",
              amountMinor: 350_000,
              plan,
              confirmedAt: now,
              startsAt: new Date(now.getTime() + startOffset),
              endsAt: new Date("2027-08-01T10:00:00Z"),
            });
            const label = messages.billing.plans[planKey].name;
            expect(message.text).toContain(label);
            expect(message.html).toContain(label);
          }
        }
      }
    },
  );
  it("includes actual real paid SELF_SERVE receipts, including grandfathered contracts", () => {
    expect(canNotifySubscriptionPayment(organization, invoice)).toBe(true);
    expect(
      canNotifySubscriptionPayment({ ...organization, subscriptionContract: null }, invoice),
    ).toBe(true);
    expect(
      canNotifySubscriptionPayment({ ...organization, subscriptionStatus: "PAST_DUE" }, invoice),
    ).toBe(true);
  });
  it.each([
    { subscriptionBillingMode: "MANUAL" },
    { subscriptionStatus: "CANCELED" },
    { subscriptionContract: { lifetimeAccess: true } },
    ...[...LIFETIME_ORGANIZATION_IDS].map((id) => ({ id })),
  ])("never notifies manual, canceled or protected free organization %j", (changes) => {
    expect(canNotifySubscriptionPayment({ ...organization, ...changes }, invoice)).toBe(false);
  });
  it.each([
    { status: "REVIEW" },
    { status: "PENDING" },
    { isTest: true },
    { paidAt: null },
    { providerPaymentId: null },
    { currency: "USD" },
  ])("never treats Test or unresolved payment %j as a real confirmation", (changes) => {
    expect(canNotifySubscriptionPayment(organization, { ...invoice, ...changes })).toBe(false);
  });
  it("never retries an unknown submission after the 23-hour safety window", () => {
    expect(
      canRetrySubscriptionPaymentNotification(now, new Date(now.getTime() + 23 * 3_600_000 - 1)),
    ).toBe(true);
    expect(
      canRetrySubscriptionPaymentNotification(now, new Date(now.getTime() + 23 * 3_600_000)),
    ).toBe(false);
    expect(canRetrySubscriptionPaymentNotification(now, new Date(now.getTime() - 1))).toBe(false);
    expect(
      subscriptionPaymentNotificationRetry({
        firstAttemptAt: now,
        now: new Date(now.getTime() + 23 * 3_600_000),
        attemptCount: 2,
        error: new Error("timeout"),
      }).retryAt,
    ).toBeNull();
  });
  it.each([400, 401, 403, 409, 422])("stops permanent provider rejection %s", (status) => {
    expect(
      subscriptionPaymentNotificationRetry({
        firstAttemptAt: now,
        now,
        attemptCount: 1,
        error: error(status),
      }),
    ).toEqual({ retryAt: null, issue: "PROVIDER_PERMANENT" });
  });
  it.each([408, 425, 429, 500, 503])(
    "schedules bounded retry for transient provider %s",
    (status) => {
      expect(
        subscriptionPaymentNotificationRetry({
          firstAttemptAt: now,
          now,
          attemptCount: 1,
          error: error(status),
        }).retryAt,
      ).toEqual(new Date(now.getTime() + 60_000));
    },
  );
  it("recognizes only the provider's exact concurrent-idempotency conflict and respects Retry-After", () => {
    expect(
      subscriptionPaymentNotificationRetry({
        firstAttemptAt: now,
        now,
        attemptCount: 1,
        error: error(409, "concurrent_idempotent_requests", 120_000),
      }).retryAt,
    ).toEqual(new Date(now.getTime() + 120_000));
    expect(
      subscriptionPaymentNotificationRetry({
        firstAttemptAt: now,
        now,
        attemptCount: 5,
        error: new Error("unknown result"),
      }).retryAt,
    ).toBeNull();
  });
  it.each(["ru", "kg", "en"])(
    "freezes readable escaped %s copy with authoritative amount and dates",
    (language) => {
      const message = subscriptionPaymentNotificationContent({
        kind: "PAYMENT_CONFIRMED",
        language,
        organizationName: '<script>alert("x")</script>',
        amountMinor: 178_500,
        plan: "BUSINESS",
        startsAt: now,
        endsAt: new Date("2027-08-01T10:00:00Z"),
        confirmedAt: now,
      });
      expect(message.locale).toBe(language);
      expect(message.html).not.toContain("<script>");
      expect(message.html).toContain("https://bazaar.kg/billing");
      expect(message.text).toMatch(/1[\s,]?785/);
      expect(message.text).not.toMatch(
        /undefined|Invalid Date|\{(amount|organization|plan|start|end)\}/,
      );
      expect(message.html).not.toContain("unsubscribe");
    },
  );
  it("does not claim a future paid tier starts now or consume the remaining trial", () => {
    const message = subscriptionPaymentNotificationContent({
      kind: "PAYMENT_CONFIRMED",
      language: "en",
      organizationName: "Synthetic",
      amountMinor: 200_000,
      plan: "STARTER",
      confirmedAt: now,
      startsAt: new Date("2027-02-05T10:00:00Z"),
      endsAt: new Date("2027-03-05T10:00:00Z"),
    });
    expect(message.text).toContain(
      "Your current access conditions remain in effect until that period starts.",
    );
    expect(message.text).not.toContain("access restored");
    expect(message.text).toContain("There are no automatic charges.");
  });
  it("clearly confirms restoration after read-only access without claiming a fiscal receipt", () => {
    const message = subscriptionPaymentNotificationContent({
      kind: "ACCESS_RESTORED",
      language: "en",
      organizationName: "Synthetic",
      amountMinor: 350_000,
      plan: "BUSINESS",
      confirmedAt: now,
      startsAt: now,
      endsAt: new Date("2027-03-01T10:00:00Z"),
    });
    expect(message.subject).toContain("access restored");
    expect(message.text).toContain("You can create and edit records again.");
    expect(message.text).toContain("not a fiscal receipt");
  });
  it.each(["ru", "kg", "en"] as const)(
    "confirms %s future payment without claiming that future access has already been restored",
    (language) => {
      const expected = {
        ru: {
          subject: "Bazaar: оплата подписки подтверждена",
          future: "До начала этого периода сохраняются текущие условия доступа.",
          restoredSubject: "доступ восстановлен",
          restoredBody: "Создание и изменение записей снова доступны.",
        },
        kg: {
          subject: "Bazaar: жазылуу төлөмү ырасталды",
          future: "Бул мөөнөт башталганга чейин учурдагы жеткилик шарттары сакталат.",
          restoredSubject: "жеткилик калыбына келди",
          restoredBody: "Жазууларды түзүү жана өзгөртүү кайра жеткиликтүү.",
        },
        en: {
          subject: "Bazaar: subscription payment confirmed",
          future: "Your current access conditions remain in effect until that period starts.",
          restoredSubject: "access restored",
          restoredBody: "You can create and edit records again.",
        },
      }[language];
      const input = {
        language,
        organizationName: "Synthetic",
        amountMinor: 350_000,
        plan: "BUSINESS" as const,
        confirmedAt: now,
        startsAt: new Date("2027-02-05T10:00:00Z"),
        endsAt: new Date("2027-03-05T10:00:00Z"),
      };
      const message = subscriptionPaymentNotificationContent({
        ...input,
        kind: "ACCESS_RESTORED",
      });
      expect(message.subject).toBe(expected.subject);
      expect(message.subject).not.toContain(expected.restoredSubject);
      expect(message.text).toContain(expected.future);
      expect(message.text).not.toContain(expected.restoredBody);
      expect(message.html).toContain(expected.future);
      expect(message.html).not.toContain(expected.restoredBody);
      expect(message).toEqual(
        subscriptionPaymentNotificationContent({
          ...input,
          kind: "PAYMENT_CONFIRMED",
        }),
      );
      const immediate = subscriptionPaymentNotificationContent({
        ...input,
        kind: "ACCESS_RESTORED",
        startsAt: now,
      });
      expect(immediate.subject).toContain(expected.restoredSubject);
      expect(immediate.text).toContain(expected.restoredBody);
    },
  );
});
