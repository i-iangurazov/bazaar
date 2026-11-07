import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/prisma";
import { handleFreedomPayNotification } from "@/server/billing/paymentWebhook";
import {
  resolveSubscriptionPaymentReview,
  reconcileSubscriptionPayments,
} from "@/server/billing/subscriptionPayments";
import { getPlanMonthlyPriceKgs } from "@/server/billing/planCatalog";
import { kgsToMinor } from "@/server/billing/paymentMath";
import * as auditService from "@/server/services/audit";
import { createAuthToken } from "@/server/services/authTokens";
import { registerBusinessFromToken } from "@/server/services/signup";
import { appRouter } from "@/server/trpc/routers/_app";
import { getLogger } from "@/server/logging";
import { getBillingSummary } from "@/server/services/billing";
import { LIFETIME_ORGANIZATION_IDS } from "@/server/billing/lifetimeOrganizations";
import { assertTrialActive, assertCapacity, getOrganizationPlan } from "@/server/services/planLimits";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const secret = "synthetic-subscription-test-secret";
type Fields = Record<string, string>;
// Independent provider fixture: it does not call the production signing helper.
const sign = (script: string, fields: Fields) =>
  createHash("md5")
    .update(
      [
        script,
        ...Object.keys(fields)
          .filter((k) => k !== "pg_sig")
          .sort()
          .map((k) => fields[k]),
        secret,
      ].join(";"),
    )
    .digest("hex");
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const xml = (script: string, fields: Fields) => {
  const body = { ...fields, pg_salt: "fixture", pg_sig: "" };
  body.pg_sig = sign(script, body);
  return new Response(
    `<response>${Object.entries(body)
      .map(([k, v]) => `<${k}>${escape(v)}</${k}>`)
      .join("")}</response>`,
    { headers: { "content-type": "application/xml" } },
  );
};

describeDb("subscription payments with real database and signed provider protocol", () => {
  let f: Awaited<ReturnType<typeof seedBase>>;
  let caller: ReturnType<typeof createTestCaller>;
  let transport: ReturnType<typeof vi.fn>;
  const providerPayments = new Map<string, Fields>();
  const checkout = (plan: "STARTER" | "BUSINESS" | "ENTERPRISE" = "STARTER", key = randomUUID()) =>
    caller.billing.payments.checkout({
      expectedAmountMinor: kgsToMinor(getPlanMonthlyPriceKgs(plan, "2026-10")),
      plan,
      idempotencyKey: key,
      termsVersion: "qa-v1",
      acceptedTerms: true,
      locale: "ru",
    });
  const notify = async (invoiceId: string, changes: Fields = {}, invalidSignature = false) => {
    const p = providerPayments.get(invoiceId)!;
    const fields: Fields = { ...p, pg_result: "1", pg_salt: randomUUID(), ...changes };
    fields.pg_sig = invalidSignature ? "0".repeat(32) : sign("result", fields);
    return handleFreedomPayNotification(
      new Request("http://localhost/api/billing/freedompay/result", {
        method: "POST",
        body: new URLSearchParams(fields),
      }),
      "result",
    );
  };
  const readyToCheck = (id: string) =>
    prisma.subscriptionInvoice.update({
      where: { id },
      data: { nextCheckAt: new Date(0), processingUntil: null },
    });

  beforeEach(async () => {
    await resetDatabase();
    for (const [key, value] of Object.entries({
      BILLING_PAYMENTS_MODE: "sandbox",
      FREEDOMPAY_MERCHANT_ID: "90001",
      FREEDOMPAY_SECRET_KEY: secret,
      BILLING_PUBLIC_URL: "http://localhost:3120",
      BILLING_TERMS_URL: "http://localhost:3120/terms",
      BILLING_TERMS_VERSION: "qa-v1",
      BILLING_SELLER_NAME: "Synthetic seller",
      HARDENING_EXTERNAL_PROVIDER_MODE: "sandbox",
      VERCEL_ENV: "development",
    }))
      vi.stubEnv(key, value);
    f = await seedBase({ plan: "STARTER" });
    const end = new Date(Date.now() + 7 * 86400000);
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { subscriptionBillingMode: "SELF_SERVE", trialEndsAt: end, currentPeriodEndsAt: end },
    });
    caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    providerPayments.clear();
    transport = vi.fn(async (url: string, options: RequestInit) => {
      expect(new URL(url).origin).toBe("https://api.freedompay.kg");
      const params = Object.fromEntries(new URLSearchParams(options.body as URLSearchParams));
      const script = new URL(url).pathname.slice(1);
      expect(params.pg_sig).toBe(sign(script, params));
      if (script === "init_payment.php") {
        expect(params.pg_currency).toBe("KGS");
        expect(params.pg_testing_mode).toBe("1");
        expect(params.pg_request_method).toBe("POST");
        expect(params.pg_postpone_payment).toBe("0");
        const payment = {
          pg_order_id: params.pg_order_id,
          pg_payment_id: String(1000 + providerPayments.size),
          pg_amount: params.pg_amount,
          pg_currency: params.pg_currency,
          pg_testing_mode: "1",
          pg_payment_status: "success",
          pg_captured: "1",
          pg_payment_method: "bankcard",
        };
        providerPayments.set(params.pg_order_id, payment);
        return xml(script, {
          pg_status: "ok",
          pg_payment_id: payment.pg_payment_id,
          pg_redirect_url: `https://api.freedompay.kg/pay.html?customer=${payment.pg_order_id}&source=qa`,
        });
      }
      const p = params.pg_payment_id
        ? [...providerPayments.values()].find((p) => p.pg_payment_id === params.pg_payment_id)
        : providerPayments.get(params.pg_order_id);
      return xml(script, p ? { ...p, pg_status: "ok" } : { pg_status: "ok", pg_payment_id: "0" });
    });
    vi.stubGlobal("fetch", transport);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("creates an immutable KGS invoice, calls checkout once on retries and preserves access until confirmation", async () => {
    vi.stubEnv("PLAN_PRICE_STARTER_KGS", "1890.50");
    const key = randomUUID();
    const [a, b] = await Promise.all([checkout("STARTER", key), checkout("STARTER", key)]);
    expect(a.id).toBe(b.id);
    const invoice = await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: a.id } });
    expect(invoice).toMatchObject({
      amountMinor: 189050,
      currency: "KGS",
      status: "PENDING",
      termsVersion: "qa-v1",
      sellerName: "Synthetic seller",
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
    vi.stubEnv("PLAN_PRICE_STARTER_KGS", "1999");
    expect((await notify(a.id)).status).toBe(200);
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: a.id } })).amountMinor,
    ).toBe(189050);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });
  it("concurrent callbacks grant exactly one period, one event and one audit receipt", async () => {
    const invoice = await checkout("BUSINESS");
    const responses = await Promise.all([
      notify(invoice.id),
      notify(invoice.id),
      notify(invoice.id),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
    expect(await prisma.subscriptionPaymentEvent.count()).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: "SUBSCRIPTION_PAYMENT_CONFIRMED" } }),
    ).toBe(1);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } });
    expect(org.plan).toBe("BUSINESS");
    expect(org.subscriptionBillingMode).toBe("SELF_SERVE");
    expect(org.currentPeriodEndsAt!.getTime()).toBeGreaterThan(
      f.org.createdAt.getTime() + 30 * 86400000,
    );
    await expect(assertTrialActive(org.id)).resolves.toHaveProperty("id", org.id);
  });
  it.each<Fields>([
    { pg_amount: "1" },
    { pg_currency: "USD" },
    { pg_testing_mode: "0" },
    { pg_payment_id: "999999" },
    { pg_merchant_id: "999999" },
  ])("rejects signed mismatched payment data %j without granting access", async (changes) => {
    const invoice = await checkout();
    expect((await notify(invoice.id, changes)).status).toBe(409);
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
    expect(await prisma.subscriptionPaymentEvent.count()).toBe(0);
  });
  it("rejects invalid signatures and duplicate parameters before reading or changing invoice state", async () => {
    const invoice = await checkout();
    expect((await notify(invoice.id, {}, true)).status).toBe(401);
    const request = new Request("http://localhost", {
      method: "POST",
      body: new URLSearchParams([
        ["pg_order_id", invoice.id],
        ["pg_order_id", "other"],
      ]),
    });
    expect((await handleFreedomPayNotification(request, "result")).status).toBe(400);
    expect(await prisma.subscriptionPaymentEvent.count()).toBe(0);
  });
  it("waits for capture rather than granting a period for card authorization", async () => {
    const invoice = await checkout();
    expect((await notify(invoice.id, { pg_captured: "0" })).status).toBe(200);
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
    expect((await notify(invoice.id)).status).toBe(200);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });
  it("reconciles a lost callback and does not create a second period when it finally arrives", async () => {
    const invoice = await checkout();
    await readyToCheck(invoice.id);
    const result = await caller.billing.payments.check({ invoiceId: invoice.id });
    expect(result.status).toBe("PAID");
    expect((await notify(invoice.id)).status).toBe(200);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });
  it("recovers an uncertain initialization by order id without retrying initialization", async () => {
    const ordinary = transport.getMockImplementation()!;
    transport.mockImplementationOnce(async (...args) => {
      await ordinary(...args);
      throw new Error("connection lost after provider created order");
    });
    const key = randomUUID();
    const invoice = await checkout("STARTER", key);
    expect(invoice.status).toBe("CREATING");
    await checkout("STARTER", key);
    expect(transport).toHaveBeenCalledTimes(1);
    await readyToCheck(invoice.id);
    expect((await caller.billing.payments.check({ invoiceId: invoice.id })).status).toBe("PAID");
    expect(new URL(transport.mock.calls[1][0]).pathname).toBe("/get_status3.php");
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });
  it("keeps a known failure terminal under an out-of-order pending event, but accepts a late confirmed success", async () => {
    const invoice = await checkout();
    await notify(invoice.id, { pg_result: "0" });
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
    ).toBe("FAILED");
    await notify(invoice.id, { pg_result: "2" });
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
    ).toBe("FAILED");
    await notify(invoice.id);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
    await notify(invoice.id, { pg_result: "0" });
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
    ).toBe("PAID");
  });
  it("preserves approved manual access and rejects checkout instead of silently converting old businesses", async () => {
    await prisma.organization.update({
      where: { id: f.org.id },
      data: {
        plan: "BUSINESS",
        subscriptionBillingMode: "MANUAL",
        currentPeriodEndsAt: new Date(0),
        trialEndsAt: new Date(0),
      },
    });
    await expect(checkout()).rejects.toMatchObject({ message: "billingManualAccessProtected" });
    expect(transport).not.toHaveBeenCalled();
    await expect(assertTrialActive(f.org.id)).resolves.toHaveProperty("plan", "BUSINESS");
  });
  it("keeps billing available to expired subscribers, while business mutations remain blocked until payment", async () => {
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { trialEndsAt: new Date(0), currentPeriodEndsAt: new Date(0) },
    });
    await expect(assertTrialActive(f.org.id)).rejects.toHaveProperty("message", "trialExpired");
    const invoice = await checkout();
    await notify(invoice.id);
    await expect(assertTrialActive(f.org.id)).resolves.toHaveProperty("id", f.org.id);
  });
  it("blocks unauthenticated/staff checkout and cross-organization invoice access before calling provider", async () => {
    const invoice = await checkout();
    transport.mockClear();
    await expect(
      createTestCaller({ ...f.staffUser, organizationId: f.org.id }).billing.payments.checkout({
        expectedAmountMinor: 175000,
        plan: "STARTER",
        idempotencyKey: randomUUID(),
        termsVersion: "qa-v1",
        acceptedTerms: true,
        locale: "ru",
      }),
    ).rejects.toHaveProperty("code", "FORBIDDEN");
    await expect(
      createTestCaller().billing.payments.check({ invoiceId: invoice.id }),
    ).rejects.toHaveProperty("code", "FORBIDDEN");
    const other = await prisma.organization.create({ data: { name: "Other" } });
    await expect(
      createTestCaller({ ...f.adminUser, organizationId: other.id }).billing.payments.check({
        invoiceId: invoice.id,
      }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");
    expect(transport).not.toHaveBeenCalled();
  });
  it("does not shorten a period on early renewal and preserves a month-end anchor", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-12-01T00:00:00Z"));
    const end = new Date("2028-01-31T10:00:00Z");
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { trialEndsAt: end, currentPeriodEndsAt: end },
    });
    const first = await checkout();
    await notify(first.id);
    expect(
      (
        await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })
      ).currentPeriodEndsAt?.toISOString(),
    ).toBe("2028-02-29T10:00:00.000Z");
    const second = await checkout();
    await notify(second.id);
    expect(
      (
        await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })
      ).currentPeriodEndsAt?.toISOString(),
    ).toBe("2028-03-31T10:00:00.000Z");
    const scheduled = await checkout("BUSINESS");
    await notify(scheduled.id);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).plan).toBe("STARTER");
    const scheduledPeriod = await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { invoiceId: scheduled.id } });
    expect(scheduledPeriod.startsAt.toISOString()).toBe("2028-03-31T10:00:00.000Z");
    expect(scheduledPeriod.endsAt.toISOString()).toBe("2028-04-30T10:00:00.000Z");
  });
  it("preserves manual approval applied while checkout was pending, and flags the received payment for review", async () => {
    const invoice = await checkout();
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { subscriptionBillingMode: "MANUAL", plan: "ENTERPRISE" },
    });
    expect((await notify(invoice.id)).status).toBe(200);
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
    ).toBe("REVIEW");
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).plan).toBe(
      "ENTERPRISE",
    );
  });
  it("recovery job checks pending invoices and applies payment through the same durable path", async () => {
    const invoice = await checkout();
    await readyToCheck(invoice.id);
    expect(await reconcileSubscriptionPayments()).toMatchObject({
      status: "ok",
      details: { checked: 1 },
    });
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });
  it("rejects a changed consent price before persisting or contacting the provider", async () => {
    await expect(
      caller.billing.payments.checkout({
        plan: "STARTER",
        expectedAmountMinor: 1,
        idempotencyKey: randomUUID(),
        termsVersion: "qa-v1",
        acceptedTerms: true,
        locale: "ru",
      }),
    ).rejects.toHaveProperty("message", "billingPriceChanged");
    expect(await prisma.subscriptionInvoice.count()).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  });
  it("prechecks amount, current access, signature and payment binding before provider collection", async () => {
    const invoice = await checkout();
    const check = (changes: Fields = {}) => {
      const fields = { ...providerPayments.get(invoice.id)!, pg_salt: randomUUID(), ...changes };
      return handleFreedomPayNotification(
        new Request("http://localhost", {
          method: "POST",
          body: new URLSearchParams({ ...fields, pg_sig: sign("check", fields) }),
        }),
        "check",
      );
    };
    expect((await check()).status).toBe(200);
    expect((await check({ pg_amount: "1" })).status).toBe(409);
    expect((await check({ pg_testing_mode: "0" })).status).toBe(409);
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { subscriptionBillingMode: "MANUAL" },
    });
    expect((await check()).status).toBe(409);
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
  });
  it("settles a previously created payment when new checkout has been disabled", async () => {
    const invoice = await checkout();
    vi.stubEnv("BILLING_PAYMENTS_MODE", "disabled");
    expect((await notify(invoice.id)).status).toBe(200);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
    await expect(checkout()).rejects.toHaveProperty("message", "billingPaymentsUnavailable");
  });
  it("retains refund review under old success replays and closes it only with an audited owner decision", async () => {
    const invoice = await checkout();
    await notify(invoice.id);
    await notify(invoice.id, { pg_refund_amount: "1750.00" });
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
    ).toBe("REVIEW");
    await notify(invoice.id);
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
    ).toBe("REVIEW");
    await expect(checkout()).rejects.toHaveProperty("message", "billingPaymentNeedsReview");
    await expect(
      caller.platformOwner.resolvePaymentReview({
        invoiceId: invoice.id,
        note: "Refund resolved with customer",
        confirmed: true,
      }),
    ).rejects.toHaveProperty("code", "FORBIDDEN");
    const owner = createTestCaller({
      ...f.adminUser,
      organizationId: f.org.id,
      isPlatformOwner: true,
    });
    expect((await owner.platformOwner.paymentReviews()).map((x) => x.id)).toContain(invoice.id);
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } });
    await owner.platformOwner.resolvePaymentReview({
      invoiceId: invoice.id,
      note: "Refund resolved in provider dashboard; access agreed with customer",
      confirmed: true,
    });
    await notify(invoice.id);
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
    ).toBe("RESOLVED");
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } }))
        .currentPeriodEndsAt,
    ).toEqual(before.currentPeriodEndsAt);
    expect(await prisma.auditLog.count({ where: { action: "SUBSCRIPTION_REVIEW_RESOLVED" } })).toBe(
      1,
    );
    await expect(
      resolveSubscriptionPaymentReview({
        invoiceId: invoice.id,
        actorId: f.adminUser.id,
        note: "Duplicate review",
        requestId: randomUUID(),
      }),
    ).rejects.toHaveProperty("message", "billingReviewAlreadyResolved");
  });
  it("enforces immutable money and same-organization paid periods in PostgreSQL", async () => {
    const invoice = await checkout();
    await expect(
      prisma.subscriptionInvoice.update({ where: { id: invoice.id }, data: { amountMinor: 1 } }),
    ).rejects.toThrow();
    const other = await prisma.organization.create({ data: { name: "Other invoice tenant" } });
    await expect(
      prisma.subscriptionPeriod.create({
        data: {
          invoiceId: invoice.id,
          organizationId: other.id,
          plan: "STARTER",
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 86400000),
        },
      }),
    ).rejects.toThrow();
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
  });
  it("claims reconciliation once under concurrency and exposes a provider outage to recovery health", async () => {
    const invoice = await checkout();
    await readyToCheck(invoice.id);
    transport.mockClear();
    await Promise.all([
      caller.billing.payments.check({ invoiceId: invoice.id }),
      caller.billing.payments.check({ invoiceId: invoice.id }),
    ]);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
    await readyToCheck(invoice.id);
    transport.mockRejectedValue(new Error("Synthetic outage"));
    // A paid receipt stays paid even if a later provider refresh is unavailable.
    expect((await caller.billing.payments.check({ invoiceId: invoice.id })).status).toBe("PAID");
    const second = await checkout();
    await readyToCheck(second.id);
    expect(await reconcileSubscriptionPayments()).toMatchObject({
      status: "skipped",
      details: { failed: 1, reason: "failed" },
    });
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: second.id } }))
        .processingToken,
    ).toBeNull();
  });
  it("returns tenant-scoped history with stable pagination", async () => {
    const invoice = await checkout();
    await notify(invoice.id, { pg_result: "0" });
    const snapshot = await prisma.subscriptionInvoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    await prisma.subscriptionInvoice.createMany({
      data: Array.from({ length: 22 }, (_, i) => ({
        ...snapshot,
        purchaseSnapshot: snapshot.purchaseSnapshot ?? undefined,
        id: randomUUID(),
        idempotencyKey: randomUUID(),
        providerPaymentId: null,
        createdAt: new Date(Date.now() + i + 1),
      })),
    });
    const first = await caller.billing.payments.invoices({});
    const next = await caller.billing.payments.invoices({ cursor: first.nextCursor });
    expect(first.items).toHaveLength(20);
    expect(next.items).toHaveLength(3);
    expect(new Set([...first.items, ...next.items].map((x) => x.id)).size).toBe(23);
    const other = await prisma.organization.create({ data: { name: "History other" } });
    await expect(
      createTestCaller({ ...f.adminUser, organizationId: other.id }).billing.payments.invoices({
        cursor: invoice.id,
      }),
    ).rejects.toThrow("recordNotFound");
  });
  it("retains separately extended trial days when the stored billing end is older", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-12-01T00:00:00Z"));
    const trial = new Date("2028-01-31T10:00:00Z");
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { trialEndsAt: trial, currentPeriodEndsAt: new Date(0) },
    });
    const invoice = await checkout();
    await notify(invoice.id);
    const period = await prisma.subscriptionPeriod.findUniqueOrThrow({
      where: { invoiceId: invoice.id },
    });
    expect(period.startsAt).toEqual(trial);
    expect(period.endsAt.toISOString()).toBe("2028-02-29T10:00:00.000Z");
  });
  it("enrolls only new registrations after explicit rollout and never converts a legacy organization", async () => {
    const register = async () => {
      const user = await prisma.user.create({
        data: {
          email: `${randomUUID()}@example.invalid`,
          name: "Synthetic signup",
          role: "ADMIN",
          passwordHash: "synthetic-unused",
        },
      });
      const token = await createAuthToken({
        userId: user.id,
        email: user.email,
        purpose: "REGISTRATION",
        expiresInMinutes: 60,
      });
      const result = await registerBusinessFromToken({
        token: token.raw,
        orgName: "Synthetic registration",
        storeName: "Store",
        storeCode: "QA",
        requestId: randomUUID(),
      });
      return prisma.organization.findUniqueOrThrow({ where: { id: result.organizationId } });
    };
    vi.stubEnv("BILLING_SELF_SERVE_SIGNUP", "0");
    expect((await register()).subscriptionBillingMode).toBe("MANUAL");
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { subscriptionBillingMode: "MANUAL" },
    });
    vi.stubEnv("BILLING_SELF_SERVE_SIGNUP", "1");
    expect((await register()).subscriptionBillingMode).toBe("SELF_SERVE");
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } }))
        .subscriptionBillingMode,
    ).toBe("MANUAL");
    vi.stubEnv("BILLING_PAYMENTS_MODE", "disabled");
    expect((await register()).subscriptionBillingMode).toBe("MANUAL");
  });
  it("forbids payment operations during impersonation", async () => {
    const user = {
      ...f.adminUser,
      organizationId: f.org.id,
      isPlatformOwner: false,
      isOrgOwner: true,
    };
    const impersonated = appRouter.createCaller({
      prisma,
      user,
      impersonator: { ...user, isPlatformOwner: true },
      impersonationSessionId: "synthetic-session",
      ip: null,
      requestId: randomUUID(),
      logger: getLogger("synthetic-payment-impersonation"),
    });
    await expect(impersonated.billing.payments.get()).rejects.toHaveProperty("code", "FORBIDDEN");
    await expect(
      impersonated.billing.payments.checkout({
        plan: "STARTER",
        expectedAmountMinor: 175000,
        idempotencyKey: randomUUID(),
        termsVersion: "qa-v1",
        acceptedTerms: true,
        locale: "ru",
      }),
    ).rejects.toHaveProperty("code", "FORBIDDEN");
    expect(transport).not.toHaveBeenCalled();
  });
  it("recovers a late payment after an earlier failure even if the final callback was lost", async () => {
    const invoice = await checkout();
    await notify(invoice.id, { pg_result: "0" });
    await readyToCheck(invoice.id);
    expect(await reconcileSubscriptionPayments()).toMatchObject({
      status: "ok",
      details: { checked: 1 },
    });
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
    ).toBe("PAID");
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });
  it("preserves exact existing dates when the owner edits only billing mode, and changes dates only explicitly", async () => {
    const owner = createTestCaller({
      ...f.adminUser,
      organizationId: f.org.id,
      isPlatformOwner: true,
    });
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } });
    await owner.platformOwner.updateOrganizationBilling({
      organizationId: f.org.id,
      plan: "STARTER",
      subscriptionStatus: "ACTIVE",
      subscriptionBillingMode: "MANUAL",
    });
    const after = await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } });
    expect(after.currentPeriodEndsAt).toEqual(before.currentPeriodEndsAt);
    expect(after.trialEndsAt).toEqual(before.trialEndsAt);
    const changed = await owner.platformOwner.updateOrganizationBilling({
      organizationId: f.org.id,
      plan: "STARTER",
      subscriptionStatus: "ACTIVE",
      trialDays: 0,
      currentPeriodDays: 60,
    });
    expect(changed.trialEndsAt).toBeNull();
    expect(
      Math.abs(changed.currentPeriodEndsAt!.getTime() - Date.now() - 60 * 86400000),
    ).toBeLessThan(2000);
  });
  it("rolls back an owner billing change when its audit write fails", async () => {
    const owner = createTestCaller({
      ...f.adminUser,
      organizationId: f.org.id,
      isPlatformOwner: true,
    });
    const audit = vi
      .spyOn(auditService, "writeAuditLog")
      .mockRejectedValueOnce(new Error("Synthetic audit failure"));
    try {
      await expect(
        owner.platformOwner.updateOrganizationBilling({
          organizationId: f.org.id,
          plan: "ENTERPRISE",
          subscriptionStatus: "ACTIVE",
          subscriptionBillingMode: "MANUAL",
        }),
      ).rejects.toThrow("Synthetic audit failure");
    } finally {
      audit.mockRestore();
    }
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } });
    expect(org.plan).toBe("STARTER");
    expect(org.subscriptionBillingMode).toBe("SELF_SERVE");
  });
  const modernContract = async () => {
    // A new single-owner contract; historical fixture users remain as inactive records.
    await prisma.user.updateMany({ where: { organizationId: f.org.id, id: { not: f.adminUser.id } }, data: { isActive: false } });
    await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11" } });
    await prisma.organization.update({ where: { id: f.org.id }, data: { trialEndsAt: null, currentPeriodEndsAt: null } });
  };
  const purchase = async (
    plan: "STARTER" | "BUSINESS" | "ENTERPRISE", months: 1 | 6 | 12 = 1,
    extras = { stores: 0, productPacks: 0, userPacks: 0 }, action: "RENEW" | "CHANGE" = "RENEW",
    idempotencyKey = randomUUID(),
  ) => {
    const quote = await caller.billing.payments.quote({ plan, months, extras, action });
    const request = { plan, months: quote.months, extras, action, quoteToken: quote.quoteToken,
      expectedAmountMinor: quote.amountMinor, idempotencyKey, termsVersion: "qa-v1" as const,
      acceptedTerms: true as const, locale: "ru" as const };
    return { quote, request, invoice: await caller.billing.payments.checkout(request) };
  };

  it.each([
    ["STARTER", 6, 1140000], ["STARTER", 12, 2040000],
    ["BUSINESS", 6, 1995000], ["BUSINESS", 12, 3570000],
    ["ENTERPRISE", 6, 3135000], ["ENTERPRISE", 12, 5610000],
  ] as const)("v2: charges %s for %s months once and grants the complete term", async (plan, months, expected) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-31T10:00:00.000Z"));
    await modernContract();
    const result = await purchase(plan, months);
    expect(result.invoice.amountMinor).toBe(expected);
    await Promise.all([notify(result.invoice.id), notify(result.invoice.id), notify(result.invoice.id)]);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
    const period = await prisma.subscriptionPeriod.findFirstOrThrow();
    expect(period.endsAt.toISOString()).toBe(months === 6 ? "2027-07-31T10:00:00.000Z" : "2028-01-31T10:00:00.000Z");
    expect((await getOrganizationPlan(f.org.id)).plan).toBe(plan);
  });

  it("v2: bills extra capacity with the term discount and enforces purchased store capacity", async () => {
    await modernContract();
    const result = await purchase("BUSINESS", 6, { stores: 1, productPacks: 1, userPacks: 0 });
    expect(result.invoice.amountMinor).toBe(2850000);
    await notify(result.invoice.id);
    const summary = await caller.billing.get();
    expect(summary?.limits).toEqual({ maxStores: 2, maxProducts: 6000, maxUsers: 7 });
    await assertCapacity({ organizationId: f.org.id, kind: "stores", add: 1 });
    await prisma.store.create({ data: { organizationId: f.org.id, name: "Extra store", code: "EXT" } });
    await expect(assertCapacity({ organizationId: f.org.id, kind: "stores", add: 1 })).rejects.toThrow();
    expect((await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: result.invoice.id } })).purchaseSnapshot).toMatchObject({ extras: { stores: 1, productPacks: 1, userPacks: 0 } });
  });

  it("v2: prorates successive annual upgrades and preserves the original end date and every prior invoice", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2027-01-01T00:00:00.000Z");
    vi.setSystemTime(start);
    await modernContract();
    const first = await purchase("STARTER", 12);
    await notify(first.invoice.id);
    const end = new Date("2028-01-01T00:00:00.000Z");
    vi.setSystemTime(new Date(start.getTime() + (end.getTime() - start.getTime()) / 2));
    const second = await purchase("BUSINESS", 12, { stores: 0, productPacks: 0, userPacks: 0 }, "CHANGE");
    expect(second.quote.creditMinor).toBe(1020000);
    expect(second.invoice.amountMinor).toBe(765000);
    await notify(second.invoice.id);
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("BUSINESS");
    vi.setSystemTime(new Date(start.getTime() + (end.getTime() - start.getTime()) * 3 / 4));
    const third = await purchase("ENTERPRISE", 12, { stores: 0, productPacks: 0, userPacks: 0 }, "CHANGE");
    expect(third.quote.creditMinor).toBe(892500);
    expect(third.invoice.amountMinor).toBe(510000);
    await notify(third.invoice.id);
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("ENTERPRISE");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).currentPeriodEndsAt).toEqual(end);
    expect((await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: first.invoice.id } })).amountMinor).toBe(2040000);
    expect(await prisma.subscriptionPeriod.count()).toBe(3);
  });

  it("v2: schedules a downgrade without removing current access, then applies its features at the boundary", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-01T00:00:00.000Z"));
    await modernContract();
    const first = await purchase("ENTERPRISE", 1);
    await notify(first.invoice.id);
    vi.setSystemTime(new Date("2027-01-10T00:00:00.000Z"));
    await expect(caller.billing.payments.quote({ plan: "STARTER", action: "CHANGE" })).rejects.toThrow("billingDowngradeNextPeriod");
    const second = await purchase("STARTER", 1);
    await notify(second.invoice.id);
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("ENTERPRISE");
    vi.setSystemTime(new Date("2027-02-01T00:00:01.000Z"));
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("STARTER");
    const features = await caller.billing.features();
    expect(features?.featureFlags.analytics).toBe(false);
    expect(await prisma.user.count({ where: { organizationId: f.org.id } })).toBe(4);
    expect(await prisma.product.count({ where: { organizationId: f.org.id } })).toBe(1);
  });

  it("v2: rejects altered amounts and stale/foreign quotes before contacting the provider", async () => {
    await modernContract();
    const quote = await caller.billing.payments.quote({ plan: "STARTER", months: 12 });
    const request = { plan: "STARTER" as const, months: 12 as const, quoteToken: quote.quoteToken,
      expectedAmountMinor: 1, termsVersion: "qa-v1", acceptedTerms: true as const, locale: "ru" as const,
      idempotencyKey: randomUUID() };
    await expect(caller.billing.payments.checkout(request)).rejects.toThrow("billingPriceChanged");
    const bad = quote.quoteToken.split(".");
    bad[0] = Buffer.from(JSON.stringify({ ...quote, amountMinor: 1 })).toString("base64url");
    await expect(caller.billing.payments.checkout({ ...request, quoteToken: bad.join(".") })).rejects.toThrow("billingQuoteChanged");
    expect(transport).not.toHaveBeenCalled();
    expect(await prisma.subscriptionInvoice.count()).toBe(0);
  });

  it("v2: retries preserve the full selection and cannot reuse a payment key for different add-ons", async () => {
    await modernContract();
    const result = await purchase("BUSINESS", 12, { stores: 1, productPacks: 0, userPacks: 0 });
    expect((await caller.billing.payments.checkout(result.request)).id).toBe(result.invoice.id);
    await expect(caller.billing.payments.checkout({ ...result.request, extras: { stores: 2, productPacks: 0, userPacks: 0 } })).rejects.toThrow("idempotencyConflict");
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(prisma.subscriptionInvoice.update({ where: { id: result.invoice.id }, data: { purchaseSnapshot: { amountMinor: 1 } } })).rejects.toThrow();
  });

  it("preserves all five lifetime grants by identity, after renaming, without charging or altering their plans", async () => {
    for (const id of LIFETIME_ORGANIZATION_IDS) {
      const organization = await prisma.organization.create({ data: {
        id, name: `Renamed ${id}`, plan: "ENTERPRISE", subscriptionStatus: "ACTIVE",
        subscriptionBillingMode: "MANUAL", trialEndsAt: new Date(0), currentPeriodEndsAt: new Date(0),
        subscriptionContract: { create: { catalogVersion: "2026-10", lifetimeAccess: true } },
      } });
      const user = await prisma.user.create({ data: { organizationId: id, name: "Lifetime admin", email: `${id}@example.invalid`, passwordHash: "hash", role: "ADMIN", isOrgOwner: true, emailVerifiedAt: new Date() } });
      const customer = createTestCaller({ ...user, organizationId: id });
      expect((await getOrganizationPlan(id)).lifetimeAccess).toBe(true);
      await assertTrialActive(id);
      const state = await customer.billing.payments.get();
      expect(state.canPurchase).toBe(false);
      expect((await customer.billing.get())?.monthlyPriceKgs).toBe(0);
      await expect(customer.billing.payments.quote({ plan: "STARTER", months: 12 })).rejects.toThrow("billingLifetimeProtected");
      await expect(prisma.organization.update({ where: { id }, data: { subscriptionBillingMode: "SELF_SERVE" } })).rejects.toThrow();
      await expect(prisma.subscriptionContract.update({ where: { organizationId: id }, data: { lifetimeAccess: false } })).rejects.toThrow();
      expect(await prisma.organization.findUniqueOrThrow({ where: { id } })).toEqual(organization);
    }
    const namesake = await prisma.organization.create({ data: { name: "Avant", subscriptionContract: { create: { catalogVersion: "2026-11" } } } });
    expect((await getOrganizationPlan(namesake.id)).lifetimeAccess).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("legacy terms retain their old prices and capacities while new registrations use the new catalog", async () => {
    await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-10" } });
    await prisma.organization.update({ where: { id: f.org.id }, data: { plan: "ENTERPRISE" } });
    const state = await caller.billing.get();
    expect(state?.monthlyPriceKgs).toBe(8750);
    expect(state?.limits.maxUsers).toBe(20);
    expect(state?.billingCatalogVersion).toBe("2026-10");
    const modern = await prisma.organization.create({ data: { name: "New customer", plan: "ENTERPRISE", subscriptionContract: { create: { catalogVersion: "2026-11" } } } });
    const summary = await getBillingSummary({ organizationId: modern.id });
    expect(summary?.monthlyPriceKgs).toBe(5500);
    expect(summary?.limits.maxUsers).toBe(15);
  });

  it("rejects a rollback-era one-month grant for a six-month invoice without corrupting payment recovery", async () => {
    await modernContract();
    const result = await purchase("STARTER", 6);
    const now = new Date();
    await expect(prisma.subscriptionPeriod.create({ data: {
      invoiceId: result.invoice.id, organizationId: f.org.id, plan: "STARTER",
      startsAt: now, endsAt: new Date(now.getTime() + 30 * 86400000),
    } })).rejects.toThrow();
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
    await notify(result.invoice.id);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
    expect((await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: result.invoice.id } })).status).toBe("PAID");
  });

});
