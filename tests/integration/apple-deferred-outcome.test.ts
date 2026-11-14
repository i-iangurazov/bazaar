import { randomUUID } from "node:crypto";
import { Type } from "@apple/app-store-server-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { createContractTerms } from "@/server/billing/contractTerms";
import { appleSubscriptionOffer } from "@/server/billing/appleOfferCatalog";
import { applyAppleTransaction, authorizeApplePurchase, cancelApplePurchaseIntent, createApplePurchaseIntent, getAppleBillingState } from "@/server/billing/applePayments";
import { applyAppleSignedRenewal, reconcileAppleBilling } from "@/server/billing/appleLifecycle";
import { applyAppleDeferredOutcome } from "@/server/billing/appleDeferredOutcome";
import { readAppleDeferredSource } from "@/server/billing/appleDeferredEvidence";
import { getSubscriptionPaymentState } from "@/server/billing/subscriptionPayments";
import { getSubscriptionUsage, reserveSubscriptionUsage, withSubscriptionUsage } from "@/server/billing/subscriptionUsage";
import { assertFeatureCanBeConfigured, getCapacityLimits, getOrganizationPlan, resolveOrganizationAccessState } from "@/server/services/planLimits";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { syntheticAppleStoreKitConsent, signSyntheticApplePayload, syntheticAppleTransaction, syntheticAppleVerifier } from "../helpers/appleSignedFixture";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const DAY = 86_400_000, terms = createContractTerms("2026-11");
const extras = { stores: 0, productPacks: 0, userPacks: 0 as const };
const selections = [{ plan: "ENTERPRISE" as const, months: 12 as const, extras },
  { plan: "BUSINESS" as const, months: 1 as const, extras }, { plan: "STARTER" as const, months: 1 as const, extras },
  { plan: "ENTERPRISE" as const, months: 12 as const, extras: { ...extras, stores: 1 } }];
const intentFor = async (actor: { id: string; organizationId: string }, offerKey: string, action: "RENEW" | "CHANGE") => {
  const intent = await createApplePurchaseIntent(actor, { expectedOrganizationId: actor.organizationId, offerKey, action,
    idempotencyKey: randomUUID(), termsVersion: LEGAL_TERMS_VERSION, storeKitConsent: syntheticAppleStoreKitConsent, acceptedTerms: true });
  const attemptId = randomUUID();
  await authorizeApplePurchase(actor, intent.intentId, { attemptId });
  return { ...intent, attemptId };
};
const seed = async (termMs = 365 * DAY) => {
  const f = await seedBase({ plan: "ENTERPRISE" });
  await prisma.user.updateMany({ where: { organizationId: f.org.id, id: { not: f.adminUser.id } }, data: { isActive: false } });
  await prisma.organization.update({ where: { id: f.org.id }, data: { subscriptionBillingMode: "SELF_SERVE", currentPeriodEndsAt: null, trialEndsAt: null } });
  await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11", termsSnapshot: terms } });
  const mappings = selections.map((selection, index) => ({ offerKey: appleSubscriptionOffer(terms, selection).offerKey,
    productId: `synthetic.deferred.${index}`, productType: "AUTO_RENEWABLE", subscriptionGroupId: "synthetic-deferred-group", approved: true }));
  for (const [key, value] of Object.entries({ APPLE_BILLING_MODE: "sandbox", APPLE_APP_ID: "1234567890", APPLE_IAP_KEY_ID: "SYNTHETIC",
    APPLE_IAP_ISSUER_ID: "SYNTHETIC", APPLE_IAP_PRIVATE_KEY: "SYNTHETIC PRIVATE KEY", APPLE_BILLING_TERMS_VERSION: LEGAL_TERMS_VERSION,
    APPLE_BILLING_TERMS_APPROVED: "true", APPLE_BILLING_SALES_APPROVED: "true", APPLE_BILLING_SANDBOX_ORGANIZATION_IDS: f.org.id,
    APPLE_BILLING_CATALOG_JSON: JSON.stringify(mappings) })) vi.stubEnv(key, value);
  const actor = { id: f.adminUser.id, organizationId: f.org.id }, first = await intentFor(actor, mappings[0].offerKey, "RENEW");
  const baseData = { appAccountToken: first.appAccountToken, productId: first.productId, type: Type.AUTO_RENEWABLE_SUBSCRIPTION,
    subscriptionGroupIdentifier: "synthetic-deferred-group", transactionId: "100000000000001", originalTransactionId: "100000000000001",
    purchaseDate: Date.now() - 60_000, expiresDate: Date.now() + termMs, price: 9990, currency: "USD", signedDate: Date.now() };
  const baseSigned = syntheticAppleTransaction(baseData), verifier = syntheticAppleVerifier();
  await applyAppleTransaction(await verifier.transaction(baseSigned), { organizationId: f.org.id, intentId: first.intentId, source: "CLIENT" });
  const previous = await prisma.appleTransaction.findUniqueOrThrow({ where: { environment_transactionId: { environment: "Sandbox", transactionId: baseData.transactionId } } });
  const change = await intentFor(actor, mappings[1].offerKey, "CHANGE");
  const intent = await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: change.intentId } });
  return { ...f, actor, first, change, intent, previous, baseData, baseSigned, verifier, mappings };
};
type Fixture = Awaited<ReturnType<typeof seed>>;
const evidence = async (f: Fixture, txOverrides: Partial<Parameters<typeof syntheticAppleTransaction>[0]> = {}, renewalOverrides: object = {}) => {
  const txSigned = Object.keys(txOverrides).length ? syntheticAppleTransaction({ ...f.baseData, ...txOverrides }) : f.baseSigned;
  const renewalSigned = signSyntheticApplePayload({ environment: "Sandbox", originalTransactionId: f.baseData.originalTransactionId,
    appAccountToken: f.first.appAccountToken, productId: f.first.productId, autoRenewProductId: f.change.productId,
    autoRenewStatus: 1, renewalDate: f.baseData.expiresDate, signedDate: f.intent.authorizedAt!.getTime() + 1, ...renewalOverrides });
  return { transaction: await f.verifier.transaction(txSigned), renewal: await f.verifier.verifiedRenewal(renewalSigned), txSigned, renewalSigned };
};
const ack = (f: Fixture, proof: Awaited<ReturnType<typeof evidence>>, attemptId = f.change.attemptId) =>
  applyAppleDeferredOutcome(f.actor, { intentId: f.change.intentId, attemptId }, proof.transaction, proof.renewal);
const applyNewMoney = async (f: Fixture, quantity = 1) => {
  const signed = syntheticAppleTransaction({ ...f.baseData, productId: f.change.productId, transactionId: "100000000000002",
    purchaseDate: Date.now(), expiresDate: Date.now() + 30 * DAY, signedDate: Date.now(), quantity });
  return applyAppleTransaction(await f.verifier.transaction(signed), { organizationId: f.org.id, intentId: f.change.intentId, source: "NOTIFICATION" });
};

describeDb("earned native deferred-purchase outcomes on PostgreSQL", () => {
  let network: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    await resetDatabase();
    network = vi.fn(() => { throw new Error("Deferred outcome tests cannot call external providers"); });
    vi.stubGlobal("fetch", network);
  });
  afterEach(() => {
    expect(network).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  });

  it("records one exact winning old-transaction result, keeps quota and base access, and permits a later change without waiting a year", async () => {
    const f = await seed(), proof = await evidence(f);
    await withSubscriptionUsage({ organizationId: f.org.id, resource: "ai", units: 3, operationKey: "before-deferred" }, async () => true);
    await reserveSubscriptionUsage({ organizationId: f.org.id, resource: "ai", units: 2, operationKey: "reserved-before-deferred" });
    const periods = await prisma.subscriptionPeriod.findMany({ where: { organizationId: f.org.id } });
    const buckets = await prisma.subscriptionUsageBucket.findMany({ where: { organizationId: f.org.id } });
    const results = await Promise.allSettled([ack(f, proof), ack(f, proof)]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const replies = results.map((result) => { if (result.status === "rejected") throw result.reason; return result.value; });
    for (const reply of replies) expect(reply).toMatchObject({ acknowledged: true, deferred: true, recorded: false, scheduled: true,
      intentId: f.change.intentId, productId: f.change.productId, effectiveAt: new Date(f.baseData.expiresDate).toISOString() });
    expect(await prisma.appleNativeDeferredOutcome.count()).toBe(1);
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.change.intentId } })).status).toBe("COMPLETED");
    expect(await prisma.subscriptionPeriod.findMany({ where: { organizationId: f.org.id } })).toEqual(periods);
    expect(await prisma.subscriptionUsageBucket.findMany({ where: { organizationId: f.org.id } })).toEqual(buckets);
    expect(await prisma.subscriptionInvoice.count()).toBe(0); expect(await prisma.appleTransaction.count()).toBe(1);
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("ENTERPRISE");
    expect((await getCapacityLimits(await getOrganizationPlan(f.org.id))).maxUsers).toBe(5);
    await expect(assertFeatureCanBeConfigured(f.org.id, "bundles")).rejects.toThrow("billingScheduledFeatureRestriction");
    expect((await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai")).toMatchObject({ used: 3, reserved: 2 });
    const preference = await prisma.appleSubscriptionChain.findFirstOrThrow();
    const catalog = await getAppleBillingState(f.actor), activeOffer = catalog.offers.find((offer) => offer.productId === f.first.productId)!;
    expect(activeOffer.availableActions).not.toContain("CHANGE"); expect(activeOffer.changeUnavailableReason).toBe("billingNoPaidChange");
    expect(catalog.managementUrl).toBe("https://apps.apple.com/account/subscriptions");
    await expect(createApplePurchaseIntent(f.actor, { expectedOrganizationId: f.org.id, offerKey: f.mappings[0].offerKey, action: "CHANGE",
      idempotencyKey: randomUUID(), termsVersion: LEGAL_TERMS_VERSION, storeKitConsent: syntheticAppleStoreKitConsent, acceptedTerms: true })).rejects.toThrow("billingNoPaidChange");
    expect(await prisma.appleSubscriptionChain.findFirstOrThrow()).toEqual(preference);
    const next = await createApplePurchaseIntent(f.actor, { expectedOrganizationId: f.org.id, offerKey: f.mappings[2].offerKey, action: "CHANGE",
      idempotencyKey: randomUUID(), termsVersion: LEGAL_TERMS_VERSION, storeKitConsent: syntheticAppleStoreKitConsent, acceptedTerms: true });
    expect(next.intentId).not.toBe(f.change.intentId);
  });

  it.each(["WRONG_ATTEMPT", "OTHER_ADMIN", "DEMOTED", "DEACTIVATED"] as const)("refuses %s without accepting another invocation's proof", async (failure) => {
    const f = await seed(), proof = await evidence(f);
    if (failure === "WRONG_ATTEMPT") await expect(ack(f, proof, randomUUID())).rejects.toThrow("applePurchaseAttemptMismatch");
    else if (failure === "OTHER_ADMIN") {
      await prisma.user.update({ where: { id: f.managerUser.id }, data: { role: "ADMIN", isActive: true } });
      await expect(applyAppleDeferredOutcome({ id: f.managerUser.id, organizationId: f.org.id }, { intentId: f.change.intentId, attemptId: f.change.attemptId },
        proof.transaction, proof.renewal)).rejects.toThrow("recordNotFound");
    } else {
      await prisma.user.update({ where: { id: f.adminUser.id }, data: failure === "DEMOTED" ? { role: "STAFF" } : { isActive: false } });
      await expect(ack(f, proof)).rejects.toThrow("forbidden");
    }
    expect(await prisma.appleNativeDeferredOutcome.count()).toBe(0);
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.change.intentId } })).status).toBe("PENDING");
  });

  it.each([
    ["OFF", {}, { autoRenewStatus: 0 }],
    ["unrelated original chain", {}, { originalTransactionId: "100000000000999" }],
    ["another account token", {}, { appAccountToken: "00000000-0000-4000-8000-000000000999" }],
    ["another current product", {}, { productId: "synthetic.other.current" }],
    ["another target", {}, { autoRenewProductId: "synthetic.other.target" }],
    ["another renewal date", {}, { renewalDate: 1 }],
    ["another group", { subscriptionGroupIdentifier: "synthetic-other-group" }, {}],
    ["a new target transaction", { productId: "synthetic.deferred.1", transactionId: "100000000000099" }, {}],
    ["a refunded old transaction", { revocationDate: Date.now() }, {}],
    ["an upgraded old transaction", { isUpgraded: true }, {}],
    ["changed old money", { price: 9991 }, {}],
  ] as const)("rejects signed but mismatched %s evidence without clearing the hold", async (_name, transactionOverrides, renewalOverrides) => {
    const f = await seed(), proof = await evidence(f, transactionOverrides, renewalOverrides);
    await expect(ack(f, proof)).rejects.toThrow("appleDeferredOutcomeMismatch");
    expect(await prisma.appleNativeDeferredOutcome.count()).toBe(0);
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.change.intentId } })).status).toBe("PENDING");
    expect(await prisma.appleTransaction.count()).toBe(1); expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });

  it.each(["BEFORE_AUTHORIZATION", "AFTER_OLD_TERM"] as const)("rejects renewal evidence signed %s even when its target matches", async (when) => {
    const f = await seed(5 * 60_000);
    const signedDate = when === "BEFORE_AUTHORIZATION" ? f.intent.authorizedAt!.getTime() - 1 : f.baseData.expiresDate;
    // The after-term fixture is a cryptographically verified future renewal
    // observed on that real simulated business date, never an unverified object.
    if (when === "AFTER_OLD_TERM") { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(signedDate); }
    const proof = await evidence(f, {}, { signedDate });
    await expect(ack(f, proof)).rejects.toThrow("appleDeferredOutcomeMismatch");
    expect(await prisma.appleNativeDeferredOutcome.count()).toBe(0);
  });

  it.each([0, 1])("records an older earned result without rolling back a newer signed preference (autoRenew=%i)", async (autoRenewStatus) => {
    const f = await seed(), proof = await evidence(f);
    const newer = signSyntheticApplePayload({ ...proof.renewal.data, autoRenewStatus,
      autoRenewProductId: f.mappings[2].productId, signedDate: proof.renewal.data.signedDate + 1000 });
    await applyAppleSignedRenewal(newer, f.verifier);
    const chain = await prisma.appleSubscriptionChain.findFirstOrThrow();
    expect(await ack(f, proof)).toMatchObject({ deferred: true, recorded: false, scheduled: false });
    const after = await prisma.appleSubscriptionChain.findUniqueOrThrow({ where: { id: chain.id } });
    expect(after).toMatchObject({ autoRenewEnabled: chain.autoRenewEnabled, pendingProductId: chain.pendingProductId,
      pendingChangeOffer: chain.pendingChangeOffer, lastSignedAt: chain.lastSignedAt });
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.change.intentId } })).status).toBe("COMPLETED");
    expect(await ack(f, proof)).toMatchObject({ deferred: true, scheduled: false });
  });

  it("can retry captured during-term proof after local expiry without adding past access or another charge", async () => {
    const f = await seed(), proof = await evidence(f), previous = await prisma.subscriptionPeriod.findFirstOrThrow();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(f.baseData.expiresDate + 1); vi.stubEnv("APPLE_IAP_PRIVATE_KEY", "");
    await reconcileAppleBilling();
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.change.intentId } })).status).toBe("REVIEW");
    expect(await ack(f, proof)).toMatchObject({ deferred: true, recorded: false, scheduled: false });
    expect(await prisma.subscriptionPeriod.findFirstOrThrow()).toEqual(previous);
    expect(await prisma.appleTransaction.count()).toBe(1); expect(await prisma.subscriptionInvoice.count()).toBe(0);
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("ENTERPRISE");
  });

  it.each([1, 2])("gives durable money precedence (quantity=%i) without recording deferral or clearing financial REVIEW", async (quantity) => {
    const f = await seed(), proof = await evidence(f);
    await applyNewMoney(f, quantity);
    const intent = await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.change.intentId } });
    const money = await prisma.appleTransaction.findMany({ where: { intentId: intent.id } });
    expect(await ack(f, proof)).toMatchObject({ acknowledged: true, deferred: false, recorded: true,
      status: quantity === 2 ? "REVIEW" : "COMPLETED", reason: quantity === 2 ? "appleQuantityMismatch" : null });
    expect(await prisma.appleNativeDeferredOutcome.count()).toBe(0);
    expect(await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.id } })).toEqual(intent);
    expect(await prisma.appleTransaction.findMany({ where: { intentId: intent.id } })).toEqual(money);
  });

  it("hands a later paid REVIEW to normal recovery even after an earlier deferred ACK", async () => {
    const f = await seed(), proof = await evidence(f); await ack(f, proof);
    await applyNewMoney(f, 2);
    const intent = await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.change.intentId } });
    expect(await ack(f, proof)).toMatchObject({ deferred: false, recorded: true, status: "REVIEW", reason: "appleQuantityMismatch" });
    expect(await prisma.appleNativeDeferredOutcome.count()).toBe(1);
    expect(await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.id } })).toEqual(intent);
    expect((await getSubscriptionPaymentState(f.org.id)).purchaseBlockedReason).toBe("applePaymentNeedsReview");
  });

  it("serializes a concurrent earned-outcome ACK and paid receipt without losing financial REVIEW", async () => {
    const f = await seed(), proof = await evidence(f);
    const results = await Promise.allSettled([ack(f, proof), applyNewMoney(f, 2)]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const responseResult = results[0], paidResult = results[1];
    if (responseResult.status === "rejected") throw responseResult.reason;
    if (paidResult.status === "rejected") throw paidResult.reason;
    const response = responseResult.value, paid = paidResult.value;
    expect(paid.status).toBe("REVIEW");
    expect(response.acknowledged).toBe(true);
    expect(await prisma.appleNativeDeferredOutcome.count()).toBeLessThanOrEqual(1);
    expect(await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.change.intentId } }))
      .toMatchObject({ status: "REVIEW", lastIssue: "appleQuantityMismatch" });
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
    expect((await getSubscriptionPaymentState(f.org.id)).purchaseBlockedReason).toBe("applePaymentNeedsReview");
  });

  it("rejects changed replay evidence without rewriting the accepted outcome, current preference or intent", async () => {
    const f = await seed(), proof = await evidence(f); await ack(f, proof);
    const prior = await prisma.appleNativeDeferredOutcome.findFirstOrThrow();
    const intent = await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.change.intentId } });
    const chain = await prisma.appleSubscriptionChain.findFirstOrThrow();
    const changed = await evidence(f, {}, { signedDate: proof.renewal.data.signedDate + 1 });
    await expect(ack(f, changed)).rejects.toThrow("appleDeferredOutcomeMismatch");
    expect(await prisma.appleNativeDeferredOutcome.findFirstOrThrow()).toEqual(prior);
    expect(await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.id } })).toEqual(intent);
    expect(await prisma.appleSubscriptionChain.findFirstOrThrow()).toEqual(chain);
    expect(await prisma.appleTransaction.count()).toBe(1); expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });

  it("resolves only its own invocation while retaining another signed receipt's independent REVIEW", async () => {
    const f = await seed(), proof = await evidence(f);
    const other = syntheticAppleTransaction({ ...f.baseData, productId: "synthetic.unknown", transactionId: "100000000000999", originalTransactionId: "100000000000999" });
    expect((await applyAppleTransaction(await f.verifier.transaction(other), { organizationId: f.org.id, source: "NOTIFICATION" })).status).toBe("REVIEW");
    const review = await prisma.appleTransaction.findFirstOrThrow({ where: { status: "REVIEW" } });
    expect(await ack(f, proof)).toMatchObject({ deferred: true });
    expect(await prisma.appleTransaction.findUniqueOrThrow({ where: { id: review.id } })).toEqual(review);
    expect((await getSubscriptionPaymentState(f.org.id)).purchaseBlockedReason).toBe("applePaymentNeedsReview");
  });

  it("does not earn proof from invalid signatures and protects the accepted evidence from update/delete", async () => {
    const f = await seed(), proof = await evidence(f);
    await expect(f.verifier.verifiedRenewal(proof.renewalSigned + "corrupted")).rejects.toThrow("appleInvalidTransaction");
    await expect(applyAppleDeferredOutcome(f.actor, { intentId: f.change.intentId, attemptId: f.change.attemptId },
      { ...proof.transaction } as never, { data: proof.renewal.data } as never)).rejects.toThrow("appleInvalidTransaction");
    expect(await prisma.appleNativeDeferredOutcome.count()).toBe(0);
    await ack(f, proof);
    const outcome = await prisma.appleNativeDeferredOutcome.findFirstOrThrow();
    await expect(prisma.appleNativeDeferredOutcome.update({ where: { id: outcome.id }, data: { effectiveAt: new Date(outcome.effectiveAt.getTime() + DAY) } }))
      .rejects.toThrow("Native deferred outcome evidence is append-only");
    await expect(prisma.appleNativeDeferredOutcome.delete({ where: { id: outcome.id } })).rejects.toThrow("Native deferred outcome evidence is append-only");
    expect(await prisma.appleNativeDeferredOutcome.findFirstOrThrow()).toEqual(outcome);
    expect(JSON.stringify(await getAppleBillingState(f.actor))).not.toContain(f.change.attemptId);
  });

  it("rejects a direct malformed outcome binding in SQL, with no financial or quota rewrite", async () => {
    const f = await seed(), proof = await evidence(f), source = readAppleDeferredSource(f.intent.offerSnapshot)!;
    await expect(prisma.appleNativeDeferredOutcome.create({ data: { intentId: f.change.intentId, organizationId: f.org.id,
      nativeAttemptId: randomUUID(), actorId: f.actor.id, chainId: source.chainId, previousTransactionId: f.previous.id,
      environment: "Sandbox", originalTransactionId: source.originalTransactionId, appAccountToken: f.first.appAccountToken,
      currentProductId: source.productId, productId: f.change.productId, effectiveAt: new Date(source.expiresAt),
      renewalSignedAt: new Date(proof.renewal.data.signedDate), transactionDigest: proof.transaction.digest, renewalDigest: proof.renewal.digest,
      signedTransactionInfo: proof.txSigned, signedRenewalInfo: proof.renewalSigned } }))
      .rejects.toThrow("Native deferred outcome must match its original winning attempt and verified source");
    expect(await prisma.appleNativeDeferredOutcome.count()).toBe(0);
    expect(await prisma.appleTransaction.count()).toBe(1); expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });

  it.each(["REFUNDED", "SUPERSEDED"] as const)("records only historical earned outcome when its valid-at-authorization source is later %s", async (reason) => {
    const f = await seed(), proof = await evidence(f), invalidatedAt = proof.renewal.data.signedDate + 1000;
    await withSubscriptionUsage({ organizationId: f.org.id, resource: "ai", units: 3, operationKey: "before-later-source-invalidation" }, async () => true);
    if (reason === "REFUNDED") await applyAppleTransaction(await f.verifier.transaction(syntheticAppleTransaction({ ...f.baseData,
      revocationDate: invalidatedAt, signedDate: invalidatedAt + 1 })), { organizationId: f.org.id, source: "NOTIFICATION" });
    else await applyAppleTransaction(await f.verifier.transaction(syntheticAppleTransaction({ ...f.baseData,
      productId: f.mappings[3].productId, transactionId: "100000000000003", purchaseDate: invalidatedAt,
      expiresDate: f.baseData.expiresDate + DAY, signedDate: invalidatedAt + 1 })), { organizationId: f.org.id, source: "NOTIFICATION" });
    const periods = await prisma.subscriptionPeriod.findMany({ where: { organizationId: f.org.id }, orderBy: { id: "asc" } });
    const money = await prisma.appleTransaction.findMany({ where: { organizationId: f.org.id }, orderBy: { id: "asc" } });
    const chain = await prisma.appleSubscriptionChain.findFirstOrThrow(), buckets = await prisma.subscriptionUsageBucket.findMany({ where: { organizationId: f.org.id } });
    expect(await ack(f, proof)).toMatchObject({ deferred: true, scheduled: false, recorded: false });
    expect(await prisma.subscriptionPeriod.findMany({ where: { organizationId: f.org.id }, orderBy: { id: "asc" } })).toEqual(periods);
    expect(await prisma.appleTransaction.findMany({ where: { organizationId: f.org.id }, orderBy: { id: "asc" } })).toEqual(money);
    expect(await prisma.appleSubscriptionChain.findFirstOrThrow()).toEqual(chain);
    expect(await prisma.subscriptionUsageBucket.findMany({ where: { organizationId: f.org.id } })).toEqual(buckets);
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.change.intentId } })).status).toBe("COMPLETED");
    if (reason === "REFUNDED") expect(resolveOrganizationAccessState(await getOrganizationPlan(f.org.id)).hasAccess).toBe(false);
    expect(await ack(f, proof)).toMatchObject({ deferred: true, scheduled: false });
  });

  it.each(["BEFORE_AUTHORIZATION", "BEFORE_EARNED_PREFERENCE"] as const)("retains protection when source invalidation is %s", async (when) => {
    const f = await seed(), proof = await evidence(f);
    const at = when === "BEFORE_AUTHORIZATION" ? f.intent.authorizedAt!.getTime() - 1 : f.intent.authorizedAt!.getTime();
    await prisma.subscriptionPeriod.updateMany({ where: { appleTransactionId: f.previous.id }, data: { revokedAt: new Date(at) } });
    await expect(ack(f, proof)).rejects.toThrow("appleDeferredOutcomeMismatch");
    expect(await prisma.appleNativeDeferredOutcome.count()).toBe(0);
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.change.intentId } })).status).toBe("PENDING");
  });

  it("rechecks a frozen source is still active and GRANTED before consuming final authorization", async () => {
    const f = await seed(); await cancelApplePurchaseIntent(f.actor, f.change.intentId, f.change.attemptId);
    const pending = await createApplePurchaseIntent(f.actor, { expectedOrganizationId: f.org.id, offerKey: f.mappings[1].offerKey, action: "CHANGE",
      idempotencyKey: randomUUID(), storeKitConsent: syntheticAppleStoreKitConsent, acceptedTerms: true, termsVersion: LEGAL_TERMS_VERSION });
    await prisma.subscriptionPeriod.updateMany({ where: { appleTransactionId: f.previous.id }, data: { revokedAt: new Date() } });
    await expect(authorizeApplePurchase(f.actor, pending.intentId, { attemptId: randomUUID() })).rejects.toThrow("appleAccessChanged");
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: pending.intentId } })).authorizedAt).toBeNull();
  });
});
