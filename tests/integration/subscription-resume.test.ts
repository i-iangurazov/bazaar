import { randomUUID } from "node:crypto";
import { Type } from "@apple/app-store-server-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createContractTerms } from "@/server/billing/contractTerms";
import { createSubscriptionCheckout, resumeSubscriptionCheckout } from "@/server/billing/subscriptionPayments";
import { getSubscriptionQuote, type SubscriptionQuoteInput } from "@/server/billing/subscriptionQuotes";
import { appleSubscriptionOffer } from "@/server/billing/appleOfferCatalog";
import { createApplePurchaseIntent, authorizeApplePurchase, applyAppleTransaction, getApplePurchasePreview } from "@/server/billing/applePayments";
import { applyAppleSignedRenewal } from "@/server/billing/appleLifecycle";
import { handleGoPayNotification } from "@/server/billing/goPayWebhook";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { syntheticAppleTransaction, syntheticAppleVerifier, signSyntheticApplePayload } from "../helpers/appleSignedFixture";
import { GOPAY_FIXTURE_API_KEY, GOPAY_FIXTURE_API_SECRET, GOPAY_FIXTURE_WEBHOOK_SECRET, goPayProtocolFixture } from "../helpers/gopayProtocolFixture";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const terms = createContractTerms("2026-11");
const selection = { plan: "BUSINESS" as const, months: 1 as const, extras: { stores: 0, productPacks: 0, userPacks: 0 as const }, action: "RENEW" as const };
const offer = appleSubscriptionOffer(terms, selection);

describeDb("fresh validation of saved GoPay payment links", () => {
  let f: Awaited<ReturnType<typeof seedBase>>;
  let provider: ReturnType<typeof goPayProtocolFixture>;
  const actor = () => ({ id: f.adminUser.id, organizationId: f.org.id });
  const checkout = async (input: SubscriptionQuoteInput = selection) => {
    const quote = await getSubscriptionQuote(f.org.id, input);
    return createSubscriptionCheckout({ ...input, actorId: f.adminUser.id, organizationId: f.org.id, idempotencyKey: randomUUID(),
      quoteToken: quote.quoteToken, expectedAmountMinor: quote.amountMinor, termsVersion: LEGAL_TERMS_VERSION,
      expectedProvider: "GOPAY", locale: "ru", requestId: "synthetic-resume" });
  };
  const resume = (invoiceId: string) => resumeSubscriptionCheckout({ actorId: f.adminUser.id, organizationId: f.org.id, invoiceId });
  const expiredApple = async () => {
    for (const [key, value] of Object.entries({ APPLE_BILLING_MODE: "sandbox", APPLE_APP_ID: "1234567890", APPLE_IAP_KEY_ID: "SYNTHETIC",
      APPLE_IAP_ISSUER_ID: "SYNTHETIC", APPLE_IAP_PRIVATE_KEY: "SYNTHETIC PRIVATE KEY", APPLE_BILLING_TERMS_VERSION: LEGAL_TERMS_VERSION,
      APPLE_BILLING_TERMS_APPROVED: "true", APPLE_BILLING_SALES_APPROVED: "true", APPLE_BILLING_SANDBOX_ORGANIZATION_IDS: f.org.id,
      APPLE_BILLING_CATALOG_JSON: JSON.stringify([{ offerKey: offer.offerKey, productId: "synthetic.resume.business", productType: "AUTO_RENEWABLE",
        subscriptionGroupId: "synthetic-resume-group", approved: true }]) })) vi.stubEnv(key, value);
    const intent = await createApplePurchaseIntent(actor(), { expectedOrganizationId: f.org.id, offerKey: offer.offerKey, action: "RENEW",
      idempotencyKey: randomUUID(), acceptedTerms: true, termsVersion: LEGAL_TERMS_VERSION });
    await authorizeApplePurchase(actor(), intent.intentId);
    const signed = syntheticAppleTransaction({ appAccountToken: intent.appAccountToken, productId: intent.productId,
      type: Type.AUTO_RENEWABLE_SUBSCRIPTION, subscriptionGroupIdentifier: "synthetic-resume-group", purchaseDate: Date.now() - 120_000, expiresDate: Date.now() - 60_000 });
    await applyAppleTransaction(await syntheticAppleVerifier().transaction(signed), { organizationId: f.org.id, intentId: intent.intentId, source: "CLIENT" });
    await applyAppleSignedRenewal(signSyntheticApplePayload({ environment: "Sandbox", originalTransactionId: "100000000000001", appAccountToken: intent.appAccountToken,
      productId: intent.productId, autoRenewProductId: intent.productId, autoRenewStatus: 0, signedDate: Date.now() }), syntheticAppleVerifier());
    return intent;
  };

  beforeEach(async () => {
    await resetDatabase();
    f = await seedBase({ plan: "BUSINESS" });
    await prisma.organization.update({ where: { id: f.org.id }, data: { subscriptionBillingMode: "SELF_SERVE", currentPeriodEndsAt: null, trialEndsAt: null } });
    await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11", termsSnapshot: terms } });
    for (const [key, value] of Object.entries({ BILLING_PAYMENTS_MODE: "sandbox", BILLING_PAYMENT_PROVIDER: "gopay", GOPAY_API_KEY: GOPAY_FIXTURE_API_KEY,
      GOPAY_API_SECRET: GOPAY_FIXTURE_API_SECRET, GOPAY_WEBHOOK_SECRET: GOPAY_FIXTURE_WEBHOOK_SECRET, BILLING_PUBLIC_URL: "http://localhost:3120",
      BILLING_TERMS_URL: "http://localhost:3120/legal/offer", BILLING_TERMS_VERSION: LEGAL_TERMS_VERSION, BILLING_SELLER_NAME: "SYNTHETIC SELLER",
      HARDENING_EXTERNAL_PROVIDER_MODE: "sandbox", VERCEL_ENV: "development", BILLING_LIVE_PILOT_ORGANIZATION_ID: "" })) vi.stubEnv(key, value);
    provider = goPayProtocolFixture(); vi.stubGlobal("fetch", provider.transport);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("returns the existing still-valid link without another provider call or invoice", async () => {
    const invoice = await checkout(), calls = provider.transport.mock.calls.length;
    expect(await resume(invoice.id)).toMatchObject({ id: invoice.id, checkoutUrl: invoice.checkoutUrl, status: "PENDING" });
    expect(provider.transport).toHaveBeenCalledTimes(calls); expect(provider.payments.size).toBe(1);
    expect(await prisma.subscriptionInvoice.count()).toBe(1); expect(await prisma.subscriptionPeriod.count()).toBe(0);
  });

  it("refuses a saved unpaid link after a verified Apple renewal arrives", async () => {
    const old = await expiredApple(), invoice = await checkout(), calls = provider.transport.mock.calls.length;
    const signed = syntheticAppleTransaction({ appAccountToken: old.appAccountToken, productId: old.productId, transactionId: "100000000000002",
      type: Type.AUTO_RENEWABLE_SUBSCRIPTION, subscriptionGroupIdentifier: "synthetic-resume-group", expiresDate: Date.now() + 30 * 86400000 });
    await applyAppleTransaction(await syntheticAppleVerifier().transaction(signed), { organizationId: f.org.id, source: "NOTIFICATION" });
    await expect(resume(invoice.id)).rejects.toThrow("appleSubscriptionManagedByApple");
    expect(provider.transport).toHaveBeenCalledTimes(calls); expect((await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("PENDING");
  });

  it("refuses a link when an unbound verified Apple charge needs review", async () => {
    const old = await expiredApple(), invoice = await checkout(), calls = provider.transport.mock.calls.length;
    const signed = syntheticAppleTransaction({ appAccountToken: old.appAccountToken, productId: "synthetic.unmapped.product", transactionId: "100000000000003",
      originalTransactionId: "100000000000003", type: Type.AUTO_RENEWABLE_SUBSCRIPTION, subscriptionGroupIdentifier: "synthetic-resume-group", expiresDate: Date.now() + 30 * 86400000 });
    expect((await applyAppleTransaction(await syntheticAppleVerifier().transaction(signed), { organizationId: f.org.id, source: "NOTIFICATION" })).status).toBe("REVIEW");
    await expect(resume(invoice.id)).rejects.toThrow("applePaymentNeedsReview");
    expect(provider.transport).toHaveBeenCalledTimes(calls);
  });

  it("refuses stale frozen coverage rather than redirecting to an otherwise valid URL", async () => {
    const invoice = await checkout(), calls = provider.transport.mock.calls.length;
    await prisma.organization.update({ where: { id: f.org.id }, data: { currentPeriodEndsAt: new Date(Date.now() + 30 * 86400000) } });
    await expect(resume(invoice.id)).rejects.toThrow("billingQuoteChanged");
    expect(provider.transport).toHaveBeenCalledTimes(calls); expect(await prisma.subscriptionInvoice.count()).toBe(1);
  });

  it("rechecks the active admin and invoice tenant before returning a saved URL", async () => {
    const invoice = await checkout();
    await prisma.user.update({ where: { id: f.adminUser.id }, data: { role: "STAFF" } });
    await expect(resume(invoice.id)).rejects.toThrow("forbidden");
    const other = await prisma.organization.create({ data: { name: "Other synthetic tenant" } });
    const admin = await prisma.user.create({ data: { organizationId: other.id, email: "other-admin@synthetic.test", name: "Other", passwordHash: "synthetic", role: "ADMIN" } });
    await expect(resumeSubscriptionCheckout({ actorId: admin.id, organizationId: other.id, invoiceId: invoice.id })).rejects.toThrow("recordNotFound");
  });

  it("does not resume an expired invoice even if its provider URL still exists", async () => {
    const invoice = await checkout(), calls = provider.transport.mock.calls.length;
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(invoice.expiresAt.getTime() + 1));
    await expect(resume(invoice.id)).rejects.toThrow("billingQuoteChanged");
    expect(provider.transport).toHaveBeenCalledTimes(calls);
  });

  it("never uses Apple service valuation as GoPay upgrade funding, while preserving an independently paid full renewal", async () => {
    for (const [key, value] of Object.entries({ APPLE_BILLING_MODE: "sandbox", APPLE_APP_ID: "1234567890", APPLE_IAP_KEY_ID: "SYNTHETIC",
      APPLE_IAP_ISSUER_ID: "SYNTHETIC", APPLE_IAP_PRIVATE_KEY: "SYNTHETIC PRIVATE KEY", APPLE_BILLING_TERMS_VERSION: LEGAL_TERMS_VERSION,
      APPLE_BILLING_TERMS_APPROVED: "true", APPLE_BILLING_SALES_APPROVED: "true", APPLE_BILLING_SANDBOX_ORGANIZATION_IDS: f.org.id,
      APPLE_BILLING_CATALOG_JSON: JSON.stringify([{ offerKey: offer.offerKey, productId: "synthetic.resume.nonrenewing", productType: "NON_RENEWING", approved: true }]) })) vi.stubEnv(key, value);
    const preview = await getApplePurchasePreview(actor(), { expectedOrganizationId: f.org.id, offerKey: offer.offerKey, action: "RENEW" });
    const intent = await createApplePurchaseIntent(actor(), { expectedOrganizationId: f.org.id, offerKey: offer.offerKey, action: "RENEW", quoteToken: preview.quoteToken!,
      idempotencyKey: randomUUID(), acceptedTerms: true, termsVersion: LEGAL_TERMS_VERSION });
    await authorizeApplePurchase(actor(), intent.intentId);
    const purchaseDate = Date.now();
    await applyAppleTransaction(await syntheticAppleVerifier().transaction(syntheticAppleTransaction({ appAccountToken: intent.appAccountToken,
      productId: intent.productId, purchaseDate })), { organizationId: f.org.id, intentId: intent.intentId, source: "CLIENT" });
    const change = { ...selection, plan: "ENTERPRISE" as const, action: "CHANGE" as const };
    await expect(getSubscriptionQuote(f.org.id, change)).rejects.toThrow("appleSubscriptionManagedByApple");
    await expect(checkout(change)).rejects.toThrow("appleSubscriptionManagedByApple");
    expect(provider.transport).not.toHaveBeenCalled(); expect(await prisma.subscriptionInvoice.count()).toBe(0);
    const fullRenewal = { ...selection, plan: "ENTERPRISE" as const };
    const quote = await getSubscriptionQuote(f.org.id, fullRenewal);
    expect(quote.creditMinor).toBe(0); expect(quote.amountMinor).toBe(quote.serviceValueMinor);
    const invoice = await checkout(fullRenewal);
    const persisted = await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    const payment = provider.payments.get(persisted.providerOrderId!)!;
    await handleGoPayNotification(provider.notification(provider.commit(payment)));
    expect((await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("PAID");
    const paid = await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { invoiceId: invoice.id } });
    expect(paid.plan).toBe("ENTERPRISE"); expect(paid.startsAt.toISOString()).toBe(quote.startsAt);
    await applyAppleTransaction(await syntheticAppleVerifier().transaction(syntheticAppleTransaction({ appAccountToken: intent.appAccountToken,
      productId: intent.productId, purchaseDate, revocationDate: Date.now(), signedDate: Date.now() + 1000 })), { organizationId: f.org.id, source: "NOTIFICATION" });
    expect((await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: paid.id } })).revokedAt).toBeNull();
    expect((await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).amountMinor).toBe(quote.amountMinor);
  });

});
