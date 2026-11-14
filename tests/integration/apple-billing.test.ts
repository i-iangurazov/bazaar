import { randomUUID } from "node:crypto";
import { Type } from "@apple/app-store-server-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createContractTerms } from "@/server/billing/contractTerms";
import { appleSubscriptionOffer, appleWhatsAppOffer } from "@/server/billing/appleOfferCatalog";
import { APPLE_WHATSAPP_OFFER_VERSION } from "@/server/billing/appleConfig";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { APPLE_PURCHASE_TERMS_REVISION, APPLE_PURCHASE_TERMS_URL } from "@/lib/applePurchaseLegal";
import { syntheticSellerEnvironment } from "../helpers/legalSeller";
import { createApplePurchaseIntent, authorizeApplePurchase, applyAppleTransaction, getAppleBillingState, getApplePurchasePreview } from "@/server/billing/applePayments";
import { createSubscriptionCheckout } from "@/server/billing/subscriptionPayments";
import { calculateSubscriptionQuote } from "@/server/billing/subscriptionQuotes";
import { getOrganizationPlan } from "@/server/services/planLimits";
import { getSubscriptionUsage, withSubscriptionUsage } from "@/server/billing/subscriptionUsage";
import { whatsappQuota } from "@/server/whatsapp/quota";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { syntheticAppleStoreKitConsent, syntheticAppleTransaction, syntheticAppleVerifier } from "../helpers/appleSignedFixture";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const terms = createContractTerms("2026-11");
const selection = { plan: "BUSINESS" as const, months: 1 as const, extras: { stores: 0, productPacks: 0, userPacks: 0 as const } };
const offer = appleSubscriptionOffer(terms, selection);
const productId = "kg.bazaar.synthetic.business.month";
const asJson = <T,>(v: T) => JSON.parse(JSON.stringify(v));
const mapping = (type = "NON_RENEWING") => ({ offerKey: offer.offerKey, productId, productType: type, approved: true,
  ...(type === "AUTO_RENEWABLE" ? { subscriptionGroupId: "synthetic-group" } : {}) });
const setConfig = (organizationId: string, products: object[] = [mapping()]) => {
  for (const [k, v] of Object.entries({ APPLE_BILLING_MODE: "sandbox", APPLE_APP_ID: "1234567890", APPLE_IAP_KEY_ID: "SYNTHETIC",
    APPLE_IAP_ISSUER_ID: "SYNTHETIC", APPLE_IAP_PRIVATE_KEY: "SYNTHETIC PRIVATE KEY", APPLE_BILLING_TERMS_VERSION: LEGAL_TERMS_VERSION,
    APPLE_BILLING_TERMS_APPROVED: "true", APPLE_BILLING_SALES_APPROVED: "true", APPLE_BILLING_SANDBOX_ORGANIZATION_IDS: organizationId,
    APPLE_BILLING_CATALOG_JSON: JSON.stringify(products) })) vi.stubEnv(k, v);
};
const seed = async () => {
  const f = await seedBase({ plan: "BUSINESS" });
  await prisma.organization.update({ where: { id: f.org.id }, data: { subscriptionBillingMode: "SELF_SERVE", currentPeriodEndsAt: null, trialEndsAt: null } });
  await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11", termsSnapshot: terms } });
  setConfig(f.org.id);
  return { ...f, actor: { id: f.adminUser.id, organizationId: f.org.id } };
};
const intentFor = async (f: Awaited<ReturnType<typeof seed>>, extra = {}) => {
  const preview = await getApplePurchasePreview(f.actor, { expectedOrganizationId: f.org.id, offerKey: offer.offerKey, action: "RENEW" });
  const intent = await createApplePurchaseIntent(f.actor, { quoteToken: preview.quoteToken ?? undefined, expectedOrganizationId: f.org.id, offerKey: offer.offerKey,
    action: "RENEW", idempotencyKey: randomUUID(), termsVersion: LEGAL_TERMS_VERSION, storeKitConsent: syntheticAppleStoreKitConsent, acceptedTerms: true, ...extra });
  await authorizeApplePurchase(f.actor, intent.intentId, { attemptId: randomUUID() });
  return intent;
};
const receive = async (intent: Awaited<ReturnType<typeof intentFor>>, extra = {}) => {
  const receipt = await syntheticAppleVerifier().transaction(syntheticAppleTransaction({ appAccountToken: intent.appAccountToken, productId, ...extra }));
  return applyAppleTransaction(receipt, { organizationId: (await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } })).organizationId,
    intentId: intent.intentId, source: "CLIENT" });
};
const paidWebPeriod = async (f: Awaited<ReturnType<typeof seed>>) => {
  const snapshot = await calculateSubscriptionQuote(f.org.id, { ...selection, action: "RENEW" });
  const invoice = await prisma.subscriptionInvoice.create({ data: { organizationId: f.org.id, createdById: f.adminUser.id,
    idempotencyKey: randomUUID(), plan: "BUSINESS", amountMinor: snapshot.amountMinor, merchantId: "synthetic-historical", isTest: true,
    status: "PAID", providerPaymentId: randomUUID(), termsVersion: LEGAL_TERMS_VERSION, termsUrl: "https://www.bazaar.kg/legal/offer",
    sellerName: "SYNTHETIC SELLER", expiresAt: new Date(Date.now() + 600_000), paidAt: new Date(), purchaseSnapshot: asJson(snapshot) } });
  const period = await prisma.subscriptionPeriod.create({ data: { invoiceId: invoice.id, organizationId: f.org.id, plan: "BUSINESS",
    startsAt: new Date(snapshot.startsAt), endsAt: new Date(snapshot.endsAt), purchaseSnapshot: asJson(snapshot) } });
  await prisma.organization.update({ where: { id: f.org.id }, data: { currentPeriodEndsAt: period.endsAt } });
  return period;
};
describeDb("verified Apple purchases on isolated PostgreSQL", () => {
  beforeEach(resetDatabase);
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  const approveScopedTerms = () => {
    for (const [key, value] of Object.entries({ ...syntheticSellerEnvironment, BILLING_LEGAL_RELEASE_APPROVED: LEGAL_TERMS_VERSION,
      BILLING_SUPPORT_EMAIL_VERIFIED: "1", BILLING_PUBLIC_CONTACT_ADDRESS: "Synthetic correspondence address 100",
      APPLE_LEGAL_RELEASE_APPROVED: APPLE_PURCHASE_TERMS_REVISION })) vi.stubEnv(key, value);
  };
  it("blocks only a new production purchase when scoped legal approval is absent", async () => {
    const f = await seed(); vi.stubEnv("APPLE_BILLING_MODE", "live"); vi.stubEnv("APPLE_BILLING_SANDBOX_ORGANIZATION_IDS", "");
    await expect(intentFor(f)).rejects.toThrow("billingTermsChanged");
    expect(await prisma.applePurchaseIntent.count()).toBe(0);
    expect((await getAppleBillingState(f.actor)).ready).toBe(true);
    expect((await getAppleBillingState(f.actor)).offers.find(o => o.offerKey === offer.offerKey))
      .toMatchObject({ available: false, unavailableReason: "appleUnavailable" });
  });
  it("retains the exact scoped consent and URL while notification/restore still grant after its release flag is removed", async () => {
    const f = await seed(); approveScopedTerms();
    const intent = await intentFor(f, { termsRevision: APPLE_PURCHASE_TERMS_REVISION });
    const before = await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } });
    expect(before).toMatchObject({ termsVersion: "2026-11-11-v2", termsUrl: APPLE_PURCHASE_TERMS_URL,
      offerSnapshot: { appleLegalConsent: { version: 1, revision: APPLE_PURCHASE_TERMS_REVISION,
        termsVersion: LEGAL_TERMS_VERSION, termsUrl: APPLE_PURCHASE_TERMS_URL } } });
    vi.stubEnv("APPLE_LEGAL_RELEASE_APPROVED", "");
    const receipt = await syntheticAppleVerifier().transaction(syntheticAppleTransaction({ appAccountToken: intent.appAccountToken, productId }));
    expect((await applyAppleTransaction(receipt, { organizationId: f.org.id, source: "NOTIFICATION" })).status).toBe("GRANTED");
    expect((await applyAppleTransaction(receipt, { organizationId: f.org.id, source: "RESTORE" })).status).toBe("GRANTED");
    const after = await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } });
    expect(after.offerSnapshot).toEqual(before.offerSnapshot); expect(after.termsUrl).toBe(before.termsUrl);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });
  it("finishes an existing v2 intent across a new scoped edition without reacceptance or rewriting its snapshot", async () => {
    const f = await seed(), preview = await getApplePurchasePreview(f.actor, { expectedOrganizationId: f.org.id, offerKey: offer.offerKey, action: "RENEW" });
    const input = { expectedOrganizationId: f.org.id, offerKey: offer.offerKey, action: "RENEW" as const, quoteToken: preview.quoteToken!,
      idempotencyKey: randomUUID(), termsVersion: LEGAL_TERMS_VERSION, acceptedTerms: true as const, storeKitConsent: syntheticAppleStoreKitConsent };
    const intent = await createApplePurchaseIntent(f.actor, input);
    const original = await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } });
    expect(original.termsUrl).toBe("https://www.bazaar.kg/legal/offer");
    approveScopedTerms();
    expect((await createApplePurchaseIntent(f.actor, input)).intentId).toBe(intent.intentId);
    await authorizeApplePurchase(f.actor, intent.intentId, { attemptId: randomUUID() });
    vi.stubEnv("APPLE_LEGAL_RELEASE_APPROVED", "");
    expect((await receive(intent)).status).toBe("GRANTED");
    const after = await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } });
    expect(after.offerSnapshot).toEqual(original.offerSnapshot); expect(after.termsVersion).toBe(original.termsVersion); expect(after.termsUrl).toBe(original.termsUrl);
  });
  it("durably records exact signed USD milliunits, grants once, and restores without quota reset", async () => {
    const f = await seed(), intent = await intentFor(f);
    const receipt = await syntheticAppleVerifier().transaction(syntheticAppleTransaction({ appAccountToken: intent.appAccountToken, productId }));
    const first = await applyAppleTransaction(receipt, { organizationId: f.org.id, intentId: intent.intentId, source: "NOTIFICATION" });
    expect(first.status).toBe("GRANTED");
    const catalog = await getAppleBillingState(f.actor);
    expect(catalog.organization.id).toBe(f.org.id);
    expect(catalog.recentTransactions[0]).toMatchObject({ intentId: intent.intentId, productId,
      environment: "Sandbox", transactionId: receipt.data.transactionId, status: "GRANTED" });
    await withSubscriptionUsage({ organizationId: f.org.id, resource: "ai", operationKey: "already-used", units: 5 }, async () => true);
    const usage = await getSubscriptionUsage(f.org.id);
    await applyAppleTransaction(receipt, { organizationId: f.org.id, source: "RESTORE" });
    expect(await prisma.subscriptionPeriod.count()).toBe(1); expect(await prisma.subscriptionInvoice.count()).toBe(0);
    expect(await prisma.appleTransaction.count()).toBe(1); expect(await getSubscriptionUsage(f.org.id)).toEqual(usage);
    const saved = await prisma.appleTransaction.findFirstOrThrow();
    expect(saved.priceMillis).toBe(9990n); expect(saved.currency).toBe("USD");
    expect((saved.offerSnapshot as { serviceValue: { currency: string } }).serviceValue.currency).toBe("KGS");
  });
  it("serializes duplicate receipts and duplicate intents with one durable grant", async () => {
    const f = await seed(); const key = randomUUID();
    const preview = await getApplePurchasePreview(f.actor, { expectedOrganizationId: f.org.id, offerKey: offer.offerKey, action: "RENEW" });
    const params = { quoteToken: preview.quoteToken ?? undefined, expectedOrganizationId: f.org.id, offerKey: offer.offerKey, action: "RENEW" as const, idempotencyKey: key, termsVersion: LEGAL_TERMS_VERSION, storeKitConsent: syntheticAppleStoreKitConsent, acceptedTerms: true as const };
    const intents = await Promise.all([createApplePurchaseIntent(f.actor, params), createApplePurchaseIntent(f.actor, params)]);
    expect(intents[0].intentId).toBe(intents[1].intentId);
    await authorizeApplePurchase(f.actor, intents[0].intentId, { attemptId: randomUUID() });
    const receipt = await syntheticAppleVerifier().transaction(syntheticAppleTransaction({ appAccountToken: intents[0].appAccountToken, productId }));
    const results = await Promise.all([applyAppleTransaction(receipt, { organizationId: f.org.id, source: "CLIENT" }),
      applyAppleTransaction(receipt, { organizationId: f.org.id, source: "NOTIFICATION" })]);
    expect(results.every((r) => r.status === "GRANTED")).toBe(true);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });
  it("never moves a verified transaction or original chain to another organization", async () => {
    const f = await seed(), intent = await intentFor(f);
    await receive(intent);
    const other = await prisma.organization.create({ data: { name: "Separate tenant" } });
    const receipt = await syntheticAppleVerifier().transaction(syntheticAppleTransaction({ appAccountToken: intent.appAccountToken, productId }));
    await expect(applyAppleTransaction(receipt, { organizationId: other.id, source: "RESTORE" })).rejects.toThrow("applePurchaseOrganizationMismatch");
    await expect(prisma.appleBillingAccount.update({ where: { organizationId: f.org.id }, data: { organizationId: other.id } })).rejects.toThrow();
    expect((await prisma.subscriptionPeriod.findFirstOrThrow()).organizationId).toBe(f.org.id);
  });
  it("preserves a web prepayment and appends a nonrenewing Apple term; refund removes only its own grant", async () => {
    const f = await seed(), web = await paidWebPeriod(f), intent = await intentFor(f);
    const purchaseDate = Date.now(), signedDate = purchaseDate;
    await receive(intent, { purchaseDate, signedDate });
    const applePeriod = await prisma.subscriptionPeriod.findFirstOrThrow({ where: { appleTransactionId: { not: null } } });
    expect(applePeriod.startsAt.getTime()).toBe(web.endsAt.getTime());
    await receive(intent, { purchaseDate, signedDate: signedDate + 1000, revocationDate: signedDate + 500 });
    expect((await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: web.id } })).revokedAt).toBeNull();
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).currentPeriodEndsAt).toEqual(web.endsAt);
    expect((await getOrganizationPlan(f.org.id)).activeSubscriptionPeriod?.id).toBe(web.id);
  });
  it("blocks automatic Apple billing while already paid on web", async () => {
    const f = await seed(); await paidWebPeriod(f); setConfig(f.org.id, [mapping("AUTO_RENEWABLE")]);
    await expect(intentFor(f)).rejects.toThrow("appleExistingAccessActive");
    expect(await prisma.applePurchaseIntent.count()).toBe(0);
  });
  it("blocks new GoPay checkout while an Apple sheet reservation exists before contacting a provider", async () => {
    const f = await seed(); await intentFor(f);
    for (const [key, value] of Object.entries({ BILLING_PAYMENTS_MODE: "sandbox", BILLING_PAYMENT_PROVIDER: "gopay", GOPAY_API_KEY: "synthetic-gopay-key-123456",
      GOPAY_API_SECRET: "synthetic-gopay-secret-123456", GOPAY_WEBHOOK_SECRET: "synthetic-gopay-webhook-123456", BILLING_PUBLIC_URL: "http://localhost:3120",
      BILLING_TERMS_URL: "http://localhost:3120/legal/offer", BILLING_TERMS_VERSION: "synthetic-web-terms", BILLING_SELLER_NAME: "SYNTHETIC SELLER", HARDENING_EXTERNAL_PROVIDER_MODE: "enabled" })) vi.stubEnv(key, value);
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("TEST MUST NOT CALL A PROVIDER"));
    await expect(createSubscriptionCheckout({ organizationId: f.org.id, actorId: f.adminUser.id, ...selection, action: "RENEW",
      idempotencyKey: randomUUID(), termsVersion: "synthetic-web-terms", expectedAmountMinor: offer.serviceValue.amountMinor,
      locale: "ru", requestId: "synthetic" })).rejects.toThrow("applePurchasePending");
    expect(fetcher).not.toHaveBeenCalled(); expect(await prisma.subscriptionInvoice.count()).toBe(0);
  });
  it("durably retains a late Apple charge in review if web coverage changed after its sheet opened", async () => {
    const f = await seed(), intent = await intentFor(f); await paidWebPeriod(f);
    const result = await receive(intent);
    expect(result.status).toBe("REVIEW"); expect(result.reason).toBe("appleAccessChanged");
    expect(await prisma.appleTransaction.count()).toBe(1); expect(await prisma.subscriptionPeriod.count()).toBe(1);
    const catalog = await getAppleBillingState(f.actor); expect(catalog.recentTransactions[0].refundable).toBe(true);
  });
  it("rejects expected organization races and current role changes before opening StoreKit", async () => {
    const f = await seed();
    await expect(createApplePurchaseIntent(f.actor, { expectedOrganizationId: "different-org", offerKey: offer.offerKey, action: "RENEW",
      idempotencyKey: randomUUID(), termsVersion: LEGAL_TERMS_VERSION, storeKitConsent: syntheticAppleStoreKitConsent, acceptedTerms: true })).rejects.toThrow("applePurchaseOrganizationMismatch");
    const intent = await intentFor(f);
    await prisma.user.update({ where: { id: f.adminUser.id }, data: { role: "STAFF" } });
    await expect(authorizeApplePurchase(f.actor, intent.intentId, { attemptId: randomUUID() })).rejects.toThrow("forbidden");
  });
  it("enforces source XOR, immutable money and tenant constraints in the database", async () => {
    const f = await seed(), intent = await intentFor(f); await receive(intent);
    const row = await prisma.appleTransaction.findFirstOrThrow(), period = await prisma.subscriptionPeriod.findFirstOrThrow();
    await expect(prisma.appleTransaction.update({ where: { id: row.id }, data: { priceMillis: 1n } })).rejects.toThrow();
    await expect(prisma.appleTransaction.update({ where: { id: row.id }, data: { currency: "KGS" } })).rejects.toThrow();
    await expect(prisma.subscriptionPeriod.update({ where: { id: period.id }, data: { startsAt: new Date(0) } })).rejects.toThrow();
    await expect(prisma.subscriptionPeriod.create({ data: { organizationId: f.org.id, plan: "BUSINESS", startsAt: new Date(), endsAt: new Date(Date.now() + 10000) } })).rejects.toThrow();
  });
  it("grants Apple consumable credit without expiry and preserves web expiry and used units on restore/reversal", async () => {
    const f = await seed(), pack = appleWhatsAppOffer(1), token = randomUUID();
    await prisma.organization.update({ where: { id: f.org.id }, data: { currentPeriodEndsAt: new Date(Date.now() + 86_400_000) } });
    await prisma.appleBillingAccount.create({ data: { organizationId: f.org.id, appAccountToken: token } });
    const now = new Date();
    const intent = await prisma.applePurchaseIntent.create({ data: { organizationId: f.org.id, createdById: f.adminUser.id, idempotencyKey: randomUUID(),
      scope: "WHATSAPP_PACK", productType: "CONSUMABLE", offerKey: pack.offerKey, productId: "synthetic.whatsapp", environment: "Sandbox", appAccountToken: token,
      offerSnapshot: asJson({ ...pack, appleProduct: { appleOfferVersion: APPLE_WHATSAPP_OFFER_VERSION } }), termsVersion: LEGAL_TERMS_VERSION,
      termsUrl: "https://www.bazaar.kg/legal/offer", status: "COMPLETED", authorizedAt: now, expiresAt: new Date(now.getTime() + 600_000) } });
    const receiptFor = (extra = {}) => syntheticAppleVerifier().transaction(syntheticAppleTransaction({ appAccountToken: token, productId: "synthetic.whatsapp",
      type: Type.CONSUMABLE, purchaseDate: now.getTime(), signedDate: now.getTime(), ...extra }));
    await applyAppleTransaction(await receiptFor(), { organizationId: f.org.id, intentId: intent.id, source: "CLIENT" });
    const lot = await prisma.whatsAppCreditLot.findFirstOrThrow(); expect(lot.expiresAt).toBeNull();
    await prisma.whatsAppCreditLot.update({ where: { id: lot.id }, data: { used: 7 } });
    expect((await whatsappQuota(f.org.id)).paidRemaining).toBe(993);
    await applyAppleTransaction(await receiptFor(), { organizationId: f.org.id, source: "RESTORE" });
    expect((await prisma.whatsAppCreditLot.findUniqueOrThrow({ where: { id: lot.id } })).used).toBe(7);
    await applyAppleTransaction(await receiptFor({ signedDate: now.getTime() + 1000, revocationDate: now.getTime() + 500 }), { source: "NOTIFICATION" });
    expect((await whatsappQuota(f.org.id)).paidRemaining).toBe(0);
    await applyAppleTransaction(await receiptFor({ signedDate: now.getTime() + 2000 }), { source: "RECONCILIATION" });
    expect((await whatsappQuota(f.org.id)).paidRemaining).toBe(993);
  });
});
