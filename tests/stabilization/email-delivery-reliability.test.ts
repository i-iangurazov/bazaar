import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Prisma } from "@prisma/client";

const provider = vi.hoisted(() => ({
  lookup: vi.fn(),
  Error: class extends Error {
    constructor(
      public status: number,
      public providerMessage: string,
      public retryAfterMs = 0,
    ) {
      super("mock-provider-error");
    }
  },
}));
vi.mock("@/server/services/email", () => ({
  retrieveResendEmail: provider.lookup,
  EmailProviderError: provider.Error,
}));

import { prisma } from "@/server/db/prisma";
import {
  processEmailProviderRecipientEvent,
  reconcileEmailCampaignRecipients,
} from "@/server/services/emailCampaignDeliveryState";
import { cleanupCommerceFixtures, createCommerceFixtures, type CommerceFixtures } from "./fixtures";

describe("isolated provider callback and reconciliation reliability", () => {
  let fixture: CommerceFixtures;
  let afterScan: (() => Promise<void>) | null = null;
  let failCampaignUpdate = false;
  beforeAll(() => {
    prisma.$use(async (params, next) => {
      if (failCampaignUpdate && params.model === "EmailCampaign" && params.action === "update") {
        failCampaignUpdate = false;
        throw new Error("Synthetic campaign summary commit failure");
      }
      const result = await next(params);
      if (afterScan && params.model === "EmailCampaignRecipient" && params.action === "findMany") {
        const run = afterScan;
        afterScan = null;
        await run();
      }
      return result;
    });
  });
  beforeEach(async () => {
    vi.resetAllMocks();
    fixture = await createCommerceFixtures(prisma);
  });
  afterEach(async () => {
    afterScan = null;
    failCampaignUpdate = false;
    vi.restoreAllMocks();
    if (!fixture) return;
    const where = {
      organizationId: { in: Object.values(fixture.tenants).map((tenant) => tenant.org.id) },
    };
    await prisma.emailCampaignRecipientEvent.deleteMany({ where });
    await prisma.emailCampaignRecipient.deleteMany({ where });
    await prisma.emailCampaign.deleteMany({ where });
    await prisma.emailMarketingSuppression.deleteMany({ where });
    await cleanupCommerceFixtures(prisma, fixture);
  });

  // Only synthetic campaign/customer metadata: no send/job function is imported.
  const recipientFixture = async (
    data: Prisma.EmailCampaignRecipientUncheckedUpdateInput = {},
    tenant: "a" | "b" = "a",
  ) => {
    const { org, stores } = fixture.tenants[tenant];
    const customer = await prisma.customer.create({
      data: {
        organizationId: org.id,
        storeId: stores[0].id,
        name: "Synthetic callback recipient",
        email: `${randomUUID()}@example.invalid`,
      },
    });
    const campaign = await prisma.emailCampaign.create({
      data: {
        organizationId: org.id,
        storeId: stores[0].id,
        subject: "Synthetic callback fixture",
        body: "Never sent",
        status: "AWAITING_EVENTS",
        recipientCount: 1,
        acceptedCount: 1,
        sentCount: 1,
        unresolvedCount: 1,
      },
    });
    const recipient = await prisma.emailCampaignRecipient.create({
      data: {
        organizationId: org.id,
        campaignId: campaign.id,
        customerId: customer.id,
        email: customer.email!,
        status: "ACCEPTED",
        provider: "resend",
        providerMessageId: `synthetic-${randomUUID()}`,
        sendOperationKey: `synthetic-${randomUUID()}`,
        acceptedAt: new Date(Date.now() - 3_600_000),
        updatedAt: new Date(Date.now() - 3_600_000),
      },
    });
    return Object.keys(data).length
      ? prisma.emailCampaignRecipient.update({ where: { id: recipient.id }, data })
      : recipient;
  };
  const callback = (
    recipient: { providerMessageId: string | null },
    eventType = "email.delivered",
    extra: Partial<Parameters<typeof processEmailProviderRecipientEvent>[0]> = {},
  ) =>
    processEmailProviderRecipientEvent({
      provider: "resend",
      providerMessageId: recipient.providerMessageId!,
      providerEventId: `evt-${randomUUID()}`,
      eventType,
      eventAt: new Date(Date.now() - 10_000),
      ...extra,
    });
  const reconcile = (recipient: { campaignId: string }) =>
    reconcileEmailCampaignRecipients({
      organizationId: fixture.tenants.a.org.id,
      campaignId: recipient.campaignId,
      stuckBefore: new Date(Date.now() + 60_000),
    });
  const stored = (recipient: { id: string }) =>
    prisma.emailCampaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } });

  it("backs off repeated accepted lookups and stops at its bounded reconciliation budget", async () => {
    const recipient = await recipientFixture();
    provider.lookup.mockResolvedValue({ id: recipient.providerMessageId, last_event: "sent" });
    await reconcile(recipient);
    expect(await stored(recipient)).toMatchObject({ status: "ACCEPTED", reconcileAttemptCount: 1 });
    expect((await stored(recipient)).retryAt!.getTime()).toBeGreaterThan(Date.now());
    await prisma.emailCampaignRecipient.update({
      where: { id: recipient.id },
      data: { retryAt: null, reconcileAttemptCount: 7 },
    });
    expect(await reconcile(recipient)).toMatchObject({ exhausted: 1, failed: 1 });
    expect(await stored(recipient)).toMatchObject({
      status: "FAILED",
      reconcileAttemptCount: 8,
      retryAt: null,
    });
  });

  it("a late authoritative delivery corrects local reconciliation exhaustion", async () => {
    const recipient = await recipientFixture({ reconcileAttemptCount: 7 });
    provider.lookup.mockResolvedValue({ id: recipient.providerMessageId, last_event: "unknown" });
    await reconcile(recipient);
    expect((await stored(recipient)).status).toBe("FAILED");
    expect(await callback(recipient)).toMatchObject({ applied: true, status: "DELIVERED" });
    expect(await stored(recipient)).toMatchObject({
      status: "DELIVERED",
      failedAt: null,
      normalizedErrorCategory: "NONE",
      retryAt: null,
    });
  });

  it("poll observation time cannot discard a delayed complaint with an earlier provider timestamp", async () => {
    const recipient = await recipientFixture();
    provider.lookup.mockResolvedValue({ id: recipient.providerMessageId, last_event: "delivered" });
    await reconcile(recipient);
    expect(await callback(recipient, "email.complained")).toMatchObject({
      applied: true,
      status: "COMPLAINED",
    });
    expect(
      await prisma.emailMarketingSuppression.count({
        where: { organizationId: recipient.organizationId, email: recipient.email, active: true },
      }),
    ).toBe(1);
  });

  it.each(["unknown", "error"])(
    "preserves a completed callback while a stale %s lookup finishes",
    async (mode) => {
      const recipient = await recipientFixture();
      provider.lookup.mockImplementation(async () => {
        await callback(recipient);
        if (mode === "error") throw new TypeError("Synthetic lookup failure");
        return { id: recipient.providerMessageId, last_event: "unknown" };
      });
      await reconcile(recipient);
      expect(await stored(recipient)).toMatchObject({
        status: "DELIVERED",
        retryAt: null,
        providerReason: null,
        normalizedErrorCategory: "NONE",
        reconcileAttemptCount: 0,
      });
    },
  );

  it("expired-lease recovery cannot requeue a sender result committed after the scan", async () => {
    const recipient = await recipientFixture({
      status: "SENDING",
      providerMessageId: null,
      acceptedAt: null,
      sendLeaseExpiresAt: new Date(Date.now() - 1000),
      providerOperationStartedAt: new Date(),
    });
    afterScan = async () => {
      await prisma.emailCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "ACCEPTED",
          providerMessageId: `accepted-${randomUUID()}`,
          acceptedAt: new Date(),
          sendLeaseExpiresAt: null,
        },
      });
    };
    expect(await reconcile(recipient)).toMatchObject({ requeued: 0 });
    expect((await stored(recipient)).status).toBe("ACCEPTED");
    expect(provider.lookup).not.toHaveBeenCalled();
  });

  it("rejects a provider lookup response for a different message identity", async () => {
    const recipient = await recipientFixture();
    provider.lookup.mockResolvedValue({ id: "another-tenant-message", last_event: "delivered" });
    await reconcile(recipient);
    expect(await stored(recipient)).toMatchObject({
      status: "ACCEPTED",
      reconcileAttemptCount: 1,
      providerReason: "providerLookupIdentityMismatch",
    });
    expect(
      await prisma.emailCampaignRecipientEvent.count({ where: { recipientId: recipient.id } }),
    ).toBe(0);
  });

  it("deduplicates concurrent callbacks and rejects reuse of an event identity for another message", async () => {
    const recipient = await recipientFixture();
    const other = await recipientFixture({}, "b");
    const providerEventId = `evt-${randomUUID()}`;
    const eventAt = new Date();
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        callback(recipient, "email.bounced", { providerEventId, eventAt }),
      ),
    );
    expect(results.filter((result) => "applied" in result && result.applied)).toHaveLength(1);
    expect(await callback(other, "email.bounced", { providerEventId, eventAt })).toMatchObject({
      processed: false,
      reason: "event_identity_conflict",
    });
    expect((await stored(other)).status).toBe("ACCEPTED");
    expect(
      await prisma.emailCampaignRecipientEvent.count({ where: { recipientId: recipient.id } }),
    ).toBe(1);
    expect(
      await prisma.emailMarketingSuppression.count({
        where: { organizationId: other.organizationId },
      }),
    ).toBe(0);
  });

  it("rejects wrong campaign/store tags and does not reverse an authoritative terminal failure", async () => {
    const recipient = await recipientFixture();
    expect(
      await callback(recipient, "email.bounced", {
        payload: {
          data: {
            tags: { campaign_id: recipient.campaignId, store_id: fixture.tenants.b.stores[0].id },
          },
        },
      }),
    ).toMatchObject({ processed: false, reason: "scope_mismatch" });
    await callback(recipient, "email.bounced");
    expect(await callback(recipient, "email.delivered", { eventAt: new Date() })).toMatchObject({
      applied: false,
      ignoredReason: "terminal_state_regression",
    });
    expect((await stored(recipient)).status).toBe("BOUNCED");
  });

  it("rolls back callback, event, suppression and counters together on a summary failure, then safely retries", async () => {
    const recipient = await recipientFixture();
    const before = await stored(recipient);
    const event = { providerEventId: `evt-${randomUUID()}`, eventAt: new Date() };
    failCampaignUpdate = true;
    await expect(callback(recipient, "email.bounced", event)).rejects.toThrow(
      "Synthetic campaign summary commit failure",
    );
    expect(await stored(recipient)).toEqual(before);
    expect(
      await prisma.emailCampaignRecipientEvent.count({ where: { recipientId: recipient.id } }),
    ).toBe(0);
    expect(
      await prisma.emailMarketingSuppression.count({
        where: { organizationId: recipient.organizationId },
      }),
    ).toBe(0);
    expect(await callback(recipient, "email.bounced", event)).toMatchObject({ applied: true });
    expect(
      await prisma.emailCampaign.findUniqueOrThrow({ where: { id: recipient.campaignId } }),
    ).toMatchObject({ bouncedCount: 1, unresolvedCount: 0 });
  });

  it("rolls back expired-lease recovery if summary persistence fails, then retries from the original snapshot", async () => {
    const recipient = await recipientFixture({
      status: "SENDING",
      providerMessageId: null,
      acceptedAt: null,
      sendLeaseExpiresAt: new Date(Date.now() - 1000),
      providerOperationStartedAt: new Date(),
    });
    const before = await stored(recipient);
    failCampaignUpdate = true;
    await expect(reconcile(recipient)).rejects.toThrow("Synthetic campaign summary commit failure");
    expect(await stored(recipient)).toEqual(before);
    expect(await reconcile(recipient)).toMatchObject({ requeued: 1 });
    expect(
      await prisma.emailCampaign.findUniqueOrThrow({ where: { id: recipient.campaignId } }),
    ).toMatchObject({ status: "QUEUED", queuedCount: 1 });
  });

  it("does not rewrite campaign completion time when a later engagement is ignored", async () => {
    const recipient = await recipientFixture();
    await callback(recipient);
    const before = await prisma.emailCampaign.findUniqueOrThrow({
      where: { id: recipient.campaignId },
    });
    await callback(recipient, "email.opened", { eventAt: new Date() });
    expect(
      (await prisma.emailCampaign.findUniqueOrThrow({ where: { id: recipient.campaignId } }))
        .sentAt,
    ).toEqual(before.sentAt);
  });

  it("requests replay for a tagged callback before provider identity persistence and applies that replay once", async () => {
    const recipient = await recipientFixture({ status: "SENDING", providerMessageId: null });
    const providerMessageId = `synthetic-early-${randomUUID()}`;
    const input = {
      providerMessageId,
      providerEventId: `evt-${randomUUID()}`,
      eventAt: new Date(),
      payload: {
        data: {
          tags: { campaign_id: recipient.campaignId, store_id: fixture.tenants.a.stores[0].id },
        },
      },
    };
    expect(await callback(recipient, "email.delivered", input)).toMatchObject({
      processed: false,
      reason: "recipient_identity_pending",
    });
    expect(
      await prisma.emailCampaignRecipientEvent.count({ where: { recipientId: recipient.id } }),
    ).toBe(0);
    await prisma.emailCampaignRecipient.update({
      where: { id: recipient.id },
      data: { providerMessageId, status: "ACCEPTED" },
    });
    expect(await callback(recipient, "email.delivered", input)).toMatchObject({ applied: true });
    expect(await callback(recipient, "email.delivered", input)).toMatchObject({ duplicate: true });
    expect((await stored(recipient)).status).toBe("DELIVERED");
    expect(
      await callback(recipient, "email.delivered", { providerMessageId: "unrelated-message" }),
    ).toMatchObject({ processed: false, reason: "recipient_not_found" });
  });

  it("rejects inconsistent tenant ownership before lookup, suppression or summary changes", async () => {
    const recipient = await recipientFixture({ organizationId: fixture.tenants.b.org.id });
    const before = await prisma.emailCampaign.findUniqueOrThrow({
      where: { id: recipient.campaignId },
    });
    expect(
      await reconcileEmailCampaignRecipients({
        organizationId: fixture.tenants.b.org.id,
        campaignId: recipient.campaignId,
        stuckBefore: new Date(Date.now() + 60_000),
      }),
    ).toMatchObject({ inspected: 0 });
    expect(provider.lookup).not.toHaveBeenCalled();
    expect(await callback(recipient, "email.bounced")).toMatchObject({
      processed: false,
      reason: "recipient_organization_mismatch",
    });
    expect(
      await prisma.emailCampaign.findUniqueOrThrow({ where: { id: recipient.campaignId } }),
    ).toEqual(before);
    expect(
      await prisma.emailMarketingSuppression.count({
        where: {
          organizationId: { in: Object.values(fixture.tenants).map((tenant) => tenant.org.id) },
        },
      }),
    ).toBe(0);
  });

  it("honors rate-limit Retry-After and treats a missing provider message as locally unknown until an authoritative callback", async () => {
    const recipient = await recipientFixture();
    provider.lookup.mockRejectedValueOnce(new provider.Error(429, "rate limited", 720_000));
    const started = Date.now();
    expect(await reconcile(recipient)).toMatchObject({ deferred: 1 });
    const limited = await stored(recipient);
    expect(limited).toMatchObject({
      status: "ACCEPTED",
      reconcileAttemptCount: 1,
      normalizedErrorCategory: "RATE_LIMIT",
    });
    expect(limited.retryAt!.getTime()).toBeGreaterThanOrEqual(started + 720_000);
    expect(await reconcile(recipient)).toMatchObject({ inspected: 0 });
    expect(provider.lookup).toHaveBeenCalledTimes(1);
    await prisma.emailCampaignRecipient.update({
      where: { id: recipient.id },
      data: { retryAt: null },
    });
    provider.lookup.mockRejectedValueOnce(new provider.Error(404, "not found"));
    expect(await reconcile(recipient)).toMatchObject({ failed: 1 });
    expect(await stored(recipient)).toMatchObject({
      status: "FAILED",
      lastProviderEvent: "reconciliation.failed",
      providerReason: "providerMessageNotFound",
    });
    expect(await callback(recipient, "email.bounced")).toMatchObject({
      applied: true,
      status: "BOUNCED",
    });
    expect(
      await prisma.emailMarketingSuppression.count({
        where: { organizationId: recipient.organizationId, email: recipient.email },
      }),
    ).toBe(1);
  });

  it("two overlapping lookups commit only one reconciliation attempt for the scanned version", async () => {
    const recipient = await recipientFixture();
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    let lookups = 0;
    provider.lookup.mockImplementation(async () => {
      if (++lookups === 2) release();
      await bothStarted;
      return { id: recipient.providerMessageId, last_event: "sent" };
    });
    const results = await Promise.all([reconcile(recipient), reconcile(recipient)]);
    expect(results.reduce((sum, result) => sum + result.reconciled, 0)).toBe(1);
    expect(await stored(recipient)).toMatchObject({ status: "ACCEPTED", reconcileAttemptCount: 1 });
    expect(
      await prisma.emailCampaignRecipientEvent.count({ where: { recipientId: recipient.id } }),
    ).toBe(1);
  });
});
