import { createHash } from "node:crypto";

import {
  EmailCampaignRecipientStatus,
  EmailCampaignStatus,
  EmailDeliveryErrorCategory,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import {
  EmailProviderError,
  retrieveResendEmail,
} from "@/server/services/email";
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

const toLifecycleStatus = (
  status: EmailCampaignRecipientStatus,
): EmailRecipientLifecycleStatus => {
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
  const grouped = await tx.emailCampaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });
  const statuses = grouped.flatMap((row) =>
    Array.from(
      { length: row._count._all },
      () => toLifecycleStatus(row.status),
    ),
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
      sentAt: counts.unresolved === 0 && cumulativeAccepted > 0 ? new Date() : undefined,
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
  return tags && typeof tags === "object" ? tags[name] ?? null : null;
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

export const processEmailProviderRecipientEvent = async (input: {
  provider: string;
  providerMessageId: string;
  providerEventId?: string | null;
  eventType: string;
  eventAt: Date;
  providerReason?: string | null;
  payload?: ProviderEventPayload | null;
}) => {
  const provider = input.provider.trim().toLowerCase();
  const eventIdentity = buildEmailProviderEventIdentity({
    provider,
    providerEventId: input.providerEventId,
    providerMessageId: input.providerMessageId,
    eventType: input.eventType,
    eventAt: input.eventAt,
  });

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "EmailCampaignRecipient"
      WHERE "provider" = ${provider}
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
    const campaignTag = providerTag(input.payload, "campaign_id");
    const storeTag = providerTag(input.payload, "store_id");
    if (
      (campaignTag && campaignTag !== recipient.campaignId) ||
      (storeTag && storeTag !== recipient.campaign.storeId)
    ) {
      return { processed: false as const, reason: "scope_mismatch" as const };
    }

    const currentStatus = toLifecycleStatus(recipient.status);
    const eventStatus = lifecycleStatusForProviderEvent(input.eventType);
    const decision = decideEmailRecipientTransition({
      currentStatus,
      currentEventAt: recipient.lastProviderEventAt,
      currentEventIdentity: recipient.lastProviderEventId,
      eventStatus,
      eventAt: input.eventAt,
      eventIdentity,
    });
    const inserted = await tx.emailCampaignRecipientEvent.createMany({
      data: [
        {
          organizationId: recipient.organizationId,
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
          lastProviderEventAt: input.eventAt,
          retryAt:
            decision.nextStatus === "DEFERRED"
              ? new Date(input.eventAt.getTime() + 15 * 60 * 1_000)
              : null,
          deliveredAt: decision.nextStatus === "DELIVERED" ? input.eventAt : undefined,
          bouncedAt: decision.nextStatus === "BOUNCED" ? input.eventAt : undefined,
          complainedAt: decision.nextStatus === "COMPLAINED" ? input.eventAt : undefined,
          failedAt: terminalFailureStatus(decision.nextStatus) ? input.eventAt : undefined,
          terminalAt: isTerminal ? input.eventAt : null,
          sendLeaseToken: null,
          sendLeaseExpiresAt: null,
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
              organizationId: recipient.organizationId,
              storeId: recipient.campaign.storeId,
              email: recipient.email.trim().toLowerCase(),
            },
          },
          create: {
            organizationId: recipient.organizationId,
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
  });
};

const reconciliationEventId = (messageId: string, lastEvent: string) =>
  `reconcile:${createHash("sha256")
    .update(`${messageId}\u0000${lastEvent}`)
    .digest("hex")}`;

export const canonicalEmailEventTypeForProviderLookup = (lastEvent: string) => {
  const normalized = lastEvent.trim().toLowerCase().replace(/^email\./, "");
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

const reconciliationRetryAt = (attempt: number, minimumDelayMs = 0) => {
  const delayMinutes = Math.min(6 * 60, 5 * 2 ** Math.max(0, attempt - 1));
  return new Date(Date.now() + Math.max(minimumDelayMs, delayMinutes * 60 * 1_000));
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

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
      ...(input?.organizationId ? { organizationId: input.organizationId } : {}),
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
  const campaignIds = new Set<string>();
  let lastProviderLookupStartedAt = 0;

  for (const recipient of recipients) {
    campaignIds.add(recipient.campaignId);
    if (recipient.status === EmailCampaignRecipientStatus.SENDING && !recipient.providerMessageId) {
      if (recipient.sendLeaseExpiresAt && recipient.sendLeaseExpiresAt > now) {
        continue;
      }
      const operationExpired = isEmailProviderOperationExpired({
        providerOperationStartedAt: recipient.providerOperationStartedAt,
        lastUpdatedAt: recipient.updatedAt,
        now,
      });
      await prisma.emailCampaignRecipient.update({
        where: { id: recipient.id },
        data: operationExpired
          ? {
              status: EmailCampaignRecipientStatus.FAILED,
              normalizedErrorCategory: EmailDeliveryErrorCategory.UNKNOWN,
              providerReason: "providerMessageIdMissingAfterIdempotencyWindow",
              errorMessage: "providerMessageIdMissingAfterIdempotencyWindow",
              failedAt: now,
              terminalAt: now,
              retryAt: null,
              sendLeaseToken: null,
              sendLeaseExpiresAt: null,
              reconcileAt: now,
              reconcileAttemptCount: { increment: 1 },
            }
          : {
              status: EmailCampaignRecipientStatus.QUEUED,
              normalizedErrorCategory: EmailDeliveryErrorCategory.PROVIDER_TIMEOUT,
              providerReason: "sendLeaseExpiredBeforeProviderIdentityPersisted",
              retryAt: now,
              sendLeaseToken: null,
              sendLeaseExpiresAt: null,
              reconcileAt: now,
              reconcileAttemptCount: { increment: 1 },
            },
      });
      if (operationExpired) failed += 1;
      else requeued += 1;
      continue;
    }

    if (!recipient.providerMessageId || recipient.provider !== "resend") {
      await prisma.emailCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: EmailCampaignRecipientStatus.FAILED,
          normalizedErrorCategory: EmailDeliveryErrorCategory.UNKNOWN,
          providerReason: "providerLookupUnavailable",
          errorMessage: "providerLookupUnavailable",
          failedAt: now,
          terminalAt: now,
          retryAt: null,
          reconcileAt: now,
          reconcileAttemptCount: { increment: 1 },
        },
      });
      failed += 1;
      continue;
    }

    try {
      const lookupDelayMs = Math.max(0, 250 - (Date.now() - lastProviderLookupStartedAt));
      if (lookupDelayMs > 0) await wait(lookupDelayMs);
      lastProviderLookupStartedAt = Date.now();
      const providerEmail = await retrieveResendEmail(recipient.providerMessageId);
      const lastEvent = providerEmail.last_event?.trim().toLowerCase() ?? "";
      const lookupStatus = lifecycleStatusForProviderLookup(lastEvent);
      if (!lookupStatus) {
        await prisma.emailCampaignRecipient.update({
          where: { id: recipient.id },
          data: {
            providerReason: `providerLookupUnknownEvent:${lastEvent || "missing"}`,
            normalizedErrorCategory: EmailDeliveryErrorCategory.UNKNOWN,
            retryAt: reconciliationRetryAt(recipient.reconcileAttemptCount + 1),
            reconcileAt: now,
            reconcileAttemptCount: { increment: 1 },
          },
        });
        deferred += 1;
        continue;
      }
      const result = await processEmailProviderRecipientEvent({
        provider: "resend",
        providerMessageId: recipient.providerMessageId,
        providerEventId: reconciliationEventId(recipient.providerMessageId, lastEvent),
        // Resend lookups use opened/clicked as the latest event. Canonicalize those
        // engagement-only values to delivered because the lookup proves delivery.
        eventType: canonicalEmailEventTypeForProviderLookup(lastEvent),
        eventAt: now,
        providerReason: `reconciledFromProvider:${lastEvent}`,
      });
      if (result.processed) reconciled += 1;
    } catch (error) {
      const providerError = error instanceof EmailProviderError ? error : null;
      const retryable =
        !providerError ||
        providerError.status === 408 ||
        providerError.status === 429 ||
        providerError.status >= 500;
      if (retryable) {
        await prisma.emailCampaignRecipient.update({
          where: { id: recipient.id },
          data: {
            providerReason: boundedText(
              providerError?.providerMessage ?? (error instanceof Error ? error.message : "providerLookupFailed"),
              1_000,
            ),
            normalizedErrorCategory:
              providerError?.status === 429
                ? EmailDeliveryErrorCategory.RATE_LIMIT
                : EmailDeliveryErrorCategory.PROVIDER_TEMPORARY,
            retryAt: reconciliationRetryAt(
              recipient.reconcileAttemptCount + 1,
              providerError?.retryAfterMs ?? 0,
            ),
            reconcileAt: now,
            reconcileAttemptCount: { increment: 1 },
          },
        });
        deferred += 1;
      } else {
        await processEmailProviderRecipientEvent({
          provider: "resend",
          providerMessageId: recipient.providerMessageId,
          providerEventId: reconciliationEventId(recipient.providerMessageId, "lookup_failed"),
          eventType: "email.failed",
          eventAt: now,
          providerReason:
            providerError?.status === 404
              ? "providerMessageNotFound"
              : (providerError?.providerMessage ?? "providerLookupPermanentFailure"),
        });
        failed += 1;
      }
    }
  }

  for (const campaignId of campaignIds) {
    await recomputeEmailCampaignDeliverySummary(campaignId);
  }

  return {
    inspected: recipients.length,
    reconciled,
    requeued,
    failed,
    deferred,
    campaigns: Array.from(campaignIds),
  };
};
