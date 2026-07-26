import { createHash } from "node:crypto";

export const emailRecipientLifecycleStatuses = [
  "QUEUED",
  "SENDING",
  "ACCEPTED",
  "DEFERRED",
  "DELIVERED",
  "BOUNCED",
  "DROPPED",
  "SUPPRESSED",
  "COMPLAINED",
  "FAILED",
  "CANCELLED",
] as const;

export type EmailRecipientLifecycleStatus =
  (typeof emailRecipientLifecycleStatuses)[number];

export const terminalEmailRecipientStatuses = new Set<EmailRecipientLifecycleStatus>([
  "DELIVERED",
  "BOUNCED",
  "DROPPED",
  "SUPPRESSED",
  "COMPLAINED",
  "FAILED",
  "CANCELLED",
]);

export type EmailCampaignLifecycleStatus =
  | "DRAFT"
  | "QUEUED"
  | "SENDING"
  | "AWAITING_EVENTS"
  | "COMPLETED"
  | "COMPLETED_WITH_ERRORS"
  | "FAILED"
  | "CANCELLED";

export type EmailDeliveryErrorCategory =
  | "NONE"
  | "PROVIDER_TIMEOUT"
  | "RATE_LIMIT"
  | "PROVIDER_TEMPORARY"
  | "RECIPIENT_TEMPORARY"
  | "HARD_BOUNCE"
  | "INVALID_ADDRESS"
  | "SUPPRESSED"
  | "UNSUBSCRIBED"
  | "COMPLAINT"
  | "PROVIDER_PERMANENT"
  | "CONFIGURATION"
  | "UNKNOWN";

export type EmailDeliveryCounts = Record<EmailRecipientLifecycleStatus, number> & {
  audience: number;
  unresolved: number;
  terminal: number;
  permanentFailures: number;
  invariantTotal: number;
  invariantSatisfied: boolean;
};

const emptyStatusCounts = (): Record<EmailRecipientLifecycleStatus, number> => ({
  QUEUED: 0,
  SENDING: 0,
  ACCEPTED: 0,
  DEFERRED: 0,
  DELIVERED: 0,
  BOUNCED: 0,
  DROPPED: 0,
  SUPPRESSED: 0,
  COMPLAINED: 0,
  FAILED: 0,
  CANCELLED: 0,
});

export const countEmailRecipientLifecycleStatuses = (
  statuses: readonly EmailRecipientLifecycleStatus[],
): EmailDeliveryCounts => {
  const counts = emptyStatusCounts();
  for (const status of statuses) {
    counts[status] += 1;
  }
  const invariantTotal = emailRecipientLifecycleStatuses.reduce(
    (total, status) => total + counts[status],
    0,
  );
  const unresolved = counts.QUEUED + counts.SENDING + counts.ACCEPTED + counts.DEFERRED;
  const permanentFailures =
    counts.BOUNCED +
    counts.DROPPED +
    counts.SUPPRESSED +
    counts.COMPLAINED +
    counts.FAILED;

  return {
    ...counts,
    audience: statuses.length,
    unresolved,
    terminal: statuses.length - unresolved,
    permanentFailures,
    invariantTotal,
    invariantSatisfied: invariantTotal === statuses.length,
  };
};

export const resolveEmailCampaignLifecycleStatus = (
  counts: EmailDeliveryCounts,
): EmailCampaignLifecycleStatus => {
  if (counts.audience > 0 && counts.CANCELLED === counts.audience) {
    return "CANCELLED";
  }
  if (counts.SENDING > 0 || (counts.QUEUED > 0 && counts.invariantTotal > counts.QUEUED)) {
    return "SENDING";
  }
  if (counts.QUEUED > 0) {
    return "QUEUED";
  }
  if (counts.ACCEPTED > 0 || counts.DEFERRED > 0) {
    return "AWAITING_EVENTS";
  }
  if (counts.audience === 0) {
    return "FAILED";
  }
  if (counts.permanentFailures === 0 && counts.CANCELLED === 0) {
    return "COMPLETED";
  }
  if (counts.DELIVERED > 0) {
    return "COMPLETED_WITH_ERRORS";
  }
  return "FAILED";
};

const normalizedProviderEventType = (eventType: string) =>
  eventType.trim().toLowerCase().replace(/^email\./, "");

export const lifecycleStatusForProviderEvent = (
  eventType: string,
): EmailRecipientLifecycleStatus | null => {
  switch (normalizedProviderEventType(eventType)) {
    case "scheduled":
      return "QUEUED";
    case "sent":
      return "ACCEPTED";
    case "delivery_delayed":
    case "deferred":
      return "DEFERRED";
    case "delivered":
      return "DELIVERED";
    case "bounced":
      return "BOUNCED";
    case "dropped":
      return "DROPPED";
    case "suppressed":
      return "SUPPRESSED";
    case "complained":
      return "COMPLAINED";
    case "failed":
      return "FAILED";
    case "cancelled":
      return "CANCELLED";
    default:
      return null;
  }
};

export const lifecycleStatusForProviderLookup = (
  lastEvent: string,
): EmailRecipientLifecycleStatus | null => {
  const normalized = normalizedProviderEventType(lastEvent);
  if (normalized === "opened" || normalized === "clicked") {
    // Engagement is only possible after delivery. Resend's sent-email lookup returns
    // the last event, so opened/clicked must reconcile to the delivered lifecycle state.
    return "DELIVERED";
  }
  return lifecycleStatusForProviderEvent(normalized);
};

export const buildEmailProviderEventIdentity = (input: {
  provider: string;
  providerEventId?: string | null;
  providerMessageId: string;
  eventType: string;
  eventAt: Date;
}) => {
  const provider = input.provider.trim().toLowerCase();
  const providerEventId = input.providerEventId?.trim();
  if (providerEventId) {
    return `${provider}:${providerEventId}`;
  }
  return createHash("sha256")
    .update(
      [
        provider,
        input.providerMessageId.trim(),
        normalizedProviderEventType(input.eventType),
        input.eventAt.toISOString(),
      ].join("\u0000"),
    )
    .digest("hex");
};

const activeProgressionRank: Partial<Record<EmailRecipientLifecycleStatus, number>> = {
  QUEUED: 0,
  SENDING: 1,
  ACCEPTED: 2,
  DEFERRED: 3,
};

export type EmailRecipientTransitionDecision = {
  nextStatus: EmailRecipientLifecycleStatus;
  apply: boolean;
  reason:
    | "applied"
    | "duplicate_event"
    | "engagement_event"
    | "older_event"
    | "active_state_regression"
    | "terminal_state_regression";
};

export const decideEmailRecipientTransition = (input: {
  currentStatus: EmailRecipientLifecycleStatus;
  currentEventAt?: Date | null;
  currentEventIdentity?: string | null;
  eventStatus: EmailRecipientLifecycleStatus | null;
  eventAt: Date;
  eventIdentity: string;
}): EmailRecipientTransitionDecision => {
  if (input.currentEventIdentity && input.currentEventIdentity === input.eventIdentity) {
    return { nextStatus: input.currentStatus, apply: false, reason: "duplicate_event" };
  }
  if (!input.eventStatus) {
    return { nextStatus: input.currentStatus, apply: false, reason: "engagement_event" };
  }
  if (input.currentEventAt && input.eventAt.getTime() < input.currentEventAt.getTime()) {
    return { nextStatus: input.currentStatus, apply: false, reason: "older_event" };
  }

  if (terminalEmailRecipientStatuses.has(input.currentStatus)) {
    // Resend defines complained as an event after successful delivery.
    if (input.currentStatus === "DELIVERED" && input.eventStatus === "COMPLAINED") {
      return { nextStatus: "COMPLAINED", apply: true, reason: "applied" };
    }
    if (input.currentStatus === input.eventStatus) {
      return { nextStatus: input.currentStatus, apply: false, reason: "duplicate_event" };
    }
    return {
      nextStatus: input.currentStatus,
      apply: false,
      reason: "terminal_state_regression",
    };
  }

  const currentRank = activeProgressionRank[input.currentStatus];
  const nextRank = activeProgressionRank[input.eventStatus];
  if (currentRank !== undefined && nextRank !== undefined && nextRank < currentRank) {
    return {
      nextStatus: input.currentStatus,
      apply: false,
      reason: "active_state_regression",
    };
  }
  return { nextStatus: input.eventStatus, apply: true, reason: "applied" };
};

const containsAny = (value: string, fragments: readonly string[]) =>
  fragments.some((fragment) => value.includes(fragment));

export const normalizeEmailDeliveryError = (input: {
  status?: EmailRecipientLifecycleStatus | null;
  providerHttpStatus?: number | null;
  reason?: string | null;
}): EmailDeliveryErrorCategory => {
  const reason = input.reason?.trim().toLowerCase() ?? "";
  if (input.status === "COMPLAINED") return "COMPLAINT";
  if (input.status === "SUPPRESSED") return "SUPPRESSED";
  if (input.status === "BOUNCED") {
    return containsAny(reason, ["invalid", "does not exist", "unknown user", "mailbox not found"])
      ? "INVALID_ADDRESS"
      : "HARD_BOUNCE";
  }
  if (containsAny(reason, ["unsubscribe", "unsubscribed"])) return "UNSUBSCRIBED";
  if (input.providerHttpStatus === 429 || reason.includes("rate limit")) return "RATE_LIMIT";
  if (
    input.providerHttpStatus === 408 ||
    containsAny(reason, ["timeout", "timed out", "aborterror"])
  ) {
    return "PROVIDER_TIMEOUT";
  }
  if (
    (input.providerHttpStatus !== null &&
      input.providerHttpStatus !== undefined &&
      input.providerHttpStatus >= 500) ||
    containsAny(reason, ["temporary", "temporarily", "try again", "service unavailable"])
  ) {
    return "PROVIDER_TEMPORARY";
  }
  if (input.status === "DEFERRED") return "RECIPIENT_TEMPORARY";
  if (containsAny(reason, ["domain", "dkim", "spf", "api key", "configuration"])) {
    return "CONFIGURATION";
  }
  if (
    input.providerHttpStatus !== null &&
    input.providerHttpStatus !== undefined &&
    input.providerHttpStatus >= 400
  ) {
    return "PROVIDER_PERMANENT";
  }
  if (!input.status && !reason && !input.providerHttpStatus) return "NONE";
  return "UNKNOWN";
};

export const isRetryableEmailDeliveryFailure = (input: {
  status: EmailRecipientLifecycleStatus;
  category: EmailDeliveryErrorCategory;
}) => {
  if (terminalEmailRecipientStatuses.has(input.status) && input.status !== "FAILED") {
    return false;
  }
  return (
    input.category === "PROVIDER_TIMEOUT" ||
    input.category === "RATE_LIMIT" ||
    input.category === "PROVIDER_TEMPORARY" ||
    input.category === "RECIPIENT_TEMPORARY"
  );
};

export type LegacyEmailCampaignRecipient = {
  status: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
  providerStatus?: string | null;
  errorMessage?: string | null;
  sentAt?: Date | null;
  deliveredAt?: Date | null;
  bouncedAt?: Date | null;
  complainedAt?: Date | null;
};

export const classifyLegacyEmailCampaignRecipient = (
  recipient: LegacyEmailCampaignRecipient,
): EmailRecipientLifecycleStatus => {
  const providerStatus = normalizedProviderEventType(recipient.providerStatus ?? "");
  if (recipient.complainedAt || providerStatus === "complained") return "COMPLAINED";
  if (providerStatus === "suppressed") return "SUPPRESSED";
  if (recipient.bouncedAt || providerStatus === "bounced") return "BOUNCED";
  if (
    recipient.deliveredAt ||
    providerStatus === "delivered" ||
    providerStatus === "opened" ||
    providerStatus === "clicked"
  ) {
    return "DELIVERED";
  }
  if (providerStatus === "delivery_delayed" || providerStatus === "deferred") {
    return "DEFERRED";
  }
  if (recipient.status === "PENDING") return "QUEUED";
  if (recipient.status === "SKIPPED") {
    return containsAny(recipient.errorMessage?.toLowerCase() ?? "", ["unsubscribe", "suppressed"])
      ? "SUPPRESSED"
      : "FAILED";
  }
  if (recipient.status === "FAILED" || providerStatus === "failed") return "FAILED";
  if (recipient.sentAt || recipient.status === "SENT") return "ACCEPTED";
  return "FAILED";
};

export const summarizeLegacyEmailCampaignRecipients = (
  recipients: readonly LegacyEmailCampaignRecipient[],
) => countEmailRecipientLifecycleStatuses(recipients.map(classifyLegacyEmailCampaignRecipient));
