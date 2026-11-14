import { randomUUID } from "node:crypto";
import { Type } from "@apple/app-store-server-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { createContractTerms } from "@/server/billing/contractTerms";
import { appleSubscriptionOffer, appleWhatsAppOffer } from "@/server/billing/appleOfferCatalog";
import { APPLE_WHATSAPP_OFFER_VERSION } from "@/server/billing/appleConfig";
import { applyAppleTransaction, authorizeApplePurchase, createApplePurchaseIntent, getAppleBillingState,
  getApplePurchasePreview } from "@/server/billing/applePayments";
import { calculateSubscriptionQuote } from "@/server/billing/subscriptionQuotes";
import { readAppleStoreKitConsent } from "@/server/billing/appleStoreKitConsent";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { syntheticAppleTransaction, syntheticAppleVerifier } from "../helpers/appleSignedFixture";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const terms = createContractTerms("2026-11");
const selection = { plan: "BUSINESS" as const, months: 1 as const, extras: { stores: 0, productPacks: 0, userPacks: 0 as const } };
const offer = appleSubscriptionOffer(terms, selection);
const consent = { storefrontId: "143586", currency: "USD", priceMillis: "24950", displayPrice: "$24.95" };
const constraint = { storefrontId: "143586", currency: "USD", priceMillis: "24950" };
const productId = "synthetic.price.business";
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const seed = async (type = "NON_RENEWING") => {
  const f = await seedBase({ plan: "BUSINESS" });
  await prisma.organization.update({ where: { id: f.org.id }, data: { subscriptionBillingMode: "SELF_SERVE", currentPeriodEndsAt: null, trialEndsAt: null } });
  await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11", termsSnapshot: terms } });
  for (const [key, value] of Object.entries({ APPLE_BILLING_MODE: "sandbox", APPLE_APP_ID: "1234567890", APPLE_IAP_KEY_ID: "SYNTHETIC",
    APPLE_IAP_ISSUER_ID: "SYNTHETIC", APPLE_IAP_PRIVATE_KEY: "SYNTHETIC PRIVATE KEY", APPLE_BILLING_TERMS_VERSION: LEGAL_TERMS_VERSION,
    APPLE_BILLING_TERMS_APPROVED: "true", APPLE_BILLING_SALES_APPROVED: "true", APPLE_BILLING_SANDBOX_ORGANIZATION_IDS: f.org.id,
    APPLE_BILLING_CATALOG_JSON: JSON.stringify([{ offerKey: offer.offerKey, productId, productType: type, approved: true,
      ...(type === "AUTO_RENEWABLE" ? { subscriptionGroupId: "synthetic-price-group" } : {}) }]) })) vi.stubEnv(key, value);
  return { ...f, actor: { id: f.adminUser.id, organizationId: f.org.id } };
};
type Fixture = Awaited<ReturnType<typeof seed>>;
const inputFor = async (f: Fixture) => {
  const preview = await getApplePurchasePreview(f.actor, { expectedOrganizationId: f.org.id, offerKey: offer.offerKey, action: "RENEW" });
  return { expectedOrganizationId: f.org.id, offerKey: offer.offerKey, action: "RENEW" as const, quoteToken: preview.quoteToken ?? undefined,
    idempotencyKey: randomUUID(), termsVersion: LEGAL_TERMS_VERSION, acceptedTerms: true as const, storeKitConsent: consent };
};
const create = async (f: Fixture) => createApplePurchaseIntent(f.actor, await inputFor(f));
type Intent = Awaited<ReturnType<typeof create>>;
const apply = async (f: Fixture, intent: Intent, overrides: Partial<Parameters<typeof syntheticAppleTransaction>[0]> = {}) => {
  const receipt = await syntheticAppleVerifier().transaction(syntheticAppleTransaction({ appAccountToken: intent.appAccountToken,
    productId: intent.productId, price: 24950, currency: "USD", storefrontId: "143586", ...overrides }));
  return applyAppleTransaction(receipt, { organizationId: f.org.id, intentId: intent.intentId, source: "NOTIFICATION" });
};
const legacy = async (f: Fixture, authorized: boolean) => {
  const account = await prisma.appleBillingAccount.create({ data: { organizationId: f.org.id, appAccountToken: randomUUID() } });
  const purchase = await calculateSubscriptionQuote(f.org.id, { ...selection, action: "RENEW" });
  return prisma.applePurchaseIntent.create({ data: { organizationId: f.org.id, createdById: f.adminUser.id, idempotencyKey: randomUUID(),
    scope: "SUBSCRIPTION", pendingSlot: `SUBSCRIPTION:${f.org.id}`, action: "RENEW", productType: "NON_RENEWING", offerKey: offer.offerKey,
    productId, environment: "Sandbox", appAccountToken: account.appAccountToken, offerSnapshot: json({ ...offer, appleProduct: {} }),
    purchaseSnapshot: json(purchase), termsVersion: LEGAL_TERMS_VERSION, termsUrl: "https://example.invalid/legal/offer",
    authorizedAt: authorized ? new Date() : null, expiresAt: new Date(Date.now() + 600_000) } });
};

describeDb("buyer-observed StoreKit price binding on isolated PostgreSQL", () => {
  let network: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    await resetDatabase();
    network = vi.fn(() => { throw new Error("Price binding tests must not call providers"); });
    vi.stubGlobal("fetch", network);
  });
  afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("freezes the exact observed price immutably and returns it in preparation and final authorization", async () => {
    const f = await seed(), input = await inputFor(f), intent = await createApplePurchaseIntent(f.actor, input);
    const row = await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } });
    expect(readAppleStoreKitConsent(row.offerSnapshot)).toEqual(consent);
    expect(intent.priceConstraint).toEqual(constraint);
    expect((await authorizeApplePurchase(f.actor, intent.intentId, { prepareOnly: true })).priceConstraint).toEqual(constraint);
    expect((await authorizeApplePurchase(f.actor, intent.intentId, { attemptId: randomUUID() })).priceConstraint).toEqual(constraint);
    await expect(prisma.applePurchaseIntent.update({ where: { id: row.id }, data: { offerSnapshot: json({ ...offer,
      appleProduct: { storeKitConsent: { ...consent, priceMillis: "26950" } } }) } })).rejects.toThrow();
    await expect(authorizeApplePurchase(f.actor, intent.intentId, { attemptId: randomUUID() })).rejects.toThrow("applePurchasePendingVerification");
  });
  it("requires a fresh price on new intents and conflicts on changed idempotent consent", async () => {
    const f = await seed(), input = await inputFor(f);
    await expect(createApplePurchaseIntent(f.actor, { ...input, storeKitConsent: undefined })).rejects.toThrow("applePriceConsentRequired");
    expect(await prisma.applePurchaseIntent.count()).toBe(0);
    const first = await createApplePurchaseIntent(f.actor, input);
    expect((await createApplePurchaseIntent(f.actor, input)).intentId).toBe(first.intentId);
    for (const change of [{ priceMillis: "26950" }, { currency: "EUR" }, { storefrontId: "143441" }, { displayPrice: "$26.95" }])
      await expect(createApplePurchaseIntent(f.actor, { ...input, storeKitConsent: { ...consent, ...change } })).rejects.toThrow("idempotencyConflict");
  });
  it.each([{ price: 26950 }, { currency: "EUR" }, { storefrontId: "143441" }, { price: undefined, currency: undefined }, { storefrontId: undefined }])
    ("retains a mismatched signed payment for recovery without granting or creating another charge: %j", async (change) => {
      const f = await seed(), intent = await create(f);
      await authorizeApplePurchase(f.actor, intent.intentId, { attemptId: randomUUID() });
      const result = await apply(f, intent, change);
      expect(result).toMatchObject({ acknowledged: true, status: "REVIEW", reason: "applePriceChanged" });
      expect(await prisma.appleTransaction.count()).toBe(1);
      expect(await prisma.subscriptionPeriod.count()).toBe(0);
      expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } })).status).toBe("REVIEW");
      expect((await getAppleBillingState(f.actor)).recentTransactions[0]).toMatchObject({ intentId: intent.intentId, status: "REVIEW", refundable: true });
      await expect(authorizeApplePurchase(f.actor, intent.intentId, { attemptId: randomUUID() })).rejects.toThrow("applePurchasePendingVerification");
    });
  it("grants an exact signed price once without converting service value or trusting display text", async () => {
    const f = await seed(), intent = await create(f);
    await authorizeApplePurchase(f.actor, intent.intentId, { attemptId: randomUUID() });
    const purchaseDate = Date.now();
    expect((await apply(f, intent, { purchaseDate })).status).toBe("GRANTED");
    expect((await apply(f, intent, { purchaseDate })).status).toBe("GRANTED");
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
    expect(await prisma.subscriptionInvoice.count()).toBe(0);
    expect((await prisma.appleTransaction.findFirstOrThrow()).priceMillis).toBe(24950n);
  });
  it("fails closed for an old unstarted markerless intent without changing its immutable snapshot", async () => {
    const f = await seed(), old = await legacy(f, false);
    await expect(authorizeApplePurchase(f.actor, old.id, { prepareOnly: true })).rejects.toThrow("applePriceConsentRequired");
    await expect(authorizeApplePurchase(f.actor, old.id, { attemptId: randomUUID() })).rejects.toThrow("applePriceConsentRequired");
    await expect(createApplePurchaseIntent(f.actor, { ...await inputFor(f), idempotencyKey: old.idempotencyKey })).rejects.toThrow("applePriceConsentRequired");
    expect(readAppleStoreKitConsent((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: old.id } })).offerSnapshot)).toBeNull();
  });
  it("preserves an already authorized markerless paid receipt and restores its GRANTED result without a new sheet", async () => {
    const f = await seed(), old = await legacy(f, true);
    await expect(authorizeApplePurchase(f.actor, old.id, { prepareOnly: true })).rejects.toThrow("applePurchasePendingVerification");
    const receipt = await syntheticAppleVerifier().transaction(syntheticAppleTransaction({ appAccountToken: old.appAccountToken, productId, price: 26950 }));
    const first = await applyAppleTransaction(receipt, { organizationId: f.org.id, intentId: old.id, source: "NOTIFICATION" });
    const restored = await applyAppleTransaction(receipt, { organizationId: f.org.id, source: "RESTORE" });
    expect(first.status).toBe("GRANTED"); expect(restored.status).toBe("GRANTED");
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
    expect((await prisma.appleTransaction.findFirstOrThrow()).priceMillis).toBe(26950n);
    expect(readAppleStoreKitConsent((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: old.id } })).offerSnapshot)).toBeNull();
  });
  it("keeps role and organization authorization ahead of any new sheet", async () => {
    const f = await seed(), input = await inputFor(f);
    await expect(createApplePurchaseIntent(f.actor, { ...input, expectedOrganizationId: "foreign-org" })).rejects.toThrow("applePurchaseOrganizationMismatch");
    const intent = await createApplePurchaseIntent(f.actor, input);
    await prisma.user.update({ where: { id: f.adminUser.id }, data: { role: "STAFF" } });
    await expect(authorizeApplePurchase(f.actor, intent.intentId, { prepareOnly: true })).rejects.toThrow("forbidden");
  });
  it("uses the common immutable price marker for consumables while retaining a null subscription snapshot", async () => {
    const f = await seed(), pack = appleWhatsAppOffer(1), now = new Date();
    const account = await prisma.appleBillingAccount.create({ data: { organizationId: f.org.id, appAccountToken: randomUUID() } });
    const intent = await prisma.applePurchaseIntent.create({ data: { organizationId: f.org.id, createdById: f.adminUser.id,
      idempotencyKey: randomUUID(), pendingSlot: `WHATSAPP_PACK:${f.org.id}`, scope: "WHATSAPP_PACK", productType: "CONSUMABLE", offerKey: pack.offerKey,
      productId: "synthetic.price.whatsapp", environment: "Sandbox", appAccountToken: account.appAccountToken,
      offerSnapshot: json({ ...pack, appleProduct: { appleOfferVersion: APPLE_WHATSAPP_OFFER_VERSION, storeKitConsent: consent } }),
      termsVersion: LEGAL_TERMS_VERSION, termsUrl: "https://example.invalid/legal/offer", authorizedAt: now,
      expiresAt: new Date(now.getTime() + 600_000) } });
    expect(intent.purchaseSnapshot).toBeNull();
    expect((await getAppleBillingState(f.actor)).pendingIntent?.priceConstraint).toEqual(constraint);
    const receipt = await syntheticAppleVerifier().transaction(syntheticAppleTransaction({ appAccountToken: account.appAccountToken,
      productId: intent.productId, type: Type.CONSUMABLE, price: 26950 }));
    expect((await applyAppleTransaction(receipt, { organizationId: f.org.id, intentId: intent.id, source: "NOTIFICATION" })).reason).toBe("applePriceChanged");
    expect(await prisma.whatsAppCreditLot.count()).toBe(0);
  });
  it("checks the first automatic purchase but does not retroactively price a later signed Apple renewal", async () => {
    const f = await seed("AUTO_RENEWABLE"), intent = await create(f);
    await authorizeApplePurchase(f.actor, intent.intentId, { attemptId: randomUUID() });
    const purchaseDate = Date.now() - 1000, expiresDate = Date.now() + 30 * 86_400_000;
    const auto = { type: Type.AUTO_RENEWABLE_SUBSCRIPTION, subscriptionGroupIdentifier: "synthetic-price-group" };
    expect((await apply(f, intent, { ...auto, purchaseDate, expiresDate, transactionReason: "PURCHASE" })).status).toBe("GRANTED");
    expect((await apply(f, intent, { ...auto, transactionId: "100000000000002", purchaseDate: Date.now(),
      expiresDate: expiresDate + 30 * 86_400_000, transactionReason: "RENEWAL", price: 26950, signedDate: Date.now() + 1000 })).status).toBe("GRANTED");
    expect(await prisma.subscriptionPeriod.count()).toBe(2);
  });
  it("does not treat a mismatched first automatic payment as an established renewal", async () => {
    const f = await seed("AUTO_RENEWABLE"), intent = await create(f);
    await authorizeApplePurchase(f.actor, intent.intentId, { attemptId: randomUUID() });
    const result = await apply(f, intent, { type: Type.AUTO_RENEWABLE_SUBSCRIPTION, subscriptionGroupIdentifier: "synthetic-price-group",
      expiresDate: Date.now() + 30 * 86_400_000, transactionReason: "RENEWAL", price: 26950 });
    expect(result).toMatchObject({ status: "REVIEW", reason: "applePriceChanged" });
    expect(await prisma.appleSubscriptionChain.count()).toBe(0);
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
  });
});
