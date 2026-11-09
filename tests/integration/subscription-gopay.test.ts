import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WHATSAPP_OFFER_VERSION,
  whatsappKnowledgeSchema,
  whatsappProfileSchema,
  whatsappPeriod,
} from "@/lib/whatsapp-ai";
import { handleFreedomPayNotification } from "@/server/billing/paymentWebhook";
import { handleGoPayNotification } from "@/server/billing/goPayWebhook";
import { LIFETIME_ORGANIZATION_IDS } from "@/server/billing/lifetimeOrganizations";
import { prisma } from "@/server/db/prisma";
import { getOrganizationPlan } from "@/server/services/planLimits";
import {
  checkWhatsAppPayment,
  createWhatsAppCheckout,
  reconcileWhatsAppPayments,
} from "@/server/whatsapp/payments";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import {
  GOPAY_FIXTURE_API_KEY,
  GOPAY_FIXTURE_API_SECRET,
  GOPAY_FIXTURE_WEBHOOK_SECRET,
  goPayProtocolFixture,
} from "../helpers/gopayProtocolFixture";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const freedomSecret = "synthetic-gopay-legacy-freedom-secret";
const emptyExtras = { stores: 0, productPacks: 0, userPacks: 0 };

describeDb("GoPay checkout, settlement and provider isolation with real PostgreSQL", () => {
  let fixture: ReturnType<typeof goPayProtocolFixture>;
  let f: Awaited<ReturnType<typeof seedBase>>;
  let caller: ReturnType<typeof createTestCaller>;

  const purchase = async (
    plan: "STARTER" | "BUSINESS" | "ENTERPRISE" = "STARTER",
    months: 1 | 6 | 12 = 1,
    extras = emptyExtras,
    action: "RENEW" | "CHANGE" = "RENEW",
    idempotencyKey = randomUUID(),
  ) => {
    const quote = await caller.billing.payments.quote({ plan, months, extras, action });
    const request = {
      plan,
      months: quote.months,
      extras,
      action,
      quoteToken: quote.quoteToken,
      expectedAmountMinor: quote.amountMinor,
      termsVersion: "gopay-qa-v1",
      acceptedTerms: true as const,
      locale: "ru" as const,
      idempotencyKey,
    };
    return { quote, request, invoice: await caller.billing.payments.checkout(request) };
  };
  const onlyPayment = () => {
    expect(fixture.payments.size).toBe(1);
    return [...fixture.payments.values()][0]!;
  };
  const settle = async (invoiceId?: string) => {
    const row = invoiceId
      ? await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoiceId } })
      : null;
    const payment = row ? fixture.payments.get(row.providerOrderId!)! : onlyPayment();
    return handleGoPayNotification(fixture.notification(fixture.commit(payment)));
  };
  const readyToCheck = (id: string) =>
    prisma.subscriptionInvoice.update({
      where: { id },
      data: { nextCheckAt: new Date(0), processingUntil: null },
    });
  const prepareWhatsApp = async (quantity = 1) => {
    for (const key of [
      "WHATSAPP_AI_ENABLED",
      "WHATSAPP_PARTNER_APPROVED",
      "WHATSAPP_PRIVACY_APPROVED",
      "WHATSAPP_PARTNER_BILLING_CONFIRMED",
      "WHATSAPP_INBOUND_SPEND_CAP_CONFIRMED",
      "WHATSAPP_PILOT_APPROVED",
      "WHATSAPP_PACK_PAYMENTS_APPROVED",
    ])
      vi.stubEnv(key, "1");
    vi.stubEnv("WHATSAPP_PUBLIC_URL", "https://bazaar.kg");
    vi.stubEnv("WHATSAPP_ENCRYPTION_KEY", "ab".repeat(32));
    await prisma.organization.update({
      where: { id: f.org.id },
      data: {
        plan: "ENTERPRISE",
        subscriptionBillingMode: "MANUAL",
        subscriptionStatus: "ACTIVE",
        currentPeriodEndsAt: new Date(Date.now() + 30 * 86400_000),
      },
    });
    await prisma.whatsAppConnection.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        state: "CONNECTED",
        providerAppId: "synthetic-app",
        profile: whatsappProfileSchema.parse({}),
        knowledge: whatsappKnowledgeSchema.parse({ storeName: "Synthetic store" }),
      },
    });
    await prisma.whatsAppWorkerState.create({
      data: { id: "worker", state: "READY", dailyPeriod: whatsappPeriod().key },
    });
    return {
      actor: { id: f.adminUser.id, organizationId: f.org.id },
      input: {
        quantity,
        offerVersion: WHATSAPP_OFFER_VERSION,
        termsAccepted: true,
        termsVersion: "gopay-qa-v1",
        expectedAmountMinor: quantity * 349_000,
        idempotencyKey: randomUUID(),
        locale: "ru",
      },
    };
  };

  beforeEach(async () => {
    await resetDatabase();
    for (const [key, value] of Object.entries({
      BILLING_PAYMENT_PROVIDER: "gopay",
      BILLING_PAYMENTS_MODE: "sandbox",
      GOPAY_API_KEY: GOPAY_FIXTURE_API_KEY,
      GOPAY_API_SECRET: GOPAY_FIXTURE_API_SECRET,
      GOPAY_WEBHOOK_SECRET: GOPAY_FIXTURE_WEBHOOK_SECRET,
      FREEDOMPAY_MERCHANT_ID: "90001",
      FREEDOMPAY_SECRET_KEY: freedomSecret,
      BILLING_PUBLIC_URL: "http://localhost:3120",
      BILLING_TERMS_URL: "http://localhost:3120/terms",
      BILLING_TERMS_VERSION: "gopay-qa-v1",
      BILLING_SELLER_NAME: "Synthetic GoPay seller",
      HARDENING_EXTERNAL_PROVIDER_MODE: "sandbox",
      VERCEL_ENV: "development",
    }))
      vi.stubEnv(key, value);
    f = await seedBase({ plan: "STARTER" });
    // Existing fixture people remain records; this new single-store contract
    // starts with one active owner, as a new real customer would.
    await prisma.user.updateMany({
      where: { organizationId: f.org.id, id: { not: f.adminUser.id } },
      data: { isActive: false },
    });
    await prisma.subscriptionContract.create({
      data: { organizationId: f.org.id, catalogVersion: "2026-11" },
    });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { subscriptionBillingMode: "SELF_SERVE", trialEndsAt: null, currentPeriodEndsAt: null },
    });
    caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    fixture = goPayProtocolFixture();
    vi.stubGlobal("fetch", fixture.transport);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    ["STARTER", 1, emptyExtras, 200_000, "2027-02-28T10:00:00.000Z"],
    [
      "BUSINESS",
      6,
      { stores: 1, productPacks: 1, userPacks: 0 },
      2_850_000,
      "2027-07-31T10:00:00.000Z",
    ],
    [
      "ENTERPRISE",
      12,
      { stores: 14, productPacks: 1, userPacks: 0 },
      20_400_000,
      "2028-01-31T10:00:00.000Z",
    ],
  ] as const)(
    "charges immutable %s/%s month KGS totals and grants only after confirmation",
    async (plan, months, extras, amount, end) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2027-01-31T10:00:00.000Z"));
      const before = await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } });
      const result = await purchase(plan, months, extras);
      expect(result.invoice).toMatchObject({
        status: "PENDING",
        amountMinor: amount,
        isTest: true,
      });
      expect(onlyPayment().amount).toBe((amount / 100).toFixed(2));
      expect(JSON.parse(String(fixture.transport.mock.calls[0]?.[1]?.body)).description).toBe(
        `Bazaar ${plan}: доступ на ${months} мес.`,
      );
      expect(await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).toEqual(
        before,
      );
      expect(await prisma.subscriptionPeriod.count()).toBe(0);
      expect((await settle()).status).toBe(200);
      const period = await prisma.subscriptionPeriod.findUniqueOrThrow({
        where: { invoiceId: result.invoice.id },
      });
      expect(period.endsAt.toISOString()).toBe(end);
      expect((await getOrganizationPlan(f.org.id)).plan).toBe(plan);
      expect(
        (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: result.invoice.id } }))
          .amountMinor,
      ).toBe(amount);
      expect(await prisma.product.count({ where: { organizationId: f.org.id } })).toBe(1);
      expect(await prisma.store.count({ where: { organizationId: f.org.id } })).toBe(1);
    },
  );

  it("creates one remote payment under concurrent checkout retries and one period under concurrent notifications", async () => {
    const key = randomUUID();
    const [first, retry] = await Promise.all([
      purchase("BUSINESS", 6, emptyExtras, "RENEW", key),
      purchase("BUSINESS", 6, emptyExtras, "RENEW", key),
    ]);
    expect(first.invoice.id).toBe(retry.invoice.id);
    expect(fixture.payments.size).toBe(1);
    expect(fixture.transport).toHaveBeenCalledTimes(1);
    const payment = fixture.commit(onlyPayment());
    const responses = await Promise.all(
      [1, 2, 3].map(() => handleGoPayNotification(fixture.notification(payment))),
    );
    expect(responses.every((response) => response.status >= 200 && response.status < 300)).toBe(
      true,
    );
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: "SUBSCRIPTION_PAYMENT_CONFIRMED" } }),
    ).toBe(1);
  });

  it("recovers an initialization response lost after provider creation without creating another payment", async () => {
    fixture.loseInitializationResponse();
    const result = await purchase();
    expect(result.invoice.status).toBe("CREATING");
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
    fixture.commit(onlyPayment());
    const retry = await caller.billing.payments.checkout(result.request);
    expect(retry.id).toBe(result.invoice.id);
    expect(fixture.transport).toHaveBeenCalledTimes(1);
    await readyToCheck(result.invoice.id);
    expect(await caller.billing.payments.check({ invoiceId: result.invoice.id })).toMatchObject({
      status: "PAID",
    });
    expect(fixture.payments.size).toBe(1);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });

  it("releases an unknown checkout only after confirmed GoPay 4041 and the one-minute grace period", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date();
    vi.setSystemTime(start);
    fixture.loseInitializationRequest();
    const result = await purchase();
    expect(result.invoice.status).toBe("CREATING");
    expect(fixture.payments.size).toBe(0);
    await readyToCheck(result.invoice.id);
    expect(await caller.billing.payments.check({ invoiceId: result.invoice.id })).toMatchObject({
      status: "CREATING",
      syncDelayed: true,
    });
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: result.invoice.id } }))
        .pendingSlot,
    ).toBe(f.org.id);
    vi.setSystemTime(new Date(start.getTime() + 61_000));
    await readyToCheck(result.invoice.id);
    expect(await caller.billing.payments.check({ invoiceId: result.invoice.id })).toMatchObject({
      status: "FAILED",
    });
    expect(
      await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: result.invoice.id } }),
    ).toMatchObject({ pendingSlot: null, lastIssue: "PAYMENT_NOT_CREATED" });
    const previousAttempts = fixture.transport.mock.calls.filter(
      ([url]) => new URL(String(url)).pathname === "/v1/payments",
    ).length;
    expect(await caller.billing.payments.checkout(result.request)).toMatchObject({
      id: result.invoice.id,
      status: "FAILED",
    });
    expect(
      fixture.transport.mock.calls.filter(
        ([url]) => new URL(String(url)).pathname === "/v1/payments",
      ),
    ).toHaveLength(previousAttempts);
    fixture.recoverInitialization();
    const next = await purchase();
    expect(next.invoice.id).not.toBe(result.invoice.id);
    expect(next.invoice.status).toBe("PENDING");
    expect(fixture.payments.size).toBe(1);
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
  });

  it("rejects a provider changed since consent before creating an invoice or calling either provider", async () => {
    const quote = await caller.billing.payments.quote({ plan: "STARTER", months: 1 });
    await expect(
      caller.billing.payments.checkout({
        plan: "STARTER",
        months: 1,
        extras: emptyExtras,
        quoteToken: quote.quoteToken,
        expectedAmountMinor: quote.amountMinor,
        expectedProvider: "FREEDOMPAY",
        idempotencyKey: randomUUID(),
        termsVersion: "gopay-qa-v1",
        acceptedTerms: true,
        locale: "ru",
      }),
    ).rejects.toThrow("billingQuoteChanged");
    expect(await prisma.subscriptionInvoice.count()).toBe(0);
    expect(fixture.transport).not.toHaveBeenCalled();
  });

  it("reconciles a missed callback and deduplicates a later callback", async () => {
    const result = await purchase();
    fixture.commit(onlyPayment());
    await readyToCheck(result.invoice.id);
    expect(await caller.billing.payments.check({ invoiceId: result.invoice.id })).toMatchObject({
      status: "PAID",
    });
    expect((await settle()).status).toBe(200);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });

  it("does not treat a signed committed notification as proof while the provider query is still unpaid", async () => {
    const result = await purchase();
    const payment = onlyPayment();
    const response = await handleGoPayNotification(
      fixture.notification(payment, {
        changes: { status: "COMMITTED", committed_at: new Date().toISOString() },
      }),
    );
    expect(response.status).toBe(200);
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: result.invoice.id } }))
        .status,
    ).not.toBe("PAID");
    expect((await settle()).status).toBe(200);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });

  it("accepts a late confirmed payment after expiry once, and ignores later stale failed notices", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2027-02-01T10:00:00.000Z");
    vi.setSystemTime(start);
    const result = await purchase();
    const payment = onlyPayment();
    payment.status = "EXPIRED";
    vi.setSystemTime(new Date(start.getTime() + 16 * 60_000));
    expect((await handleGoPayNotification(fixture.notification(payment))).status).toBe(200);
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: result.invoice.id } }))
        .status,
    ).toBe("EXPIRED");
    expect((await settle()).status).toBe(200);
    const paidOrg = await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } });
    expect(
      (
        await handleGoPayNotification(
          fixture.notification(payment, { changes: { status: "FAILED", committed_at: null } }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: result.invoice.id } }))
        .status,
    ).toBe("PAID");
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).toEqual(
      paidOrg,
    );
  });

  it("serializes a payment callback racing with status reconciliation", async () => {
    const result = await purchase();
    const payment = fixture.commit(onlyPayment());
    await readyToCheck(result.invoice.id);
    await Promise.all([
      caller.billing.payments.check({ invoiceId: result.invoice.id }),
      handleGoPayNotification(fixture.notification(payment)),
    ]);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: "SUBSCRIPTION_PAYMENT_CONFIRMED" } }),
    ).toBe(1);
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: result.invoice.id } }))
        .status,
    ).toBe("PAID");
  });

  it("rejects a webhook signed with the API secret instead of the distinct webhook secret", async () => {
    await purchase();
    const payment = fixture.commit(onlyPayment());
    fixture.transport.mockClear();
    const response = await handleGoPayNotification(
      fixture.notification(payment, { secret: GOPAY_FIXTURE_API_SECRET }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(fixture.transport).not.toHaveBeenCalled();
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
    expect(await prisma.subscriptionPaymentEvent.count()).toBe(0);
  });

  it.each([
    { amount: "0.01" },
    { payment_id: "f".repeat(32) },
    { order_id: "different-order" },
    { testing_mode: false },
  ])(
    "rejects an authenticated status response that does not match the immutable invoice: %j",
    async (change) => {
      const result = await purchase();
      fixture.commit(onlyPayment());
      fixture.overrideStatus(change);
      await readyToCheck(result.invoice.id);
      await caller.billing.payments.check({ invoiceId: result.invoice.id });
      expect(await prisma.subscriptionPeriod.count()).toBe(0);
      expect(
        (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: result.invoice.id } }))
          .status,
      ).not.toBe("PAID");
    },
  );

  it("keeps a provider status outage recoverable and grants once when the service returns", async () => {
    const result = await purchase();
    fixture.failStatus();
    await readyToCheck(result.invoice.id);
    expect(await caller.billing.payments.check({ invoiceId: result.invoice.id })).toMatchObject({
      syncDelayed: true,
    });
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: result.invoice.id } }))
        .pendingSlot,
    ).toBe(f.org.id);
    fixture.recoverStatus();
    fixture.commit(onlyPayment());
    await readyToCheck(result.invoice.id);
    expect(await caller.billing.payments.check({ invoiceId: result.invoice.id })).toMatchObject({
      status: "PAID",
    });
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });

  it("prorates an annual plan upgrade and an additional-store purchase without extending the original cycle", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-01T00:00:00.000Z"));
    const first = await purchase("STARTER", 12);
    expect((await settle(first.invoice.id)).status).toBe(200);
    const end = new Date("2028-01-01T00:00:00.000Z");
    vi.setSystemTime(
      new Date((new Date("2027-01-01T00:00:00.000Z").getTime() + end.getTime()) / 2),
    );
    const upgrade = await purchase("BUSINESS", 12, emptyExtras, "CHANGE");
    expect(upgrade.quote.creditMinor).toBe(1_020_000);
    expect(upgrade.invoice.amountMinor).toBe(765_000);
    expect((await settle(upgrade.invoice.id)).status).toBe(200);
    const extraStore = await purchase(
      "BUSINESS",
      12,
      { stores: 1, productPacks: 0, userPacks: 0 },
      "CHANGE",
    );
    expect(extraStore.invoice.amountMinor).toBe(510_000);
    expect((await settle(extraStore.invoice.id)).status).toBe(200);
    expect((await getOrganizationPlan(f.org.id)).entitlements.limits.maxStores).toBe(2);
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } }))
        .currentPeriodEndsAt,
    ).toEqual(end);
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: first.invoice.id } }))
        .amountMinor,
    ).toBe(2_040_000);
    expect(await prisma.subscriptionPeriod.count()).toBe(3);
  });

  it("locks the provider and provider order identity after invoice creation", async () => {
    const result = await purchase();
    const row = await prisma.subscriptionInvoice.findUniqueOrThrow({
      where: { id: result.invoice.id },
    });
    expect(row.provider).toBe("GOPAY");
    expect(row.providerOrderId).toBe(onlyPayment().order_id);
    await expect(
      prisma.subscriptionInvoice.update({
        where: { id: row.id },
        data: { provider: "FREEDOMPAY" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.subscriptionInvoice.update({
        where: { id: row.id },
        data: { providerOrderId: "different-provider-order" },
      }),
    ).rejects.toThrow();
    expect(await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: row.id } })).toEqual(
      row,
    );
  });

  it("protects manual access granted while checkout was pending", async () => {
    const result = await purchase();
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { subscriptionBillingMode: "MANUAL", plan: "ENTERPRISE" },
    });
    expect((await settle()).status).toBe(200);
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: result.invoice.id } }))
        .status,
    ).toBe("REVIEW");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).plan).toBe(
      "ENTERPRISE",
    );
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
  });

  it("cannot create or settle a sandbox payment in Vercel Production", async () => {
    const result = await purchase();
    const payment = fixture.commit(onlyPayment());
    fixture.transport.mockClear();
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await caller.billing.payments.get()).available).toBe(false);
    await expect(caller.billing.payments.checkout(result.request)).rejects.toThrow(
      "billingPaymentsUnavailable",
    );
    expect(
      (await handleGoPayNotification(fixture.notification(payment))).status,
    ).toBeGreaterThanOrEqual(400);
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: result.invoice.id } }))
        .status,
    ).toBe("PENDING");
  });

  it("rejects foreign-organization and staff invoice checks before any provider request", async () => {
    const result = await purchase();
    fixture.transport.mockClear();
    await expect(
      createTestCaller({ ...f.staffUser, organizationId: f.org.id }).billing.payments.check({
        invoiceId: result.invoice.id,
      }),
    ).rejects.toHaveProperty("code", "FORBIDDEN");
    const other = await prisma.organization.create({ data: { name: "Other tenant" } });
    await expect(
      createTestCaller({ ...f.adminUser, organizationId: other.id }).billing.payments.check({
        invoiceId: result.invoice.id,
      }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");
    expect(fixture.transport).not.toHaveBeenCalled();
  });

  it("preserves all five lifetime organizations, and never creates a GoPay payment for them", async () => {
    for (const id of LIFETIME_ORGANIZATION_IDS) {
      await prisma.organization.create({
        data: {
          id,
          name: `Renamed friend ${id}`,
          plan: "ENTERPRISE",
          subscriptionStatus: "ACTIVE",
          subscriptionBillingMode: "MANUAL",
          subscriptionContract: { create: { lifetimeAccess: true, catalogVersion: "2026-10" } },
        },
      });
      const user = await prisma.user.create({
        data: {
          organizationId: id,
          name: "Friend owner",
          email: `${id}@example.invalid`,
          passwordHash: "hash",
          role: "ADMIN",
          isOrgOwner: true,
          emailVerifiedAt: new Date(),
        },
      });
      const customer = createTestCaller({ ...user, organizationId: id });
      expect((await customer.billing.payments.get()).canPurchase).toBe(false);
      await expect(
        customer.billing.payments.quote({ plan: "ENTERPRISE", months: 12 }),
      ).rejects.toThrow("billingLifetimeProtected");
      expect((await getOrganizationPlan(id)).lifetimeAccess).toBe(true);
    }
    expect(fixture.transport).not.toHaveBeenCalled();
    expect(await prisma.subscriptionInvoice.count()).toBe(0);
  });

  it("rejects a FreedomPay callback for a persisted GoPay invoice, even with an authentic FreedomPay signature", async () => {
    const result = await purchase();
    const fields: Record<string, string> = {
      pg_order_id: result.invoice.id,
      pg_payment_id: onlyPayment().payment_id,
      pg_merchant_id: "90001",
      pg_amount: "2000.00",
      pg_currency: "KGS",
      pg_testing_mode: "1",
      pg_result: "1",
      pg_payment_method: "bankcard",
      pg_captured: "1",
      pg_salt: "fixture",
    };
    fields.pg_sig = createHash("md5")
      .update(
        [
          "result",
          ...Object.keys(fields)
            .sort()
            .map((key) => fields[key]),
          freedomSecret,
        ].join(";"),
      )
      .digest("hex");
    const response = await handleFreedomPayNotification(
      new Request("http://localhost/api/billing/freedompay/result", {
        method: "POST",
        body: new URLSearchParams(fields),
      }),
      "result",
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
  });

  it("continues authenticating historical FreedomPay invoices after the default provider changes to GoPay", async () => {
    const newCheckout = await purchase();
    const oldOrg = await prisma.organization.create({
      data: {
        name: "Historical FreedomPay customer",
        subscriptionBillingMode: "SELF_SERVE",
        plan: "STARTER",
        subscriptionContract: { create: { catalogVersion: "2026-10" } },
      },
    });
    const oldUser = await prisma.user.create({
      data: {
        organizationId: oldOrg.id,
        name: "Historical owner",
        email: "legacy-fp@example.invalid",
        passwordHash: "hash",
        role: "ADMIN",
        isOrgOwner: true,
        emailVerifiedAt: new Date(),
      },
    });
    // Omit the new provider field exactly as an old application/database row did.
    const oldInvoice = await prisma.subscriptionInvoice.create({
      data: {
        organizationId: oldOrg.id,
        createdById: oldUser.id,
        idempotencyKey: randomUUID(),
        pendingSlot: oldOrg.id,
        plan: "STARTER",
        amountMinor: 175_000,
        merchantId: "90001",
        isTest: true,
        providerPaymentId: "12345",
        status: "PENDING",
        termsVersion: "historical-terms",
        termsUrl: "http://localhost:3120/old-terms",
        sellerName: "Historical seller",
        expiresAt: new Date(Date.now() + 900_000),
      },
    });
    expect(oldInvoice.provider).toBe("FREEDOMPAY");
    const fields: Record<string, string> = {
      pg_order_id: oldInvoice.id,
      pg_payment_id: "12345",
      pg_merchant_id: "90001",
      pg_amount: "1750.00",
      pg_currency: "KGS",
      pg_testing_mode: "1",
      pg_result: "1",
      pg_payment_method: "bankcard",
      pg_captured: "1",
      pg_salt: "historical",
    };
    fields.pg_sig = createHash("md5")
      .update(
        [
          "result",
          ...Object.keys(fields)
            .sort()
            .map((key) => fields[key]),
          freedomSecret,
        ].join(";"),
      )
      .digest("hex");
    const response = await handleFreedomPayNotification(
      new Request("http://localhost/api/billing/freedompay/result", {
        method: "POST",
        body: new URLSearchParams(fields),
      }),
      "result",
    );
    expect(response.status).toBe(200);
    expect(await prisma.subscriptionPeriod.count({ where: { invoiceId: oldInvoice.id } })).toBe(1);
    expect(
      (
        await prisma.subscriptionInvoice.findUniqueOrThrow({
          where: { id: newCheckout.invoice.id },
        })
      ).status,
    ).toBe("PENDING");
    expect(await prisma.subscriptionPeriod.count({ where: { organizationId: f.org.id } })).toBe(0);
    expect((await settle()).status).toBe(200);
    expect(await prisma.subscriptionPeriod.count()).toBe(2);
  });

  it("purchases WhatsApp packs through GoPay without altering the subscription or inventory", async () => {
    const { actor, input } = await prepareWhatsApp(2);
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } });
    const [first, retry] = await Promise.all([
      createWhatsAppCheckout(actor, f.store.id, input, "qa"),
      createWhatsAppCheckout(actor, f.store.id, input, "qa"),
    ]);
    expect(first.id).toBe(retry.id);
    expect(fixture.payments.size).toBe(1);
    expect(onlyPayment().order_id.length).toBeLessThanOrEqual(32);
    expect(onlyPayment().amount).toBe("6980.00");
    expect(await prisma.whatsAppCreditLot.count()).toBe(0);
    const payment = fixture.commit(onlyPayment());
    await Promise.all([1, 2, 3].map(() => handleGoPayNotification(fixture.notification(payment))));
    expect(await prisma.whatsAppCreditLot.count()).toBe(1);
    expect(await prisma.whatsAppCreditLot.findFirstOrThrow()).toMatchObject({
      total: 2000,
      used: 0,
    });
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).toEqual(
      before,
    );
    expect(await prisma.product.count({ where: { organizationId: f.org.id } })).toBe(1);
  });

  it("recovers a paid WhatsApp pack without callbacks or user clicks through the scheduled reconciliation path", async () => {
    const { actor, input } = await prepareWhatsApp();
    const invoice = await createWhatsAppCheckout(actor, f.store.id, input, "qa");
    const payment = fixture.commit(onlyPayment());
    await prisma.whatsAppInvoice.update({
      where: { id: invoice.id },
      data: { nextCheckAt: new Date(0), processingUntil: null },
    });
    expect(await prisma.whatsAppCreditLot.count()).toBe(0);
    expect(await reconcileWhatsAppPayments()).toMatchObject({
      job: "whatsapp-payment-reconcile",
      status: "ok",
      details: { checked: 1, deferred: 0, failed: 0 },
    });
    expect(
      await prisma.whatsAppInvoice.findUniqueOrThrow({ where: { id: invoice.id } }),
    ).toMatchObject({ status: "PAID", pendingSlot: null });
    expect(await prisma.whatsAppCreditLot.findFirstOrThrow()).toMatchObject({
      invoiceId: invoice.id,
      total: 1000,
      used: 0,
    });
    expect(await reconcileWhatsAppPayments()).toMatchObject({
      status: "ok",
      details: { checked: 0, failed: 0 },
    });
    expect((await handleGoPayNotification(fixture.notification(payment))).status).toBe(200);
    expect(await prisma.whatsAppCreditLot.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "WHATSAPP_PACK_GRANTED" } })).toBe(1);
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
  });

  it("automatically recovers a historical FreedomPay WhatsApp payment even when the selected GoPay provider is unavailable", async () => {
    const { actor } = await prepareWhatsApp();
    const invoice = await prisma.whatsAppInvoice.create({
      data: {
        id: `wa_${randomUUID().replaceAll("-", "")}`,
        organizationId: actor.organizationId,
        createdById: actor.id,
        idempotencyKey: randomUUID(),
        pendingSlot: actor.organizationId,
        quantity: 1,
        amountMinor: 349_000,
        offerVersion: WHATSAPP_OFFER_VERSION,
        merchantId: "90001",
        isTest: true,
        providerPaymentId: "12345",
        status: "PENDING",
        termsVersion: "historical-terms",
        termsUrl: "http://localhost:3120/old-terms",
        expiresAt: new Date(Date.now() + 900_000),
        nextCheckAt: new Date(0),
      },
    });
    expect(invoice.provider).toBe("FREEDOMPAY");
    vi.stubEnv("GOPAY_API_KEY", "");
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      expect(url).toBe("https://api.freedompay.kg/get_status3.php");
      const params = Object.fromEntries(new URLSearchParams(options.body as URLSearchParams));
      const unsignedParams = Object.fromEntries(
        Object.entries(params).filter(([key]) => key !== "pg_sig"),
      );
      expect(params.pg_sig).toBe(
        createHash("md5")
          .update(
            [
              "get_status3.php",
              ...Object.keys(unsignedParams)
                .sort()
                .map((key) => unsignedParams[key]),
              freedomSecret,
            ].join(";"),
          )
          .digest("hex"),
      );
      expect(params.pg_payment_id).toBe("12345");
      const fields: Record<string, string> = {
        pg_status: "ok",
        pg_order_id: invoice.id,
        pg_payment_id: "12345",
        pg_merchant_id: "90001",
        pg_amount: "3490.00",
        pg_currency: "KGS",
        pg_testing_mode: "1",
        pg_payment_status: "success",
        pg_payment_method: "bankcard",
        pg_captured: "1",
        pg_salt: "historical-reconciliation",
      };
      fields.pg_sig = createHash("md5")
        .update(
          [
            "get_status3.php",
            ...Object.keys(fields)
              .sort()
              .map((key) => fields[key]),
            freedomSecret,
          ].join(";"),
        )
        .digest("hex");
      return new Response(
        `<response>${Object.entries(fields)
          .map(([key, value]) => `<${key}>${value}</${key}>`)
          .join("")}</response>`,
        { headers: { "content-type": "application/xml" } },
      );
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await reconcileWhatsAppPayments()).toMatchObject({
      job: "whatsapp-payment-reconcile",
      status: "ok",
      details: { checked: 1, failed: 0 },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      await prisma.whatsAppInvoice.findUniqueOrThrow({ where: { id: invoice.id } }),
    ).toMatchObject({ status: "PAID", pendingSlot: null });
    expect(await prisma.whatsAppCreditLot.findFirstOrThrow()).toMatchObject({
      invoiceId: invoice.id,
      total: 1000,
      used: 0,
    });
    expect(await reconcileWhatsAppPayments()).toMatchObject({ details: { checked: 0, failed: 0 } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await prisma.whatsAppCreditLot.count()).toBe(1);
  });

  it("stores an expired WhatsApp payment as FAILED, then grants a late confirmed pack exactly once", async () => {
    const { actor, input } = await prepareWhatsApp();
    const invoice = await createWhatsAppCheckout(actor, f.store.id, input, "qa");
    const payment = onlyPayment();
    payment.status = "EXPIRED";
    expect((await handleGoPayNotification(fixture.notification(payment))).status).toBe(200);
    expect(
      await prisma.whatsAppInvoice.findUniqueOrThrow({ where: { id: invoice.id } }),
    ).toMatchObject({ status: "FAILED", pendingSlot: null });
    expect(await prisma.whatsAppCreditLot.count()).toBe(0);
    fixture.commit(payment);
    const responses = await Promise.all(
      [1, 2, 3].map(() => handleGoPayNotification(fixture.notification(payment))),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(
      await prisma.whatsAppInvoice.findUniqueOrThrow({ where: { id: invoice.id } }),
    ).toMatchObject({ status: "PAID", pendingSlot: null });
    expect(await prisma.whatsAppCreditLot.count()).toBe(1);
    expect(await prisma.whatsAppCreditLot.findFirstOrThrow()).toMatchObject({
      total: 1000,
      used: 0,
    });
    expect(await prisma.auditLog.count({ where: { action: "WHATSAPP_PACK_GRANTED" } })).toBe(1);
  });

  it("does not grant a late confirmed WhatsApp payment while its refund is under review", async () => {
    const { actor, input } = await prepareWhatsApp();
    const invoice = await createWhatsAppCheckout(actor, f.store.id, input, "qa");
    await prisma.whatsAppInvoice.update({
      where: { id: invoice.id },
      data: { status: "REVIEW", pendingSlot: null, lastIssue: "REFUND_REVIEW" },
    });
    const before = await prisma.whatsAppInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect((await settle()).status).toBe(200);
    expect(await prisma.whatsAppInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).toEqual(
      before,
    );
    expect(await prisma.whatsAppCreditLot.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "WHATSAPP_PACK_GRANTED" } })).toBe(0);
  });

  it("protects the WhatsApp financial, provider and payment binding snapshots at the database layer", async () => {
    const { actor, input } = await prepareWhatsApp();
    const invoice = await createWhatsAppCheckout(actor, f.store.id, input, "qa");
    const before = await prisma.whatsAppInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    for (const mutation of [
      { provider: "FREEDOMPAY" as const },
      { providerOrderId: "b".repeat(32) },
      { merchantId: "different-merchant" },
      { providerPaymentId: "f".repeat(32) },
      { quantity: 2 },
      { amountMinor: 1 },
      { currency: "USD" },
      { isTest: false },
      { termsVersion: "altered-terms" },
      { offerVersion: "altered-offer" },
    ])
      await expect(
        prisma.whatsAppInvoice.update({ where: { id: invoice.id }, data: mutation }),
      ).rejects.toThrow();
    expect(await prisma.whatsAppInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).toEqual(
      before,
    );
    expect(await prisma.whatsAppCreditLot.count()).toBe(0);
  });

  it("rejects a WhatsApp provider changed since consent before creating a payable pack", async () => {
    const { actor, input } = await prepareWhatsApp();
    await expect(
      createWhatsAppCheckout(actor, f.store.id, { ...input, expectedProvider: "FREEDOMPAY" }, "qa"),
    ).rejects.toThrow("billingQuoteChanged");
    expect(await prisma.whatsAppInvoice.count()).toBe(0);
    expect(await prisma.whatsAppCreditLot.count()).toBe(0);
    expect(fixture.transport).not.toHaveBeenCalled();
  });

  it("releases an unknown WhatsApp checkout after confirmed GoPay 4041 without repeating initialization", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date();
    vi.setSystemTime(start);
    const { actor, input } = await prepareWhatsApp();
    fixture.loseInitializationRequest();
    const invoice = await createWhatsAppCheckout(actor, f.store.id, input, "qa");
    expect(invoice.status).toBe("REVIEW");
    expect(fixture.payments.size).toBe(0);
    vi.setSystemTime(new Date(start.getTime() + 61_000));
    await prisma.whatsAppInvoice.update({
      where: { id: invoice.id },
      data: { nextCheckAt: new Date(0), processingUntil: null },
    });
    expect(await checkWhatsAppPayment(actor, invoice.id)).toMatchObject({
      status: "FAILED",
      lastIssue: "PAYMENT_NOT_CREATED",
    });
    expect(
      (await prisma.whatsAppInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).pendingSlot,
    ).toBeNull();
    expect(await createWhatsAppCheckout(actor, f.store.id, input, "qa")).toMatchObject({
      id: invoice.id,
      status: "FAILED",
    });
    expect(
      fixture.transport.mock.calls.filter(
        ([url]) => new URL(String(url)).pathname === "/v1/payments",
      ),
    ).toHaveLength(1);
    expect(await prisma.whatsAppCreditLot.count()).toBe(0);
  });
});
