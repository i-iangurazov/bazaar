import { beforeEach, describe, expect, it } from "vitest";
import {
  CustomerSource,
  EmailCampaignRecipientStatus,
  EmailCampaignStatus,
  EmailSenderDomainStatus,
  EmailSenderIdentityStatus,
  Role,
} from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { runJob } from "@/server/jobs";
import { EMAIL_CAMPAIGN_SEND_JOB_NAME } from "@/server/jobs/emailMarketing";
import { MARKETING_EMAIL_FROM } from "@/server/services/email";
import {
  countEmailReachableCustomers,
  runCustomerImport,
} from "@/server/services/customers";
import {
  buildEmailUnsubscribeUrl,
  deliverPendingEmailCampaigns,
  handleResendEmailWebhook,
  listEmailSenderSetup,
  previewEmailCampaign,
  sendEmailCampaignToAudience,
  unsubscribeCustomerFromEmailMarketing,
} from "@/server/services/emailMarketing";
import { createBazaarApiOrder } from "@/server/services/bazaarApi";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const asCallerUser = (user: {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
  isOrgOwner?: boolean | null;
}) => {
  if (!user.organizationId) {
    throw new Error("test user must belong to an organization");
  }
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    isOrgOwner: Boolean(user.isOrgOwner),
  };
};

describeDb("customer database", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("enforces role and store scope for customer CRUD", async () => {
    const { org, store, adminUser, managerUser, cashierUser } = await seedBase({
      plan: "BUSINESS",
    });
    const otherStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Second Store",
        code: "S2",
      },
    });
    await prisma.userStoreAccess.createMany({
      data: [{ organizationId: org.id, userId: managerUser.id, storeId: store.id }],
      skipDuplicates: true,
    });

    const adminCaller = createTestCaller(asCallerUser(adminUser));
    const managerCaller = createTestCaller(asCallerUser(managerUser));
    const cashierCaller = createTestCaller(asCallerUser(cashierUser));

    await adminCaller.customers.create({
      storeId: store.id,
      name: "Store A Customer",
      email: "MixedCase@Example.COM",
      phone: null,
      address: "A address",
    });
    await adminCaller.customers.create({
      storeId: otherStore.id,
      name: "Store B Customer",
      email: "mixedcase@example.com",
      phone: null,
      address: "B address",
    });

    const storeA = await managerCaller.customers.list({ storeId: store.id, page: 1, pageSize: 25 });
    expect(storeA.total).toBe(1);
    expect(storeA.items[0]).toMatchObject({
      storeId: store.id,
      email: "mixedcase@example.com",
      address: "A address",
    });

    await expect(
      managerCaller.customers.list({ storeId: otherStore.id, page: 1, pageSize: 25 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      cashierCaller.customers.list({ storeId: store.id, page: 1, pageSize: 25 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("imports customers with store-scoped dedupe and isolated visibility", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const otherStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Other Store",
        code: "OTH",
      },
    });
    const user = asCallerUser(adminUser);

    await prisma.customer.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Existing",
        email: "existing@example.com",
        source: CustomerSource.MANUAL,
      },
    });
    await prisma.customer.create({
      data: {
        organizationId: org.id,
        storeId: otherStore.id,
        name: "Other Store Existing",
        email: "other@example.com",
        source: CustomerSource.MANUAL,
      },
    });

    const result = await runCustomerImport({
      user,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "customer-import-1",
      source: "csv",
      rows: [
        { rowNumber: 2, name: "Existing Updated", email: "existing@example.com", phone: "+996 700 000 001" },
        { rowNumber: 3, name: "New Customer", email: "new@example.com", phone: "" },
        { rowNumber: 4, name: "Other Store Copy", email: "other@example.com", phone: "" },
        { rowNumber: 5, name: "", email: "bad@example.com", phone: "" },
        { rowNumber: 6, name: "Duplicate In File", email: "new@example.com", phone: "" },
        {
          rowNumber: 7,
          name: "Duplicate Phone In File",
          email: "phone-duplicate@example.com",
          phone: "+996 700 000 001",
        },
      ],
    });

    expect(result.summary).toMatchObject({
      rows: 6,
      created: 3,
      updated: 1,
      skipped: 2,
      errors: 2,
    });

    const storeCustomers = await prisma.customer.findMany({
      where: { organizationId: org.id, storeId: store.id, deletedAt: null },
      orderBy: { email: "asc" },
    });
    const otherStoreCustomers = await prisma.customer.findMany({
      where: { organizationId: org.id, storeId: otherStore.id, deletedAt: null },
    });

    expect(storeCustomers.map((customer) => customer.email)).toEqual([
      "bad@example.com",
      "existing@example.com",
      "new@example.com",
      "other@example.com",
    ]);
    expect(storeCustomers.find((customer) => customer.email === "existing@example.com")?.phone).toBe(
      "+996700000001",
    );
    expect(otherStoreCustomers).toHaveLength(1);
    expect(otherStoreCustomers[0]).toMatchObject({
      email: "other@example.com",
      name: "Other Store Existing",
    });
    expect(storeCustomers.find((customer) => customer.email === "other@example.com")).toMatchObject({
      storeId: store.id,
      name: "Other Store Copy",
    });
  });

  it("auto-creates store-local customers from manual and bazaar API orders", async () => {
    const { org, store, product, adminUser } = await seedBase();
    const otherStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Second Store",
        code: "S2",
      },
    });
    const caller = createTestCaller(asCallerUser(adminUser));

    await caller.salesOrders.createDraft({
      storeId: store.id,
      customerName: "Email Customer",
      customerEmail: "Customer@Example.COM",
      customerPhone: null,
      customerAddress: "Bishkek, Chui 1",
    });
    await caller.salesOrders.createDraft({
      storeId: store.id,
      customerName: "Phone Customer",
      customerEmail: null,
      customerPhone: "+996 555 123 123",
    });
    await caller.salesOrders.createDraft({
      storeId: otherStore.id,
      customerName: "Other Store Same Email",
      customerEmail: "customer@example.com",
      customerPhone: null,
    });
    await caller.salesOrders.createDraft({
      storeId: store.id,
      customerName: "No Contact",
      customerEmail: null,
      customerPhone: null,
    });
    await createBazaarApiOrder({
      organizationId: org.id,
      storeId: store.id,
      customerName: "API Customer",
      customerEmail: "api@example.com",
      customerPhone: "+996 555 222 333",
      customerAddress: "Osh, Lenin 2",
      lines: [{ productId: product.id, qty: 1 }],
    });

    const storeCustomers = await prisma.customer.findMany({
      where: { organizationId: org.id, storeId: store.id },
      orderBy: { email: "asc" },
    });
    const otherStoreCustomers = await prisma.customer.findMany({
      where: { organizationId: org.id, storeId: otherStore.id },
    });

    expect(storeCustomers.map((customer) => customer.email).filter(Boolean)).toEqual([
      "api@example.com",
      "customer@example.com",
    ]);
    expect(storeCustomers.some((customer) => customer.phone === "+996555123123")).toBe(true);
    expect(storeCustomers.find((customer) => customer.email === "customer@example.com")?.address).toBe(
      "Bishkek, Chui 1",
    );
    expect(storeCustomers.find((customer) => customer.email === "api@example.com")?.address).toBe(
      "Osh, Lenin 2",
    );
    expect(storeCustomers.every((customer) => customer.source === CustomerSource.ORDER)).toBe(true);
    expect(otherStoreCustomers).toHaveLength(1);
    expect(otherStoreCustomers[0]).toMatchObject({
      storeId: otherStore.id,
      email: "customer@example.com",
      name: "Other Store Same Email",
      source: CustomerSource.ORDER,
    });
    expect(otherStoreCustomers[0]?.id).not.toBe(
      storeCustomers.find((customer) => customer.email === "customer@example.com")?.id,
    );
  });

  it("uses a verified custom sender as the only primary sender instead of the Bazaar fallback", async () => {
    const previousEmailFrom = process.env.EMAIL_FROM;
    const previousEmailProvider = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_FROM = MARKETING_EMAIL_FROM;
    process.env.EMAIL_PROVIDER = "log";

    try {
      const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
      const user = asCallerUser(adminUser);

      const fallbackSetup = await listEmailSenderSetup({ user, storeId: store.id });
      expect(fallbackSetup.defaultSender?.fromEmail).toBe(MARKETING_EMAIL_FROM);
      expect(fallbackSetup.primarySenderId).toBeNull();

      const fallbackPreview = await previewEmailCampaign({
        user,
        campaign: {
          storeId: store.id,
          source: "ALL",
          subject: "Store update",
          body: "New stock is available.",
          brandColor: "#111827",
          buttonColor: "#111827",
        },
      });
      expect(fallbackPreview.from).toBe(MARKETING_EMAIL_FROM);

      const pendingDomain = await prisma.emailSenderDomain.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          domain: "pendingdomain.com",
          status: EmailSenderDomainStatus.PENDING,
          recordsJson: [],
        },
      });
      const pendingSender = await prisma.emailSenderIdentity.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          domainId: pendingDomain.id,
          displayName: "Pending Domain",
          fromEmail: "no-reply@pendingdomain.com",
          status: EmailSenderIdentityStatus.PENDING,
        },
      });
      const pendingSetup = await listEmailSenderSetup({ user, storeId: store.id });
      expect(pendingSetup.defaultSender?.fromEmail).toBe(MARKETING_EMAIL_FROM);
      expect(pendingSetup.primarySenderId).toBeNull();
      expect(pendingSetup.senders.map((item) => item.id)).toContain(pendingSender.id);

      const pendingPreview = await previewEmailCampaign({
        user,
        campaign: {
          storeId: store.id,
          source: "ALL",
          subject: "Store update",
          body: "New stock is available.",
          senderIdentityId: pendingSender.id,
          brandColor: "#111827",
          buttonColor: "#111827",
        },
      });
      expect(pendingPreview.from).toBe(MARKETING_EMAIL_FROM);

      const domain = await prisma.emailSenderDomain.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          domain: "clientdomain.com",
          status: EmailSenderDomainStatus.VERIFIED,
          verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
          recordsJson: [],
        },
      });
      const sender = await prisma.emailSenderIdentity.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          domainId: domain.id,
          displayName: "Client Domain",
          fromEmail: "no-reply@clientdomain.com",
          replyToEmail: "support@clientdomain.com",
          status: EmailSenderIdentityStatus.VERIFIED,
        },
      });

      const customSetup = await listEmailSenderSetup({ user, storeId: store.id });
      expect(customSetup.defaultSender).toBeNull();
      expect(customSetup.primarySenderId).toBe(sender.id);
      expect(customSetup.senders.map((item) => item.id)).toEqual([sender.id]);

      const customPreview = await previewEmailCampaign({
        user,
        campaign: {
          storeId: store.id,
          source: "ALL",
          subject: "Store update",
          body: "New stock is available.",
          senderIdentityId: null,
          brandColor: "#111827",
          buttonColor: "#111827",
        },
      });
      expect(customPreview.from).toBe("no-reply@clientdomain.com");
      expect(customPreview.sender?.from).toBe("Client Domain <no-reply@clientdomain.com>");
    } finally {
      if (previousEmailFrom === undefined) {
        delete process.env.EMAIL_FROM;
      } else {
        process.env.EMAIL_FROM = previousEmailFrom;
      }
      if (previousEmailProvider === undefined) {
        delete process.env.EMAIL_PROVIDER;
      } else {
        process.env.EMAIL_PROVIDER = previousEmailProvider;
      }
    }
  });

  it("builds email audiences from selected-store customers with email and sends from fixed sender", async () => {
    const previousEmailFrom = process.env.EMAIL_FROM;
    const previousEmailProvider = process.env.EMAIL_PROVIDER;
    const previousNextAuthUrl = process.env.NEXTAUTH_URL;
    const previousNextAuthSecret = process.env.NEXTAUTH_SECRET;
    process.env.EMAIL_FROM = MARKETING_EMAIL_FROM;
    process.env.EMAIL_PROVIDER = "log";
    process.env.NEXTAUTH_URL = "https://app.bazaar.test";
    process.env.NEXTAUTH_SECRET = "test-nextauth-secret";

    try {
      const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
      const otherStore = await prisma.store.create({
        data: {
          organizationId: org.id,
          name: "Other Store",
          code: "OTH",
        },
      });
      const user = asCallerUser(adminUser);
      await prisma.customer.createMany({
        data: [
          {
            organizationId: org.id,
            storeId: store.id,
            name: "Email One",
            email: "one@example.com",
            source: CustomerSource.MANUAL,
          },
          {
            organizationId: org.id,
            storeId: store.id,
            name: "Phone Only",
            phone: "+996 500 000 000",
            source: CustomerSource.MANUAL,
          },
          {
            organizationId: org.id,
            storeId: otherStore.id,
            name: "Other Store",
            email: "other@example.com",
            source: CustomerSource.MANUAL,
          },
        ],
      });

      await expect(
        countEmailReachableCustomers({ user, storeId: store.id, source: "ALL" }),
      ).resolves.toBe(1);

      const preview = await previewEmailCampaign({
        user,
        campaign: {
          storeId: store.id,
          source: "ALL",
          subject: "Store update",
          body: "New stock is available.",
          brandColor: "#111827",
          buttonColor: "#111827",
        },
      });
      expect(preview.from).toBe(MARKETING_EMAIL_FROM);
      expect(preview.reachableCustomers).toBe(1);
      expect(preview.rendered.text).toContain("New stock is available.");

      const queued = await sendEmailCampaignToAudience({
        user,
        actorId: adminUser.id,
        requestId: "email-campaign-1",
        campaign: {
          storeId: store.id,
          source: "ALL",
          subject: "Store update",
          body: "New stock is available.",
          brandColor: "#111827",
          buttonColor: "#111827",
        },
      });

      expect(queued).toMatchObject({
        queued: true,
        sent: 0,
        failed: 0,
        recipientCount: 1,
        from: MARKETING_EMAIL_FROM,
      });
      expect(queued.campaign.status).toBe(EmailCampaignStatus.SENDING);

      await expect(runJob(EMAIL_CAMPAIGN_SEND_JOB_NAME, { organizationId: org.id })).resolves.toMatchObject({
        status: "ok",
      });

      const sent = await prisma.emailCampaign.findUniqueOrThrow({
        where: { id: queued.campaign.id },
        include: {
          recipients: {
            select: { email: true, status: true },
          },
        },
      });
      expect(sent.status).toBe(EmailCampaignStatus.SENT);
      expect(sent.recipients[0]?.email).toBe("one@example.com");
      expect(sent.recipients[0]?.status).toBe(EmailCampaignRecipientStatus.SENT);

      const recipientText = await prisma.emailCampaignRecipient.findFirstOrThrow({
        where: { campaignId: queued.campaign.id },
        select: { customerId: true, email: true },
      });
      const unsubscribeUrl = new URL(
        buildEmailUnsubscribeUrl({
          baseUrl: "https://app.bazaar.test",
          customerId: recipientText.customerId,
          email: recipientText.email,
        }),
      );
      await expect(
        unsubscribeCustomerFromEmailMarketing({
          customerId: unsubscribeUrl.searchParams.get("customerId") ?? "",
          email: unsubscribeUrl.searchParams.get("email") ?? "",
          token: unsubscribeUrl.searchParams.get("token") ?? "",
        }),
      ).resolves.toMatchObject({ status: "unsubscribed", email: "one@example.com" });
      await expect(
        unsubscribeCustomerFromEmailMarketing({
          customerId: unsubscribeUrl.searchParams.get("customerId") ?? "",
          email: unsubscribeUrl.searchParams.get("email") ?? "",
          token: unsubscribeUrl.searchParams.get("token") ?? "",
        }),
      ).resolves.toMatchObject({ status: "already_unsubscribed", email: "one@example.com" });
      await expect(
        unsubscribeCustomerFromEmailMarketing({
          customerId: recipientText.customerId,
          email: recipientText.email,
          token: "invalid",
        }),
      ).rejects.toMatchObject({ message: "apiUnauthorized" });
      await expect(
        countEmailReachableCustomers({ user, storeId: store.id, source: "ALL" }),
      ).resolves.toBe(0);
    } finally {
      if (previousEmailFrom === undefined) {
        delete process.env.EMAIL_FROM;
      } else {
        process.env.EMAIL_FROM = previousEmailFrom;
      }
      if (previousEmailProvider === undefined) {
        delete process.env.EMAIL_PROVIDER;
      } else {
        process.env.EMAIL_PROVIDER = previousEmailProvider;
      }
      if (previousNextAuthUrl === undefined) {
        delete process.env.NEXTAUTH_URL;
      } else {
        process.env.NEXTAUTH_URL = previousNextAuthUrl;
      }
      if (previousNextAuthSecret === undefined) {
        delete process.env.NEXTAUTH_SECRET;
      } else {
        process.env.NEXTAUTH_SECRET = previousNextAuthSecret;
      }
    }
  });

  it("delivers email campaigns in resumable batches instead of leaving them stuck sending", async () => {
    const previousEmailFrom = process.env.EMAIL_FROM;
    const previousEmailProvider = process.env.EMAIL_PROVIDER;
    const previousNextAuthUrl = process.env.NEXTAUTH_URL;
    const previousNextAuthSecret = process.env.NEXTAUTH_SECRET;
    process.env.EMAIL_FROM = MARKETING_EMAIL_FROM;
    process.env.EMAIL_PROVIDER = "log";
    process.env.NEXTAUTH_URL = "https://app.bazaar.test";
    process.env.NEXTAUTH_SECRET = "test-nextauth-secret";

    try {
      const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
      const user = asCallerUser(adminUser);
      await prisma.customer.createMany({
        data: ["one@example.com", "two@example.com", "three@example.com"].map((email, index) => ({
          organizationId: org.id,
          storeId: store.id,
          name: `Batch Customer ${index + 1}`,
          email,
          source: CustomerSource.MANUAL,
        })),
      });

      const queued = await sendEmailCampaignToAudience({
        user,
        actorId: adminUser.id,
        requestId: "email-campaign-batch-queue",
        campaign: {
          storeId: store.id,
          source: "ALL",
          subject: "Batch update",
          body: "New stock is available.",
          brandColor: "#111827",
          buttonColor: "#111827",
        },
      });

      const firstBatch = await deliverPendingEmailCampaigns({
        organizationId: org.id,
        campaignId: queued.campaign.id,
        batchSize: 2,
        maxBatches: 1,
      });
      expect(firstBatch).toMatchObject({
        processed: 1,
        sent: 2,
        failed: 0,
        pending: 1,
      });
      await expect(
        prisma.emailCampaign.findUniqueOrThrow({ where: { id: queued.campaign.id } }),
      ).resolves.toMatchObject({
        status: EmailCampaignStatus.SENDING,
        sentCount: 2,
        failedCount: 0,
      });

      const secondBatch = await deliverPendingEmailCampaigns({
        organizationId: org.id,
        campaignId: queued.campaign.id,
        batchSize: 2,
        maxBatches: 1,
      });
      expect(secondBatch).toMatchObject({
        processed: 1,
        sent: 1,
        failed: 0,
        pending: 0,
      });
      await expect(
        prisma.emailCampaign.findUniqueOrThrow({ where: { id: queued.campaign.id } }),
      ).resolves.toMatchObject({
        status: EmailCampaignStatus.SENT,
        sentCount: 3,
        failedCount: 0,
      });
    } finally {
      if (previousEmailFrom === undefined) {
        delete process.env.EMAIL_FROM;
      } else {
        process.env.EMAIL_FROM = previousEmailFrom;
      }
      if (previousEmailProvider === undefined) {
        delete process.env.EMAIL_PROVIDER;
      } else {
        process.env.EMAIL_PROVIDER = previousEmailProvider;
      }
      if (previousNextAuthUrl === undefined) {
        delete process.env.NEXTAUTH_URL;
      } else {
        process.env.NEXTAUTH_URL = previousNextAuthUrl;
      }
      if (previousNextAuthSecret === undefined) {
        delete process.env.NEXTAUTH_SECRET;
      } else {
        process.env.NEXTAUTH_SECRET = previousNextAuthSecret;
      }
    }
  });

  it("drains queued email campaigns autonomously across multiple batches by default", async () => {
    const previousEmailFrom = process.env.EMAIL_FROM;
    const previousEmailProvider = process.env.EMAIL_PROVIDER;
    const previousNextAuthUrl = process.env.NEXTAUTH_URL;
    const previousNextAuthSecret = process.env.NEXTAUTH_SECRET;
    process.env.EMAIL_FROM = MARKETING_EMAIL_FROM;
    process.env.EMAIL_PROVIDER = "log";
    process.env.NEXTAUTH_URL = "https://app.bazaar.test";
    process.env.NEXTAUTH_SECRET = "test-nextauth-secret";

    try {
      const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
      const user = asCallerUser(adminUser);
      await prisma.customer.createMany({
        data: ["one@example.com", "two@example.com", "three@example.com"].map((email, index) => ({
          organizationId: org.id,
          storeId: store.id,
          name: `Auto Batch Customer ${index + 1}`,
          email,
          source: CustomerSource.MANUAL,
        })),
      });

      const queued = await sendEmailCampaignToAudience({
        user,
        actorId: adminUser.id,
        requestId: "email-campaign-auto-batch-queue",
        campaign: {
          storeId: store.id,
          source: "ALL",
          subject: "Auto batch update",
          body: "New stock is available.",
          brandColor: "#111827",
          buttonColor: "#111827",
        },
      });

      const delivery = await deliverPendingEmailCampaigns({
        organizationId: org.id,
        campaignId: queued.campaign.id,
        batchSize: 2,
      });
      expect(delivery).toMatchObject({
        processed: 2,
        sent: 3,
        failed: 0,
        pending: 0,
      });
      await expect(
        prisma.emailCampaign.findUniqueOrThrow({ where: { id: queued.campaign.id } }),
      ).resolves.toMatchObject({
        status: EmailCampaignStatus.SENT,
        sentCount: 3,
        failedCount: 0,
      });
    } finally {
      if (previousEmailFrom === undefined) {
        delete process.env.EMAIL_FROM;
      } else {
        process.env.EMAIL_FROM = previousEmailFrom;
      }
      if (previousEmailProvider === undefined) {
        delete process.env.EMAIL_PROVIDER;
      } else {
        process.env.EMAIL_PROVIDER = previousEmailProvider;
      }
      if (previousNextAuthUrl === undefined) {
        delete process.env.NEXTAUTH_URL;
      } else {
        process.env.NEXTAUTH_URL = previousNextAuthUrl;
      }
      if (previousNextAuthSecret === undefined) {
        delete process.env.NEXTAUTH_SECRET;
      } else {
        process.env.NEXTAUTH_SECRET = previousNextAuthSecret;
      }
    }
  });

  it("updates delivered and bounced counts from Resend webhook events", async () => {
    const previousEmailFrom = process.env.EMAIL_FROM;
    const previousEmailProvider = process.env.EMAIL_PROVIDER;
    const previousNextAuthUrl = process.env.NEXTAUTH_URL;
    const previousNextAuthSecret = process.env.NEXTAUTH_SECRET;
    process.env.EMAIL_FROM = MARKETING_EMAIL_FROM;
    process.env.EMAIL_PROVIDER = "log";
    process.env.NEXTAUTH_URL = "https://app.bazaar.test";
    process.env.NEXTAUTH_SECRET = "test-nextauth-secret";

    try {
      const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
      const user = asCallerUser(adminUser);
      await prisma.customer.createMany({
        data: ["delivered@example.com", "bounced@example.com"].map((email, index) => ({
          organizationId: org.id,
          storeId: store.id,
          name: `Webhook Customer ${index + 1}`,
          email,
          source: CustomerSource.MANUAL,
        })),
      });

      const queued = await sendEmailCampaignToAudience({
        user,
        actorId: adminUser.id,
        requestId: "email-campaign-webhook-queue",
        campaign: {
          storeId: store.id,
          source: "ALL",
          subject: "Webhook update",
          body: "New stock is available.",
          brandColor: "#111827",
          buttonColor: "#111827",
        },
      });

      await deliverPendingEmailCampaigns({
        organizationId: org.id,
        campaignId: queued.campaign.id,
        batchSize: 2,
      });
      const recipients = await prisma.emailCampaignRecipient.findMany({
        where: { campaignId: queued.campaign.id },
        orderBy: { email: "asc" },
      });
      const bounced = recipients.find((recipient) => recipient.email === "bounced@example.com");
      const delivered = recipients.find((recipient) => recipient.email === "delivered@example.com");
      expect(bounced?.providerMessageId).toBeTruthy();
      expect(delivered?.providerMessageId).toBeTruthy();

      await expect(
        handleResendEmailWebhook({
          webhookEventId: "evt-delivered",
          event: {
            type: "email.delivered",
            created_at: "2026-07-17T00:00:00.000Z",
            data: {
              email_id: delivered?.providerMessageId ?? "",
              to: ["delivered@example.com"],
              subject: "Webhook update",
            },
          },
        }),
      ).resolves.toMatchObject({ processed: true, delivered: 1 });

      await expect(
        handleResendEmailWebhook({
          webhookEventId: "evt-bounced",
          event: {
            type: "email.bounced",
            created_at: "2026-07-17T00:01:00.000Z",
            data: {
              email_id: bounced?.providerMessageId ?? "",
              to: ["bounced@example.com"],
              subject: "Webhook update",
              bounce: {
                type: "Permanent",
                subType: "Suppressed",
                message: "Recipient address rejected.",
              },
            },
          },
        }),
      ).resolves.toMatchObject({ processed: true, delivered: 1, failed: 1 });

      await expect(
        prisma.emailCampaign.findUniqueOrThrow({ where: { id: queued.campaign.id } }),
      ).resolves.toMatchObject({
        status: EmailCampaignStatus.PARTIAL,
        sentCount: 2,
        deliveredCount: 1,
        failedCount: 1,
      });
      await expect(
        prisma.emailCampaignRecipient.findUniqueOrThrow({ where: { id: bounced?.id ?? "" } }),
      ).resolves.toMatchObject({
        status: EmailCampaignRecipientStatus.FAILED,
        providerStatus: "bounced",
      });
    } finally {
      if (previousEmailFrom === undefined) {
        delete process.env.EMAIL_FROM;
      } else {
        process.env.EMAIL_FROM = previousEmailFrom;
      }
      if (previousEmailProvider === undefined) {
        delete process.env.EMAIL_PROVIDER;
      } else {
        process.env.EMAIL_PROVIDER = previousEmailProvider;
      }
      if (previousNextAuthUrl === undefined) {
        delete process.env.NEXTAUTH_URL;
      } else {
        process.env.NEXTAUTH_URL = previousNextAuthUrl;
      }
      if (previousNextAuthSecret === undefined) {
        delete process.env.NEXTAUTH_SECRET;
      } else {
        process.env.NEXTAUTH_SECRET = previousNextAuthSecret;
      }
    }
  });
});
