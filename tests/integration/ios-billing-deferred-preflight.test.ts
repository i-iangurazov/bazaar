import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import bcrypt from "bcryptjs";
import { Environment, Type } from "@apple/app-store-server-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { prisma } from "@/server/db/prisma";
import { appleSubscriptionOffer } from "@/server/billing/appleOfferCatalog";
import { createContractTerms } from "@/server/billing/contractTerms";
import { applyAppleTransaction, authorizeApplePurchase, createApplePurchaseIntent } from "@/server/billing/applePayments";
import { appleEvidenceDigest, parseAppleCompletionPublicKey } from "@/server/billing/appleCompletionCrypto";
import { completeAppleNativeOutcome, createAppleCompletionChallenge } from "@/server/billing/appleNativeCompletion";
import * as verification from "@/server/billing/appleVerification";
import { deleteOwnAccount } from "@/server/services/accountDeletion";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { assertSafeTestDatabaseReset } from "../helpers/testDatabaseSafety";
import { syntheticAppleStoreKitConsent, signSyntheticApplePayload, syntheticAppleTransaction, syntheticAppleVerifier } from "../helpers/appleSignedFixture";
import { parsePreflightTarget, runIosBillingPreflight } from "../../scripts/deployment/ios-billing-preflight";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const origin = "https://www.bazaar.kg", password = "Synthetic-preflight-departing-buyer";
const audit = async () => {
  const { databaseUrl } = assertSafeTestDatabaseReset();
  const connection = new URL(databaseUrl);
  const args = ["--url-env", "EXPLICIT_OWNED_CI_AUDIT_URL", "--expect-host", connection.hostname,
    "--expect-port", connection.port || "5432", "--expect-database", decodeURIComponent(connection.pathname.slice(1)),
    "--expect-user", decodeURIComponent(connection.username), "--expect-stage", "POST_TEMPORARY_MINIMUM"];
  if (process.env.IOS_MIGRATION_PREFLIGHT_PSQL) args.push("--psql", process.env.IOS_MIGRATION_PREFLIGHT_PSQL);
  return runIosBillingPreflight(parsePreflightTarget(args, { EXPLICIT_OWNED_CI_AUDIT_URL: databaseUrl }));
};
const snapshot = async () => {
  const rows = await Promise.all([
    prisma.organization.findMany({ orderBy: { id: "asc" } }), prisma.user.findMany({ orderBy: { id: "asc" } }),
    prisma.subscriptionContract.findMany({ orderBy: { organizationId: "asc" } }),
    prisma.appleBillingAccount.findMany({ orderBy: { organizationId: "asc" } }),
    prisma.applePurchaseIntent.findMany({ orderBy: { id: "asc" } }), prisma.appleSubscriptionChain.findMany({ orderBy: { id: "asc" } }),
    prisma.appleTransaction.findMany({ orderBy: { id: "asc" } }), prisma.subscriptionPeriod.findMany({ orderBy: { id: "asc" } }),
    prisma.appleNativeCompletion.findMany({ orderBy: { id: "asc" } }), prisma.appleNativeDeferredOutcome.findMany({ orderBy: { id: "asc" } }),
  ]);
  return { counts: rows.map((group) => group.length), digest: createHash("sha256")
    .update(JSON.stringify(rows, (_key, value) => typeof value === "bigint" ? value.toString() : value)).digest("hex") };
};

async function seedCapability(deferred: boolean) {
  const f = await seedBase({ plan: "ENTERPRISE" });
  await prisma.user.update({ where: { id: f.adminUser.id }, data: { passwordHash: await bcrypt.hash(password, 4) } });
  await prisma.user.updateMany({ where: { organizationId: f.org.id, id: { not: f.adminUser.id } }, data: { isActive: false } });
  await prisma.organization.update({ where: { id: f.org.id }, data: {
    subscriptionBillingMode: "SELF_SERVE", trialEndsAt: null, currentPeriodEndsAt: null,
  } });
  const terms = createContractTerms("2026-11"), extras = { stores: 0, productPacks: 0, userPacks: 0 as const };
  await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11", termsSnapshot: terms } });
  const selections = [{ plan: "ENTERPRISE" as const, months: 12 as const, extras },
    { plan: "BUSINESS" as const, months: 1 as const, extras }];
  const mappings = selections.map((selection, index) => ({ offerKey: appleSubscriptionOffer(terms, selection).offerKey,
    productId: `synthetic.preflight.completion.${index}`, productType: "AUTO_RENEWABLE", subscriptionGroupId: "synthetic-preflight-group", approved: true }));
  for (const [key, value] of Object.entries({ APPLE_BILLING_MODE: "sandbox", APPLE_APP_ID: "1234567890",
    APPLE_IAP_KEY_ID: "SYNTHETIC", APPLE_IAP_ISSUER_ID: "SYNTHETIC", APPLE_IAP_PRIVATE_KEY: "SYNTHETIC PRIVATE KEY",
    APPLE_BILLING_TERMS_VERSION: LEGAL_TERMS_VERSION, APPLE_BILLING_TERMS_APPROVED: "true", APPLE_BILLING_SALES_APPROVED: "true",
    APPLE_BILLING_SANDBOX_ORGANIZATION_IDS: f.org.id, APPLE_BILLING_CATALOG_JSON: JSON.stringify(mappings) })) vi.stubEnv(key, value);
  const actor = { id: f.adminUser.id, organizationId: f.org.id };
  const makeIntent = (index: number, action: "RENEW" | "CHANGE") => createApplePurchaseIntent(actor, {
    expectedOrganizationId: f.org.id, offerKey: mappings[index].offerKey, action,
    idempotencyKey: randomUUID(), termsVersion: LEGAL_TERMS_VERSION, storeKitConsent: syntheticAppleStoreKitConsent, acceptedTerms: true,
  });
  const first = await makeIntent(0, "RENEW"), verifier = syntheticAppleVerifier();
  const baseData = { appAccountToken: first.appAccountToken, productId: first.productId,
    type: Type.AUTO_RENEWABLE_SUBSCRIPTION, subscriptionGroupIdentifier: "synthetic-preflight-group",
    transactionId: "100000000008001", originalTransactionId: "100000000008001",
    purchaseDate: Date.now() - 60_000, expiresDate: Date.now() + 365 * 86400000, signedDate: Date.now() };
  const baseSigned = syntheticAppleTransaction(baseData);
  if (deferred) {
    await authorizeApplePurchase(actor, first.intentId, { attemptId: randomUUID() });
    await applyAppleTransaction(await verifier.transaction(baseSigned), { organizationId: f.org.id, intentId: first.intentId, source: "CLIENT" });
  }
  const intent = deferred ? await makeIntent(1, "CHANGE") : first, attemptId = randomUUID();
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKey = key.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const fingerprint = parseAppleCompletionPublicKey(publicKey).fingerprint;
  await authorizeApplePurchase(actor, intent.intentId, { attemptId, completionPublicKey: publicKey, completionOrigin: origin });
  const row = await prisma.applePurchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId } });
  const renewalSigned = signSyntheticApplePayload({ environment: "Sandbox", originalTransactionId: baseData.originalTransactionId,
    appAccountToken: first.appAccountToken, productId: first.productId, autoRenewProductId: intent.productId,
    autoRenewStatus: 1, renewalDate: baseData.expiresDate, signedDate: row.authorizedAt!.getTime() + 1 });
  const outcome = deferred ? "DEFERRED" as const : "CANCELED" as const;
  const challenge = await createAppleCompletionChallenge({ intentId: intent.intentId, attemptId, keyFingerprint: fingerprint, outcome,
    ...(deferred ? { transactionDigest: appleEvidenceDigest(baseSigned), renewalDigest: appleEvidenceDigest(renewalSigned) } : {}) }, origin);
  const proof = { challenge: challenge.challenge, signature: sign("sha256", Buffer.from(challenge.challenge),
    { key: key.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64"),
    ...(deferred ? { signedTransactionInfo: baseSigned, signedRenewalInfo: renewalSigned } : {}) };
  return { ...f, actor, intent, attemptId, publicKey, fingerprint, baseData, baseSigned, renewalSigned, verifier, proof };
}

describeDb("deferred capability aggregate preflight on exact owned PostgreSQL", () => {
  const network = vi.fn(() => { throw new Error("Preflight tests cannot call providers"); });
  beforeEach(async () => {
    await resetDatabase(); network.mockClear(); vi.stubGlobal("fetch", network);
    vi.stubEnv("NEXTAUTH_SECRET", "synthetic-preflight-completion-server-secret");
    vi.spyOn(verification, "verifyAppleTransaction").mockImplementation((signed) => syntheticAppleVerifier().transaction(signed));
    vi.spyOn(verification, "appleReceiptVerifier").mockImplementation((environment) =>
      syntheticAppleVerifier(environment === "Production" ? Environment.PRODUCTION : Environment.SANDBOX));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("accepts an enrolled cancellation without leaking capability material or changing any source row", async () => {
    const f = await seedCapability(false);
    await expect(completeAppleNativeOutcome(f.proof, origin)).resolves.toMatchObject({ acknowledged: true, kind: "CANCELED" });
    const before = await snapshot(), result = await audit();
    expect(result).toMatchObject({ ok: true, schemaStage: "POST_TEMPORARY_MINIMUM", transactionReadOnly: true, blockerChecks: 0, skippedChecks: 0 });
    expect(await snapshot()).toEqual(before);
    for (const value of [f.org.id, f.adminUser.id, f.adminUser.email, f.intent.intentId, f.attemptId,
      f.publicKey, f.fingerprint, f.proof.challenge, f.proof.signature]) expect(JSON.stringify(result)).not.toContain(value);
    expect(await prisma.appleTransaction.count()).toBe(0);
    expect(network).not.toHaveBeenCalled();
  });

  it("accepts immutable deferred proof after buyer deletion and later source refund without demanding current GRANTED access", async () => {
    const f = await seedCapability(true);
    await deleteOwnAccount({ userId: f.adminUser.id, organizationId: f.org.id,
      password, confirmation: "DELETE", requestId: "synthetic-preflight-deletion" });
    await expect(completeAppleNativeOutcome(f.proof, origin)).resolves.toMatchObject({ acknowledged: true, kind: "DEFERRED" });
    const revoked = syntheticAppleTransaction({ ...f.baseData, revocationDate: Date.now(), signedDate: Date.now() + 2 });
    await applyAppleTransaction(await f.verifier.transaction(revoked), { organizationId: f.org.id, source: "NOTIFICATION" });
    expect(await prisma.appleNativeDeferredOutcome.count()).toBe(1);
    expect((await prisma.appleTransaction.findUniqueOrThrow({ where: { environment_transactionId: {
      environment: "Sandbox", transactionId: f.baseData.transactionId,
    } } })).status).toBe("REVOKED");
    const before = await snapshot(), result = await audit();
    expect(result).toMatchObject({ ok: true, schemaStage: "POST_TEMPORARY_MINIMUM", blockerChecks: 0, skippedChecks: 0 });
    expect(await snapshot()).toEqual(before);
    for (const value of [f.org.id, f.adminUser.id, f.adminUser.email, f.intent.intentId, f.publicKey, f.proof.challenge,
      f.proof.signature, f.baseSigned, f.renewalSigned]) expect(JSON.stringify(result)).not.toContain(value);
    expect(network).not.toHaveBeenCalled();
  });

  it("detects a same-name wrong-key read index and restores its exact definition without disabling financial guards", async () => {
    assertSafeTestDatabaseReset();
    const original = await prisma.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_indexdef('public."AppleNativeCompletion_organizationId_createdAt_idx"'::regclass) AS definition
    `;
    const before = await snapshot();
    try {
      await prisma.$executeRawUnsafe('DROP INDEX public."AppleNativeCompletion_organizationId_createdAt_idx"');
      await prisma.$executeRawUnsafe('CREATE INDEX "AppleNativeCompletion_organizationId_createdAt_idx" ON public."AppleNativeCompletion" ("createdAt","organizationId")');
      const result = await audit();
      expect(result).toMatchObject({ ok: false, blockerChecks: 1, skippedChecks: 0 });
      expect(result.checks.find((check) => check.name === "native_outcome_indexes_missing_or_invalid"))
        .toMatchObject({ count: 1, severity: "blocker" });
    } finally {
      await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS public."AppleNativeCompletion_organizationId_createdAt_idx"');
      await prisma.$executeRawUnsafe(original[0].definition);
    }
    expect(await snapshot()).toEqual(before);
    expect((await audit()).ok).toBe(true);
    expect(network).not.toHaveBeenCalled();
  });
});
