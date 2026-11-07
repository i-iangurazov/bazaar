import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { handleFreedomPayNotification } from "@/server/billing/paymentWebhook";
import { getSubscriptionQuote } from "@/server/billing/subscriptionQuotes";
import { verifyPurchaseQuote } from "@/server/billing/purchaseSnapshot";
import { minorToKgs } from "@/server/billing/paymentMath";
import { parseFreedomPayXml } from "@/server/billing/freedomPay";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const secret = "synthetic-freedompay-precheck-secret";
const sign = (script: string, fields: Record<string, string>) =>
  createHash("md5")
    .update(
      [
        script,
        ...Object.keys(fields)
          .filter((key) => key !== "pg_sig")
          .sort()
          .map((key) => fields[key]),
        secret,
      ].join(";"),
    )
    .digest("hex");

describeDb("subscription provider precheck against current locked organization state", () => {
  let fixture: Awaited<ReturnType<typeof seedBase>>;
  let blockedNetwork: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    await resetDatabase();
    for (const [key, value] of Object.entries({
      BILLING_PAYMENTS_MODE: "sandbox",
      FREEDOMPAY_MERCHANT_ID: "90002",
      FREEDOMPAY_SECRET_KEY: secret,
      BILLING_PUBLIC_URL: "http://localhost:3120",
      BILLING_TERMS_URL: "http://localhost:3120/terms",
      BILLING_TERMS_VERSION: "qa-precheck-v1",
      BILLING_SELLER_NAME: "Synthetic seller",
      HARDENING_EXTERNAL_PROVIDER_MODE: "sandbox",
      VERCEL_ENV: "development",
      NEXTAUTH_SECRET: "synthetic-precheck-hmac-secret",
    }))
      vi.stubEnv(key, value);
    blockedNetwork = vi.fn(() => {
      throw new Error("A precheck test must never call an external provider");
    });
    vi.stubGlobal("fetch", blockedNetwork);
    fixture = await seedBase({ plan: "ENTERPRISE" });
    await prisma.user.updateMany({
      where: { organizationId: fixture.org.id, id: { not: fixture.adminUser.id } },
      data: { isActive: false },
    });
    await prisma.subscriptionContract.create({
      data: { organizationId: fixture.org.id, catalogVersion: "2026-11" },
    });
    const trialEnd = new Date(Date.now() + 7 * 86400000);
    await prisma.organization.update({
      where: { id: fixture.org.id },
      data: {
        subscriptionBillingMode: "SELF_SERVE",
        subscriptionStatus: "ACTIVE",
        trialEndsAt: trialEnd,
        currentPeriodEndsAt: trialEnd,
      },
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const quote = () =>
    getSubscriptionQuote(fixture.org.id, {
      plan: "STARTER",
      months: 6,
      extras: { stores: 0, productPacks: 0, userPacks: 0 },
      action: "RENEW",
    });
  const persistPending = async (
    issued: Awaited<ReturnType<typeof quote>>,
    paymentId = "1234567",
  ) => {
    // A genuine server-issued HMAC quote, persisted without initializing a real
    // provider. This also reproduces invoices created before a competing change.
    const snapshot = verifyPurchaseQuote(issued.quoteToken, fixture.org.id);
    return prisma.subscriptionInvoice.create({
      data: {
        organizationId: fixture.org.id,
        createdById: fixture.adminUser.id,
        idempotencyKey: randomUUID(),
        pendingSlot: fixture.org.id,
        plan: snapshot.plan,
        amountMinor: snapshot.amountMinor,
        purchaseSnapshot: snapshot,
        merchantId: "90002",
        isTest: true,
        providerPaymentId: paymentId,
        status: "PENDING",
        termsVersion: "qa-precheck-v1",
        termsUrl: "http://localhost:3120/terms",
        sellerName: "Synthetic seller",
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });
  };
  const check = async (
    invoice: Awaited<ReturnType<typeof persistPending>>,
    changes: Record<string, string> = {},
    badSignature = false,
  ) => {
    const fields = {
      pg_order_id: invoice.id,
      pg_payment_id: invoice.providerPaymentId!,
      pg_merchant_id: invoice.merchantId,
      pg_amount: minorToKgs(invoice.amountMinor),
      pg_currency: "KGS",
      pg_testing_mode: "1",
      pg_salt: randomUUID(),
      ...changes,
    };
    const response = await handleFreedomPayNotification(
      new Request("http://localhost/api/billing/freedompay/check", {
        method: "POST",
        body: new URLSearchParams({
          ...fields,
          pg_sig: badSignature ? "0".repeat(32) : sign("check", fields),
        }),
      }),
      "check",
    );
    const acknowledgement = await parseFreedomPayXml(await response.text());
    expect(acknowledgement.pg_sig).toBe(sign("check", acknowledgement as Record<string, string>));
    expect(blockedNetwork).not.toHaveBeenCalled();
    return { response, acknowledgement };
  };
  const unchanged = async (invoiceId: string) => {
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
    expect(await prisma.subscriptionPaymentEvent.count()).toBe(0);
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoiceId } })).status,
    ).toBe("PENDING");
  };

  it("accepts a valid signed precheck but creates no paid event or access", async () => {
    const invoice = await persistPending(await quote());
    const { response, acknowledgement } = await check(invoice);
    expect(response.status).toBe(200);
    expect(acknowledgement.pg_status).toBe("ok");
    await unchanged(invoice.id);
  });
  it("rejects an owner plan change before permitting collection", async () => {
    const invoice = await persistPending(await quote());
    await prisma.organization.update({ where: { id: fixture.org.id }, data: { plan: "BUSINESS" } });
    expect((await check(invoice)).response.status).toBe(409);
    await unchanged(invoice.id);
  });
  it("rejects an owner paid-end change before permitting collection", async () => {
    const invoice = await persistPending(await quote());
    await prisma.organization.update({
      where: { id: fixture.org.id },
      data: { currentPeriodEndsAt: new Date(Date.now() + 30 * 86400000) },
    });
    expect((await check(invoice)).response.status).toBe(409);
    await unchanged(invoice.id);
  });
  it("rejects an invoice whose downgrade now has an unprepared operational module", async () => {
    const issued = await quote();
    await prisma.store.update({ where: { id: fixture.store.id }, data: { trackExpiryLots: true } });
    const invoice = await persistPending(issued);
    const { response, acknowledgement } = await check(invoice);
    expect(response.status).toBe(409);
    expect(acknowledgement.pg_status).toBe("error");
    await unchanged(invoice.id);
  });
  it.each<Record<string, string>>([
    { pg_amount: "1" },
    { pg_currency: "USD" },
    { pg_payment_id: "999" },
    { pg_testing_mode: "0" },
  ])("rejects signed binding mismatch %j", async (changes) => {
    const invoice = await persistPending(await quote());
    expect((await check(invoice, changes)).response.status).toBe(409);
    await unchanged(invoice.id);
  });
  it("rejects a forged provider check before any state change", async () => {
    const invoice = await persistPending(await quote());
    expect((await check(invoice, {}, true)).response.status).toBe(401);
    await unchanged(invoice.id);
  });
  it("rejects a stale upgrade source after a late same-plan capacity payment, even when stored plan and end date are unchanged", async () => {
    await prisma.organization.update({
      where: { id: fixture.org.id },
      data: { plan: "BUSINESS", trialEndsAt: null, currentPeriodEndsAt: null },
    });
    const baseQuote = await getSubscriptionQuote(fixture.org.id, {
      plan: "BUSINESS",
      months: 12,
      extras: { stores: 0, productPacks: 0, userPacks: 0 },
      action: "RENEW",
    });
    const baseInvoice = await persistPending(baseQuote, "1234500");
    await prisma.subscriptionInvoice.update({
      where: { id: baseInvoice.id },
      data: { status: "PAID", pendingSlot: null, paidAt: new Date() },
    });
    await prisma.subscriptionPeriod.create({
      data: {
        invoiceId: baseInvoice.id,
        organizationId: fixture.org.id,
        plan: "BUSINESS",
        startsAt: new Date(baseQuote.startsAt),
        endsAt: new Date(baseQuote.endsAt),
        purchaseSnapshot: verifyPurchaseQuote(baseQuote.quoteToken, fixture.org.id),
      },
    });
    await prisma.organization.update({
      where: { id: fixture.org.id },
      data: { currentPeriodEndsAt: new Date(baseQuote.endsAt) },
    });
    const capacityQuote = await getSubscriptionQuote(fixture.org.id, {
      plan: "BUSINESS",
      months: 12,
      extras: { stores: 0, productPacks: 1, userPacks: 0 },
      action: "CHANGE",
    });
    const capacityInvoice = await persistPending(capacityQuote, "1234501");
    await prisma.subscriptionInvoice.update({
      where: { id: capacityInvoice.id },
      data: { status: "FAILED", pendingSlot: null },
    });
    const upgradeQuote = await getSubscriptionQuote(fixture.org.id, {
      plan: "ENTERPRISE",
      months: 12,
      extras: { stores: 0, productPacks: 0, userPacks: 0 },
      action: "CHANGE",
    });
    const upgradeInvoice = await persistPending(upgradeQuote, "1234502");
    expect((await check(upgradeInvoice)).response.status).toBe(200);
    const fields = {
      pg_order_id: capacityInvoice.id,
      pg_payment_id: capacityInvoice.providerPaymentId!,
      pg_amount: minorToKgs(capacityInvoice.amountMinor),
      pg_currency: "KGS",
      pg_testing_mode: "1",
      pg_result: "1",
      pg_captured: "1",
      pg_payment_method: "bankcard",
      pg_salt: randomUUID(),
    };
    const lateResult = await handleFreedomPayNotification(
      new Request("http://localhost/api/billing/freedompay/result", {
        method: "POST",
        body: new URLSearchParams({ ...fields, pg_sig: sign("result", fields) }),
      }),
      "result",
    );
    expect(lateResult.status).toBe(200);
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: fixture.org.id } }))
        .currentPeriodEndsAt,
    ).toEqual(new Date(baseQuote.endsAt));
    expect(await prisma.subscriptionPeriod.count()).toBe(2);
    expect((await check(upgradeInvoice)).response.status).toBe(409);
    expect(await prisma.subscriptionPeriod.count()).toBe(2);
    expect(
      (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: upgradeInvoice.id } }))
        .status,
    ).toBe("PENDING");
  });
  it("reads the final owner change after waiting on the organization row lock", async () => {
    const invoice = await persistPending(await quote());
    let unlock!: () => void;
    let ready!: () => void;
    const wait = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const owner = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${fixture.org.id} FOR UPDATE`;
      ready();
      await wait;
      await tx.organization.update({ where: { id: fixture.org.id }, data: { plan: "BUSINESS" } });
    });
    await locked;
    const checking = check(invoice);
    unlock();
    await owner;
    expect((await checking).response.status).toBe(409);
    await unchanged(invoice.id);
  });
});
