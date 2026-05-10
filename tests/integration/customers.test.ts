import { beforeEach, describe, expect, it } from "vitest";
import {
  CustomerSource,
  EmailCampaignRecipientStatus,
  EmailCampaignStatus,
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
    await prisma.userStoreAccess.create({
      data: { organizationId: org.id, userId: managerUser.id, storeId: store.id },
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

  it("imports customers with same-store dedupe and cross-store isolation", async () => {
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
      created: 2,
      updated: 1,
      skipped: 3,
      errors: 3,
    });

    const storeCustomers = await prisma.customer.findMany({
      where: { organizationId: org.id, storeId: store.id, deletedAt: null },
      orderBy: { email: "asc" },
    });
    const otherStoreCustomers = await prisma.customer.findMany({
      where: { organizationId: org.id, storeId: otherStore.id, deletedAt: null },
    });

    expect(storeCustomers.map((customer) => customer.email)).toEqual([
      "existing@example.com",
      "new@example.com",
      "other@example.com",
    ]);
    expect(storeCustomers.find((customer) => customer.email === "existing@example.com")?.phone).toBe(
      "+996 700 000 001",
    );
    expect(otherStoreCustomers).toHaveLength(1);
  });

  it("auto-creates customers from manual and bazaar API orders", async () => {
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
    expect(storeCustomers.some((customer) => customer.phone === "+996 555 123 123")).toBe(true);
    expect(storeCustomers.every((customer) => customer.source === CustomerSource.ORDER)).toBe(true);
    expect(otherStoreCustomers).toHaveLength(1);
    expect(otherStoreCustomers[0]?.email).toBe("customer@example.com");
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
      expect(preview.rendered.text).toContain(`From: ${MARKETING_EMAIL_FROM}`);

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
});
