import { randomUUID } from "node:crypto";
import type { Prisma, SubscriptionInvoice } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { sendTransactionalEmail } from "@/server/services/email";
import {
  buildEmailProviderEventIdentity,
  decideEmailRecipientTransition,
  lifecycleStatusForProviderEvent,
  type EmailRecipientLifecycleStatus,
} from "@/server/services/emailDeliveryLifecycle";
import { subscriptionPaymentNotificationContent } from "./paymentNotificationContent";
import {
  canNotifySubscriptionPayment,
  canRetrySubscriptionPaymentNotification,
  subscriptionPaymentNotificationRetry,
} from "./paymentNotificationPolicy";

const ownerWhere = (organizationId: string, id?: string) => ({
  ...(id ? { id } : {}),
  organizationId,
  role: "ADMIN" as const,
  isOrgOwner: true,
  isActive: true,
  emailVerifiedAt: { not: null },
});

/** Called only inside the verified payment/grant transaction; never sends mail. */
export async function queueSubscriptionPaymentNotifications(
  tx: Prisma.TransactionClient,
  input: {
    organization: {
      id: string;
      name: string;
      subscriptionBillingMode: string;
      subscriptionStatus: string;
      subscriptionContract: { lifetimeAccess: boolean } | null;
    };
    invoice: SubscriptionInvoice;
    startsAt: Date;
    endsAt: Date;
    hadAccess: boolean;
    now: Date;
  },
) {
  if (!canNotifySubscriptionPayment(input.organization, input.invoice)) return 0;
  const owners = await tx.user.findMany({
    where: ownerWhere(input.organization.id),
    select: { id: true, email: true, preferredLocale: true },
  });
  const kind = input.hadAccess ? "PAYMENT_CONFIRMED" : "ACCESS_RESTORED";
  const senderEmail = process.env.EMAIL_FROM?.trim() || "Bazaar <no-reply@bazaar.kg>";
  const rows = owners.flatMap((owner) => {
    const recipientEmail = owner.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) return [];
    const id = randomUUID();
    const message = subscriptionPaymentNotificationContent({
      kind,
      organizationName: input.organization.name,
      language: owner.preferredLocale,
      amountMinor: input.invoice.amountMinor,
      plan: input.invoice.plan,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      confirmedAt: input.now,
    });
    return [
      {
        id,
        organizationId: input.organization.id,
        invoiceId: input.invoice.id,
        ownerId: owner.id,
        kind,
        operationKey: `subscription-payment-v1/${id}`,
        recipientEmail,
        recipientLocale: message.locale,
        senderEmail,
        subject: message.subject,
        text: message.text,
        html: message.html,
        nextAttemptAt: input.now,
      },
    ];
  });
  if (!rows.length) return 0;
  return (await tx.subscriptionPaymentNotification.createMany({ data: rows, skipDuplicates: true }))
    .count;
}

export async function processSubscriptionPaymentNotifications(now = new Date()) {
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
    process.env.HARDENING_EXTERNAL_PROVIDER_MODE === "disabled"
  ) {
    const required = await prisma.subscriptionPaymentNotification.count({ where: dueWhere });
    return {
      job: "subscription-payment-notifications",
      status: required ? ("skipped" as const) : ("ok" as const),
      details: {
        queued: required,
        accepted: 0,
        reason: required ? "failed" : "notNeeded",
        issue: "transactionalEmailNotConfigured",
      },
    };
  }
  await prisma.subscriptionPaymentNotification.updateMany({
    where: { status: "PROCESSING", leaseExpiresAt: { lte: now }, attemptCount: { gte: 5 } },
    data: {
      status: "FAILED",
      leaseToken: null,
      leaseExpiresAt: null,
      lastIssue: "DELIVERY_UNCONFIRMED",
    },
  });
  const rows = await prisma.subscriptionPaymentNotification.findMany({
    where: dueWhere,
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    take: 20,
  });
  const deadline = Date.now() + 20_000;
  let accepted = 0,
    canceled = 0,
    failed = 0;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    const leaseToken = randomUUID();
    const claim = await prisma.subscriptionPaymentNotification.updateMany({
      where: {
        id: row.id,
        ...dueWhere,
        firstAttemptAt: row.firstAttemptAt,
        attemptCount: { lt: 5 },
      },
      data: {
        status: "PROCESSING",
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + 120_000),
        attemptCount: { increment: 1 },
        firstAttemptAt: row.firstAttemptAt ?? now,
        lastAttemptAt: now,
        deliveryStatus: "SENDING",
      },
    });
    if (!claim.count) continue;
    const finish = (
      status: string,
      data: Prisma.SubscriptionPaymentNotificationUpdateManyMutationInput = {},
    ) =>
      prisma.subscriptionPaymentNotification.updateMany({
        where: { id: row.id, leaseToken, status: "PROCESSING" },
        data: { status, leaseToken: null, leaseExpiresAt: null, ...data },
      });
    try {
      const [invoice, owner] = await Promise.all([
        prisma.subscriptionInvoice.findUnique({
          where: { id: row.invoiceId },
          include: {
            period: true,
            organization: { include: { subscriptionContract: true } },
            events: {
              where: { state: "PAID", source: { in: ["CALLBACK", "RECONCILIATION"] } },
              take: 1,
            },
          },
        }),
        prisma.user.findFirst({ where: ownerWhere(row.organizationId, row.ownerId) }),
      ]);
      if (
        !invoice?.period ||
        !invoice.events.length ||
        !canNotifySubscriptionPayment(invoice.organization, invoice) ||
        !owner ||
        owner.email.trim().toLowerCase() !== row.recipientEmail
      ) {
        await finish("CANCELED", {
          lastIssue: "PAYMENT_OR_OWNER_CHANGED",
          deliveryStatus: "CANCELLED",
        });
        canceled++;
        continue;
      }
      if (!canRetrySubscriptionPaymentNotification(row.firstAttemptAt ?? now, new Date())) {
        await finish("FAILED", {
          lastIssue: "IDEMPOTENCY_WINDOW_EXPIRED",
          deliveryStatus: "FAILED",
        });
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
        tags: [
          { name: "kind", value: "subscription_payment" },
          { name: "subscription_notification", value: row.id },
        ],
      });
      if (result.provider !== "resend" || !result.id) {
        await finish("FAILED", { lastIssue: "NON_DELIVERY_TRANSPORT", deliveryStatus: "FAILED" });
        failed++;
        continue;
      }
      // A signed delivered event can arrive before this acknowledgement. Its
      // completed row no longer matches our lease and must never be downgraded.
      await finish("ACCEPTED", {
        providerMessageId: result.id,
        acceptedAt: new Date(),
        lastIssue: null,
        deliveryStatus: "ACCEPTED",
      });
      accepted++;
    } catch (error) {
      const retry = subscriptionPaymentNotificationRetry({
        firstAttemptAt: row.firstAttemptAt ?? now,
        attemptCount: row.attemptCount + 1,
        error,
        now: new Date(),
      });
      await finish(retry.retryAt ? "QUEUED" : "FAILED", {
        lastIssue: retry.issue,
        deliveryStatus: retry.retryAt ? "QUEUED" : "FAILED",
        ...(retry.retryAt ? { nextAttemptAt: retry.retryAt } : {}),
      });
      failed++;
    }
  }
  return {
    job: "subscription-payment-notifications",
    status: failed ? ("skipped" as const) : ("ok" as const),
    details: { accepted, canceled, failed, ...(failed ? { reason: "failed" } : {}) },
  };
}

const emailEventSchema = z.object({
  type: z.string(),
  created_at: z.string().optional(),
  data: z.object({
    email_id: z.string().optional(),
    id: z.string().optional(),
    created_at: z.string().optional(),
    to: z.array(z.string()).optional(),
    tags: z
      .union([
        z.record(z.string(), z.string()),
        z.array(z.object({ name: z.string(), value: z.string() })),
      ])
      .nullish(),
  }),
});

/** Only the existing signature-verified Resend route may dispatch these facts. */
export async function handleSubscriptionPaymentEmailEvent(input: {
  event: unknown;
  webhookEventId?: string | null;
}) {
  const parsed = emailEventSchema.safeParse(input.event);
  if (!parsed.success) return { processed: false, reason: "not_subscription_notification" };
  const event = parsed.data;
  const providerMessageId = event.data.email_id ?? event.data.id;
  const eventStatus = lifecycleStatusForProviderEvent(event.type);
  if (!providerMessageId || !event.type.startsWith("email.") || !eventStatus)
    return { processed: false, reason: "not_subscription_notification" };
  const tags = event.data.tags;
  const tagId = Array.isArray(tags)
    ? tags.find((tag) => tag.name === "subscription_notification")?.value
    : tags?.subscription_notification;
  const row = await prisma.subscriptionPaymentNotification.findFirst({
    where: {
      OR: [{ providerMessageId }, ...(tagId ? [{ id: tagId }] : [])],
    },
    select: { id: true },
  });
  if (!row) return { processed: false, reason: "not_subscription_notification" };
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "SubscriptionPaymentNotification" WHERE id=${row.id} FOR UPDATE`;
    const current = await tx.subscriptionPaymentNotification.findUniqueOrThrow({
      where: { id: row.id },
    });
    // Match the immutable recipient as well as provider/tag identity, including
    // the race in which a webhook beats persistence of the send response.
    if (
      !current.firstAttemptAt ||
      (current.providerMessageId && current.providerMessageId !== providerMessageId) ||
      !event.data.to?.some((email) => email.trim().toLowerCase() === current.recipientEmail)
    )
      return { processed: false, reason: "subscription_notification_identity_mismatch" };
    const rawDate = event.created_at ?? event.data.created_at;
    const timestamp = rawDate ? new Date(rawDate) : new Date();
    const eventAt = Number.isFinite(timestamp.getTime()) ? timestamp : new Date();
    const eventKey = buildEmailProviderEventIdentity({
      provider: "resend",
      providerMessageId,
      providerEventId: input.webhookEventId,
      eventType: event.type,
      eventAt,
    });
    const decision = decideEmailRecipientTransition({
      currentStatus: current.deliveryStatus as EmailRecipientLifecycleStatus,
      currentEventAt: current.deliveryEventAt,
      currentEventIdentity: current.deliveryEventKey,
      currentFailureIsLocal: !current.deliveryEventKey,
      eventStatus,
      eventAt,
      eventIdentity: eventKey,
    });
    if (!decision.apply) return { processed: true, reason: decision.reason };
    await tx.subscriptionPaymentNotification.update({
      where: { id: row.id },
      data: {
        providerMessageId,
        acceptedAt: current.acceptedAt ?? new Date(),
        ...(current.status === "CANCELED"
          ? {}
          : { status: "ACCEPTED", leaseToken: null, leaseExpiresAt: null }),
        deliveryStatus: decision.nextStatus,
        deliveryEventAt: eventAt,
        deliveryEventKey: eventKey,
        ...(decision.nextStatus === "DELIVERED"
          ? { deliveredAt: current.deliveredAt ?? eventAt }
          : {}),
        lastIssue: ["BOUNCED", "DROPPED", "SUPPRESSED", "COMPLAINED", "FAILED"].includes(
          decision.nextStatus,
        )
          ? "PROVIDER_DELIVERY_FAILED"
          : null,
      },
    });
    return { processed: true, status: decision.nextStatus };
  });
}
