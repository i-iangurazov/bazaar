import { randomUUID } from "node:crypto";
import { Environment, Type } from "@apple/app-store-server-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createContractTerms } from "@/server/billing/contractTerms";
import { appleSubscriptionOffer, appleWhatsAppOffer } from "@/server/billing/appleOfferCatalog";
import { createApplePurchaseIntent, authorizeApplePurchase, applyAppleTransaction, getApplePurchasePreview, getAppleBillingState, restoreApplePurchases, cancelApplePurchaseIntent } from "@/server/billing/applePayments";
import { applyAppleSignedRenewal, acceptAppleServerNotification, reconcileAppleBilling } from "@/server/billing/appleLifecycle";
import { calculateSubscriptionQuote } from "@/server/billing/subscriptionQuotes";
import { getSubscriptionPaymentState } from "@/server/billing/subscriptionPayments";
import { getOrganizationPlan, getCapacityLimits, assertFeatureCanBeConfigured, resolveOrganizationAccessState } from "@/server/services/planLimits";
import { getSubscriptionUsage, withSubscriptionUsage } from "@/server/billing/subscriptionUsage";
import * as verification from "@/server/billing/appleVerification";
import { APPLE_WHATSAPP_OFFER_VERSION } from "@/server/billing/appleConfig";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import type { SubscriptionSelection } from "@/lib/billing/subscriptionPricing";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { syntheticAppleTransaction, syntheticAppleVerifier, signSyntheticApplePayload } from "../helpers/appleSignedFixture";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const empty = { stores: 0, productPacks: 0, userPacks: 0 as const };
const business: SubscriptionSelection = { plan: "BUSINESS", months: 1, extras: empty };
const enterprise: SubscriptionSelection = { plan: "ENTERPRISE", months: 1, extras: empty };
const starter: SubscriptionSelection = { plan: "STARTER", months: 1, extras: empty };
const terms = createContractTerms("2026-11");
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
const configure = (id: string, selections: SubscriptionSelection[], type = "AUTO_RENEWABLE", customTerms = terms) => {
  const mappings = selections.map((selection, i) => ({ offerKey: appleSubscriptionOffer(customTerms, selection).offerKey,
    productId: `synthetic.lifecycle.${i}`, productType: type, approved: true,
    ...(type === "AUTO_RENEWABLE" ? { subscriptionGroupId: "synthetic-lifecycle-group" } : {}) }));
  for (const [k, v] of Object.entries({ APPLE_BILLING_MODE: "sandbox", APPLE_APP_ID: "1234567890", APPLE_IAP_KEY_ID: "SYNTHETIC",
    APPLE_IAP_ISSUER_ID: "SYNTHETIC", APPLE_IAP_PRIVATE_KEY: "SYNTHETIC PRIVATE KEY", APPLE_BILLING_TERMS_VERSION: LEGAL_TERMS_VERSION,
    APPLE_BILLING_TERMS_APPROVED: "true", APPLE_BILLING_SALES_APPROVED: "true", APPLE_BILLING_SANDBOX_ORGANIZATION_IDS: id,
    APPLE_BILLING_CATALOG_JSON: JSON.stringify(mappings) })) vi.stubEnv(k, v);
  return mappings;
};
const seed = async () => {
  const f = await seedBase({ plan: "BUSINESS" });
  await prisma.organization.update({ where: { id: f.org.id }, data: { subscriptionBillingMode: "SELF_SERVE", currentPeriodEndsAt: null, trialEndsAt: null } });
  await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11", termsSnapshot: terms } });
  return { ...f, actor: { id: f.adminUser.id, organizationId: f.org.id } };
};
const intentFor = async (f: Awaited<ReturnType<typeof seed>>, offerKey: string, action: "RENEW" | "CHANGE" = "RENEW") => {
  const preview = await getApplePurchasePreview(f.actor, { expectedOrganizationId: f.org.id, offerKey, action });
  const intent = await createApplePurchaseIntent(f.actor, { quoteToken: preview.quoteToken ?? undefined, expectedOrganizationId: f.org.id, offerKey, action, idempotencyKey: randomUUID(),
    termsVersion: LEGAL_TERMS_VERSION, acceptedTerms: true });
  const attemptId = randomUUID();
  await authorizeApplePurchase(f.actor, intent.intentId, { attemptId });
  return { ...intent, attemptId };
};
const tx = (intent: Pick<Awaited<ReturnType<typeof createApplePurchaseIntent>>, "appAccountToken" | "productId">, extra: object = {}) => syntheticAppleTransaction({ appAccountToken: intent.appAccountToken,
  productId: intent.productId, type: Type.AUTO_RENEWABLE_SUBSCRIPTION, subscriptionGroupIdentifier: "synthetic-lifecycle-group",
  expiresDate: Date.now() + 30 * 86400000, ...extra });
const apply = async (signed: string, org: string, intentId?: string) => applyAppleTransaction(await syntheticAppleVerifier().transaction(signed), {
  organizationId: org, intentId, source: "NOTIFICATION" });
const renewal = (token: string, overrides: object = {}) => signSyntheticApplePayload({ environment: "Sandbox", originalTransactionId: "100000000000001",
  productId: "synthetic.lifecycle.0", autoRenewProductId: "synthetic.lifecycle.0", autoRenewStatus: 1, appAccountToken: token, signedDate: Date.now(), ...overrides });
const useSyntheticRuntime = () => vi.spyOn(verification, "appleReceiptVerifier").mockImplementation((env) => syntheticAppleVerifier(env === "Production" ? Environment.PRODUCTION : Environment.SANDBOX));

describeDb("Apple lifecycle, source isolation and recovery on PostgreSQL", () => {
  beforeEach(resetDatabase);
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("atomically supersedes annual coverage when a verified monthly replacement arrives, preserving usage", async () => {
    const f = await seed(), [annual, monthly] = configure(f.org.id, [{ ...business, months: 12 }, enterprise]);
    const first = await intentFor(f, annual.offerKey), start = Date.now() - 60_000;
    await apply(tx(first, { purchaseDate: start, expiresDate: start + 365 * 86400000 }), f.org.id, first.intentId);
    await withSubscriptionUsage({ organizationId: f.org.id, resource: "ai", units: 7, operationKey: "before-upgrade" }, async () => true);
    const second = await intentFor(f, monthly.offerKey, "CHANGE"), nextStart = Date.now() - 1000, nextEnd = nextStart + 30 * 86400000;
    await apply(tx(second, { transactionId: "100000000000002", purchaseDate: nextStart, expiresDate: nextEnd, signedDate: Date.now() + 1000 }), f.org.id, second.intentId);
    const original = await prisma.appleTransaction.findUniqueOrThrow({ where: { environment_transactionId: { environment: "Sandbox", transactionId: "100000000000001" } } });
    expect(original.supersededAt?.getTime()).toBe(nextStart); expect(original.status).toBe("REVOKED"); expect(original.revocationDate).toBeNull();
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).currentPeriodEndsAt?.getTime()).toBe(nextEnd);
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("ENTERPRISE");
    expect((await getSubscriptionUsage(f.org.id)).find((u) => u.resource === "ai")?.used).toBe(7);
    // A later re-signed old receipt, refund, and reversal cannot restore the
    // credited annual entitlement after the replacement's shorter end.
    await apply(tx(first, { purchaseDate: start, expiresDate: start + 365 * 86400000, signedDate: Date.now() + 2000, revocationDate: Date.now() + 1000 }), f.org.id);
    await apply(tx(first, { purchaseDate: start, expiresDate: start + 365 * 86400000, signedDate: Date.now() + 3000 }), f.org.id);
    expect((await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { appleTransactionId: original.id } })).revokedAt).not.toBeNull();
    await expect(prisma.appleTransaction.update({ where: { id: original.id }, data: { supersededAt: null, status: "GRANTED" } })).rejects.toThrow();
    await expect(prisma.subscriptionPeriod.update({ where: { appleTransactionId: original.id }, data: { revokedAt: null } })).rejects.toThrow();
  });

  it("does not grant an older annual transaction arriving after its shorter replacement", async () => {
    const f = await seed(), [annual, monthly] = configure(f.org.id, [{ ...business, months: 12 }, enterprise]);
    const first = await intentFor(f, annual.offerKey), oldStart = Date.now() - 30_000;
    await apply(tx(first, { transactionId: "100000000000002", purchaseDate: Date.now() - 1000, expiresDate: Date.now() + 30 * 86400000 }), f.org.id);
    // Approved same-group App Store management change, without a JS-created
    // second intent, is recovered from its signed original-organization chain.
    const replacement = tx({ ...first, productId: monthly.productId }, { transactionId: "100000000000003", purchaseDate: Date.now(), expiresDate: Date.now() + 20 * 86400000, signedDate: Date.now() + 1000 });
    expect((await apply(replacement, f.org.id)).status).toBe("GRANTED");
    const old = tx(first, { purchaseDate: oldStart, expiresDate: Date.now() + 365 * 86400000, signedDate: Date.now() + 2000 });
    expect((await apply(old, f.org.id)).status).toBe("REVOKED");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).currentPeriodEndsAt!.getTime()).toBeLessThan(Date.now() + 21 * 86400000);
  });

  it("retains signed deferred downgrade limits after intent expiry until Apple cancels or renews it", async () => {
    const f = await seed(), [high, low] = configure(f.org.id, [enterprise, starter]);
    await prisma.user.updateMany({ where: { organizationId: f.org.id, id: { not: f.adminUser.id } }, data: { isActive: false } });
    const first = await intentFor(f, high.offerKey); await apply(tx(first), f.org.id, first.intentId);
    await applyAppleSignedRenewal(renewal(first.appAccountToken, { autoRenewProductId: low.productId, signedDate: Date.now() + 1000 }), syntheticAppleVerifier());
    const org = await getOrganizationPlan(f.org.id);
    expect((await getCapacityLimits(org)).maxUsers).toBe(2); expect(org.plan).toBe("ENTERPRISE");
    await expect(assertFeatureCanBeConfigured(f.org.id, "bundles")).rejects.toThrow("billingScheduledFeatureRestriction");
    await prisma.user.create({ data: { organizationId: f.org.id, email: "second@synthetic.test", name: "Second", passwordHash: "synthetic", role: "STAFF" } });
    await expect(prisma.user.create({ data: { organizationId: f.org.id, email: "third@synthetic.test", name: "Third", passwordHash: "synthetic", role: "STAFF" } })).rejects.toThrow();
    await applyAppleSignedRenewal(renewal(first.appAccountToken, { autoRenewStatus: 0, signedDate: Date.now() + 2000 }), syntheticAppleVerifier());
    expect((await getCapacityLimits(await getOrganizationPlan(f.org.id))).maxUsers).toBe(15);
    // Replaying the older deferred preference cannot reinstate a canceled change.
    await applyAppleSignedRenewal(renewal(first.appAccountToken, { autoRenewProductId: low.productId, signedDate: Date.now() + 1000 }), syntheticAppleVerifier());
    expect((await prisma.appleSubscriptionChain.findFirstOrThrow()).pendingProductId).toBeNull();
  });

  it("uses Apple's signed grace period, not an extra automatic seven days", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business]), first = await intentFor(f, mapping.offerKey);
    await apply(tx(first, { purchaseDate: Date.now() - 60_000, expiresDate: Date.now() - 1000 }), f.org.id);
    expect(resolveOrganizationAccessState(await getOrganizationPlan(f.org.id)).hasAccess).toBe(false);
    await applyAppleSignedRenewal(renewal(first.appAccountToken, { gracePeriodExpiresDate: Date.now() + 3 * 86400000, signedDate: Date.now() + 1000 }), syntheticAppleVerifier());
    expect(resolveOrganizationAccessState(await getOrganizationPlan(f.org.id)).inGrace).toBe(true);
    await applyAppleSignedRenewal(renewal(first.appAccountToken, { autoRenewStatus: 0, signedDate: Date.now() + 2000 }), syntheticAppleVerifier());
    expect(resolveOrganizationAccessState(await getOrganizationPlan(f.org.id)).hasAccess).toBe(false);
  });

  it("deduplicates signed notifications and retries a durable notification after transient verifier failure", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business]), first = await intentFor(f, mapping.offerKey);
    const signedTx = tx(first);
    let count = 0;
    vi.spyOn(verification, "appleReceiptVerifier").mockImplementation((env) => {
      if (++count === 3) throw new Error("Synthetic transient verifier failure");
      return syntheticAppleVerifier(env === "Production" ? Environment.PRODUCTION : Environment.SANDBOX);
    });
    const signed = signSyntheticApplePayload({ version: "2.0", notificationUUID: randomUUID(), notificationType: "SUBSCRIBED", signedDate: Date.now(),
      data: { bundleId: "kg.bazaar.app", environment: "Sandbox", appAppleId: 1234567890, signedTransactionInfo: signedTx } });
    await acceptAppleServerNotification(signed);
    expect((await prisma.appleServerNotification.findFirstOrThrow()).status).toBe("PENDING");
    await prisma.appleServerNotification.updateMany({ data: { nextAttemptAt: new Date(0) } });
    vi.stubEnv("APPLE_IAP_PRIVATE_KEY", "");
    await reconcileAppleBilling();
    expect((await prisma.appleServerNotification.findFirstOrThrow()).status).toBe("PROCESSED");
    await acceptAppleServerNotification(signed);
    expect(await prisma.appleServerNotification.count()).toBe(1); expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });

  it("recovers every history page, skips another organization's token and verifies current renewal state", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business]), first = await intentFor(f, mapping.offerKey), start = Date.now() - 60_000;
    const old = tx(first, { purchaseDate: start, expiresDate: start + 20_000 }); await apply(old, f.org.id);
    const next = tx(first, { transactionId: "100000000000002", purchaseDate: start + 30_000, expiresDate: Date.now() + 30 * 86400000 });
    const foreign = tx({ ...first, appAccountToken: randomUUID() }, { transactionId: "100000000000999" });
    useSyntheticRuntime();
    const history = vi.fn().mockResolvedValueOnce({ signedTransactions: [old, foreign], hasMore: true, revision: "page-two" })
      .mockResolvedValueOnce({ signedTransactions: [next], hasMore: false });
    vi.spyOn(verification, "appleApiClient").mockReturnValue({ getTransactionHistory: history,
      getAllSubscriptionStatuses: vi.fn().mockResolvedValue({ data: [{ lastTransactions: [{ signedTransactionInfo: foreign, originalTransactionId: "other-original" }, { signedTransactionInfo: next,
        signedRenewalInfo: renewal(first.appAccountToken, { autoRenewStatus: 0 }) }] }] }),
      getNotificationHistory: vi.fn().mockResolvedValue({ notificationHistory: [], hasMore: false }),
    } as unknown as ReturnType<typeof verification.appleApiClient>);
    await reconcileAppleBilling();
    expect(history).toHaveBeenCalledTimes(2); expect(await prisma.appleTransaction.count()).toBe(2);
    expect((await prisma.appleSubscriptionChain.findFirstOrThrow()).autoRenewEnabled).toBe(false);
    expect((await prisma.appleSubscriptionChain.findFirstOrThrow()).lastIssue).toBeNull();
  });

  it("returns per-receipt restore outcomes without aborting a batch on a foreign or invalid receipt", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business], "NON_RENEWING"), first = await intentFor(f, mapping.offerKey);
    const own = syntheticAppleTransaction({ appAccountToken: first.appAccountToken, productId: first.productId });
    const foreign = syntheticAppleTransaction({ appAccountToken: randomUUID(), productId: first.productId, transactionId: "100000000000999" });
    vi.spyOn(verification, "verifyAppleTransaction").mockImplementation((signed) => syntheticAppleVerifier().transaction(signed));
    const result = await restoreApplePurchases(f.actor, [own, foreign, "invalid", own]);
    expect(result.results.map((r) => r.success)).toEqual([true, false, false, true]);
    expect(result.results[1]).toMatchObject({ reason: "applePurchaseOrganizationMismatch", retryable: false });
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });

  it("disables the web paywall before charge while Apple checkout or auto-renewal controls access", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business]), first = await intentFor(f, mapping.offerKey);
    expect(await getSubscriptionPaymentState(f.org.id)).toMatchObject({ canPurchase: false, purchaseBlockedReason: "applePurchasePending" });
    await apply(tx(first), f.org.id);
    expect(await getSubscriptionPaymentState(f.org.id)).toMatchObject({ canPurchase: false, canChange: false,
      currentPaymentSource: "APPLE", purchaseBlockedReason: "appleSubscriptionManagedByApple" });
  });

  it("provides a signed nonrenewing next-period preview and rejects stale org coverage", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [{ ...business, months: 6 }], "NON_RENEWING");
    const paidEnd = new Date(Date.now() + 30 * 86400000);
    await prisma.organization.update({ where: { id: f.org.id }, data: { currentPeriodEndsAt: paidEnd } });
    const preview = await getApplePurchasePreview(f.actor, { expectedOrganizationId: f.org.id, offerKey: mapping.offerKey, action: "RENEW" });
    expect(preview.timing?.startsAt).toBe(paidEnd.toISOString()); expect(preview.quoteToken).toBeTruthy();
    await prisma.organization.update({ where: { id: f.org.id }, data: { currentPeriodEndsAt: new Date(paidEnd.getTime() + 86400000) } });
    await expect(createApplePurchaseIntent(f.actor, { expectedOrganizationId: f.org.id, offerKey: mapping.offerKey, action: "RENEW", idempotencyKey: randomUUID(),
      quoteToken: preview.quoteToken!, acceptedTerms: true, termsVersion: LEGAL_TERMS_VERSION })).rejects.toThrow("appleAccessChanged");
  });

  it.each(["MANUAL", "LIFETIME"])("preserves existing %s access and never creates a new Apple sale", async (kind) => {
    const f = await seed(), [mapping] = configure(f.org.id, [business]);
    if (kind === "LIFETIME") await prisma.subscriptionContract.update({ where: { organizationId: f.org.id }, data: { lifetimeAccess: true } });
    else await prisma.organization.update({ where: { id: f.org.id }, data: { subscriptionBillingMode: "MANUAL", currentPeriodEndsAt: null } });
    await expect(intentFor(f, mapping.offerKey)).rejects.toThrow(kind === "LIFETIME" ? "billingLifetimeProtected" : "billingManualAccessProtected");
    expect(await prisma.appleTransaction.count()).toBe(0); expect((await getOrganizationPlan(f.org.id)).plan).toBe("BUSINESS");
  });

  it("retains custom legacy financial/feature terms with a distinct approved product mapping", async () => {
    const f = await seedBase({ plan: "BUSINESS" }), legacy = createContractTerms("2026-10");
    legacy.plans.BUSINESS.monthlyPriceKgs = 4321.5;
    await prisma.organization.update({ where: { id: f.org.id }, data: { subscriptionBillingMode: "SELF_SERVE", currentPeriodEndsAt: null } });
    await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, termsSnapshot: legacy } });
    const [mapping] = configure(f.org.id, [{ ...business, months: 6 }], "NON_RENEWING", legacy);
    const actor = { id: f.adminUser.id, organizationId: f.org.id };
    const preview = await getApplePurchasePreview(actor, { expectedOrganizationId: f.org.id, offerKey: mapping.offerKey, action: "RENEW" });
    const intent = await createApplePurchaseIntent(actor, { quoteToken: preview.quoteToken ?? undefined, expectedOrganizationId: f.org.id, offerKey: mapping.offerKey, action: "RENEW", idempotencyKey: randomUUID(),
      acceptedTerms: true, termsVersion: LEGAL_TERMS_VERSION });
    await authorizeApplePurchase(actor, intent.intentId, { attemptId: randomUUID() });
    await apply(syntheticAppleTransaction({ appAccountToken: intent.appAccountToken, productId: mapping.productId }), f.org.id);
    const org = await getOrganizationPlan(f.org.id);
    expect(org.billingCatalogVersion).toBe("2026-10"); expect(org.entitlements.monthlyPriceKgs).toBe(4321.5); expect(org.entitlements.limits.maxStores).toBe(5);
    expect(org.entitlements.usageLimits.ai).toBeNull(); expect((await prisma.appleTransaction.findFirstOrThrow()).currency).toBe("USD");
  });

  it("keeps authorized Ask-to-Buy pending after TTL and grants a late approval once without opening GoPay", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business], "NON_RENEWING"), first = await intentFor(f, mapping.offerKey);
    const later = Date.now() + 16 * 60_000;
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(later);
    vi.stubEnv("APPLE_IAP_PRIVATE_KEY", "");
    await reconcileAppleBilling();
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: first.intentId } })).status).toBe("REVIEW");
    expect(await getSubscriptionPaymentState(f.org.id)).toMatchObject({ canPurchase: false, purchaseBlockedReason: "applePaymentNeedsReview" });
    const signed = syntheticAppleTransaction({ appAccountToken: first.appAccountToken, productId: first.productId });
    expect((await apply(signed, f.org.id)).status).toBe("GRANTED");
    await apply(signed, f.org.id); expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });

  it("preserves future GoPay credit after Apple refund without activating an unpaid coverage gap", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business], "NON_RENEWING"), first = await intentFor(f, mapping.offerKey);
    const purchaseDate = Date.now(), appleReceipt = syntheticAppleTransaction({ appAccountToken: first.appAccountToken, productId: first.productId, purchaseDate });
    await apply(appleReceipt, f.org.id);
    const quote = await calculateSubscriptionQuote(f.org.id, { ...business, action: "RENEW" });
    const invoice = await prisma.subscriptionInvoice.create({ data: { organizationId: f.org.id, createdById: f.adminUser.id, idempotencyKey: randomUUID(),
      plan: "BUSINESS", amountMinor: quote.amountMinor, status: "PAID", merchantId: "synthetic-historical", isTest: true, providerPaymentId: randomUUID(),
      sellerName: "SYNTHETIC", termsVersion: LEGAL_TERMS_VERSION, termsUrl: "https://www.bazaar.kg/legal/offer", expiresAt: new Date(Date.now() + 600000),
      paidAt: new Date(), purchaseSnapshot: json(quote) } });
    const future = await prisma.subscriptionPeriod.create({ data: { organizationId: f.org.id, invoiceId: invoice.id, plan: "BUSINESS",
      startsAt: new Date(quote.startsAt), endsAt: new Date(quote.endsAt), purchaseSnapshot: json(quote) } });
    await prisma.organization.update({ where: { id: f.org.id }, data: { currentPeriodEndsAt: future.endsAt } });
    await apply(syntheticAppleTransaction({ appAccountToken: first.appAccountToken, productId: first.productId, purchaseDate,
      signedDate: Date.now() + 1000, revocationDate: Date.now() }), f.org.id);
    const org = await getOrganizationPlan(f.org.id);
    expect(org.paidCoverageGap).toBe(true); expect(resolveOrganizationAccessState(org).hasAccess).toBe(false);
    expect(org.currentPeriodEndsAt).toEqual(future.endsAt);
    expect((await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { id: future.id } })).revokedAt).toBeNull();
  });

  it("preserves previously approved date-based access if a future Apple prepayment is refunded", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business], "NON_RENEWING");
    const approvedEnd = new Date(Date.now() + 14 * 86400000);
    await prisma.organization.update({ where: { id: f.org.id }, data: { currentPeriodEndsAt: approvedEnd } });
    const first = await intentFor(f, mapping.offerKey), purchaseDate = Date.now();
    await apply(syntheticAppleTransaction({ appAccountToken: first.appAccountToken, productId: first.productId, purchaseDate }), f.org.id);
    await apply(syntheticAppleTransaction({ appAccountToken: first.appAccountToken, productId: first.productId, purchaseDate,
      signedDate: Date.now() + 1000, revocationDate: Date.now() }), f.org.id);
    const org = await getOrganizationPlan(f.org.id);
    expect(org.currentPeriodEndsAt).toEqual(approvedEnd); expect(resolveOrganizationAccessState(org).hasAccess).toBe(true);
    expect(org.entitlements).toEqual(terms.plans.BUSINESS);
  });

  it("releases refunded Apple coverage for switching only after verified auto-renewal is off", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business]), first = await intentFor(f, mapping.offerKey), purchaseDate = Date.now();
    const expiresDate = purchaseDate + 30 * 86400000;
    await apply(tx(first, { purchaseDate, expiresDate }), f.org.id);
    await applyAppleSignedRenewal(renewal(first.appAccountToken, { signedDate: Date.now() + 1000 }), syntheticAppleVerifier());
    await apply(tx(first, { purchaseDate, expiresDate, signedDate: Date.now() + 2000, revocationDate: Date.now() }), f.org.id);
    expect((await getSubscriptionPaymentState(f.org.id)).purchaseBlockedReason).toBe("appleSubscriptionManagedByApple");
    await applyAppleSignedRenewal(renewal(first.appAccountToken, { autoRenewStatus: 0, signedDate: Date.now() + 3000 }), syntheticAppleVerifier());
    expect((await getSubscriptionPaymentState(f.org.id)).purchaseBlockedReason).toBeNull();
  });


  it("releases only an unrecorded expired authorization after a definite native cancellation", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business], "NON_RENEWING"), first = await intentFor(f, mapping.offerKey);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 16 * 60_000); vi.stubEnv("APPLE_IAP_PRIVATE_KEY", "");
    await reconcileAppleBilling();
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: first.intentId } })).status).toBe("REVIEW");
    expect(await cancelApplePurchaseIntent(f.actor, first.intentId, first.attemptId)).toEqual({ canceled: true, recorded: false });
    expect((await getSubscriptionPaymentState(f.org.id)).purchaseBlockedReason).toBeNull();
  });


  it("lets metadata-only preparation expire safely without recording a potentially paid authorization", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business]);
    const intent = await createApplePurchaseIntent(f.actor, { expectedOrganizationId: f.org.id, offerKey: mapping.offerKey, action: "RENEW",
      idempotencyKey: randomUUID(), acceptedTerms: true, termsVersion: LEGAL_TERMS_VERSION });
    expect(await authorizeApplePurchase(f.actor, intent.intentId, { prepareOnly: true })).toEqual({ ...intent, attemptId: null });
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } })).authorizedAt).toBeNull();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 16 * 60_000); vi.stubEnv("APPLE_IAP_PRIVATE_KEY", "");
    await reconcileAppleBilling();
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } })).status).toBe("EXPIRED");
    expect((await getSubscriptionPaymentState(f.org.id)).purchaseBlockedReason).toBeNull();
    expect(await cancelApplePurchaseIntent(f.actor, intent.intentId)).toEqual({ canceled: true, recorded: false });
    expect(await cancelApplePurchaseIntent(f.actor, intent.intentId)).toEqual({ canceled: true, recorded: false });
  });

  it("consumes final native authorization once and refuses both sheet and preparation replay", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business]);
    const intent = await createApplePurchaseIntent(f.actor, { expectedOrganizationId: f.org.id, offerKey: mapping.offerKey, action: "RENEW",
      idempotencyKey: randomUUID(), acceptedTerms: true, termsVersion: LEGAL_TERMS_VERSION });
    await authorizeApplePurchase(f.actor, intent.intentId, { prepareOnly: true });
    const attemptId = randomUUID();
    expect((await authorizeApplePurchase(f.actor, intent.intentId, { attemptId: attemptId.toUpperCase() })).attemptId).toBe(attemptId);
    const authorized = (await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } })).authorizedAt;
    expect(authorized).not.toBeNull();
    await expect(authorizeApplePurchase(f.actor, intent.intentId, { prepareOnly: true })).rejects.toThrow("applePurchasePendingVerification");
    await expect(authorizeApplePurchase(f.actor, intent.intentId, { attemptId })).rejects.toThrow("applePurchasePendingVerification");
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } })).authorizedAt).toEqual(authorized);
  });


  it("admits only one concurrent final native authorization before any StoreKit sheet", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business]);
    const intent = await createApplePurchaseIntent(f.actor, { expectedOrganizationId: f.org.id, offerKey: mapping.offerKey, action: "RENEW",
      idempotencyKey: randomUUID(), acceptedTerms: true, termsVersion: LEGAL_TERMS_VERSION });
    const ids = [randomUUID(), randomUUID()];
    const attempts = await Promise.allSettled(ids.map((attemptId) => authorizeApplePurchase(f.actor, intent.intentId, { attemptId })));
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    const denied = attempts.find((a) => a.status === "rejected");
    expect(denied?.status === "rejected" && denied.reason.message).toBe("applePurchasePendingVerification");
    const winner = attempts.find((attempt) => attempt.status === "fulfilled");
    const winningId = winner?.status === "fulfilled" ? winner.value.attemptId : null;
    const losingId = ids.find((id) => id !== winningId)!;
    expect(winningId).toBeTruthy();
    const persisted = await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } });
    expect(persisted.authorizedAt).not.toBeNull(); expect(persisted.nativeAttemptId).toBe(winningId);
    await expect(cancelApplePurchaseIntent(f.actor, intent.intentId, losingId)).rejects.toThrow("applePurchaseAttemptMismatch");
    await expect(cancelApplePurchaseIntent(f.actor, intent.intentId)).rejects.toThrow("applePurchaseAttemptMismatch");
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } })).status).toBe("PENDING");
    expect(await cancelApplePurchaseIntent(f.actor, intent.intentId, winningId!)).toEqual({ canceled: true, recorded: false });
    expect(await cancelApplePurchaseIntent(f.actor, intent.intentId, winningId!)).toEqual({ canceled: true, recorded: false });
  });

  it("recovers a lost pre-SDK authorization response only through the original durable native attempt", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business]);
    const input = { expectedOrganizationId: f.org.id, offerKey: mapping.offerKey, action: "RENEW" as const,
      idempotencyKey: randomUUID(), acceptedTerms: true as const, termsVersion: LEGAL_TERMS_VERSION };
    const intent = await createApplePurchaseIntent(f.actor, input), attemptId = randomUUID();
    // Discard the successful server response: the local journal still has the
    // UUID it persisted before sending final authorization, and SDK was not called.
    await authorizeApplePurchase(f.actor, intent.intentId, { attemptId });
    const replay = await createApplePurchaseIntent(f.actor, input);
    expect(replay).not.toHaveProperty("attemptId");
    expect(JSON.stringify(await getAppleBillingState(f.actor))).not.toContain(attemptId);
    await expect(authorizeApplePurchase(f.actor, intent.intentId, { attemptId })).rejects.toThrow("applePurchasePendingVerification");
    await expect(cancelApplePurchaseIntent(f.actor, intent.intentId, randomUUID())).rejects.toThrow("applePurchaseAttemptMismatch");
    await prisma.user.update({ where: { id: f.managerUser.id }, data: { role: "ADMIN" } });
    await expect(cancelApplePurchaseIntent({ id: f.managerUser.id, organizationId: f.org.id }, intent.intentId, attemptId)).rejects.toThrow("recordNotFound");
    expect(await cancelApplePurchaseIntent(f.actor, intent.intentId, attemptId.toUpperCase())).toEqual({ canceled: true, recorded: false });
    expect((await getSubscriptionPaymentState(f.org.id)).purchaseBlockedReason).toBeNull();
  });

  it("retains historical authorized intents without an attempt and rejects retroactive device claims in the database", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business]);
    const intent = await createApplePurchaseIntent(f.actor, { expectedOrganizationId: f.org.id, offerKey: mapping.offerKey, action: "RENEW",
      idempotencyKey: randomUUID(), acceptedTerms: true, termsVersion: LEGAL_TERMS_VERSION });
    await prisma.applePurchaseIntent.update({ where: { id: intent.intentId }, data: { authorizedAt: new Date() } });
    await expect(cancelApplePurchaseIntent(f.actor, intent.intentId)).rejects.toThrow("applePurchaseAttemptMismatch");
    await expect(cancelApplePurchaseIntent(f.actor, intent.intentId, randomUUID())).rejects.toThrow("applePurchaseAttemptMismatch");
    await expect(prisma.applePurchaseIntent.update({ where: { id: intent.intentId }, data: { nativeAttemptId: randomUUID() } })).rejects.toThrow();
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } })).status).toBe("PENDING");
  });

  it("requires a valid native UUID and makes a bound authorization immutable even for raw database writers", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business]);
    const intent = await createApplePurchaseIntent(f.actor, { expectedOrganizationId: f.org.id, offerKey: mapping.offerKey, action: "RENEW",
      idempotencyKey: randomUUID(), acceptedTerms: true, termsVersion: LEGAL_TERMS_VERSION });
    await expect(authorizeApplePurchase(f.actor, intent.intentId)).rejects.toThrow("applePurchaseAttemptRequired");
    await expect(authorizeApplePurchase(f.actor, intent.intentId, { attemptId: "not-a-uuid" })).rejects.toThrow("applePurchaseAttemptRequired");
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } })).authorizedAt).toBeNull();
    const attemptId = randomUUID();
    await authorizeApplePurchase(f.actor, intent.intentId, { attemptId });
    await expect(prisma.applePurchaseIntent.update({ where: { id: intent.intentId }, data: { nativeAttemptId: randomUUID() } })).rejects.toThrow();
    await expect(prisma.applePurchaseIntent.update({ where: { id: intent.intentId }, data: { nativeAttemptId: null } })).rejects.toThrow();
    await expect(prisma.applePurchaseIntent.update({ where: { id: intent.intentId }, data: { authorizedAt: null } })).rejects.toThrow();
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } })).nativeAttemptId).toBe(attemptId);
  });

  it("retains a second nonrenewing charge for one intent in review without granting it or hiding it on other receipts", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business], "NON_RENEWING"), intent = await intentFor(f, mapping.offerKey);
    const purchaseDate = Date.now();
    const one = syntheticAppleTransaction({ appAccountToken: intent.appAccountToken, productId: intent.productId, purchaseDate });
    const two = syntheticAppleTransaction({ appAccountToken: intent.appAccountToken, productId: intent.productId, purchaseDate,
      transactionId: "100000000000002", originalTransactionId: "100000000000002" });
    const results = await Promise.all([apply(one, f.org.id, intent.intentId), apply(two, f.org.id, intent.intentId)]);
    expect(results.map((r) => r.status).sort()).toEqual(["GRANTED", "REVIEW"]);
    expect(results.find((r) => r.status === "REVIEW")?.reason).toBe("appleIntentAlreadyFulfilled");
    expect(await prisma.appleTransaction.count()).toBe(2); expect(await prisma.subscriptionPeriod.count()).toBe(1);
    const granted = results.find((r) => r.status === "GRANTED")!.transactionId === "100000000000001" ? one : two;
    await apply(granted, f.org.id);
    await apply(syntheticAppleTransaction({ appAccountToken: intent.appAccountToken, productId: intent.productId, purchaseDate,
      transactionId: "100000000000003", originalTransactionId: "100000000000003", revocationDate: Date.now() }), f.org.id, intent.intentId);
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } })).status).toBe("REVIEW");
    expect(await cancelApplePurchaseIntent(f.actor, intent.intentId, randomUUID())).toEqual({ canceled: false, recorded: true });
  });

  it("does not grant a second consumable balance for another verified transaction using one intent", async () => {
    const f = await seed(); configure(f.org.id, [business]);
    const token = randomUUID(), pack = appleWhatsAppOffer(1), stamp = new Date();
    await prisma.appleBillingAccount.create({ data: { organizationId: f.org.id, appAccountToken: token } });
    const intent = await prisma.applePurchaseIntent.create({ data: { organizationId: f.org.id, createdById: f.adminUser.id,
      idempotencyKey: randomUUID(), pendingSlot: `WHATSAPP_PACK:${f.org.id}`, scope: "WHATSAPP_PACK", productId: "synthetic.consumable",
      productType: "CONSUMABLE", offerKey: pack.offerKey, environment: "Sandbox", appAccountToken: token,
      offerSnapshot: json({ ...pack, appleProduct: { appleOfferVersion: APPLE_WHATSAPP_OFFER_VERSION } }),
      authorizedAt: stamp, termsVersion: LEGAL_TERMS_VERSION, termsUrl: "https://www.bazaar.kg/legal/offer", expiresAt: new Date(stamp.getTime() + 900000) } });
    const receipt = (id: string) => syntheticAppleTransaction({ appAccountToken: token, productId: intent.productId, type: Type.CONSUMABLE,
      transactionId: id, originalTransactionId: id });
    expect((await apply(receipt("100000000000001"), f.org.id, intent.id)).status).toBe("GRANTED");
    expect(await apply(receipt("100000000000002"), f.org.id, intent.id)).toMatchObject({ status: "REVIEW", reason: "appleIntentAlreadyFulfilled" });
    expect(await prisma.appleTransaction.count()).toBe(2); expect(await prisma.whatsAppCreditLot.count()).toBe(1);
    expect((await prisma.whatsAppCreditLot.findFirstOrThrow()).total).toBe(1000);
  });


  it("uses a server-allowlisted review organization's Sandbox intent on a live deployment", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business]); vi.stubEnv("APPLE_BILLING_MODE", "live");
    expect(await getAppleBillingState(f.actor)).toMatchObject({ ready: true, environment: "Sandbox" });
    const intent = await intentFor(f, mapping.offerKey);
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } })).environment).toBe("Sandbox");
    expect((await apply(tx(intent), f.org.id, intent.intentId)).status).toBe("GRANTED");
    expect((await prisma.appleTransaction.findFirstOrThrow()).environment).toBe("Sandbox");
  });

  it("keeps ordinary live organizations in Production and refuses Sandbox fulfillment", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business]);
    vi.stubEnv("APPLE_BILLING_MODE", "live"); vi.stubEnv("APPLE_BILLING_SANDBOX_ORGANIZATION_IDS", "synthetic-review-only-other-org");
    expect(await getAppleBillingState(f.actor)).toMatchObject({ ready: true, environment: "Production" });
    const intent = await intentFor(f, mapping.offerKey);
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } })).environment).toBe("Production");
    await expect(apply(tx(intent), f.org.id, intent.intentId)).rejects.toThrow("applePurchaseBindingMismatch");
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
    const production = await syntheticAppleVerifier(Environment.PRODUCTION).transaction(tx(intent, { environment: "Production" }));
    expect((await applyAppleTransaction(production, { organizationId: f.org.id, intentId: intent.intentId, source: "CLIENT" })).status).toBe("GRANTED");
    expect((await prisma.appleTransaction.findFirstOrThrow()).environment).toBe("Production");
  });

  it("forbids non-allowlisted organizations in sandbox mode, including a previously prepared intent", async () => {
    const f = await seed(), [mapping] = configure(f.org.id, [business]);
    const intent = await createApplePurchaseIntent(f.actor, { expectedOrganizationId: f.org.id, offerKey: mapping.offerKey, action: "RENEW",
      idempotencyKey: randomUUID(), acceptedTerms: true, termsVersion: LEGAL_TERMS_VERSION });
    await authorizeApplePurchase(f.actor, intent.intentId, { prepareOnly: true });
    vi.stubEnv("APPLE_BILLING_SANDBOX_ORGANIZATION_IDS", "");
    const catalog = await getAppleBillingState(f.actor);
    expect(catalog).toMatchObject({ ready: false, environment: "Sandbox", unavailableReason: "appleSandboxNotAllowed" });
    expect(catalog.offers.every((o) => !o.available)).toBe(true);
    await expect(authorizeApplePurchase(f.actor, intent.intentId, { attemptId: randomUUID() })).rejects.toThrow("appleSandboxNotAllowed");
    await expect(createApplePurchaseIntent(f.actor, { expectedOrganizationId: f.org.id, offerKey: mapping.offerKey, action: "RENEW",
      idempotencyKey: randomUUID(), acceptedTerms: true, termsVersion: LEGAL_TERMS_VERSION })).rejects.toThrow("appleSandboxNotAllowed");
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
  });

});
