import { createHash } from "node:crypto";

import {
  EmailCampaignRecipientStatus,
  EmailCampaignStatus,
  EmailDeliveryErrorCategory,
  Prisma,
  type EmailCampaignRecipient,
} from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { EmailProviderError, retrieveResendEmail } from "@/server/services/email";
import {
  buildEmailProviderEventIdentity,
  countEmailRecipientLifecycleStatuses,
  decideEmailRecipientTransition,
  emailRecipientLifecycleStatuses,
  lifecycleStatusForProviderEvent,
  lifecycleStatusForProviderLookup,
  normalizeEmailDeliveryError,
  resolveEmailCampaignLifecycleStatus,
  terminalEmailRecipientStatuses,
  type EmailDeliveryCounts,
  type EmailRecipientLifecycleStatus,
} from "@/server/services/emailDeliveryLifecycle";

type DeliveryTransaction = Prisma.TransactionClient;

const lifecycleStatusSet = new Set<string>(emailRecipientLifecycleStatuses);

const toLifecycleStatus = (status: EmailCampaignRecipientStatus): EmailRecipientLifecycleStatus => {
  if (lifecycleStatusSet.has(status)) {
    return status as EmailRecipientLifecycleStatus;
  }
  if (status === EmailCampaignRecipientStatus.PENDING) return "QUEUED";
  if (status === EmailCampaignRecipientStatus.SENT) return "ACCEPTED";
  return "FAILED";
};

const campaignStatus = (counts: EmailDeliveryCounts) =>
  resolveEmailCampaignLifecycleStatus(counts) as EmailCampaignStatus;

export const recomputeEmailCampaignDeliverySummaryTx = async (
  tx: DeliveryTransaction,
  campaignId: string,
  errorMessage?: string | null,
) => {
  // Serialize counter recomputation per campaign before reading recipients. If two
  // webhook/reconciliation transactions counted first, the later campaign update
  // could persist a snapshot that did not include the other committed transition.
  const [campaign] = await tx.$queryRaw<Array<{ id: string; sentAt: Date | null }>>`
    SELECT "id", "sentAt"
    FROM "EmailCampaign"
    WHERE "id" = ${campaignId}
    FOR UPDATE
  `;
  const grouped = await tx.emailCampaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });
  const statuses = grouped.flatMap((row) =>
    Array.from({ length: row._count._all }, () => toLifecycleStatus(row.status)),
  );
  const counts = countEmailRecipientLifecycleStatuses(statuses);
  const cumulativeAccepted = await tx.emailCampaignRecipient.count({
    where: { campaignId, acceptedAt: { not: null } },
  });
  const nextStatus = campaignStatus(counts);
  const updated = await tx.emailCampaign.update({
    where: { id: campaignId },
    data: {
      status: nextStatus,
      recipientCount: counts.audience,
      queuedCount: counts.QUEUED,
      sendingCount: counts.SENDING,
      acceptedCount: counts.ACCEPTED,
      deferredCount: counts.DEFERRED,
      deliveredCount: counts.DELIVERED,
      bouncedCount: counts.BOUNCED,
      droppedCount: counts.DROPPED,
      suppressedCount: counts.SUPPRESSED,
      complainedCount: counts.COMPLAINED,
      failedCount: counts.FAILED,
      cancelledCount: counts.CANCELLED,
      unresolvedCount: counts.unresolved,
      sentCount: cumulativeAccepted,
      sentAt:
        counts.unresolved === 0 && cumulativeAccepted > 0
          ? (campaign?.sentAt ?? new Date())
          : undefined,
      errorMessage:
        nextStatus === EmailCampaignStatus.FAILED ||
        nextStatus === EmailCampaignStatus.COMPLETED_WITH_ERRORS
          ? (errorMessage ?? "emailCampaignPartialOrFullFailure")
          : null,
    },
  });

  if (!counts.invariantSatisfied || updated.recipientCount !== counts.invariantTotal) {
    throw new Error("emailCampaignRecipientCounterInvariantFailed");
  }

  return {
    campaign: updated,
    counts,
    sent: cumulativeAccepted,
    failed: counts.FAILED,
    skipped: counts.SUPPRESSED + counts.CANCELLED,
    pending: counts.unresolved,
    failedOrSkipped: counts.permanentFailures + counts.CANCELLED,
  };
};

export const recomputeEmailCampaignDeliverySummary = async (
  campaignId: string,
  errorMessage?: string | null,
) =>
  prisma.$transaction((tx) =>
    recomputeEmailCampaignDeliverySummaryTx(tx, campaignId, errorMessage),
  );

const boundedText = (value: unknown, maxLength: number) =>
  typeof value === "string" ? value.slice(0, maxLength) : null;

type ProviderEventPayload = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    id?: string;
    created_at?: string;
    subject?: string;
    to?: unknown;
    bounce?: {
      message?: string | null;
      type?: string | null;
      subType?: string | null;
    } | null;
    tags?: Record<string, string> | Array<{ name?: string; value?: string }> | null;
  } | null;
};

const providerTag = (payload: ProviderEventPayload | null | undefined, name: string) => {
  const tags = payload?.data?.tags;
  if (Array.isArray(tags)) {
    return tags.find((tag) => tag.name === name)?.value ?? null;
  }
  return tags && typeof tags === "object" ? (tags[name] ?? null) : null;
};

const sanitizedProviderPayload = (payload: ProviderEventPayload | null | undefined) => {
  if (!payload) return null;
  const bounce = payload.data?.bounce;
  return {
    type: boundedText(payload.type, 100),
    createdAt: boundedText(payload.created_at ?? payload.data?.created_at, 100),
    emailId: boundedText(payload.data?.email_id ?? payload.data?.id, 200),
    subject: boundedText(payload.data?.subject, 300),
    bounce: bounce
      ? {
          type: boundedText(bounce.type, 100),
          subType: boundedText(bounce.subType, 100),
          message: boundedText(bounce.message, 1_000),
        }
      : null,
    tags: {
      campaignId: boundedText(providerTag(payload, "campaign_id"), 100),
      storeId: boundedText(providerTag(payload, "store_id"), 100),
    },
  } satisfies Prisma.InputJsonObject;
};

const terminalFailureStatus = (status: EmailRecipientLifecycleStatus) =>
  status === "BOUNCED" ||
  status === "DROPPED" ||
  status === "SUPPRESSED" ||
  status === "COMPLAINED" ||
  status === "FAILED";

type ProviderRecipientEventInput = {
  provider: string;
  providerMessageId: string;
  providerEventId?: string | null;
  eventType: string;
  eventAt: Date;
  providerReason?: string | null;
  payload?: ProviderEventPayload | null;
};

type ReconciliationEventInput = ProviderRecipientEventInput & {
  reconciliation?: {
    recipient: EmailCampaignRecipient;
    retryAt: Date | null;
    localFailure?: boolean;
  };
};

export const processEmailProviderRecipientEvent = (input: ProviderRecipientEventInput) =>
  prisma.$transaction((tx) => processEmailProviderRecipientEventTx(tx, input));

const processEmailProviderRecipientEventTx = async (
  tx: DeliveryTransaction,
  input: ReconciliationEventInput,
) => {
  const provider = input.provider.trim().toLowerCase();
  const eventIdentity = buildEmailProviderEventIdentity({
    provider,
    providerEventId: input.providerEventId,
    providerMessageId: input.providerMessageId,
    eventType: input.eventType,
    eventAt: input.eventAt,
  });

  const candidate = await tx.emailCampaignRecipient.findFirst({
    where: {
      provider,
      providerMessageId: input.providerMessageId,
    },
    select: { id: true, campaignId: true },
  });
  if (!candidate) {
    // A signed, tagged callback can beat persistence of the batch response.
    // Ask the transport to retry only for a known campaign with a pending
    // provider identity; unrelated transactional-email callbacks stay ignored.
    const campaignId = providerTag(input.payload, "campaign_id");
    const storeId = providerTag(input.payload, "store_id");
    if (campaignId && storeId) {
      const campaign = await tx.emailCampaign.findFirst({
        where: { id: campaignId, storeId },
        select: { organizationId: true },
      });
      if (
        campaign &&
        (await tx.emailCampaignRecipient.count({
          where: {
            campaignId,
            organizationId: campaign.organizationId,
            provider,
            providerMessageId: null,
            status: EmailCampaignRecipientStatus.SENDING,
          },
        }))
      )
        return { processed: false as const, reason: "recipient_identity_pending" as const };
    }
    return { processed: false as const, reason: "recipient_not_found" as const };
  }
  // Campaign first, recipient second is the canonical lock order. This prevents
  // different-recipient webhooks from holding recipient/FK locks while each waits
  // to serialize the same campaign summary.
  await tx.$queryRaw`
      SELECT "id"
      FROM "EmailCampaign"
      WHERE "id" = ${candidate.campaignId}
      FOR UPDATE
    `;
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "EmailCampaignRecipient"
      WHERE "id" = ${candidate.id}
        AND "provider" = ${provider}
        AND "providerMessageId" = ${input.providerMessageId}
      FOR UPDATE
    `);
  if (locked.length !== 1) {
    return { processed: false as const, reason: "recipient_not_found" as const };
  }

  const recipient = await tx.emailCampaignRecipient.findUniqueOrThrow({
    where: { id: locked[0]!.id },
    include: { campaign: { select: { id: true, organizationId: true, storeId: true } } },
  });
  const snapshot = input.reconciliation?.recipient;
  if (
    snapshot &&
    (recipient.id !== snapshot.id ||
      recipient.updatedAt.getTime() !== snapshot.updatedAt.getTime() ||
      recipient.status !== snapshot.status ||
      recipient.providerMessageId !== snapshot.providerMessageId ||
      recipient.reconcileAttemptCount !== snapshot.reconcileAttemptCount ||
      recipient.lastProviderEventId !== snapshot.lastProviderEventId ||
      recipient.sendLeaseToken !== snapshot.sendLeaseToken)
  ) {
    return { processed: false as const, reason: "recipient_changed" as const };
  }
  if (recipient.organizationId !== recipient.campaign.organizationId) {
    await tx.emailCampaignRecipientEvent.createMany({
      data: [
        {
          organizationId: recipient.campaign.organizationId,
          campaignId: recipient.campaignId,
          recipientId: recipient.id,
          provider,
          eventIdentity,
          providerEventId: input.providerEventId ?? null,
          providerMessageId: input.providerMessageId,
          eventType: input.eventType.slice(0, 100),
          eventAt: input.eventAt,
          statusBefore: recipient.status,
          statusAfter: recipient.status,
          applied: false,
          ignoredReason: "recipient_organization_mismatch",
          providerReason: boundedText(input.providerReason, 1_000),
          payloadJson: sanitizedProviderPayload(input.payload) ?? Prisma.JsonNull,
        },
      ],
      skipDuplicates: true,
    });
    return {
      processed: false as const,
      reason: "recipient_organization_mismatch" as const,
      campaignId: recipient.campaignId,
      recipientId: recipient.id,
    };
  }
  const campaignTag = providerTag(input.payload, "campaign_id");
  const storeTag = providerTag(input.payload, "store_id");
  if (
    (campaignTag && campaignTag !== recipient.campaignId) ||
    (storeTag && storeTag !== recipient.campaign.storeId)
  ) {
    return { processed: false as const, reason: "scope_mismatch" as const };
  }

  const currentStatus = toLifecycleStatus(recipient.status);
  const eventStatus = input.reconciliation?.localFailure
    ? "FAILED"
    : lifecycleStatusForProviderEvent(input.eventType);
  const decision = decideEmailRecipientTransition({
    currentStatus,
    currentEventAt: recipient.lastProviderEventAt,
    currentEventIdentity: recipient.lastProviderEventId,
    eventStatus,
    eventAt: input.eventAt,
    eventIdentity,
    currentFailureIsLocal: recipient.lastProviderEvent === "reconciliation.failed",
  });
  const inserted = await tx.emailCampaignRecipientEvent.createMany({
    data: [
      {
        organizationId: recipient.campaign.organizationId,
        campaignId: recipient.campaignId,
        recipientId: recipient.id,
        provider,
        eventIdentity,
        providerEventId: input.providerEventId ?? null,
        providerMessageId: input.providerMessageId,
        eventType: input.eventType.slice(0, 100),
        eventAt: input.eventAt,
        statusBefore: recipient.status,
        statusAfter: decision.nextStatus as EmailCampaignRecipientStatus,
        applied: decision.apply,
        ignoredReason: decision.apply ? null : decision.reason,
        providerReason: boundedText(input.providerReason, 1_000),
        payloadJson: sanitizedProviderPayload(input.payload) ?? Prisma.JsonNull,
      },
    ],
    skipDuplicates: true,
  });
  if (inserted.count === 0) {
    const existing = await tx.emailCampaignRecipientEvent.findUniqueOrThrow({
      where: { provider_eventIdentity: { provider, eventIdentity } },
    });
    if (
      existing.recipientId !== recipient.id ||
      existing.providerMessageId !== input.providerMessageId ||
      existing.eventType !== input.eventType.slice(0, 100) ||
      (!input.reconciliation && existing.eventAt.getTime() !== input.eventAt.getTime())
    ) {
      return { processed: false as const, reason: "event_identity_conflict" as const };
    }
    if (input.reconciliation) {
      await tx.emailCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          reconcileAt: input.eventAt,
          reconcileAttemptCount: { increment: 1 },
          retryAt: terminalEmailRecipientStatuses.has(currentStatus)
            ? null
            : input.reconciliation.retryAt,
        },
      });
    }
    return {
      processed: true as const,
      duplicate: true,
      campaignId: recipient.campaignId,
      recipientId: recipient.id,
    };
  }

  if (decision.apply) {
    const category = normalizeEmailDeliveryError({
      status: decision.nextStatus,
      reason: input.providerReason,
    });
    const isTerminal = terminalEmailRecipientStatuses.has(decision.nextStatus);
    await tx.emailCampaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: decision.nextStatus as EmailCampaignRecipientStatus,
        providerStatus: input.eventType.replace(/^email\./, "").slice(0, 100),
        providerReason: boundedText(input.providerReason, 1_000),
        normalizedErrorCategory: category as EmailDeliveryErrorCategory,
        errorMessage: terminalFailureStatus(decision.nextStatus)
          ? (boundedText(input.providerReason, 1_000) ?? input.eventType.slice(0, 100))
          : null,
        lastProviderEvent: input.eventType.slice(0, 100),
        lastProviderEventId: eventIdentity,
        // A lookup exposes a latest event but no occurrence timestamp. Keep
        // polling time in the immutable event row, never in webhook ordering.
        lastProviderEventAt: input.reconciliation ? undefined : input.eventAt,
        retryAt: isTerminal
          ? null
          : input.reconciliation
            ? input.reconciliation.retryAt
            : decision.nextStatus === "DEFERRED"
              ? new Date(input.eventAt.getTime() + 15 * 60 * 1_000)
              : null,
        deliveredAt: decision.nextStatus === "DELIVERED" ? input.eventAt : undefined,
        bouncedAt: decision.nextStatus === "BOUNCED" ? input.eventAt : undefined,
        complainedAt: decision.nextStatus === "COMPLAINED" ? input.eventAt : undefined,
        failedAt: terminalFailureStatus(decision.nextStatus) ? input.eventAt : null,
        terminalAt: isTerminal ? input.eventAt : null,
        sendLeaseToken: null,
        sendLeaseExpiresAt: null,
        ...(input.reconciliation
          ? { reconcileAt: input.eventAt, reconcileAttemptCount: { increment: 1 } }
          : {}),
      },
    });

    if (
      decision.nextStatus === "BOUNCED" ||
      decision.nextStatus === "SUPPRESSED" ||
      decision.nextStatus === "COMPLAINED"
    ) {
      await tx.emailMarketingSuppression.upsert({
        where: {
          organizationId_storeId_email: {
            organizationId: recipient.campaign.organizationId,
            storeId: recipient.campaign.storeId,
            email: recipient.email.trim().toLowerCase(),
          },
        },
        create: {
          organizationId: recipient.campaign.organizationId,
          storeId: recipient.campaign.storeId,
          email: recipient.email.trim().toLowerCase(),
          provider,
          source: decision.nextStatus,
          reason: boundedText(input.providerReason, 1_000),
          originProviderEventId: input.providerEventId ?? eventIdentity,
          active: true,
          suppressedAt: input.eventAt,
        },
        update: {
          provider,
          source: decision.nextStatus,
          reason: boundedText(input.providerReason, 1_000),
          originProviderEventId: input.providerEventId ?? eventIdentity,
          active: true,
          suppressedAt: input.eventAt,
          clearedAt: null,
        },
      });
    }
  } else if (input.reconciliation) {
    await tx.emailCampaignRecipient.update({
      where: { id: recipient.id },
      data: {
        reconcileAt: input.eventAt,
        reconcileAttemptCount: { increment: 1 },
        retryAt: terminalEmailRecipientStatuses.has(currentStatus)
          ? null
          : input.reconciliation.retryAt,
      },
    });
  }

  const summary = await recomputeEmailCampaignDeliverySummaryTx(tx, recipient.campaignId);
  return {
    processed: true as const,
    duplicate: false,
    applied: decision.apply,
    ignoredReason: decision.apply ? null : decision.reason,
    campaignId: recipient.campaignId,
    recipientId: recipient.id,
    status: decision.nextStatus,
    counts: summary.counts,
  };
};

const reconciliationEventId = (messageId: string, lastEvent: string) =>
  `reconcile:${createHash("sha256").update(`${messageId}\u0000${lastEvent}`).digest("hex")}`;

export const canonicalEmailEventTypeForProviderLookup = (lastEvent: string) => {
  const normalized = lastEvent
    .trim()
    .toLowerCase()
    .replace(/^email\./, "");
  return normalized === "opened" || normalized === "clicked"
    ? "email.delivered"
    : `email.${normalized}`;
};

export const isEmailProviderOperationExpired = (input: {
  providerOperationStartedAt: Date | null;
  lastUpdatedAt: Date;
  now: Date;
  windowMs?: number;
}) => {
  const startedAt = input.providerOperationStartedAt ?? input.lastUpdatedAt;
  return startedAt.getTime() <= input.now.getTime() - (input.windowMs ?? 23 * 60 * 60 * 1_000);
};

export const canRetryEmailProviderOperation = (input: {
  providerOperationKey: string | null;
  providerOperationStartedAt: Date | null;
  now: Date;
}) =>
  !input.providerOperationKey ||
  (Boolean(input.providerOperationStartedAt) &&
    !isEmailProviderOperationExpired({
      providerOperationStartedAt: input.providerOperationStartedAt,
      lastUpdatedAt: input.providerOperationStartedAt ?? input.now,
      now: input.now,
    }));

export const buildEmailCampaignProviderOperationKey = (sendOperationKeys: readonly string[]) =>
  `email-campaign-${createHash("sha256")
    .update([...sendOperationKeys].sort().join("\u0000"))
    .digest("hex")}`;

export const shouldContinueEmailCampaignDeliveryRun = (input: {
  queued: number;
  progressed: number;
}) => input.queued > 0 && input.progressed > 0;

const reconciliationRetryAt = (attempt: number, minimumDelayMs = 0) => {
  const delayMinutes = Math.min(6 * 60, 5 * 2 ** Math.max(0, attempt - 1));
  return new Date(Date.now() + Math.max(minimumDelayMs, delayMinutes * 60 * 1_000));
};

export const EMAIL_RECONCILIATION_MAX_ATTEMPTS = 8;
export const EMAIL_RECONCILIATION_MAX_AGE_MS = 72 * 60 * 60 * 1_000;

export const isEmailReconciliationExhausted = (input: {
  nextAttempt: number;
  lifecycleStartedAt: Date;
  now: Date;
  maxAttempts?: number;
  maxAgeMs?: number;
}) =>
  input.nextAttempt >= (input.maxAttempts ?? EMAIL_RECONCILIATION_MAX_ATTEMPTS) ||
  input.lifecycleStartedAt.getTime() <=
    input.now.getTime() - (input.maxAgeMs ?? EMAIL_RECONCILIATION_MAX_AGE_MS);

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

// Provider calls run outside transactions. Commit only if the scanned recipient
// still has the same version, with counters in that same transaction. A callback
// or sender that won the race must never be overwritten by the stale lookup.
const updateReconciliationSnapshot = async (
  recipient: EmailCampaignRecipient,
  data: Prisma.EmailCampaignRecipientUpdateManyMutationInput,
) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "EmailCampaign" WHERE "id" = ${recipient.campaignId} FOR UPDATE`;
    const result = await tx.emailCampaignRecipient.updateMany({
      where: {
        id: recipient.id,
        campaignId: recipient.campaignId,
        organizationId: recipient.organizationId,
        campaign: { organizationId: recipient.organizationId },
        status: recipient.status,
        providerMessageId: recipient.providerMessageId,
        updatedAt: recipient.updatedAt,
        reconcileAttemptCount: recipient.reconcileAttemptCount,
        lastProviderEventId: recipient.lastProviderEventId,
        sendLeaseToken: recipient.sendLeaseToken,
      },
      data,
    });
    if (result.count) await recomputeEmailCampaignDeliverySummaryTx(tx, recipient.campaignId);
    return result.count === 1;
  });

export const reconcileEmailCampaignRecipients = async (input?: {
  organizationId?: string | null;
  campaignId?: string | null;
  stuckBefore?: Date | null;
  limit?: number | null;
}) => {
  const now = new Date();
  const stuckBefore = input?.stuckBefore ?? new Date(now.getTime() - 30 * 60 * 1_000);
  const requestedLimit = Math.trunc(input?.limit ?? 100);
  const limit = Math.max(1, Math.min(250, Number.isFinite(requestedLimit) ? requestedLimit : 100));
  const recipients = await prisma.emailCampaignRecipient.findMany({
    where: {
      ...(input?.organizationId
        ? {
            organizationId: input.organizationId,
            campaign: { organizationId: input.organizationId },
          }
        : {}),
      ...(input?.campaignId ? { campaignId: input.campaignId } : {}),
      status: {
        in: [
          EmailCampaignRecipientStatus.SENDING,
          EmailCampaignRecipientStatus.ACCEPTED,
          EmailCampaignRecipientStatus.DEFERRED,
        ],
      },
      updatedAt: { lte: stuckBefore },
      OR: [{ retryAt: null }, { retryAt: { lte: now } }],
    },
    orderBy: [{ retryAt: "asc" }, { updatedAt: "asc" }],
    take: limit,
  });

  let reconciled = 0;
  let requeued = 0;
  let failed = 0;
  let deferred = 0;
  let exhausted = 0;
  const campaignIds = new Set<string>();
  let lastProviderLookupStartedAt = 0;

  for (const recipient of recipients) {
    campaignIds.add(recipient.campaignId);
    const nextAttempt = recipient.reconcileAttemptCount + 1;
    const isExhausted = isEmailReconciliationExhausted({
      nextAttempt,
      lifecycleStartedAt:
        recipient.acceptedAt ?? recipient.providerOperationStartedAt ?? recipient.createdAt,
      now,
    });
    const metadata = { reconcileAt: now, reconcileAttemptCount: { increment: 1 } };
    const localFailure = async (reason: string, exhaustedBudget = false) => {
      if (!recipient.providerMessageId) return;
      const result = await prisma.$transaction((tx) =>
        processEmailProviderRecipientEventTx(tx, {
          provider: recipient.provider,
          providerMessageId: recipient.providerMessageId!,
          providerEventId: reconciliationEventId(
            recipient.providerMessageId!,
            `local-failure:${reason}`,
          ),
          eventType: "reconciliation.failed",
          eventAt: now,
          providerReason: reason,
          reconciliation: { recipient, retryAt: null, localFailure: true },
        }),
      );
      if (result.processed && "applied" in result && result.applied) {
        failed += 1;
        if (exhaustedBudget) exhausted += 1;
      }
    };
    const postpone = async (
      reason: string,
      category: EmailDeliveryErrorCategory,
      minimumDelayMs = 0,
    ) => {
      if (isExhausted) {
        await localFailure(`reconciliationExhausted:${reason}`, true);
        return;
      }
      if (
        await updateReconciliationSnapshot(recipient, {
          ...metadata,
          providerReason: boundedText(reason, 1_000),
          normalizedErrorCategory: category,
          retryAt: reconciliationRetryAt(nextAttempt, minimumDelayMs),
        })
      )
        deferred += 1;
    };

    if (recipient.status === EmailCampaignRecipientStatus.SENDING && !recipient.providerMessageId) {
      if (recipient.sendLeaseExpiresAt && recipient.sendLeaseExpiresAt > now) continue;
      const operationExpired = isEmailProviderOperationExpired({
        providerOperationStartedAt: recipient.providerOperationStartedAt,
        lastUpdatedAt: recipient.updatedAt,
        now,
      });
      const changed = await updateReconciliationSnapshot(recipient, {
        ...metadata,
        sendLeaseToken: null,
        sendLeaseExpiresAt: null,
        ...(operationExpired
          ? {
              status: EmailCampaignRecipientStatus.FAILED,
              normalizedErrorCategory: EmailDeliveryErrorCategory.UNKNOWN,
              providerReason: "providerMessageIdMissingAfterIdempotencyWindow",
              errorMessage: "providerMessageIdMissingAfterIdempotencyWindow",
              lastProviderEvent: "reconciliation.failed",
              failedAt: now,
              terminalAt: now,
              retryAt: null,
            }
          : {
              status: EmailCampaignRecipientStatus.QUEUED,
              normalizedErrorCategory: EmailDeliveryErrorCategory.PROVIDER_TIMEOUT,
              providerReason: "sendLeaseExpiredBeforeProviderIdentityPersisted",
              retryAt: now,
            }),
      });
      if (changed) {
        if (operationExpired) failed += 1;
        else requeued += 1;
      }
      continue;
    }

    if (!recipient.providerMessageId || recipient.provider !== "resend") {
      if (
        await updateReconciliationSnapshot(recipient, {
          ...metadata,
          status: EmailCampaignRecipientStatus.FAILED,
          normalizedErrorCategory: EmailDeliveryErrorCategory.UNKNOWN,
          providerReason: "providerLookupUnavailable",
          errorMessage: "providerLookupUnavailable",
          lastProviderEvent: "reconciliation.failed",
          failedAt: now,
          terminalAt: now,
          retryAt: null,
        })
      )
        failed += 1;
      continue;
    }

    const lookupDelayMs = Math.max(0, 250 - (Date.now() - lastProviderLookupStartedAt));
    if (lookupDelayMs > 0) await wait(lookupDelayMs);
    lastProviderLookupStartedAt = Date.now();
    let providerEmail: Awaited<ReturnType<typeof retrieveResendEmail>>;
    try {
      providerEmail = await retrieveResendEmail(recipient.providerMessageId);
    } catch (error) {
      // Only a provider call belongs in this catch. Database/commit failures must
      // propagate, not masquerade as transient provider errors and change state.
      const providerError = error instanceof EmailProviderError ? error : null;
      const retryable =
        !providerError ||
        providerError.status === 408 ||
        providerError.status === 429 ||
        providerError.status >= 500;
      if (retryable) {
        await postpone(
          providerError?.status === 429
            ? "providerRateLimitRepeated"
            : "providerLookupTransientFailure",
          providerError?.status === 429
            ? EmailDeliveryErrorCategory.RATE_LIMIT
            : EmailDeliveryErrorCategory.PROVIDER_TEMPORARY,
          providerError?.retryAfterMs ?? 0,
        );
      } else {
        await localFailure(
          providerError?.status === 404
            ? "providerMessageNotFound"
            : "providerLookupPermanentFailure",
        );
      }
      continue;
    }
    if (providerEmail.id !== recipient.providerMessageId) {
      await postpone("providerLookupIdentityMismatch", EmailDeliveryErrorCategory.UNKNOWN);
      continue;
    }
    const lastEvent = providerEmail.last_event?.trim().toLowerCase() ?? "";
    const lookupStatus = lifecycleStatusForProviderLookup(lastEvent);
    if (!lookupStatus) {
      await postpone(
        `providerLookupUnknownEvent:${lastEvent || "missing"}`,
        EmailDeliveryErrorCategory.UNKNOWN,
      );
      continue;
    }
    const unresolved = !terminalEmailRecipientStatuses.has(lookupStatus);
    if (unresolved && isExhausted) {
      await localFailure(`reconciliationExhausted:providerRemained:${lastEvent}`, true);
      continue;
    }
    const result = await prisma.$transaction((tx) =>
      processEmailProviderRecipientEventTx(tx, {
        provider: "resend",
        providerMessageId: recipient.providerMessageId!,
        providerEventId: reconciliationEventId(recipient.providerMessageId!, lastEvent),
        eventType: canonicalEmailEventTypeForProviderLookup(lastEvent),
        eventAt: now,
        providerReason: `reconciledFromProvider:${lastEvent}`,
        reconciliation: {
          recipient,
          retryAt: unresolved ? reconciliationRetryAt(nextAttempt) : null,
        },
      }),
    );
    if (result.processed) {
      reconciled += 1;
      if (unresolved) deferred += 1;
    }
  }

  return {
    inspected: recipients.length,
    reconciled,
    requeued,
    failed,
    deferred,
    exhausted,
    campaigns: Array.from(campaignIds),
  };
};
