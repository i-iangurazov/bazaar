import { createHash } from "node:crypto";
import { CURRENT_CATALOG_VERSION } from "@/lib/billing/subscriptionPricing";
import { LIFETIME_ORGANIZATION_IDS } from "./lifetimeOrganizations";

export type ReminderKind = "BEFORE_3" | "BEFORE_1" | "GRACE" | "READ_ONLY";
export type ReminderSource = "PAID" | "TRIAL";
export type ReminderState = {
  source: ReminderSource;
  kind: ReminderKind;
  accessEndsAt: Date;
  graceEndsAt: Date | null;
};
export type ReminderOrganization = {
  id: string;
  subscriptionBillingMode: string;
  subscriptionStatus: string;
  currentPeriodEndsAt: Date | null;
  trialEndsAt: Date | null;
  subscriptionContract: { catalogVersion: string; lifetimeAccess: boolean } | null;
  subscriptionPeriods: {
    endsAt: Date;
    invoice: {
      status: string;
      isTest: boolean;
      currency: string;
      paidAt: Date | null;
      providerPaymentId: string | null;
      events: { state: string; source: string }[];
    };
  }[];
};
const DAY = 86400000;

export function subscriptionReminderState(
  org: ReminderOrganization,
  now = new Date(),
): ReminderState | null {
  if (
    org.subscriptionContract?.catalogVersion !== CURRENT_CATALOG_VERSION ||
    org.subscriptionContract.lifetimeAccess ||
    LIFETIME_ORGANIZATION_IDS.has(org.id) ||
    org.subscriptionBillingMode !== "SELF_SERVE" ||
    !["ACTIVE", "PAST_DUE"].includes(org.subscriptionStatus)
  )
    return null;
  const tail = org.subscriptionPeriods[0];
  let source: ReminderSource;
  let end: Date;
  if (tail) {
    const invoice = tail.invoice;
    if (
      !org.currentPeriodEndsAt ||
      tail.endsAt.getTime() !== org.currentPeriodEndsAt.getTime() ||
      (org.trialEndsAt && tail.endsAt <= org.trialEndsAt) ||
      invoice.status !== "PAID" ||
      invoice.isTest ||
      invoice.currency !== "KGS" ||
      !invoice.paidAt ||
      !invoice.providerPaymentId ||
      !invoice.events.some(
        (event) => event.state === "PAID" && ["CALLBACK", "RECONCILIATION"].includes(event.source),
      )
    )
      return null;
    source = "PAID";
    end = tail.endsAt;
  } else {
    if (!org.trialEndsAt || (org.currentPeriodEndsAt && org.currentPeriodEndsAt > org.trialEndsAt))
      return null;
    source = "TRIAL";
    end = org.trialEndsAt;
  }
  if (!Number.isFinite(end.getTime()) || !Number.isFinite(now.getTime())) return null;
  const remaining = end.getTime() - now.getTime();
  if (remaining > 3 * DAY) return null;
  const graceEndsAt = source === "PAID" ? new Date(end.getTime() + 7 * DAY) : null;
  const kind: ReminderKind =
    remaining > DAY
      ? "BEFORE_3"
      : remaining > 0
        ? "BEFORE_1"
        : graceEndsAt && graceEndsAt > now
          ? "GRACE"
          : "READ_ONLY";
  return { source, kind, accessEndsAt: end, graceEndsAt };
}

export const subscriptionReminderKey = (orgId: string, ownerId: string, state: ReminderState) =>
  `subscription-reminder-v1-${createHash("sha256")
    .update(
      JSON.stringify([orgId, ownerId, state.source, state.kind, state.accessEndsAt.toISOString()]),
    )
    .digest("hex")}`;

export function canRetrySubscriptionReminder(firstAttemptAt: Date, now: Date) {
  // Resend retains idempotency keys for 24 hours. Stop before that boundary;
  // an unknown delivery must never be blindly repeated after retention expires.
  return now.getTime() - firstAttemptAt.getTime() < 23 * 60 * 60 * 1000;
}
