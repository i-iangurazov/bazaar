import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import bcrypt from "bcryptjs";
import { Environment, Type } from "@apple/app-store-server-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { appleSubscriptionOffer } from "@/server/billing/appleOfferCatalog";
import { createContractTerms } from "@/server/billing/contractTerms";
import { applyAppleTransaction, authorizeApplePurchase, cancelApplePurchaseIntent, createApplePurchaseIntent, getAppleBillingState } from "@/server/billing/applePayments";
import { applyAppleDeferredOutcome } from "@/server/billing/appleDeferredOutcome";
import { completeAppleNativeOutcome, createAppleCompletionChallenge } from "@/server/billing/appleNativeCompletion";
import { appleEvidenceDigest, parseAppleCompletionPublicKey } from "@/server/billing/appleCompletionCrypto";
import { reconcileAppleBilling } from "@/server/billing/appleLifecycle";
import { getOrganizationPlan } from "@/server/services/planLimits";
import { deleteOwnAccount } from "@/server/services/accountDeletion";
import { setUserActive, updateUser } from "@/server/services/users";
import * as verification from "@/server/billing/appleVerification";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { syntheticAppleStoreKitConsent, signSyntheticApplePayload, syntheticAppleTransaction, syntheticAppleVerifier } from "../helpers/appleSignedFixture";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const origin = "https://www.bazaar.kg", password = "Synthetic-native-completion-password";
const terms = createContractTerms("2026-11"), extras = { stores: 0, productPacks: 0, userPacks: 0 as const };
const selections = [{ plan: "ENTERPRISE" as const, months: 12 as const, extras }, { plan: "BUSINESS" as const, months: 1 as const, extras }];
const seed = async (deferred = false, enroll = true) => {
  const f = await seedBase({ plan: "ENTERPRISE" });
  await prisma.user.update({ where: { id: f.adminUser.id }, data: { passwordHash: await bcrypt.hash(password, 4) } });
  await prisma.user.updateMany({ where: { organizationId: f.org.id, id: { not: f.adminUser.id } }, data: { isActive: false } });
  await prisma.organization.update({ where: { id: f.org.id }, data: { subscriptionBillingMode: "SELF_SERVE", trialEndsAt: null, currentPeriodEndsAt: null } });
  await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11", termsSnapshot: terms } });
  const mappings = selections.map((selection, index) => ({ offerKey: appleSubscriptionOffer(terms, selection).offerKey,
    productId: `synthetic.completion.${index}`, productType: "AUTO_RENEWABLE", subscriptionGroupId: "synthetic-completion-group", approved: true }));
  for (const [key, value] of Object.entries({ APPLE_BILLING_MODE: "sandbox", APPLE_APP_ID: "1234567890", APPLE_IAP_KEY_ID: "SYNTHETIC",
    APPLE_IAP_ISSUER_ID: "SYNTHETIC", APPLE_IAP_PRIVATE_KEY: "SYNTHETIC PRIVATE KEY", APPLE_BILLING_TERMS_VERSION: LEGAL_TERMS_VERSION,
    APPLE_BILLING_TERMS_APPROVED: "true", APPLE_BILLING_SALES_APPROVED: "true", APPLE_BILLING_SANDBOX_ORGANIZATION_IDS: f.org.id,
    APPLE_BILLING_CATALOG_JSON: JSON.stringify(mappings) })) vi.stubEnv(key, value);
  const actor = { id: f.adminUser.id, organizationId: f.org.id };
  const makeIntent = (index: number, action: "RENEW" | "CHANGE") => createApplePurchaseIntent(actor, {
    expectedOrganizationId: f.org.id, offerKey: mappings[index].offerKey, action, idempotencyKey: randomUUID(),
    termsVersion: LEGAL_TERMS_VERSION, storeKitConsent: syntheticAppleStoreKitConsent, acceptedTerms: true });
  const first = await makeIntent(0, "RENEW"), verifier = syntheticAppleVerifier();
  const baseData = { appAccountToken: first.appAccountToken, productId: first.productId, type: Type.AUTO_RENEWABLE_SUBSCRIPTION,
    subscriptionGroupIdentifier: "synthetic-completion-group", transactionId: "100000000000001", originalTransactionId: "100000000000001",
    purchaseDate: Date.now() - 60_000, expiresDate: Date.now() + 365 * 86_400_000, signedDate: Date.now() };
  const baseSigned = syntheticAppleTransaction(baseData);
  if (deferred) {
    await authorizeApplePurchase(actor, first.intentId, { attemptId: randomUUID() });
    await applyAppleTransaction(await verifier.transaction(baseSigned), { organizationId: f.org.id, intentId: first.intentId, source: "CLIENT" });
  }
  const intent = deferred ? await makeIntent(1, "CHANGE") : first, attemptId = randomUUID();
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKey = key.publicKey.export({ format: "der", type: "spki" }).toString("base64"), fingerprint = parseAppleCompletionPublicKey(publicKey).fingerprint;
  const authorized = await authorizeApplePurchase(actor, intent.intentId, { attemptId, ...(enroll ? { completionPublicKey: publicKey, completionOrigin: origin } : {}) });
  if (enroll) {
    if (!("completionKeyFingerprint" in authorized)) throw new Error("Final authorization did not return enrolled key metadata");
    expect(authorized.completionKeyFingerprint).toBe(fingerprint);
  }
  const row = await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } });
  const renewalSigned = signSyntheticApplePayload({ environment: "Sandbox", originalTransactionId: baseData.originalTransactionId,
    appAccountToken: first.appAccountToken, productId: first.productId, autoRenewProductId: intent.productId,
    autoRenewStatus: 1, renewalDate: baseData.expiresDate, signedDate: row.authorizedAt!.getTime() + 1 });
  return { ...f, actor, intent, row, key, publicKey, fingerprint, attemptId, baseData, baseSigned, renewalSigned, verifier };
};
type Fixture = Awaited<ReturnType<typeof seed>>;
const request = async (f: Fixture, outcome: "CANCELED" | "NOT_STARTED" | "DEFERRED" | "RECORDED_ONLY") => {
  const challenge = await createAppleCompletionChallenge({ intentId: f.intent.intentId, attemptId: f.attemptId,
    keyFingerprint: f.fingerprint, outcome, ...(outcome === "DEFERRED" ? { transactionDigest: appleEvidenceDigest(f.baseSigned), renewalDigest: appleEvidenceDigest(f.renewalSigned) } : {}) }, origin);
  return { challenge: challenge.challenge, signature: sign("sha256", Buffer.from(challenge.challenge), { key: f.key.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64"),
    ...(outcome === "DEFERRED" ? { signedTransactionInfo: f.baseSigned, signedRenewalInfo: f.renewalSigned } : {}) };
};
const depart = async (f: Fixture, how: "DELETED" | "DEACTIVATED" | "DEMOTED") => {
  await prisma.user.update({ where: { id: f.managerUser.id }, data: { role: "ADMIN", isActive: true } });
  if (how === "DELETED") await deleteOwnAccount({ userId: f.adminUser.id, organizationId: f.org.id, requestId: "synthetic-completion-deletion",
    password, confirmation: "DELETE", successorUserId: f.managerUser.id });
  else if (how === "DEACTIVATED") await setUserActive({ userId: f.adminUser.id, organizationId: f.org.id, actorId: f.managerUser.id,
    isActive: false, requestId: "synthetic-completion-deactivation" });
  else await updateUser({ userId: f.adminUser.id, organizationId: f.org.id, actorId: f.managerUser.id, email: f.adminUser.email,
    name: f.adminUser.name, role: "STAFF", preferredLocale: "ru", requestId: "synthetic-completion-demotion" });
};

describeDb("pre-enrolled native completion after payer departure", () => {
  let network: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    await resetDatabase(); vi.stubEnv("NEXTAUTH_SECRET", "synthetic-native-completion-server-secret-2026");
    network = vi.fn(() => { throw new Error("Completion tests cannot call providers"); }); vi.stubGlobal("fetch", network);
    vi.spyOn(verification, "verifyAppleTransaction").mockImplementation((signed) => syntheticAppleVerifier().transaction(signed));
    vi.spyOn(verification, "appleReceiptVerifier").mockImplementation((environment) => syntheticAppleVerifier(environment === "Production" ? Environment.PRODUCTION : Environment.SANDBOX));
  });
  afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it.each(["DELETED", "DEACTIVATED", "DEMOTED"] as const)("accepts only the enrolled device's earned cancellation after payer %s without restoring identity or access", async (how) => {
    const f = await seed(), proof = await request(f, "CANCELED"); await depart(f, how);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.adminUser.id } }), org = await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } });
    await expect(cancelApplePurchaseIntent(f.actor, f.intent.intentId, f.attemptId)).rejects.toThrow("forbidden");
    expect(await completeAppleNativeOutcome(proof, origin)).toMatchObject({ acknowledged: true, kind: "CANCELED", canceled: true, recorded: false });
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.intent.intentId } })).status).toBe("CANCELED");
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(user);
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).toEqual(org);
    expect(await prisma.subscriptionPeriod.count()).toBe(0); expect(await prisma.appleTransaction.count()).toBe(0);
    await expect(getAppleBillingState(f.actor)).rejects.toThrow("forbidden");
    expect(await prisma.appleNativeCompletion.count()).toBe(1);
  });

  it.each(["DELETED", "DEACTIVATED", "DEMOTED"] as const)("accepts earned dual-JWS deferred evidence after payer %s while preserving the base and original organization", async (how) => {
    const f = await seed(true), proof = await request(f, "DEFERRED"); await depart(f, how);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.adminUser.id } }), base = await prisma.subscriptionPeriod.findFirstOrThrow();
    expect(await completeAppleNativeOutcome(proof, origin)).toMatchObject({ kind: "DEFERRED", deferred: true, scheduled: true, recorded: false });
    expect(await prisma.subscriptionPeriod.findFirstOrThrow()).toEqual(base); expect(await prisma.subscriptionPeriod.count()).toBe(1);
    expect((await getOrganizationPlan(f.org.id)).plan).toBe("ENTERPRISE");
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(user);
    expect(await prisma.appleNativeCompletion.count()).toBe(1); expect(await prisma.appleNativeDeferredOutcome.count()).toBe(1);
  });

  it("requires signed completion for an enrolled active payer and refuses key rotation or retroactive enrollment", async () => {
    const f = await seed();
    await expect(cancelApplePurchaseIntent(f.actor, f.intent.intentId, f.attemptId)).rejects.toThrow("appleCompletionRequired");
    for (const status of ["CANCELED", "COMPLETED"]) await expect(prisma.applePurchaseIntent.update({ where: { id: f.intent.intentId }, data: { status, pendingSlot: null } }))
      .rejects.toThrow("Enrolled Apple intent requires signed outcome or recorded money");
    const otherKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "der" }).toString("base64");
    await expect(prisma.applePurchaseIntent.update({ where: { id: f.intent.intentId }, data: { completionPublicKey: otherKey,
      completionKeyFingerprint: parseAppleCompletionPublicKey(otherKey).fingerprint } })).rejects.toThrow("Apple purchase intent snapshot is immutable");
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.intent.intentId } })).completionPublicKey).toBe(f.publicKey);
    expect(await completeAppleNativeOutcome(await request(f, "NOT_STARTED"), origin)).toMatchObject({ kind: "CANCELED" });
  });

  it("rejects forged signatures, changed challenges, wrong attempt/key/origin and substituted signed evidence", async () => {
    const f = await seed(true), proof = await request(f, "DEFERRED");
    const attacker = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const forged = sign("sha256", Buffer.from(proof.challenge), { key: attacker.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
    await expect(completeAppleNativeOutcome({ ...proof, signature: forged }, origin)).rejects.toThrow("appleCompletionUnavailable");
    await expect(completeAppleNativeOutcome({ ...proof, challenge: proof.challenge + "changed" }, origin)).rejects.toThrow("appleCompletionUnavailable");
    await expect(completeAppleNativeOutcome(proof, "https://different-preview.vercel.app")).rejects.toThrow("appleCompletionUnavailable");
    await expect(createAppleCompletionChallenge({ intentId: f.intent.intentId, attemptId: randomUUID(), keyFingerprint: f.fingerprint, outcome: "CANCELED" }, origin)).rejects.toThrow("appleCompletionUnavailable");
    await expect(createAppleCompletionChallenge({ intentId: f.intent.intentId, attemptId: f.attemptId, keyFingerprint: "f".repeat(64), outcome: "CANCELED" }, origin)).rejects.toThrow("appleCompletionUnavailable");
    await expect(completeAppleNativeOutcome({ ...proof, signedTransactionInfo: syntheticAppleTransaction({ ...f.baseData, appAccountToken: randomUUID() }) }, origin)).rejects.toThrow("appleCompletionUnavailable");
    expect(await prisma.appleNativeCompletion.count()).toBe(0); expect(await prisma.appleNativeDeferredOutcome.count()).toBe(0);
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.intent.intentId } })).status).toBe("PENDING");
  });

  it("consumes one completion atomically and retries its earned result without changing the immutable proof", async () => {
    const f = await seed(), proof = await request(f, "NOT_STARTED");
    const results = await Promise.allSettled([completeAppleNativeOutcome(proof, origin), completeAppleNativeOutcome(proof, origin)]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const replies = results.map((result) => { if (result.status === "rejected") throw result.reason; return result.value; });
    expect(replies.map((row) => row.kind)).toEqual(["CANCELED", "CANCELED"]);
    const stored = await prisma.appleNativeCompletion.findFirstOrThrow();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 6 * 60_000);
    expect((await completeAppleNativeOutcome(proof, origin)).kind).toBe("CANCELED");
    expect((await completeAppleNativeOutcome(await request(f, "NOT_STARTED"), origin)).kind).toBe("CANCELED");
    await expect(completeAppleNativeOutcome(await request(f, "CANCELED"), origin)).rejects.toThrow("appleCompletionUnavailable");
    expect(await prisma.appleNativeCompletion.findFirstOrThrow()).toEqual(stored);
    await expect(prisma.appleNativeCompletion.update({ where: { id: stored.id }, data: { outcome: "CANCELED" } })).rejects.toThrow("Native completion evidence is append-only");
    await expect(prisma.appleNativeCompletion.delete({ where: { id: stored.id } })).rejects.toThrow("Native completion evidence is append-only");
  });

  it("cannot complete or inspect another organization's enrolled attempt with the original device key", async () => {
    const f = await seed();
    const org = await prisma.organization.create({ data: { name: "Another synthetic merchant", plan: "ENTERPRISE", subscriptionBillingMode: "SELF_SERVE", trialEndsAt: null } });
    await prisma.subscriptionContract.create({ data: { organizationId: org.id, catalogVersion: "2026-11", termsSnapshot: terms } });
    const user = await prisma.user.create({ data: { organizationId: org.id, name: "Another synthetic administrator", email: "another-completion@synthetic.invalid", role: "ADMIN", passwordHash: "not-a-login" } });
    vi.stubEnv("APPLE_BILLING_SANDBOX_ORGANIZATION_IDS", `${f.org.id},${org.id}`);
    const actor = { id: user.id, organizationId: org.id }, intent = await createApplePurchaseIntent(actor, { expectedOrganizationId: org.id,
      offerKey: appleSubscriptionOffer(terms, selections[0]).offerKey, action: "RENEW", idempotencyKey: randomUUID(), storeKitConsent: syntheticAppleStoreKitConsent, acceptedTerms: true, termsVersion: LEGAL_TERMS_VERSION });
    const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }), publicKey = key.publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const attemptId = randomUUID(), fingerprint = parseAppleCompletionPublicKey(publicKey).fingerprint;
    await authorizeApplePurchase(actor, intent.intentId, { attemptId, completionPublicKey: publicKey, completionOrigin: origin });
    await expect(createAppleCompletionChallenge({ intentId: intent.intentId, attemptId: f.attemptId, keyFingerprint: f.fingerprint, outcome: "CANCELED" }, origin))
      .rejects.toThrow("appleCompletionUnavailable");
    const challenge = await createAppleCompletionChallenge({ intentId: intent.intentId, attemptId, keyFingerprint: fingerprint, outcome: "CANCELED" }, origin);
    const signature = sign("sha256", Buffer.from(challenge.challenge), { key: f.key.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
    await expect(completeAppleNativeOutcome({ challenge: challenge.challenge, signature }, origin)).rejects.toThrow("appleCompletionUnavailable");
    expect(await prisma.appleNativeCompletion.count()).toBe(0);
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.intent.intentId } })).status).toBe("PENDING");
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } })).status).toBe("PENDING");
    expect(await prisma.subscriptionPeriod.count()).toBe(0);
  });

  it("does not accept an expired unused challenge or recover a missing legacy key by guessing", async () => {
    const f = await seed(), proof = await request(f, "CANCELED");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 16 * 60_000); vi.stubEnv("APPLE_IAP_PRIVATE_KEY", "");
    await expect(completeAppleNativeOutcome(proof, origin)).rejects.toThrow("appleCompletionChallengeExpired");
    await reconcileAppleBilling();
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.intent.intentId } })).status).toBe("REVIEW");
    expect(await prisma.appleNativeCompletion.count()).toBe(0);
    await expect(createAppleCompletionChallenge({ intentId: f.intent.intentId, attemptId: f.attemptId, keyFingerprint: f.fingerprint, outcome: "CANCELED" }, "https://unrelated.example"))
      .rejects.toThrow("appleCompletionUnavailable");
  });

  it("retains a keyless historical authorization after deletion and rejects backfilled completion enrollment", async () => {
    const f = await seed(false, false); await depart(f, "DELETED");
    await expect(request(f, "CANCELED")).rejects.toThrow("appleCompletionUnavailable");
    await expect(prisma.applePurchaseIntent.update({ where: { id: f.intent.intentId }, data: { completionPublicKey: f.publicKey,
      completionKeyFingerprint: f.fingerprint, completionOrigin: origin } })).rejects.toThrow("Native completion key must enroll with first authorization");
    expect(await prisma.appleNativeCompletion.count()).toBe(0);
  });

  it("lets concurrent verified money win over terminal cancellation and hands subsequent retries to money recovery", async () => {
    const f = await seed(), proof = await request(f, "CANCELED");
    const money = syntheticAppleTransaction({ ...f.baseData, purchaseDate: Date.now(), expiresDate: Date.now() + 30 * 86_400_000 });
    const results = await Promise.allSettled([completeAppleNativeOutcome(proof, origin),
      applyAppleTransaction(await f.verifier.transaction(money), { organizationId: f.org.id, intentId: f.intent.intentId, source: "NOTIFICATION" })]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const charged = results[1]; if (charged.status === "rejected") throw charged.reason;
    expect(charged.value.status).toBe("GRANTED"); expect(await prisma.subscriptionPeriod.count()).toBe(1);
    expect(await prisma.appleNativeCompletion.count()).toBeLessThanOrEqual(1);
    expect(await completeAppleNativeOutcome(proof, origin)).toMatchObject({ kind: "RECORDED", recorded: true, status: "COMPLETED" });
    expect((await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.intent.intentId } })).status).toBe("COMPLETED");
  });

  it("acknowledges retained financial REVIEW without clearing it or accepting a deferred/cancel declaration", async () => {
    const f = await seed(), proof = await request(f, "CANCELED"); await depart(f, "DEACTIVATED");
    const signed = syntheticAppleTransaction({ ...f.baseData, quantity: 2 });
    await applyAppleTransaction(await f.verifier.transaction(signed), { organizationId: f.org.id, intentId: f.intent.intentId, source: "NOTIFICATION" });
    const intent = await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.intent.intentId } });
    expect(await completeAppleNativeOutcome(proof, origin)).toMatchObject({ kind: "RECORDED", status: "REVIEW", reason: "appleQuantityMismatch" });
    expect(await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.id } })).toEqual(intent);
    expect(await prisma.appleNativeCompletion.count()).toBe(0); expect(await prisma.subscriptionPeriod.count()).toBe(0);
  });

  it("does not allow a raw enrolled attempt to bypass the signed deferred protocol", async () => {
    const f = await seed(true);
    await expect(applyAppleDeferredOutcome(f.actor, { intentId: f.intent.intentId, attemptId: f.attemptId },
      await f.verifier.transaction(f.baseSigned), await f.verifier.verifiedRenewal(f.renewalSigned))).rejects.toThrow("appleCompletionRequired");
    expect(await prisma.appleNativeDeferredOutcome.count()).toBe(0);
  });

  it("performs a fresh signed money-only lookup after payer deletion without inventing missing deferred proof or clearing an absent-money hold", async () => {
    const f = await seed(true); await depart(f, "DELETED");
    const before = await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.intent.intentId } });
    expect(await completeAppleNativeOutcome(await request(f, "RECORDED_ONLY"), origin)).toEqual({ acknowledged: false, kind: "PENDING", recorded: false });
    expect(await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
    expect(await prisma.appleNativeCompletion.count()).toBe(0); expect(await prisma.appleNativeDeferredOutcome.count()).toBe(0);
    const signed = syntheticAppleTransaction({ ...f.baseData, productId: f.intent.productId, transactionId: "100000000000002", quantity: 2 });
    await applyAppleTransaction(await f.verifier.transaction(signed), { organizationId: f.org.id, intentId: f.intent.intentId, source: "NOTIFICATION" });
    const probe = await request(f, "RECORDED_ONLY"), reviewed = await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: f.intent.intentId } });
    expect(await completeAppleNativeOutcome(probe, origin)).toMatchObject({ kind: "RECORDED", recorded: true, status: "REVIEW", reason: "appleQuantityMismatch" });
    expect(await prisma.appleNativeCompletion.count()).toBe(0); expect(await prisma.appleNativeDeferredOutcome.count()).toBe(0);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 6 * 60_000);
    await expect(completeAppleNativeOutcome(probe, origin)).rejects.toThrow("appleCompletionChallengeExpired");
    expect(await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: reviewed.id } })).toEqual(reviewed);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });
});
