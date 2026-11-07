import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { EmailProviderError, sendTransactionalEmail } from "@/server/services/email";
import { resolveOrderEmailRetryAt } from "@/server/services/orderEmailRetry";
import { LIFETIME_ORGANIZATION_IDS } from "./lifetimeOrganizations";
import { subscriptionReminderContent } from "./reminderContent";
import {
  canRetrySubscriptionReminder,
  subscriptionReminderKey,
  subscriptionReminderState,
} from "./reminderPolicy";

const organizationInclude = {
  subscriptionContract: true,
  subscriptionPeriods: {
    orderBy: [{ endsAt: "desc" }, { startsAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: 1,
    include: {
      invoice: {
        include: {
          events: {
            where: { state: "PAID", source: { in: ["CALLBACK", "RECONCILIATION"] } },
            take: 1,
          },
        },
      },
    },
  },
} satisfies Prisma.OrganizationInclude;
const ownerWhere = (organizationId: string, ownerId: string) => ({
  id: ownerId,
  organizationId,
  role: "ADMIN" as const,
  isOrgOwner: true,
  isActive: true,
  emailVerifiedAt: { not: null },
});

// Filter completed phases in SQL so old subscriptions cannot starve later
// organizations in a bounded batch. The pure policy is checked again under the
// organization lock before enqueue, and immediately before provider submission.
export async function findDueSubscriptionReminderOwners(now = new Date(), limit = 100) {
  return prisma.$queryRaw<{ organizationId: string; ownerId: string }[]>`
    WITH eligible AS (
      SELECT o.id AS "organizationId", u.id AS "ownerId",
        CASE WHEN p.id IS NULL THEN 'TRIAL' ELSE 'PAID' END AS source,
        CASE WHEN p.id IS NULL THEN o."trialEndsAt" ELSE p."endsAt" END AS ending
      FROM "Organization" o JOIN "SubscriptionContract" c ON c."organizationId"=o.id
      JOIN "User" u ON u."organizationId"=o.id AND u."isOrgOwner" AND u."isActive"
        AND u.role='ADMIN' AND u."emailVerifiedAt" IS NOT NULL
        AND u.email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      LEFT JOIN LATERAL (
        SELECT p.id,p."endsAt",i.status,i."isTest",i.currency,i."paidAt",i."providerPaymentId",i.id AS invoice
        FROM "SubscriptionPeriod" p JOIN "SubscriptionInvoice" i ON i.id=p."invoiceId"
        WHERE p."organizationId"=o.id
        ORDER BY p."endsAt" DESC,p."startsAt" DESC,p."createdAt" DESC,p.id DESC LIMIT 1
      ) p ON TRUE
      WHERE c."catalogVersion"='2026-11' AND NOT c."lifetimeAccess"
        AND o."subscriptionBillingMode"='SELF_SERVE' AND o."subscriptionStatus" IN ('ACTIVE','PAST_DUE')
        AND o.id NOT IN (${Prisma.join([...LIFETIME_ORGANIZATION_IDS])})
        AND ((p.id IS NULL AND o."trialEndsAt" IS NOT NULL
          AND (o."currentPeriodEndsAt" IS NULL OR o."currentPeriodEndsAt"<=o."trialEndsAt"))
          OR (p.id IS NOT NULL AND p."endsAt"=o."currentPeriodEndsAt"
            AND (o."trialEndsAt" IS NULL OR p."endsAt">o."trialEndsAt")
            AND p.status='PAID' AND NOT p."isTest" AND p.currency='KGS'
            AND p."paidAt" IS NOT NULL AND p."providerPaymentId" IS NOT NULL
            AND EXISTS(SELECT 1 FROM "SubscriptionPaymentEvent" e WHERE e."invoiceId"=p.invoice
              AND e.state='PAID' AND e.source IN ('CALLBACK','RECONCILIATION'))))
    ), phases AS (
      SELECT *,CASE WHEN ending>${now}::timestamp+INTERVAL '3 days' THEN NULL
        WHEN ending>${now}::timestamp+INTERVAL '1 day' THEN 'BEFORE_3'
        WHEN ending>${now}::timestamp THEN 'BEFORE_1'
        WHEN source='PAID' AND ending+INTERVAL '7 days'>${now}::timestamp THEN 'GRACE'
        ELSE 'READ_ONLY' END AS kind FROM eligible
    )
    SELECT p."organizationId",p."ownerId" FROM phases p WHERE p.kind IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM "SubscriptionReminder" r WHERE r."organizationId"=p."organizationId"
        AND r."ownerId"=p."ownerId" AND r.source=p.source AND r.kind=p.kind AND r."accessEndsAt"=p.ending)
    ORDER BY p.ending,p."organizationId",p."ownerId" LIMIT ${Math.max(1, Math.min(100, limit))}`;
}

export async function queueSubscriptionReminders(
  now = new Date(),
  candidates?: { organizationId: string; ownerId: string }[],
) {
  const senderEmail = process.env.EMAIL_FROM?.trim();
  if (!senderEmail) return 0;
  let queued = 0;
  for (const candidate of candidates ?? (await findDueSubscriptionReminderOwners(now))) {
    queued += await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${candidate.organizationId} FOR UPDATE`;
      const org = await tx.organization.findUnique({
        where: { id: candidate.organizationId },
        include: organizationInclude,
      });
      const owner = await tx.user.findFirst({
        where: ownerWhere(candidate.organizationId, candidate.ownerId),
      });
      const state = org && subscriptionReminderState(org, now);
      if (!org || !owner || !state) return 0;
      const recipientEmail = owner.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) return 0;
      const content = subscriptionReminderContent(state, org.name, owner.preferredLocale);
      const result = await tx.subscriptionReminder.createMany({
        data: [
          {
            organizationId: org.id,
            ownerId: owner.id,
            source: state.source,
            kind: state.kind,
            accessEndsAt: state.accessEndsAt,
            operationKey: subscriptionReminderKey(org.id, owner.id, state),
            recipientEmail,
            senderEmail,
            recipientLocale: content.locale,
            subject: content.subject,
            text: content.text,
            html: content.html,
            nextAttemptAt: now,
          },
        ],
        skipDuplicates: true,
      });
      return result.count;
    });
  }
  return queued;
}

export async function processSubscriptionReminders(now = new Date()) {
  await prisma.subscriptionReminder.updateMany({
    where: { status: "PROCESSING", leaseExpiresAt: { lte: now }, attemptCount: { gte: 5 } },
    data: {
      status: "FAILED",
      leaseToken: null,
      leaseExpiresAt: null,
      lastIssue: "DELIVERY_UNCONFIRMED",
    },
  });
  const candidates = await findDueSubscriptionReminderOwners(now);
  const dueWhere = {
    OR: [
      { status: "QUEUED", nextAttemptAt: { lte: now } },
      { status: "PROCESSING", leaseExpiresAt: { lte: now } },
    ],
  };
  const provider = (process.env.EMAIL_PROVIDER || (process.env.RESEND_API_KEY ? "resend" : "log"))
    .trim()
    .toLowerCase();
  if (
    provider !== "resend" ||
    !process.env.RESEND_API_KEY ||
    !process.env.EMAIL_FROM ||
    process.env.HARDENING_EXTERNAL_PROVIDER_MODE === "disabled"
  ) {
    const required =
      candidates.length > 0 || (await prisma.subscriptionReminder.count({ where: dueWhere })) > 0;
    return {
      job: "subscription-reminders",
      status: required ? ("skipped" as const) : ("ok" as const),
      details: {
        reason: required ? "failed" : "notNeeded",
        issue: "transactionalEmailNotConfigured",
        queued: 0,
        accepted: 0,
      },
    };
  }
  const queued = await queueSubscriptionReminders(now, candidates);
  const rows = await prisma.subscriptionReminder.findMany({
    where: dueWhere,
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    take: 20,
  });
  const deadline = Date.now() + 20000;
  let accepted = 0;
  let canceled = 0;
  let failed = 0;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    const leaseToken = randomUUID();
    const claim = await prisma.subscriptionReminder.updateMany({
      where: {
        id: row.id,
        ...dueWhere,
        firstAttemptAt: row.firstAttemptAt,
        attemptCount: { lt: 5 },
      },
      data: {
        status: "PROCESSING",
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + 120000),
        attemptCount: { increment: 1 },
        firstAttemptAt: row.firstAttemptAt ?? now,
        lastAttemptAt: now,
      },
    });
    if (!claim.count) continue;
    const finish = (
      status: string,
      data: Prisma.SubscriptionReminderUpdateManyMutationInput = {},
    ) =>
      prisma.subscriptionReminder.updateMany({
        where: { id: row.id, leaseToken, status: "PROCESSING" },
        data: { status, leaseToken: null, leaseExpiresAt: null, ...data },
      });
    try {
      const current = await prisma.organization.findUnique({
        where: { id: row.organizationId },
        include: organizationInclude,
      });
      const owner = await prisma.user.findFirst({
        where: ownerWhere(row.organizationId, row.ownerId),
      });
      const currentState = current && subscriptionReminderState(current, new Date());
      if (
        !owner ||
        owner.email.trim().toLowerCase() !== row.recipientEmail ||
        !currentState ||
        subscriptionReminderKey(row.organizationId, row.ownerId, currentState) !== row.operationKey
      ) {
        await finish("CANCELED", { lastIssue: "ACCESS_OR_OWNER_CHANGED" });
        canceled++;
        continue;
      }
      if (!canRetrySubscriptionReminder(row.firstAttemptAt ?? now, new Date())) {
        await finish("FAILED", { lastIssue: "IDEMPOTENCY_WINDOW_EXPIRED" });
        failed++;
        continue;
      }
      const result = await sendTransactionalEmail({
        to: row.recipientEmail,
        from: row.senderEmail,
        subject: row.subject,
        text: row.text,
        html: row.html,
        idempotencyKey: row.operationKey,
        tags: [{ name: "kind", value: "subscription_reminder" }],
      });
      if (result.provider !== "resend" || !result.id) {
        await finish("FAILED", { lastIssue: "NON_DELIVERY_TRANSPORT" });
        failed++;
        continue;
      }
      await finish("ACCEPTED", {
        providerMessageId: result.id,
        acceptedAt: new Date(),
        lastIssue: null,
      });
      accepted++;
    } catch (error) {
      let concurrentProviderRequest = false;
      if (error instanceof EmailProviderError && error.status === 409) {
        try {
          concurrentProviderRequest =
            JSON.parse(error.responseText).name === "concurrent_idempotent_requests";
        } catch {
          /* An unknown conflict is terminal. */
        }
      }
      const permanent =
        error instanceof EmailProviderError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![408, 425, 429].includes(error.status) &&
        !concurrentProviderRequest;
      const retryAt = permanent
        ? null
        : resolveOrderEmailRetryAt({ hasClaim: true, attemptCount: row.attemptCount + 1, error });
      const retry = retryAt && canRetrySubscriptionReminder(row.firstAttemptAt ?? now, retryAt);
      await finish(retry ? "QUEUED" : "FAILED", {
        lastIssue: permanent ? "PROVIDER_PERMANENT" : "DELIVERY_UNCONFIRMED",
        ...(retry ? { nextAttemptAt: retryAt! } : {}),
      });
      failed++;
    }
  }
  return {
    job: "subscription-reminders",
    status: failed ? ("skipped" as const) : ("ok" as const),
    details: { queued, accepted, canceled, failed, ...(failed ? { reason: "failed" } : {}) },
  };
}
