import { randomUUID } from "node:crypto";

import {
  CustomerSource,
  EmailCampaignRecipientStatus,
  EmailCampaignStatus,
  EmailSenderDomainStatus,
  EmailSenderIdentityStatus,
  type Role,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/prisma";
import {
  processEmailProviderRecipientEvent,
  reconcileEmailCampaignRecipients,
  recomputeEmailCampaignDeliverySummary,
} from "@/server/services/emailCampaignDeliveryState";
import {
  createEmailUnsubscribeToken,
  deliverPendingEmailCampaigns,
  duplicateEmailCampaign,
  getEmailMarketingAudiencePreview,
  unsubscribeCustomerFromEmailMarketing,
} from "@/server/services/emailMarketing";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const asCallerUser = (user: {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
  isOrgOwner?: boolean | null;
}) => {
  if (!user.organizationId) throw new Error("test user must belong to an organization");
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    isOrgOwner: Boolean(user.isOrgOwner),
  };
};

describeDb("email marketing durable delivery", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("unsubscribes normalized duplicate customers in one store without leaking to another", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const otherStore = await prisma.store.create({
      data: { organizationId: org.id, name: "Other Store", code: "OTHER-EMAIL" },
    });
    const primary = await prisma.customer.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Primary",
        email: "User@Example.com",
        source: CustomerSource.MANUAL,
      },
    });
    await prisma.customer.createMany({
      data: [
        {
          organizationId: org.id,
          storeId: store.id,
          name: "Duplicate",
          email: " user@example.COM ",
          source: CustomerSource.MANUAL,
        },
        {
          organizationId: org.id,
          storeId: otherStore.id,
          name: "Other store customer",
          email: "USER@example.com",
          source: CustomerSource.MANUAL,
        },
      ],
    });
    const email = "user@example.com";
    await unsubscribeCustomerFromEmailMarketing({
      customerId: primary.id,
      email,
      token: createEmailUnsubscribeToken({ customerId: primary.id, email }),
    });

    const sameStoreCustomers = await prisma.customer.findMany({
      where: { organizationId: org.id, storeId: store.id },
      select: { email: true, emailMarketingUnsubscribedAt: true },
    });
    expect(sameStoreCustomers).toHaveLength(2);
    expect(sameStoreCustomers.every((customer) => customer.emailMarketingUnsubscribedAt)).toBe(true);
    await expect(
      prisma.customer.findFirstOrThrow({ where: { storeId: otherStore.id } }),
    ).resolves.toMatchObject({ emailMarketingUnsubscribedAt: null });
    await expect(
      prisma.emailMarketingSuppression.findUniqueOrThrow({
        where: {
          organizationId_storeId_email: {
            organizationId: org.id,
            storeId: store.id,
            email,
          },
        },
      }),
    ).resolves.toMatchObject({ source: "UNSUBSCRIBED", active: true });
    const audience = await getEmailMarketingAudiencePreview({
      user: asCallerUser(adminUser),
      storeId: store.id,
      audience: { mode: "segment", segment: "all" },
    });
    expect(audience).toMatchObject({ validRecipients: 0, excludedUnsubscribed: 2 });
  });

  it("persists webhook suppression once, rejects wrong scope, and ignores older events", async () => {
    const { org, store } = await seedBase({ plan: "BUSINESS" });
    const otherStore = await prisma.store.create({
      data: { organizationId: org.id, name: "Other Store", code: "WEBHOOK-OTHER" },
    });
    const customer = await prisma.customer.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Webhook recipient",
        email: "Bounce@Example.com",
      },
    });
    const campaign = await prisma.emailCampaign.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        status: EmailCampaignStatus.AWAITING_EVENTS,
        name: "Webhook",
        subject: "Webhook",
        body: "Webhook",
        recipientCount: 1,
        acceptedCount: 1,
        unresolvedCount: 1,
      },
    });
    const recipient = await prisma.emailCampaignRecipient.create({
      data: {
        organizationId: org.id,
        campaignId: campaign.id,
        customerId: customer.id,
        email: "bounce@example.com",
        status: EmailCampaignRecipientStatus.ACCEPTED,
        provider: "resend",
        providerMessageId: "resend_webhook_1",
        sendOperationKey: `test:${randomUUID()}`,
        acceptedAt: new Date("2026-07-27T10:00:00.000Z"),
      },
    });
    const eventAt = new Date("2026-07-27T10:05:00.000Z");
    await expect(
      processEmailProviderRecipientEvent({
        provider: "resend",
        providerMessageId: "resend_webhook_1",
        providerEventId: "evt_wrong_scope",
        eventType: "email.bounced",
        eventAt,
        providerReason: "unknown user",
        payload: { data: { tags: { campaign_id: campaign.id, store_id: otherStore.id } } },
      }),
    ).resolves.toMatchObject({ processed: false, reason: "scope_mismatch" });

    const event = {
      provider: "resend",
      providerMessageId: "resend_webhook_1",
      providerEventId: "evt_bounced",
      eventType: "email.bounced",
      eventAt,
      providerReason: "unknown user",
      payload: { data: { tags: { campaign_id: campaign.id, store_id: store.id } } },
    } as const;
    await expect(processEmailProviderRecipientEvent(event)).resolves.toMatchObject({
      processed: true,
      applied: true,
      status: "BOUNCED",
    });
    await expect(processEmailProviderRecipientEvent(event)).resolves.toMatchObject({
      processed: true,
      duplicate: true,
    });
    await expect(
      processEmailProviderRecipientEvent({
        ...event,
        providerEventId: "evt_old_sent",
        eventType: "email.sent",
        eventAt: new Date("2026-07-27T10:01:00.000Z"),
      }),
    ).resolves.toMatchObject({ applied: false, ignoredReason: "older_event" });

    await expect(
      prisma.emailCampaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } }),
    ).resolves.toMatchObject({ status: EmailCampaignRecipientStatus.BOUNCED });
    await expect(
      prisma.emailMarketingSuppression.findUniqueOrThrow({
        where: {
          organizationId_storeId_email: {
            organizationId: org.id,
            storeId: store.id,
            email: "bounce@example.com",
          },
        },
      }),
    ).resolves.toMatchObject({ source: "BOUNCED", active: true });
    expect(await prisma.emailMarketingSuppression.count({ where: { storeId: otherStore.id } })).toBe(0);
    expect(await prisma.emailCampaignRecipientEvent.count({ where: { recipientId: recipient.id } })).toBe(2);
    await expect(prisma.emailCampaign.findUniqueOrThrow({ where: { id: campaign.id } }))
      .resolves.toMatchObject({
        recipientCount: 1,
        bouncedCount: 1,
        unresolvedCount: 0,
        status: EmailCampaignStatus.FAILED,
      });
  });

  it("accounts exactly for the 3960-recipient incident-safe equivalent", async () => {
    const { org, store } = await seedBase({ plan: "BUSINESS" });
    const campaign = await prisma.emailCampaign.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        status: EmailCampaignStatus.DRAFT,
        name: "Incident equivalent",
        subject: "Incident equivalent",
        body: "Incident equivalent",
      },
    });
    const now = new Date("2026-07-27T10:00:00.000Z");
    await prisma.customer.createMany({
      data: Array.from({ length: 3_960 }, (_value, index) => ({
        id: `incident_customer_${index}`,
        organizationId: org.id,
        storeId: store.id,
        name: `Recipient ${index}`,
        email: `recipient-${index}@example.com`,
      })),
    });
    await prisma.emailCampaignRecipient.createMany({
      data: Array.from({ length: 3_960 }, (_value, index) => {
        const status =
          index < 31
            ? EmailCampaignRecipientStatus.DELIVERED
            : index < 192
              ? EmailCampaignRecipientStatus.BOUNCED
              : EmailCampaignRecipientStatus.ACCEPTED;
        return {
          id: `incident_recipient_${index}`,
          organizationId: org.id,
          campaignId: campaign.id,
          customerId: `incident_customer_${index}`,
          email: `recipient-${index}@example.com`,
          status,
          sendOperationKey: `incident:${index}`,
          acceptedAt: now,
          deliveredAt: status === EmailCampaignRecipientStatus.DELIVERED ? now : null,
          bouncedAt: status === EmailCampaignRecipientStatus.BOUNCED ? now : null,
          failedAt: status === EmailCampaignRecipientStatus.BOUNCED ? now : null,
          terminalAt:
            status === EmailCampaignRecipientStatus.ACCEPTED ? null : now,
        };
      }),
    });

    const summary = await recomputeEmailCampaignDeliverySummary(campaign.id);
    expect(summary.counts).toMatchObject({
      audience: 3_960,
      ACCEPTED: 3_768,
      DELIVERED: 31,
      BOUNCED: 161,
      unresolved: 3_768,
      invariantTotal: 3_960,
      invariantSatisfied: true,
    });
    expect(summary.campaign).toMatchObject({
      recipientCount: 3_960,
      acceptedCount: 3_768,
      deliveredCount: 31,
      bouncedCount: 161,
      unresolvedCount: 3_768,
      status: EmailCampaignStatus.AWAITING_EVENTS,
    });
  });

  it("duplicates a completed campaign into an empty-recipient draft", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const campaign = await prisma.emailCampaign.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        status: EmailCampaignStatus.COMPLETED,
        name: "Completed",
        subject: "Completed",
        body: "Completed",
        recipientCount: 1,
        deliveredCount: 1,
      },
    });
    const duplicate = await duplicateEmailCampaign({
      user: asCallerUser(adminUser),
      actorId: adminUser.id,
      requestId: "duplicate-delivery-campaign",
      campaignId: campaign.id,
    });
    expect(duplicate).toMatchObject({
      status: EmailCampaignStatus.DRAFT,
      recipientCount: 0,
      queuedCount: 0,
      deliveredCount: 0,
    });
  });

  it("paces 429 handling without a busy loop and reuses the durable idempotency key", async () => {
    const { org, store } = await seedBase({ plan: "BUSINESS" });
    const customer = await prisma.customer.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Rate limited",
        email: "rate-limited@example.com",
      },
    });
    const campaign = await prisma.emailCampaign.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        status: EmailCampaignStatus.QUEUED,
        name: "Rate limit",
        subject: "Rate limit",
        body: "Rate limit body",
        recipientCount: 1,
        queuedCount: 1,
        unresolvedCount: 1,
      },
    });
    const recipient = await prisma.emailCampaignRecipient.create({
      data: {
        organizationId: org.id,
        campaignId: campaign.id,
        customerId: customer.id,
        email: "rate-limited@example.com",
        status: EmailCampaignRecipientStatus.QUEUED,
        sendOperationKey: `rate-limit:${randomUUID()}`,
      },
    });
    const previous = {
      provider: process.env.EMAIL_PROVIDER,
      apiKey: process.env.RESEND_API_KEY,
      nextAuthUrl: process.env.NEXTAUTH_URL,
      nextAuthSecret: process.env.NEXTAUTH_SECRET,
    };
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NEXTAUTH_URL = "https://app.bazaar.test";
    process.env.NEXTAUTH_SECRET = "email-delivery-test-secret";
    const idempotencyKeys: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (_url, init) => {
        idempotencyKeys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
        return new Response(JSON.stringify({ message: "rate limited" }), {
          status: 429,
          headers: { "retry-after": "60" },
        });
      })
      .mockImplementationOnce(async (_url, init) => {
        idempotencyKeys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
        return new Response(JSON.stringify({ data: [{ id: "resend_retry_success" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
    try {
      const firstRun = await deliverPendingEmailCampaigns({
        organizationId: org.id,
        campaignId: campaign.id,
        maxBatches: 50,
      });
      expect(firstRun.processed).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const afterRateLimit = await prisma.emailCampaignRecipient.findUniqueOrThrow({
        where: { id: recipient.id },
      });
      expect(afterRateLimit).toMatchObject({
        status: EmailCampaignRecipientStatus.QUEUED,
        normalizedErrorCategory: "RATE_LIMIT",
        attemptCount: 1,
      });
      expect(afterRateLimit.retryAt).not.toBeNull();
      await prisma.emailCampaignRecipient.update({
        where: { id: recipient.id },
        data: { retryAt: new Date() },
      });
      await deliverPendingEmailCampaigns({
        organizationId: org.id,
        campaignId: campaign.id,
        maxBatches: 1,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(idempotencyKeys[0]).toBeTruthy();
      expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
      await expect(
        prisma.emailCampaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } }),
      ).resolves.toMatchObject({
        status: EmailCampaignRecipientStatus.ACCEPTED,
        providerMessageId: "resend_retry_success",
        attemptCount: 2,
      });
    } finally {
      fetchMock.mockRestore();
      if (previous.provider === undefined) delete process.env.EMAIL_PROVIDER;
      else process.env.EMAIL_PROVIDER = previous.provider;
      if (previous.apiKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previous.apiKey;
      if (previous.nextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
      else process.env.NEXTAUTH_URL = previous.nextAuthUrl;
      if (previous.nextAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET;
      else process.env.NEXTAUTH_SECRET = previous.nextAuthSecret;
    }
  });

  it("keeps a provider network timeout retry-safe instead of terminally failing", async () => {
    const { org, store } = await seedBase({ plan: "BUSINESS" });
    const customer = await prisma.customer.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Timeout",
        email: "timeout@example.com",
      },
    });
    const campaign = await prisma.emailCampaign.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        status: EmailCampaignStatus.QUEUED,
        name: "Timeout",
        subject: "Timeout",
        body: "Timeout body",
        recipientCount: 1,
        queuedCount: 1,
        unresolvedCount: 1,
      },
    });
    const recipient = await prisma.emailCampaignRecipient.create({
      data: {
        organizationId: org.id,
        campaignId: campaign.id,
        customerId: customer.id,
        email: "timeout@example.com",
        status: EmailCampaignRecipientStatus.QUEUED,
        sendOperationKey: `timeout:${randomUUID()}`,
      },
    });
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NEXTAUTH_URL = "https://app.bazaar.test";
    process.env.NEXTAUTH_SECRET = "email-delivery-test-secret";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new TypeError("fetch failed: socket closed"),
    );
    try {
      await deliverPendingEmailCampaigns({
        organizationId: org.id,
        campaignId: campaign.id,
        maxBatches: 50,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expect(
        prisma.emailCampaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } }),
      ).resolves.toMatchObject({
        status: EmailCampaignRecipientStatus.QUEUED,
        normalizedErrorCategory: "PROVIDER_TEMPORARY",
        attemptCount: 1,
        terminalAt: null,
      });
    } finally {
      fetchMock.mockRestore();
      delete process.env.EMAIL_PROVIDER;
      delete process.env.RESEND_API_KEY;
    }
  });

  it("reconciles a missing delivered webhook from the provider lookup", async () => {
    const { org, store } = await seedBase({ plan: "BUSINESS" });
    const customer = await prisma.customer.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Reconciled recipient",
        email: "reconciled@example.com",
      },
    });
    const campaign = await prisma.emailCampaign.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        status: EmailCampaignStatus.AWAITING_EVENTS,
        name: "Reconciliation",
        subject: "Reconciliation",
        body: "Reconciliation",
        recipientCount: 1,
        acceptedCount: 1,
        unresolvedCount: 1,
      },
    });
    const recipient = await prisma.emailCampaignRecipient.create({
      data: {
        organizationId: org.id,
        campaignId: campaign.id,
        customerId: customer.id,
        email: "reconciled@example.com",
        status: EmailCampaignRecipientStatus.ACCEPTED,
        provider: "resend",
        providerMessageId: "resend_missing_webhook",
        sendOperationKey: `reconcile:${randomUUID()}`,
        acceptedAt: new Date("2026-07-27T08:00:00.000Z"),
      },
    });
    const previousApiKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "re_test_key";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: "resend_missing_webhook", last_event: "delivered" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    try {
      await expect(
        reconcileEmailCampaignRecipients({
          organizationId: org.id,
          campaignId: campaign.id,
          stuckBefore: new Date("2026-07-28T00:00:00.000Z"),
        }),
      ).resolves.toMatchObject({ inspected: 1, reconciled: 1 });
      await expect(
        prisma.emailCampaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } }),
      ).resolves.toMatchObject({
        status: EmailCampaignRecipientStatus.DELIVERED,
        providerStatus: "delivered",
      });
      await expect(
        prisma.emailCampaign.findUniqueOrThrow({ where: { id: campaign.id } }),
      ).resolves.toMatchObject({
        recipientCount: 1,
        deliveredCount: 1,
        unresolvedCount: 0,
        status: EmailCampaignStatus.COMPLETED,
      });
      expect(await prisma.emailCampaignRecipientEvent.count({ where: { recipientId: recipient.id } }))
        .toBe(1);
    } finally {
      fetchMock.mockRestore();
      if (previousApiKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousApiKey;
    }
  });

  it("submits through the verified custom sender instead of Bazaar fallback", async () => {
    const { org, store } = await seedBase({ plan: "BUSINESS" });
    const domain = await prisma.emailSenderDomain.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        domain: "mail.example.com",
        status: EmailSenderDomainStatus.VERIFIED,
        resendStatus: "verified",
        verifiedAt: new Date(),
      },
    });
    const sender = await prisma.emailSenderIdentity.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        domainId: domain.id,
        displayName: "Example Store",
        fromEmail: "offers@mail.example.com",
        status: EmailSenderIdentityStatus.VERIFIED,
      },
    });
    const customer = await prisma.customer.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Sender test",
        email: "sender-test@example.com",
      },
    });
    const campaign = await prisma.emailCampaign.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        senderIdentityId: sender.id,
        status: EmailCampaignStatus.QUEUED,
        name: "Verified sender",
        subject: "Verified sender",
        body: "Verified sender body",
        recipientCount: 1,
        queuedCount: 1,
        unresolvedCount: 1,
      },
    });
    await prisma.emailCampaignRecipient.create({
      data: {
        organizationId: org.id,
        campaignId: campaign.id,
        customerId: customer.id,
        email: "sender-test@example.com",
        status: EmailCampaignRecipientStatus.QUEUED,
        sendOperationKey: `verified-sender:${randomUUID()}`,
      },
    });
    const previous = {
      provider: process.env.EMAIL_PROVIDER,
      apiKey: process.env.RESEND_API_KEY,
      nextAuthUrl: process.env.NEXTAUTH_URL,
      nextAuthSecret: process.env.NEXTAUTH_SECRET,
    };
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NEXTAUTH_URL = "https://app.bazaar.test";
    process.env.NEXTAUTH_SECRET = "email-delivery-test-secret";
    let submittedFrom = "";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as Array<{ from?: string }>;
      submittedFrom = payload[0]?.from ?? "";
      return new Response(JSON.stringify({ data: [{ id: "resend_custom_sender" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      await deliverPendingEmailCampaigns({
        organizationId: org.id,
        campaignId: campaign.id,
        maxBatches: 1,
      });
      expect(submittedFrom).toBe("Example Store <offers@mail.example.com>");
      await expect(
        prisma.emailCampaignRecipient.findFirstOrThrow({ where: { campaignId: campaign.id } }),
      ).resolves.toMatchObject({
        status: EmailCampaignRecipientStatus.ACCEPTED,
        providerMessageId: "resend_custom_sender",
      });
    } finally {
      fetchMock.mockRestore();
      if (previous.provider === undefined) delete process.env.EMAIL_PROVIDER;
      else process.env.EMAIL_PROVIDER = previous.provider;
      if (previous.apiKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previous.apiKey;
      if (previous.nextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
      else process.env.NEXTAUTH_URL = previous.nextAuthUrl;
      if (previous.nextAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET;
      else process.env.NEXTAUTH_SECRET = previous.nextAuthSecret;
    }
  });
});
