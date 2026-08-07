import {
  CustomerSource,
  EmailCampaignStatus,
  OperationRequestStatus,
  type Role,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/prisma";

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
  if (!user.organizationId) throw new Error("test user must belong to an organization");
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    isOrgOwner: Boolean(user.isOrgOwner),
  };
};

const mockResendBatch = () => {
  let sequence = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    sequence += 1;
    return new Response(JSON.stringify({ data: [{ id: `resend_campaign_${sequence}` }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
};

describeDb("email marketing send idempotency", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "re_email_campaign_idempotency");
    vi.stubEnv("NEXTAUTH_URL", "https://app.bazaar.test");
    vi.stubEnv("NEXTAUTH_SECRET", "email-campaign-idempotency-secret");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("replays a concurrent saved-campaign send without duplicate recipients, audit, or provider calls", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const customer = await prisma.customer.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Campaign recipient",
        email: "recipient@example.com",
        source: CustomerSource.MANUAL,
      },
    });
    const campaign = await prisma.emailCampaign.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        createdById: adminUser.id,
        status: EmailCampaignStatus.DRAFT,
        name: "Idempotent saved campaign",
        subject: "One durable send",
        body: "Only one copy should be queued.",
        audienceJson: { mode: "segment", segment: "all", source: "ALL", recentDays: 30 },
      },
    });
    const otherCampaign = await prisma.emailCampaign.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        createdById: adminUser.id,
        status: EmailCampaignStatus.DRAFT,
        name: "Different saved campaign",
        subject: "Different campaign",
        body: "This must not share the request key.",
        audienceJson: { mode: "segment", segment: "all", source: "ALL", recentDays: 30 },
      },
    });
    const caller = createTestCaller(asCallerUser(adminUser));
    const fetchMock = mockResendBatch();
    const request = {
      campaignId: campaign.id,
      idempotencyKey: "saved-campaign-send-key",
    };

    const [first, second] = await Promise.all([
      caller.emailMarketing.sendCampaign(request),
      caller.emailMarketing.sendCampaign(request),
    ]);
    expect(new Set([first.campaign.id, second.campaign.id])).toEqual(new Set([campaign.id]));
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await prisma.customer.update({
      where: { id: customer.id },
      data: { emailMarketingUnsubscribedAt: new Date() },
    });
    const replay = await caller.emailMarketing.sendCampaign(request);
    expect(replay).toMatchObject({ replayed: true, campaign: { id: campaign.id } });
    expect(replay.delivery).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      caller.emailMarketing.sendCampaign({
        campaignId: otherCampaign.id,
        idempotencyKey: request.idempotencyKey,
      }),
    ).rejects.toMatchObject({ message: "operationRequestPayloadMismatch" });

    await expect(
      prisma.emailCampaign.findUniqueOrThrow({ where: { id: otherCampaign.id } }),
    ).resolves.toMatchObject({ status: EmailCampaignStatus.DRAFT, recipientCount: 0 });
    expect(await prisma.emailCampaignRecipient.count({ where: { campaignId: campaign.id } })).toBe(
      1,
    );
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId: org.id,
          entity: "EmailCampaign",
          entityId: campaign.id,
          action: "EMAIL_CAMPAIGN_QUEUE",
        },
      }),
    ).toBe(1);
    await expect(
      prisma.operationRequest.findFirstOrThrow({
        where: {
          organizationId: org.id,
          scope: "emailMarketing.sendSaved.v1",
          idempotencyKey: request.idempotencyKey,
        },
      }),
    ).resolves.toMatchObject({
      status: OperationRequestStatus.COMPLETED,
      resourceType: "EmailCampaign",
      resourceId: campaign.id,
    });
  });

  it("replays an inline campaign send and conflicts when the payload changes", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const customer = await prisma.customer.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: "Inline recipient",
        email: "inline@example.com",
        source: CustomerSource.MANUAL,
      },
    });
    const caller = createTestCaller(asCallerUser(adminUser));
    const fetchMock = mockResendBatch();
    const request = {
      storeId: store.id,
      name: "Inline idempotent campaign",
      subject: "Inline subject",
      body: "Inline body",
      audience: { mode: "segment" as const, segment: "all" as const },
      idempotencyKey: "inline-campaign-send-key",
    };

    const first = await caller.emailMarketing.send(request);
    await prisma.customer.update({
      where: { id: customer.id },
      data: { emailMarketingUnsubscribedAt: new Date() },
    });
    const replay = await caller.emailMarketing.send(request);
    expect(replay).toMatchObject({ replayed: true, campaign: { id: first.campaign.id } });
    expect(replay.delivery).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      caller.emailMarketing.send({ ...request, subject: "Changed subject" }),
    ).rejects.toMatchObject({ message: "operationRequestPayloadMismatch" });
    expect(await prisma.emailCampaign.count({ where: { organizationId: org.id } })).toBe(1);
    expect(
      await prisma.emailCampaignRecipient.count({ where: { campaignId: first.campaign.id } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId: org.id,
          entity: "EmailCampaign",
          action: "EMAIL_CAMPAIGN_QUEUE",
        },
      }),
    ).toBe(1);
  });
});
