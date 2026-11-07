import { randomUUID } from "node:crypto";
import type { Prisma, EmailCampaignRecipient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createContractTerms } from "@/server/billing/contractTerms";
import {
  reserveSubscriptionUsageBatch,
  startSubscriptionUsageBatch,
  getSubscriptionUsage,
  holdUncertainSubscriptionUsageBatch,
} from "@/server/billing/subscriptionUsage";
import {
  createEmailSenderIdentity,
  updateEmailAutomation,
  cancelEmailCampaignQueuedRecipients,
  deliverPendingEmailCampaigns,
  listEmailSenderSetup,
} from "@/server/services/emailMarketing";
import { processEmailProviderRecipientEvent } from "@/server/services/emailCampaignDeliveryState";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

async function modern(plan: "BUSINESS" | "ENTERPRISE" = "BUSINESS", secondStore = false) {
  const f = await seedBase({ plan });
  // Existing stores are retained on a contract transition; this fixture needs
  // two store scopes to verify one domain is safely shared inside an org.
  const other = secondStore
    ? await prisma.store.create({
        data: { organizationId: f.org.id, name: "Other", code: "OTHER" },
      })
    : null;
  await prisma.user.updateMany({
    where: { organizationId: f.org.id, id: { not: f.adminUser.id } },
    data: { isActive: false },
  });
  await prisma.organization.update({
    where: { id: f.org.id },
    data: { currentPeriodEndsAt: new Date(Date.now() + 365 * 86400000) },
  });
  await prisma.subscriptionContract.create({
    data: {
      organizationId: f.org.id,
      catalogVersion: "2026-11",
      termsSnapshot: createContractTerms("2026-11"),
    },
  });
  return { ...f, other };
}
const user = (f: Awaited<ReturnType<typeof modern>>) => ({
  id: f.adminUser.id,
  organizationId: f.org.id,
  role: "ADMIN" as const,
  isOrgOwner: true,
});
const sender = (f: Awaited<ReturnType<typeof modern>>, fromEmail: string, storeId = f.store.id) =>
  createEmailSenderIdentity({
    user: user(f),
    actorId: f.adminUser.id,
    requestId: randomUUID(),
    storeId,
    displayName: "Merchant",
    fromEmail,
  });
const usage = async (id: string) =>
  (await getSubscriptionUsage(id)).find((row) => row.resource === "marketingEmails")!;
async function campaign(f: Awaited<ReturnType<typeof modern>>, count = 1) {
  const c = await prisma.emailCampaign.create({
    data: {
      organizationId: f.org.id,
      storeId: f.store.id,
      name: "Quota mail",
      subject: "Hello",
      body: "Hello",
      blocksJson: [{ id: "body", type: "text", body: "Hello" }],
      status: "QUEUED",
      recipientCount: count,
      queuedCount: count,
      unresolvedCount: count,
    },
  });
  const recipients: EmailCampaignRecipient[] = [];
  for (let i = 0; i < count; i++) {
    const customer = await prisma.customer.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        name: `Recipient ${i}`,
        email: `recipient-${i}@example.com`,
      },
    });
    recipients.push(
      await prisma.emailCampaignRecipient.create({
        data: {
          organizationId: f.org.id,
          campaignId: c.id,
          customerId: customer.id,
          email: customer.email!,
          sendOperationKey: randomUUID(),
          status: "QUEUED",
        },
      }),
    );
  }
  await prisma.$transaction((tx) =>
    reserveSubscriptionUsageBatch(
      {
        organizationId: f.org.id,
        resource: "marketingEmails",
        operationKeys: recipients.map((r) => `email:${r.id}`),
      },
      tx,
    ),
  );
  return { campaign: c, recipients };
}

(shouldRunDbTests ? describe : describe.skip)(
  "commercial email delivery and sender boundaries",
  () => {
    beforeEach(async () => {
      await resetDatabase();
      vi.stubEnv("EMAIL_PROVIDER", "resend");
      vi.stubEnv("RESEND_API_KEY", "re_synthetic_no_network");
      vi.stubEnv("NEXTAUTH_URL", "https://bazaar.example.test");
      vi.stubEnv("NEXTAUTH_SECRET", "synthetic-email-quota-test");
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    });
    it("rejects Business custom sender and active automation before any provider operation", async () => {
      const f = await modern();
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("network must not run"));
      await expect(sender(f, "hello@merchant.kg")).rejects.toThrow("featureLockedPlan");
      const automation = await prisma.emailAutomation.create({
        data: {
          organizationId: f.org.id,
          storeId: f.store.id,
          trigger: "ORDER_CREATED",
          name: "Order",
          subject: "Order",
          status: "PAUSED",
        },
      });
      await expect(
        updateEmailAutomation({
          user: user(f),
          actorId: f.adminUser.id,
          requestId: randomUUID(),
          automationId: automation.id,
          status: "ACTIVE",
        }),
      ).rejects.toThrow("featureLockedPlan");
      expect(fetch).not.toHaveBeenCalled();
      expect(
        (await listEmailSenderSetup({ user: user(f), storeId: f.store.id })).defaultSender
          ?.fromEmail,
      ).toContain("bazaar");
    });
    it("reserves Bazaar domains and holds a chosen merchant domain after an unknown provider outcome", async () => {
      const f = await modern("ENTERPRISE");
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new TypeError("synthetic network timeout"));
      await expect(sender(f, "hello@notify.bazaar.kg")).rejects.toThrow(
        "emailSenderReservedDomain",
      );
      expect(fetch).not.toHaveBeenCalled();
      await expect(sender(f, "hello@merchant.kg")).rejects.toThrow();
      expect(
        (
          await prisma.subscriptionContract.findUniqueOrThrow({
            where: { organizationId: f.org.id },
          })
        ).selectedSenderDomain,
      ).toBe("merchant.kg");
      const calls = fetch.mock.calls.length;
      await expect(sender(f, "hello@another.kg")).rejects.toThrow("emailSenderDomainLimitReached");
      expect(fetch).toHaveBeenCalledTimes(calls);
    });
    it("reuses one verified provider domain across stores and makes same-domain retries idempotent", async () => {
      const f = await modern("ENTERPRISE", true);
      const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "synthetic-domain",
            name: "merchant.kg",
            status: "verified",
            records: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      const a = await sender(f, "hello@merchant.kg");
      const retry = await sender(f, "hello@merchant.kg");
      const b = await sender(f, "other@merchant.kg", f.other!.id);
      expect(retry.id).toBe(a.id);
      expect(b.domainId).toBe(a.domainId);
      expect(await prisma.emailSenderDomain.count({ where: { organizationId: f.org.id } })).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      const setup = await listEmailSenderSetup({ user: user(f), storeId: f.other!.id });
      expect(setup.primarySenderId).toBe(b.id);
      expect(setup.domains).toHaveLength(1);
    });
    it("cancels only known unsubmitted recipients and retains unknown retry allowance", async () => {
      const f = await modern();
      const c = await campaign(f, 2);
      const unknown = c.recipients[1];
      await prisma.emailCampaignRecipient.update({
        where: { id: unknown.id },
        data: {
          providerOperationKey: "synthetic-unknown",
          normalizedErrorCategory: "UNKNOWN",
          attemptCount: 1,
        },
      });
      await startSubscriptionUsageBatch({
        organizationId: f.org.id,
        resource: "marketingEmails",
        operationKeys: [`email:${unknown.id}`],
      });
      const result = await cancelEmailCampaignQueuedRecipients({
        user: user(f),
        actorId: f.adminUser.id,
        requestId: randomUUID(),
        campaignId: c.campaign.id,
      });
      expect(result).toMatchObject({ cancelled: 1, awaitingReview: 1 });
      expect(await usage(f.org.id)).toMatchObject({ used: 0, reserved: 1 });
      expect(
        (await prisma.emailCampaignRecipient.findUniqueOrThrow({ where: { id: unknown.id } }))
          .status,
      ).toBe("QUEUED");
    });
    it("holds quota after provider ACK plus database rollback, then replays the same provider key", async () => {
      const f = await modern();
      const c = await campaign(f);
      const keys: string[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        keys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
        return new Response(JSON.stringify({ data: [{ id: "synthetic-message" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
      const original = prisma.$transaction.bind(prisma);
      let injected = false;
      const intercepted = ((arg: unknown, options?: { maxWait?: number; timeout?: number }) => {
        if (Array.isArray(arg)) return original(arg);
        const run = arg as (tx: Prisma.TransactionClient) => Promise<unknown>;
        return original(
          async (tx) =>
            run(
              new Proxy(tx, {
                get(target, key, receiver) {
                  if (key !== "subscriptionUsageReservation")
                    return Reflect.get(target, key, receiver);
                  return new Proxy(target.subscriptionUsageReservation, {
                    get(delegate, method, delegateReceiver) {
                      if (method !== "updateMany")
                        return Reflect.get(delegate, method, delegateReceiver);
                      return (args: Prisma.SubscriptionUsageReservationUpdateManyArgs) => {
                        if (!injected && args.data.state === "COMMITTED") {
                          injected = true;
                          throw new Error("synthetic ACK commit failure");
                        }
                        return delegate.updateMany(args);
                      };
                    },
                  });
                },
              }),
            ),
          options,
        );
      }) as typeof prisma.$transaction;
      vi.spyOn(prisma, "$transaction").mockImplementation(intercepted);
      await deliverPendingEmailCampaigns({
        organizationId: f.org.id,
        campaignId: c.campaign.id,
        maxBatches: 1,
      });
      expect(injected).toBe(true);
      expect(await usage(f.org.id)).toMatchObject({ used: 0, reserved: 1 });
      const held = await prisma.subscriptionUsageReservation.findFirstOrThrow({
        where: { organizationId: f.org.id, resource: "marketingEmails" },
        include: { bucket: true },
      });
      expect(held.expiresAt.getTime()).toBeGreaterThanOrEqual(
        held.bucket.endsAt.getTime() + 7 * 86400000,
      );
      await startSubscriptionUsageBatch({
        organizationId: f.org.id,
        resource: "marketingEmails",
        operationKeys: [`email:${c.recipients[0].id}`],
      });
      expect(
        (
          await prisma.subscriptionUsageReservation.findUniqueOrThrow({ where: { id: held.id } })
        ).expiresAt.getTime(),
      ).toBeGreaterThanOrEqual(held.expiresAt.getTime());
      await prisma.emailCampaignRecipient.update({
        where: { id: c.recipients[0].id },
        data: { retryAt: new Date(0) },
      });
      await deliverPendingEmailCampaigns({
        organizationId: f.org.id,
        campaignId: c.campaign.id,
        maxBatches: 1,
      });
      expect(keys).toHaveLength(2);
      expect(keys[0]).toBeTruthy();
      expect(keys[1]).toBe(keys[0]);
      expect(await usage(f.org.id)).toMatchObject({ used: 1, reserved: 0 });
    });
    it("settles held allowance on authoritative provider acceptance and never refunds a later bounce", async () => {
      const f = await modern();
      const c = await campaign(f);
      const recipient = c.recipients[0];
      await startSubscriptionUsageBatch({
        organizationId: f.org.id,
        resource: "marketingEmails",
        operationKeys: [`email:${recipient.id}`],
      });
      await holdUncertainSubscriptionUsageBatch({
        organizationId: f.org.id,
        operationKeys: [`email:${recipient.id}`],
      });
      await prisma.emailCampaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "SENDING", providerMessageId: "synthetic-held" },
      });
      await processEmailProviderRecipientEvent({
        provider: "resend",
        providerMessageId: "synthetic-held",
        providerEventId: "sent-1",
        eventType: "email.sent",
        eventAt: new Date(),
      });
      expect(await usage(f.org.id)).toMatchObject({ used: 1, reserved: 0 });
      await processEmailProviderRecipientEvent({
        provider: "resend",
        providerMessageId: "synthetic-held",
        providerEventId: "bounce-2",
        eventType: "email.bounced",
        eventAt: new Date(Date.now() + 1000),
      });
      expect(await usage(f.org.id)).toMatchObject({ used: 1, reserved: 0 });
    });
    it("releases only definitively rejected preaccept provider attempts", async () => {
      const f = await modern();
      const c = await campaign(f);
      const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ message: "invalid sender" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      );
      await deliverPendingEmailCampaigns({
        organizationId: f.org.id,
        campaignId: c.campaign.id,
        maxBatches: 1,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(await usage(f.org.id)).toMatchObject({ used: 0, reserved: 0 });
      expect(
        (
          await prisma.emailCampaignRecipient.findUniqueOrThrow({
            where: { id: c.recipients[0].id },
          })
        ).status,
      ).toBe("FAILED");
    });
    it("fails only the claimed batch and releases its unused allowance on a configuration error", async () => {
      const f = await modern();
      const c = await campaign(f);
      for (const key of ["NEXTAUTH_URL", "NEXT_PUBLIC_APP_URL", "APP_URL", "VERCEL_URL"])
        vi.stubEnv(key, "");
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("provider must not run"));
      await deliverPendingEmailCampaigns({
        organizationId: f.org.id,
        campaignId: c.campaign.id,
        maxBatches: 1,
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(await usage(f.org.id)).toMatchObject({ used: 0, reserved: 0 });
      expect(
        (
          await prisma.emailCampaignRecipient.findUniqueOrThrow({
            where: { id: c.recipients[0].id },
          })
        ).normalizedErrorCategory,
      ).toBe("CONFIGURATION");
    });
  },
);
