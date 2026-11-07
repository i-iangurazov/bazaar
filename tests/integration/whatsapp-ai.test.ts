import { randomUUID } from "node:crypto";
import type { WhatsAppConnection, WhatsAppConversation } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import {
  whatsappProfileSchema,
  whatsappKnowledgeSchema,
  whatsappPeriod,
  WHATSAPP_OFFER_VERSION,
} from "@/lib/whatsapp-ai";
import { encryptWhatsAppSecret } from "@/server/whatsapp/config";
import { whatsappAccess } from "@/server/whatsapp/access";
import { reserveWhatsAppUnit, settleWhatsAppUnit, whatsappQuota } from "@/server/whatsapp/quota";
import { receiveWhatsAppWebhook } from "@/server/whatsapp/webhook";
import {
  queueWhatsAppManual,
  setWhatsAppConversationMode,
  setWhatsAppEnabled,
  markWhatsAppSeen,
  listWhatsAppConversations,
  eraseWhatsAppConversation,
} from "@/server/whatsapp/workspace";
import {
  runWhatsAppWorkerBatch,
  reconcileWhatsAppStatuses,
  redactExpiredWhatsAppData,
} from "@/server/whatsapp/worker";
import { whatsappSearch } from "@/server/whatsapp/catalog";
import { applyWhatsAppPayment, createWhatsAppCheckout } from "@/server/whatsapp/payments";
import { handleFreedomPayNotification } from "@/server/billing/paymentWebhook";
import { signFreedomPay } from "@/server/billing/freedomPay";
import { LIFETIME_ORGANIZATION_IDS } from "@/server/billing/lifetimeOrganizations";
import * as transport from "@/server/whatsapp/gupshup";
import * as assistant from "@/server/whatsapp/assistant";
import * as quota from "@/server/whatsapp/quota";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const secret = "synthetic-whatsapp-payment-secret",
  webhookKey = "ff".repeat(32);
describeDb("WhatsApp AI isolation, delivery and money with a real database", () => {
  let f: Awaited<ReturnType<typeof seedBase>>,
    connection: WhatsAppConnection,
    conversation: WhatsAppConversation;
  const actor = () => ({ id: f.adminUser.id, organizationId: f.org.id });
  const webhook = async (value: object, field = "messages", key = webhookKey, appId = "app-own") =>
    receiveWhatsAppWebhook(
      new Request("http://localhost/api/integrations/whatsapp/test", {
        method: "POST",
        headers: { "X-Gupshup-Webhook-Secret": key },
        body: JSON.stringify({
          gs_app_id: appId,
          object: "whatsapp_business_account",
          entry: [{ changes: [{ field, value }] }],
        }),
      }),
      connection.id,
    );
  const incoming = (id: string = randomUUID(), phone = "996700000001", kind = "text") =>
    webhook({
      messages: [
        {
          id,
          from: phone,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: kind,
          text: { body: "Синтетический вопрос" },
        },
      ],
    });
  const outgoing = () =>
    prisma.whatsAppMessage.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        kind: "TEXT",
        body: "Синтетический ответ",
        state: "PREPARED",
        actorId: f.adminUser.id,
        providerEventKey: randomUUID(),
        generationVersion: conversation.generationVersion,
        configVersion: connection.configVersion,
      },
    });
  const invoice = () =>
    prisma.whatsAppInvoice.create({
      data: {
        id: `wa_${randomUUID().replaceAll("-", "")}`,
        organizationId: f.org.id,
        createdById: f.adminUser.id,
        idempotencyKey: randomUUID(),
        quantity: 1,
        amountMinor: 349000,
        offerVersion: WHATSAPP_OFFER_VERSION,
        merchantId: "90001",
        isTest: true,
        status: "PENDING",
        termsVersion: "test-v1",
        termsUrl: "http://localhost/terms",
        expiresAt: new Date(Date.now() + 900000),
      },
    });
  const fields = (id: string, changes: Record<string, string> = {}) => {
    const data = {
      pg_order_id: id,
      pg_payment_id: "12345",
      pg_merchant_id: "90001",
      pg_amount: "3490.00",
      pg_currency: "KGS",
      pg_testing_mode: "1",
      pg_result: "1",
      pg_payment_method: "bankcard",
      pg_captured: "1",
      pg_salt: randomUUID(),
      ...changes,
    };
    return { ...data, pg_sig: signFreedomPay("result", data, secret) };
  };

  beforeEach(async () => {
    await resetDatabase();
    for (const [key, value] of Object.entries({
      WHATSAPP_AI_ENABLED: "1",
      WHATSAPP_PARTNER_APPROVED: "1",
      WHATSAPP_PRIVACY_APPROVED: "1",
      WHATSAPP_PARTNER_BILLING_CONFIRMED: "1",
      WHATSAPP_INBOUND_SPEND_CAP_CONFIRMED: "1",
      WHATSAPP_PILOT_APPROVED: "1",
      WHATSAPP_PACK_PAYMENTS_APPROVED: "1",
      GUPSHUP_UNIVERSAL_TOKEN_EXPIRES_AT: new Date(Date.now() + 7 * 86400_000).toISOString(),
      GUPSHUP_UNIVERSAL_TOKEN: "synthetic-partner-token",
      DEEPSEEK_API_KEY: "synthetic-ai-key",
      WHATSAPP_ENCRYPTION_KEY: "ab".repeat(32),
      WHATSAPP_PUBLIC_URL: "https://bazaar.kg",
      HARDENING_EXTERNAL_PROVIDER_MODE: "sandbox",
      BILLING_PAYMENTS_MODE: "sandbox",
      FREEDOMPAY_MERCHANT_ID: "90001",
      FREEDOMPAY_SECRET_KEY: secret,
      BILLING_PUBLIC_URL: "http://localhost:3120",
      BILLING_TERMS_URL: "http://localhost:3120/terms",
      BILLING_TERMS_VERSION: "test-v1",
      BILLING_SELLER_NAME: "Synthetic seller",
      VERCEL_ENV: "development",
    }))
      vi.stubEnv(key, value);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected external call in isolated database test");
      }),
    );
    f = await seedBase({ plan: "ENTERPRISE" });
    connection = await prisma.whatsAppConnection.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        providerAppId: "app-own",
        state: "CONNECTED",
        aiEnabled: true,
        profile: whatsappProfileSchema.parse({}),
        knowledge: whatsappKnowledgeSchema.parse({ storeName: "Synthetic store" }),
        knowledgePublished: true,
      },
    });
    connection = await prisma.whatsAppConnection.update({
      where: { id: connection.id },
      data: {
        encryptedAppToken: encryptWhatsAppSecret("synthetic-app-token", connection.id),
        encryptedWebhookKey: encryptWhatsAppSecret(webhookKey, connection.id),
      },
    });
    conversation = await prisma.whatsAppConversation.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        connectionId: connection.id,
        externalIdentity: "996700000001",
        phone: "996700000001",
        buyerCountry: "KG",
        lastInboundAt: new Date(),
        mode: "HUMAN",
      },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("enforces current role, store assignment and organization boundaries", async () => {
    await expect(whatsappAccess({ ...actor(), id: f.staffUser.id }, f.store.id)).rejects.toThrow(
      "forbidden",
    );
    const other = await prisma.organization.create({ data: { name: "Other", plan: "ENTERPRISE" } });
    const store = await prisma.store.create({
      data: { organizationId: other.id, name: "Foreign", code: "foreign" },
    });
    await expect(whatsappAccess(actor(), store.id)).rejects.toThrow("storeAccessDenied");
    await expect(
      createTestCaller({ ...f.managerUser, organizationId: f.org.id }).whatsappAi.payments(),
    ).rejects.toThrow("forbidden");
    await prisma.userStoreAccess.deleteMany({ where: { userId: f.managerUser.id } });
    await expect(whatsappAccess({ ...actor(), id: f.managerUser.id }, f.store.id)).rejects.toThrow(
      "storeAccessDenied",
    );
  });
  it("rejects a cross-organization connection even through direct SQL-level relations", async () => {
    const other = await prisma.organization.create({ data: { name: "Foreign" } });
    await expect(
      prisma.whatsAppConnection.create({
        data: { organizationId: other.id, storeId: f.store.id, profile: {}, knowledge: {} },
      }),
    ).rejects.toThrow();
  });
  it("does not let an unpaid trial or Starter consume expensive external messages", async () => {
    await prisma.organization.update({
      where: { id: f.org.id },
      data: {
        subscriptionBillingMode: "SELF_SERVE",
        trialEndsAt: new Date(Date.now() + 86400_000),
        currentPeriodEndsAt: new Date(Date.now() + 86400_000),
      },
    });
    expect((await whatsappQuota(f.org.id)).active).toBe(false);
    await expect(reserveWhatsAppUnit(f.org.id, (await outgoing()).id)).rejects.toThrow(
      "whatsappPlanRequired",
    );
    await prisma.organization.update({
      where: { id: f.org.id },
      data: {
        subscriptionBillingMode: "MANUAL",
        plan: "STARTER",
        trialEndsAt: null,
        currentPeriodEndsAt: null,
      },
    });
    expect((await whatsappQuota(f.org.id)).included).toBe(0);
  });
  it.each([...LIFETIME_ORGANIZATION_IDS])(
    "preserves the protected lifetime grant for %s without editing the organization",
    async (id) => {
      const org = await prisma.organization.create({
        data: {
          id,
          name: `Synthetic protected ${id}`,
          plan: "BUSINESS",
          subscriptionStatus: "CANCELED",
        },
      });
      const before = JSON.stringify(org);
      expect(await whatsappQuota(id)).toMatchObject({ included: 1000, active: true });
      expect(JSON.stringify(await prisma.organization.findUnique({ where: { id } }))).toBe(before);
      expect(await prisma.subscriptionPeriod.count({ where: { organizationId: id } })).toBe(0);
    },
  );
  it("allows only one concurrent reservation of the last monthly unit", async () => {
    await prisma.whatsAppMonth.create({
      data: { organizationId: f.org.id, period: whatsappPeriod().key, includedUsed: 999 },
    });
    const messages = await Promise.all([outgoing(), outgoing()]);
    const result = await Promise.allSettled(
      messages.map((m) => reserveWhatsAppUnit(f.org.id, m.id)),
    );
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await whatsappQuota(f.org.id)).toMatchObject({ remaining: 0, reserved: 1 });
  });
  it("does not consume on acceptance and handles duplicate/late delivery exactly once", async () => {
    const m = await outgoing();
    await reserveWhatsAppUnit(f.org.id, m.id);
    await reserveWhatsAppUnit(f.org.id, m.id);
    expect(await whatsappQuota(f.org.id)).toMatchObject({ includedUsed: 0, reserved: 1 });
    await settleWhatsAppUnit(f.org.id, m.id, false);
    await settleWhatsAppUnit(f.org.id, m.id, true);
    await settleWhatsAppUnit(f.org.id, m.id, true);
    await settleWhatsAppUnit(f.org.id, m.id, false);
    expect(await whatsappQuota(f.org.id)).toMatchObject({
      includedUsed: 1,
      reserved: 0,
      delivered: 1,
    });
  });
  it("spends included credits first and then non-expired paid lots", async () => {
    const bill = await invoice();
    await applyWhatsAppPayment({ invoiceId: bill.id, fields: fields(bill.id), source: "CALLBACK" });
    const m1 = await outgoing();
    const use1 = await reserveWhatsAppUnit(f.org.id, m1.id);
    expect(use1.lotId).toBeNull();
    await settleWhatsAppUnit(f.org.id, m1.id, true);
    await prisma.whatsAppMonth.update({
      where: { organizationId_period: { organizationId: f.org.id, period: whatsappPeriod().key } },
      data: { includedUsed: 1000 },
    });
    const m2 = await outgoing();
    expect((await reserveWhatsAppUnit(f.org.id, m2.id)).lotId).not.toBeNull();
    await settleWhatsAppUnit(f.org.id, m2.id, true);
    expect((await whatsappQuota(f.org.id)).paidRemaining).toBe(999);
    await prisma.whatsAppCreditLot.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
    expect((await whatsappQuota(f.org.id)).paidRemaining).toBe(0);
    await expect(reserveWhatsAppUnit(f.org.id, (await outgoing()).id)).rejects.toThrow(
      "whatsappQuotaExhausted",
    );
  });
  it("requires a valid webhook secret and correct app before storing anything", async () => {
    expect((await webhook({ messages: [] }, "messages", "wrong")).status).toBe(403);
    expect((await webhook({ messages: [] }, "messages", webhookKey, "foreign-app")).status).toBe(
      400,
    );
    expect(await prisma.whatsAppEvent.count()).toBe(0);
  });
  it("deduplicates incoming messages and keeps unread state independent of Meta", async () => {
    await incoming("same-id");
    await incoming("same-id");
    const c = await prisma.whatsAppConversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(c.inboundSequence).toBe(1);
    expect(await prisma.whatsAppMessage.count()).toBe(1);
    expect(
      (await listWhatsAppConversations(actor(), { storeId: f.store.id, filter: "unread" })).items,
    ).toHaveLength(1);
    await markWhatsAppSeen(actor(), c.id, 900);
    await markWhatsAppSeen(actor(), c.id, 0);
    expect(
      (await listWhatsAppConversations(actor(), { storeId: f.store.id, filter: "unread" })).items,
    ).toHaveLength(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  it.each(["audio", "document", "video"])(
    "hands %s to a person without calling an AI or transcription provider",
    async (kind) => {
      await prisma.whatsAppConversation.update({
        where: { id: conversation.id },
        data: { mode: "AI" },
      });
      await incoming(randomUUID(), "996700000001", kind);
      expect(
        await prisma.whatsAppConversation.findUnique({ where: { id: conversation.id } }),
      ).toMatchObject({ mode: "HUMAN", needsHuman: true });
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    },
  );
  it("does not inherit KG eligibility after a customer's country/phone changes", async () => {
    await webhook({
      contacts: [{ user_id: "BSUID-own", wa_id: "996700000001" }],
      messages: [
        {
          id: "kg",
          from: "BSUID-own",
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text",
          text: { body: "Hi" },
        },
      ],
    });
    await webhook({
      contacts: [{ user_id: "BSUID-own", wa_id: "79990000000" }],
      messages: [
        {
          id: "foreign",
          from: "BSUID-own",
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text",
          text: { body: "Hi" },
        },
      ],
    });
    expect(
      await prisma.whatsAppConversation.findFirst({ where: { externalIdentity: "BSUID-own" } }),
    ).toMatchObject({ buyerCountry: null, mode: "HUMAN" });
  });
  it("handles staff takeover, cancels pending AI work and retains two manual replies", async () => {
    await prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: { mode: "AI" },
    });
    const ai = await outgoing();
    await prisma.whatsAppMessage.update({ where: { id: ai.id }, data: { actorId: null } });
    await reserveWhatsAppUnit(f.org.id, ai.id);
    const first = await queueWhatsAppManual(
      actor(),
      { conversationId: conversation.id, body: "Первый", idempotencyKey: randomUUID() },
      "test",
    );
    const second = await queueWhatsAppManual(
      actor(),
      { conversationId: conversation.id, body: "Второй", idempotencyKey: randomUUID() },
      "test",
    );
    const spy = vi
      .spyOn(transport, "sendGupshupText")
      .mockResolvedValueOnce("provider-first")
      .mockResolvedValueOnce("provider-second");
    await runWhatsAppWorkerBatch();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await prisma.whatsAppMessage.findUnique({ where: { id: ai.id } })).toMatchObject({
      state: "CANCELLED",
    });
    expect(
      await prisma.whatsAppMessage.count({
        where: { id: { in: [first.id, second.id] }, state: "SENT" },
      }),
    ).toBe(2);
    expect(await whatsappQuota(f.org.id)).toMatchObject({ includedUsed: 0, reserved: 2 });
  });
  it("fences duplicate workers so a lost claim cannot release the winner's reservation", async () => {
    const m = await outgoing();
    const spy = vi.spyOn(transport, "sendGupshupText").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return "provider-once";
    });
    await Promise.all([runWhatsAppWorkerBatch(), runWhatsAppWorkerBatch()]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await prisma.whatsAppCreditUse.findUnique({ where: { messageId: m.id } })).toMatchObject(
      { state: "RESERVED" },
    );
    expect((await whatsappQuota(f.org.id)).reserved).toBe(1);
  });
  it("keeps queued employee replies after AI is switched off or its key is unavailable", async () => {
    const m = await outgoing();
    await setWhatsAppEnabled(actor(), f.store.id, false, "test");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    const spy = vi.spyOn(transport, "sendGupshupText").mockResolvedValue("manual-still-works");
    await runWhatsAppWorkerBatch();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await prisma.whatsAppMessage.findUnique({ where: { id: m.id } })).toMatchObject({
      state: "SENT",
    });
    expect(await prisma.whatsAppWorkerState.findUnique({ where: { id: "worker" } })).toMatchObject({
      state: "MANUAL",
    });
  });
  it("routes new requests to a person when the worker loses its AI configuration", async () => {
    await prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: { mode: "AI" },
    });
    await incoming();
    await prisma.whatsAppMessage.updateMany({ data: { nextAttemptAt: new Date(0) } });
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    const model = vi.spyOn(assistant, "generateWhatsAppAnswer");
    await runWhatsAppWorkerBatch();
    expect(model).not.toHaveBeenCalled();
    expect(
      await prisma.whatsAppConversation.findUnique({ where: { id: conversation.id } }),
    ).toMatchObject({ mode: "HUMAN", needsHuman: true });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  it("does not stop existing connections when the partner onboarding token expires", async () => {
    const m = await outgoing();
    vi.stubEnv("GUPSHUP_UNIVERSAL_TOKEN_EXPIRES_AT", "2020-01-01T00:00:00Z");
    vi.spyOn(transport, "sendGupshupText").mockResolvedValue("existing-app-token");
    await runWhatsAppWorkerBatch();
    expect(await prisma.whatsAppMessage.findUnique({ where: { id: m.id } })).toMatchObject({
      state: "SENT",
    });
  });
  it("overlaps only three independent conversations while preserving message order", async () => {
    let active = 0,
      peak = 0;
    vi.spyOn(transport, "sendGupshupText").mockImplementation(async (input) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 40));
      active--;
      return `provider-${input.messageId}`;
    });
    for (let i = 0; i < 4; i++) {
      const c = await prisma.whatsAppConversation.create({
        data: {
          organizationId: f.org.id,
          storeId: f.store.id,
          connectionId: connection.id,
          externalIdentity: `synthetic-parallel-${i}`,
          phone: `99600000000${i}`,
          buyerCountry: "KG",
          lastInboundAt: new Date(),
          mode: "HUMAN",
        },
      });
      await prisma.whatsAppMessage.create({
        data: {
          organizationId: f.org.id,
          storeId: f.store.id,
          conversationId: c.id,
          actorId: f.adminUser.id,
          direction: "OUTBOUND",
          kind: "TEXT",
          body: `Message ${i}`,
          providerEventKey: randomUUID(),
          state: "PREPARED",
          generationVersion: 1,
          configVersion: 1,
        },
      });
    }
    await runWhatsAppWorkerBatch();
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
    expect(await prisma.whatsAppMessage.count({ where: { state: "SENT" } })).toBe(4);
  });
  it("restores verified recent product context with current prices for a follow-up", async () => {
    const m = await outgoing(),
      ref = `${f.product.id}:BASE`;
    await prisma.whatsAppMessage.update({
      where: { id: m.id },
      data: {
        actorId: null,
        state: "DELIVERED",
        body: "Old quote: 125.50 KGS",
        facts: {
          answer: {
            language: "ru",
            intent: "products",
            offerRefs: [ref],
            knowledgeTopics: [],
            faqIndices: [],
            question: "",
            socialText: "",
          },
          firstReply: false,
          handoff: false,
        },
      },
    });
    await prisma.storePrice.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        productId: f.product.id,
        priceKgs: 275,
      },
    });
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.instructions).toContain('"price":"275.00"');
      expect(body.instructions).toContain(ref);
      return Response.json({
        status: "completed",
        usage: { input_tokens: 100, output_tokens: 30 },
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  language: "ru",
                  intent: "products",
                  offerRefs: [ref],
                  knowledgeTopics: [],
                  faqIndices: [],
                  question: "",
                  socialText: "",
                }),
              },
            ],
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await assistant.generateWhatsAppAnswer({
      organizationId: f.org.id,
      storeId: f.store.id,
      conversationId: conversation.id,
      incoming: "А сколько стоит этот товар?",
      profile: connection.profile,
      knowledge: connection.knowledge,
      firstReply: false,
    });
    expect(result.body).toContain("275.00 KGS");
    expect(result.body).not.toContain("125.50");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["products", "unavailable", "clarify"])(
    "resolves a verified public SKU when the model classifies its price request as %s",
    async (intent) => {
      const ref = `${f.product.id}:BASE`;
      await prisma.storePrice.create({
        data: {
          organizationId: f.org.id,
          storeId: f.store.id,
          productId: f.product.id,
          priceKgs: 125.5,
        },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          const body = JSON.parse(String(init.body));
          expect(body.instructions).toContain(ref);
          expect(body.instructions).toContain('"price":"125.50"');
          return Response.json({
            status: "completed",
            usage: { input_tokens: 100, output_tokens: 30 },
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      language: "ru",
                      intent,
                      offerRefs: [],
                      knowledgeTopics: [],
                      faqIndices: [],
                      question:
                        "Возможно, вас интересует смеситель — подскажите, какой товар нужен?",
                      socialText: "",
                    }),
                  },
                ],
              },
            ],
          });
        }),
      );
      const result = await assistant.generateWhatsAppAnswer({
        organizationId: f.org.id,
        storeId: f.store.id,
        incoming: "Скажи цену товара TEST-1",
        profile: connection.profile,
        knowledge: connection.knowledge,
        firstReply: false,
      });
      expect(result.body).toContain("125.50 KGS");
      expect(result.offerRefs).toEqual([ref]);
      expect(result.answer.question).toBe("");
      expect(result.body).not.toContain("какой товар нужен?");
    },
  );
  it("keeps ambiguous sends reserved and resolves a receipt using the opaque ID", async () => {
    const m = await outgoing();
    const spy = vi
      .spyOn(transport, "sendGupshupText")
      .mockRejectedValue(new transport.WhatsAppUnknownSend());
    await runWhatsAppWorkerBatch();
    await runWhatsAppWorkerBatch();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await whatsappQuota(f.org.id)).reserved).toBe(1);
    await webhook({
      statuses: [
        {
          id: "provider-unknown",
          status: "delivered",
          timestamp: String(Math.floor(Date.now() / 1000)),
          biz_opaque_callback_data: `bazaar-wa:${m.id}`,
        },
      ],
    });
    await reconcileWhatsAppStatuses();
    expect(await prisma.whatsAppMessage.findUnique({ where: { id: m.id } })).toMatchObject({
      state: "DELIVERED",
    });
    expect(await whatsappQuota(f.org.id)).toMatchObject({ reserved: 0, includedUsed: 1 });
  });
  it("cancels a generated answer if a human takes over while AI is working", async () => {
    await prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: { mode: "AI" },
    });
    await incoming();
    await prisma.whatsAppMessage.updateMany({ data: { nextAttemptAt: new Date(0) } });
    vi.spyOn(assistant, "generateWhatsAppAnswer").mockImplementation(async () => {
      await setWhatsAppConversationMode(
        actor(),
        conversation.id,
        "HUMAN",
        conversation.generationVersion,
        "test",
      );
      return {
        body: "Hello",
        needsHuman: false,
        answer: {
          language: "en",
          intent: "greeting",
          offerRefs: [],
          knowledgeTopics: [],
          faqIndices: [],
          question: "",
          socialText: "",
        },
        offerRefs: [],
        language: "en",
        inputTokens: 10,
        outputTokens: 10,
      };
    });
    await runWhatsAppWorkerBatch();
    expect(await prisma.whatsAppMessage.count({ where: { direction: "OUTBOUND" } })).toBe(0);
  });
  it("expires stale sending leases into UNKNOWN without repeating the message", async () => {
    const m = await outgoing();
    await reserveWhatsAppUnit(f.org.id, m.id);
    await prisma.whatsAppMessage.update({
      where: { id: m.id },
      data: { state: "SENDING", sendStartedAt: new Date(), leaseUntil: new Date(0) },
    });
    await runWhatsAppWorkerBatch();
    expect(await prisma.whatsAppMessage.findUnique({ where: { id: m.id } })).toMatchObject({
      state: "UNKNOWN",
    });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  it("uses only the selected store's live price and stock and never exposes cost", async () => {
    await prisma.storePrice.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        productId: f.product.id,
        priceKgs: 250,
        discountType: "PERCENTAGE",
        discountPercentage: 10,
      },
    });
    await prisma.inventorySnapshot.create({
      data: { storeId: f.store.id, productId: f.product.id, onHand: 3 },
    });
    const offers = await whatsappSearch(f.org.id, f.store.id, { query: "TEST-1" });
    expect(offers[0]).toMatchObject({ price: "225.00", quantity: 3, available: true });
    expect(JSON.stringify(offers)).not.toMatch(/purchase|cost|supplier|profit/i);
    const otherStore = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Other store", code: "other" },
    });
    expect(await whatsappSearch(f.org.id, otherStore.id, { query: "TEST-1" })).toEqual([]);
    await prisma.storeProduct.updateMany({ data: { isHidden: true } });
    expect(await whatsappSearch(f.org.id, f.store.id, { query: "TEST-1" })).toEqual([]);
  });
  it("accepts a zero price without turning it into a missing price", async () => {
    await prisma.storePrice.create({
      data: { organizationId: f.org.id, storeId: f.store.id, productId: f.product.id, priceKgs: 0 },
    });
    expect((await whatsappSearch(f.org.id, f.store.id, { query: "TEST-1" }))[0].price).toBe("0.00");
  });
  it.each([
    {
      organizationEnabled: true,
      storeEnabled: false,
      standard: 250,
      retail: 300,
      expected: "225.00",
    },
    {
      organizationEnabled: false,
      storeEnabled: true,
      standard: 250,
      retail: 300,
      expected: "225.00",
    },
    {
      organizationEnabled: true,
      storeEnabled: false,
      standard: 250,
      retail: 0,
      expected: "225.00",
    },
    { organizationEnabled: true, storeEnabled: false, standard: 0, retail: null, expected: "0.00" },
  ])(
    "keeps the public checkout price independent of private price types: $organizationEnabled / $storeEnabled / $retail",
    async (item) => {
      await prisma.organization.update({
        where: { id: f.org.id },
        data: { retailWholesaleEnabled: item.organizationEnabled },
      });
      await prisma.store.update({
        where: { id: f.store.id },
        data: { retailWholesaleEnabled: item.storeEnabled },
      });
      await prisma.storePrice.create({
        data: {
          organizationId: f.org.id,
          storeId: f.store.id,
          productId: f.product.id,
          priceKgs: item.standard,
          retailPriceKgs: 999,
          discountType: "PERCENTAGE",
          discountPercentage: 10,
        },
      });
      await prisma.storePriceTypes.create({
        data: {
          organizationId: f.org.id,
          storeId: f.store.id,
          productId: f.product.id,
          retailPriceKgs: item.retail,
          wholesalePriceKgs: 90,
        },
      });
      expect((await whatsappSearch(f.org.id, f.store.id, { query: "TEST-1" }))[0].price).toBe(
        item.expected,
      );
    },
  );
  it("finds Cyrillic product families regardless of typed case", async () => {
    await prisma.product.update({
      where: { id: f.product.id },
      data: { name: "Смеситель хромированный" },
    });
    expect((await whatsappSearch(f.org.id, f.store.id, { query: "смеситель" }))[0].productId).toBe(
      f.product.id,
    );
  });
  it("cancels a stale prepared AI reply without disabling the next customer request", async () => {
    await prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: { mode: "AI" },
    });
    const m = await outgoing();
    await prisma.whatsAppMessage.update({
      where: { id: m.id },
      data: {
        actorId: null,
        inboundSequence: 0,
        facts: {
          answer: {
            language: "en",
            intent: "greeting",
            offerRefs: [],
            knowledgeTopics: [],
            faqIndices: [],
            question: "",
            socialText: "",
          },
          firstReply: true,
          handoff: false,
        },
      },
    });
    await incoming();
    await runWhatsAppWorkerBatch();
    expect(await prisma.whatsAppMessage.findUnique({ where: { id: m.id } })).toMatchObject({
      state: "CANCELLED",
    });
    expect(
      await prisma.whatsAppConversation.findUnique({ where: { id: conversation.id } }),
    ).toMatchObject({ mode: "AI" });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  it("creates a real signed checkout once and preserves a fast paid callback", async () => {
    await prisma.whatsAppWorkerState.create({
      data: { id: "worker", state: "READY", dailyPeriod: whatsappPeriod().key },
    });
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.freedompay.kg/init_payment.php");
      const p = Object.fromEntries(new URLSearchParams(init.body as URLSearchParams));
      expect(p.pg_currency).toBe("KGS");
      expect(p.pg_amount).toBe("3490.00");
      expect(p.pg_description).toContain("1000");
      expect(p.pg_success_url).toContain("/operations/integrations/whatsapp-ai?invoice=wa_");
      await applyWhatsAppPayment({
        invoiceId: p.pg_order_id,
        fields: fields(p.pg_order_id),
        source: "CALLBACK",
      });
      const response = {
        pg_status: "ok",
        pg_payment_id: "12345",
        pg_redirect_url: "https://api.freedompay.kg/pay",
        pg_salt: "fixture",
      };
      const signed = { ...response, pg_sig: signFreedomPay("init_payment.php", response, secret) };
      return new Response(
        `<response>${Object.entries(signed)
          .map(([k, v]) => `<${k}>${v}</${k}>`)
          .join("")}</response>`,
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const input = {
      quantity: 1,
      offerVersion: WHATSAPP_OFFER_VERSION,
      termsAccepted: true,
      termsVersion: "test-v1",
      expectedAmountMinor: 349000,
      idempotencyKey: randomUUID(),
      locale: "ru",
    };
    const first = await createWhatsAppCheckout(actor(), f.store.id, input, "test");
    const second = await createWhatsAppCheckout(actor(), f.store.id, input, "test");
    expect(first.status).toBe("PAID");
    expect(second.id).toBe(first.id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await prisma.whatsAppCreditLot.count()).toBe(1);
  });
  it("grants one paid pack under concurrent valid callbacks and leaves subscriptions untouched", async () => {
    const bill = await invoice(),
      before = await prisma.organization.findUnique({ where: { id: f.org.id } });
    await Promise.all(
      [1, 2, 3].map(() =>
        applyWhatsAppPayment({ invoiceId: bill.id, fields: fields(bill.id), source: "CALLBACK" }),
      ),
    );
    expect(await prisma.whatsAppCreditLot.count()).toBe(1);
    expect((await whatsappQuota(f.org.id)).paidRemaining).toBe(1000);
    expect(await prisma.organization.findUnique({ where: { id: f.org.id } })).toEqual(before);
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
  });
  it("routes a signed pack callback through the existing FreedomPay endpoint", async () => {
    const bill = await invoice();
    const response = await handleFreedomPayNotification(
      new Request("http://localhost/api/billing/freedompay/result", {
        method: "POST",
        body: new URLSearchParams(fields(bill.id)),
      }),
      "result",
    );
    expect(response.status).toBe(200);
    expect(await prisma.whatsAppCreditLot.count()).toBe(1);
  });
  it.each([
    ["pg_currency", "USD"],
    ["pg_amount", "34.90"],
    ["pg_testing_mode", "0"],
    ["pg_merchant_id", "90002"],
  ])("rejects a signed but mismatched payment %s=%s", async (key, value) => {
    const bill = await invoice();
    await expect(
      applyWhatsAppPayment({
        invoiceId: bill.id,
        fields: fields(bill.id, { [key]: value }),
        source: "CALLBACK",
      }),
    ).rejects.toThrow("billingPaymentMismatch");
    expect(await prisma.whatsAppCreditLot.count()).toBe(0);
  });
  it("does not grant an uncaptured authorization and revokes unused credit after a refund", async () => {
    const bill = await invoice();
    await applyWhatsAppPayment({
      invoiceId: bill.id,
      fields: fields(bill.id, { pg_captured: "0" }),
      source: "CALLBACK",
    });
    expect(await prisma.whatsAppCreditLot.count()).toBe(0);
    await applyWhatsAppPayment({ invoiceId: bill.id, fields: fields(bill.id), source: "CALLBACK" });
    await applyWhatsAppPayment({
      invoiceId: bill.id,
      fields: fields(bill.id, { pg_refund_amount: "100.00" }),
      source: "CALLBACK",
    });
    await applyWhatsAppPayment({ invoiceId: bill.id, fields: fields(bill.id), source: "CALLBACK" });
    expect((await whatsappQuota(f.org.id)).paidRemaining).toBe(0);
    expect(await prisma.whatsAppInvoice.findUnique({ where: { id: bill.id } })).toMatchObject({
      status: "REVIEW",
      lastIssue: "REFUND_REVIEW",
    });
  });
  it("cancels a prepared paid reservation after refund without releasing an older uncertain send", async () => {
    const bill = await invoice();
    await applyWhatsAppPayment({ invoiceId: bill.id, fields: fields(bill.id), source: "CALLBACK" });
    await prisma.whatsAppMonth.create({
      data: { organizationId: f.org.id, period: whatsappPeriod().key, includedUsed: 1000 },
    });
    const older = await outgoing();
    await reserveWhatsAppUnit(f.org.id, older.id);
    await prisma.whatsAppMessage.update({
      where: { id: older.id },
      data: {
        state: "SENDING",
        createdAt: new Date(Date.now() - 1000),
        sendStartedAt: new Date(),
        leaseUntil: new Date(Date.now() + 60000),
      },
    });
    const waiting = await outgoing();
    const send = vi.spyOn(transport, "sendGupshupText").mockResolvedValue("must-not-send");
    await runWhatsAppWorkerBatch();
    expect(send).not.toHaveBeenCalled();
    expect(
      await prisma.whatsAppCreditUse.findUnique({ where: { messageId: waiting.id } }),
    ).toMatchObject({ state: "RESERVED" });
    await applyWhatsAppPayment({
      invoiceId: bill.id,
      fields: fields(bill.id, { pg_refund_amount: "3490.00" }),
      source: "CALLBACK",
    });
    await prisma.whatsAppMessage.update({
      where: { id: older.id },
      data: { state: "UNKNOWN", leaseUntil: null },
    });
    await runWhatsAppWorkerBatch();
    await runWhatsAppWorkerBatch();
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.whatsAppMessage.findUnique({ where: { id: waiting.id } })).toMatchObject({
      state: "CANCELLED",
      lastIssue: "whatsappQuotaExhausted",
    });
    expect(
      await prisma.whatsAppCreditUse.findUnique({ where: { messageId: waiting.id } }),
    ).toMatchObject({ state: "RELEASED" });
    expect(
      await prisma.whatsAppCreditUse.findUnique({ where: { messageId: older.id } }),
    ).toMatchObject({ state: "RESERVED" });
    expect(
      await prisma.whatsAppCreditLot.findUnique({ where: { invoiceId: bill.id } }),
    ).toMatchObject({ revoked: true, reserved: 1, used: 0 });
    expect((await whatsappQuota(f.org.id)).paidRemaining).toBe(0);
  });
  it("rechecks a paid reservation when refund commits between reservation and the send claim", async () => {
    const bill = await invoice();
    await applyWhatsAppPayment({ invoiceId: bill.id, fields: fields(bill.id), source: "CALLBACK" });
    await prisma.whatsAppMonth.create({
      data: { organizationId: f.org.id, period: whatsappPeriod().key, includedUsed: 1000 },
    });
    const m = await outgoing(),
      reserve = quota.reserveWhatsAppUnit;
    vi.spyOn(quota, "reserveWhatsAppUnit").mockImplementationOnce(async (...args) => {
      const usage = await reserve(...args);
      await applyWhatsAppPayment({
        invoiceId: bill.id,
        fields: fields(bill.id, { pg_refund_amount: "3490.00" }),
        source: "CALLBACK",
      });
      return usage;
    });
    const send = vi.spyOn(transport, "sendGupshupText").mockResolvedValue("must-not-send");
    await runWhatsAppWorkerBatch();
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.whatsAppMessage.findUnique({ where: { id: m.id } })).toMatchObject({
      state: "CANCELLED",
      lastIssue: "whatsappQuotaExhausted",
    });
    expect(await prisma.whatsAppCreditUse.findUnique({ where: { messageId: m.id } })).toMatchObject(
      { state: "RELEASED" },
    );
    expect(
      await prisma.whatsAppCreditLot.findUnique({ where: { invoiceId: bill.id } }),
    ).toMatchObject({ revoked: true, reserved: 0, used: 0 });
  });
  it.each([false, true])(
    "keeps a refunded in-flight reservation and accounts duplicate late delivery once (unknown=%s)",
    async (unknown) => {
      const bill = await invoice();
      await applyWhatsAppPayment({
        invoiceId: bill.id,
        fields: fields(bill.id),
        source: "CALLBACK",
      });
      await prisma.whatsAppMonth.create({
        data: { organizationId: f.org.id, period: whatsappPeriod().key, includedUsed: 1000 },
      });
      const m = await outgoing();
      const send = vi.spyOn(transport, "sendGupshupText").mockImplementationOnce(async () => {
        expect(await prisma.whatsAppMessage.findUnique({ where: { id: m.id } })).toMatchObject({
          state: "SENDING",
        });
        await applyWhatsAppPayment({
          invoiceId: bill.id,
          fields: fields(bill.id, { pg_refund_amount: "3490.00" }),
          source: "CALLBACK",
        });
        expect(
          await prisma.whatsAppCreditLot.findUnique({ where: { invoiceId: bill.id } }),
        ).toMatchObject({ revoked: true, reserved: 1, used: 0 });
        if (unknown) throw new transport.WhatsAppUnknownSend();
        return "provider-refunded-in-flight";
      });
      await runWhatsAppWorkerBatch();
      await runWhatsAppWorkerBatch();
      expect(send).toHaveBeenCalledTimes(1);
      expect(await prisma.whatsAppMessage.findUnique({ where: { id: m.id } })).toMatchObject({
        state: unknown ? "UNKNOWN" : "SENT",
      });
      expect(
        await prisma.whatsAppCreditUse.findUnique({ where: { messageId: m.id } }),
      ).toMatchObject({ state: "RESERVED" });
      for (let attempt = 0; attempt < 2; attempt++) {
        await webhook({
          statuses: [
            {
              id: "provider-refunded-in-flight",
              status: "delivered",
              timestamp: String(Math.floor(Date.now() / 1000)),
              biz_opaque_callback_data: `bazaar-wa:${m.id}`,
            },
          ],
        });
        await reconcileWhatsAppStatuses();
      }
      expect(send).toHaveBeenCalledTimes(1);
      expect(await prisma.whatsAppMessage.findUnique({ where: { id: m.id } })).toMatchObject({
        state: "DELIVERED",
      });
      expect(
        await prisma.whatsAppCreditUse.findUnique({ where: { messageId: m.id } }),
      ).toMatchObject({ state: "USED" });
      expect(
        await prisma.whatsAppCreditLot.findUnique({ where: { invoiceId: bill.id } }),
      ).toMatchObject({ revoked: true, reserved: 0, used: 1 });
      expect(await whatsappQuota(f.org.id)).toMatchObject({ delivered: 1, paidRemaining: 0 });
    },
  );
  it("does not initiate payment while the partner/pilot/worker is unavailable", async () => {
    const input = {
      quantity: 1,
      offerVersion: WHATSAPP_OFFER_VERSION,
      termsAccepted: true,
      termsVersion: "test-v1",
      expectedAmountMinor: 349000,
      idempotencyKey: randomUUID(),
      locale: "ru",
    };
    await expect(createWhatsAppCheckout(actor(), f.store.id, input, "test")).rejects.toThrow(
      "whatsappNotReady",
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(await prisma.whatsAppInvoice.count()).toBe(0);
  });
  it("erases local content and identity without altering delivery/payment counters", async () => {
    const m = await outgoing();
    await reserveWhatsAppUnit(f.org.id, m.id);
    await settleWhatsAppUnit(f.org.id, m.id, true);
    await eraseWhatsAppConversation(actor(), conversation.id, "test");
    expect(
      await prisma.whatsAppConversation.findUnique({ where: { id: conversation.id } }),
    ).toMatchObject({ phone: null, bsuid: null, customerName: null, archived: true });
    expect(
      (await prisma.whatsAppConversation.findUniqueOrThrow({ where: { id: conversation.id } }))
        .externalIdentity,
    ).toMatch(/^erased:/);
    expect((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: m.id } })).body).toBe("");
    expect((await whatsappQuota(f.org.id)).includedUsed).toBe(1);
  });
  it("redacts old messages and contact identity automatically", async () => {
    const m = await outgoing(),
      old = new Date(Date.now() - 91 * 86400_000);
    await prisma.whatsAppMessage.update({ where: { id: m.id }, data: { createdAt: old } });
    await prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: old },
    });
    await redactExpiredWhatsAppData();
    expect((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: m.id } })).body).toBe("");
    expect(
      (await prisma.whatsAppConversation.findUniqueOrThrow({ where: { id: conversation.id } }))
        .phone,
    ).toBeNull();
  });
});
