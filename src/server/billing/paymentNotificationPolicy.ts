import { EmailProviderError } from "@/server/services/email";
import { resolveOrderEmailRetryAt } from "@/server/services/orderEmailRetry";
import { LIFETIME_ORGANIZATION_IDS } from "./lifetimeOrganizations";

export type SubscriptionPaymentNotificationKind = "PAYMENT_CONFIRMED" | "ACCESS_RESTORED";

export function canNotifySubscriptionPayment(
  organization: {
    id: string;
    subscriptionBillingMode: string;
    subscriptionStatus: string;
    subscriptionContract: { lifetimeAccess: boolean } | null;
  },
  invoice: {
    status: string;
    isTest: boolean;
    currency: string;
    paidAt: Date | null;
    providerPaymentId: string | null;
  },
) {
  return (
    organization.subscriptionBillingMode === "SELF_SERVE" &&
    ["ACTIVE", "PAST_DUE"].includes(organization.subscriptionStatus) &&
    !organization.subscriptionContract?.lifetimeAccess &&
    !LIFETIME_ORGANIZATION_IDS.has(organization.id) &&
    invoice.status === "PAID" &&
    !invoice.isTest &&
    invoice.currency === "KGS" &&
    Boolean(invoice.paidAt && invoice.providerPaymentId)
  );
}

export function canRetrySubscriptionPaymentNotification(firstAttemptAt: Date, now: Date) {
  const elapsed = now.getTime() - firstAttemptAt.getTime();
  // Resend's documented deduplication retention is 24 hours. A shorter bounded
  // window also covers an accepted send whose local acknowledgement was lost.
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 23 * 3_600_000;
}

export function subscriptionPaymentNotificationRetry(input: {
  firstAttemptAt: Date;
  attemptCount: number;
  error: unknown;
  now: Date;
}) {
  let concurrent = false;
  if (input.error instanceof EmailProviderError && input.error.status === 409) {
    try {
      concurrent = JSON.parse(input.error.responseText).name === "concurrent_idempotent_requests";
    } catch {
      /* An unrecognised conflict is not safe to repeat. */
    }
  }
  const permanent =
    input.error instanceof EmailProviderError &&
    input.error.status >= 400 &&
    input.error.status < 500 &&
    ![408, 425, 429].includes(input.error.status) &&
    !concurrent;
  const retryAt = permanent
    ? null
    : resolveOrderEmailRetryAt({
        hasClaim: true,
        attemptCount: input.attemptCount,
        error: input.error,
        now: input.now,
      });
  return {
    retryAt:
      retryAt && canRetrySubscriptionPaymentNotification(input.firstAttemptAt, retryAt)
        ? retryAt
        : null,
    issue: permanent ? "PROVIDER_PERMANENT" : "DELIVERY_UNCONFIRMED",
  };
}
