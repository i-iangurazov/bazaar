import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { appleSubscriptionOffer } from "@/server/billing/appleOfferCatalog";
import { createContractTerms } from "@/server/billing/contractTerms";
import { calculateSubscriptionQuote } from "@/server/billing/subscriptionQuotes";
import { appleEvidenceDigest, mintAppleCompletionChallenge, parseAppleCompletionPublicKey, readAppleCompletionChallenge, verifyAppleCompletionSignature } from "@/server/billing/appleCompletionCrypto";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const origin = "https://www.bazaar.kg";
// These are coherent authorization-at-birth fixtures for the database clock
// boundary only. Full service enrollment/OS-outcome protocol is covered by the
// native-completion suite; neither fixture claims an actual StoreKit result.
const fixture = async (when: "VALID" | "EXPIRED" | "FUTURE") => {
  const f = await seedBase({ plan: "ENTERPRISE" }), now = Date.now();
  const account = await prisma.appleBillingAccount.create({ data: { organizationId: f.org.id, appAccountToken: randomUUID() } });
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKey = key.publicKey.export({ type: "spki", format: "der" }).toString("base64"), fingerprint = parseAppleCompletionPublicKey(publicKey).fingerprint;
  const authorizedAt = when === "EXPIRED" ? now - 20 * 60_000 : now - 1000, attemptId = randomUUID();
  await prisma.organization.update({ where: { id: f.org.id }, data: { subscriptionBillingMode: "SELF_SERVE", trialEndsAt: null,
    currentPeriodEndsAt: null, createdAt: new Date(authorizedAt - 86_400_000) } });
  await prisma.user.update({ where: { id: f.adminUser.id }, data: { createdAt: new Date(authorizedAt - 86_400_000) } });
  const terms = createContractTerms("2026-11"), selection = { plan: "ENTERPRISE" as const, months: 12 as const, extras: { stores: 0, productPacks: 0, userPacks: 0 as const } };
  await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11", termsSnapshot: terms } });
  const offer = appleSubscriptionOffer(terms, selection), purchase = await calculateSubscriptionQuote(f.org.id, { ...selection, action: "RENEW" }, prisma, new Date(authorizedAt));
  const intent = await prisma.applePurchaseIntent.create({ data: { organizationId: f.org.id, createdById: f.adminUser.id,
    idempotencyKey: randomUUID(), scope: "SUBSCRIPTION", action: "RENEW", offerKey: offer.offerKey, productId: "synthetic.clock-only",
    productType: "AUTO_RENEWABLE", environment: "Sandbox", appAccountToken: account.appAccountToken,
    pendingSlot: when === "EXPIRED" ? null : `SUBSCRIPTION:${f.org.id}`, purchaseSnapshot: JSON.parse(JSON.stringify(purchase)),
    offerSnapshot: JSON.parse(JSON.stringify({ ...offer, appleProduct: { subscriptionGroupId: "synthetic-clock-group" } })),
    termsVersion: LEGAL_TERMS_VERSION, termsUrl: "https://www.bazaar.kg/legal/offer",
    createdAt: new Date(authorizedAt - 1000), authorizedAt: new Date(authorizedAt), expiresAt: new Date(authorizedAt + 15 * 60_000),
    nativeAttemptId: attemptId, completionPublicKey: publicKey, completionKeyFingerprint: fingerprint, completionOrigin: origin,
    status: when === "EXPIRED" ? "REVIEW" : "PENDING", lastIssue: when === "EXPIRED" ? "applePurchasePendingVerification" : null } });
  const issuedAt = when === "EXPIRED" ? authorizedAt + 60_000 : when === "FUTURE" ? now + 60_000 : now;
  const token = mintAppleCompletionChallenge({ intentId: intent.id, attemptId, keyFingerprint: fingerprint, outcome: "NOT_STARTED" }, origin, issuedAt);
  const signature = sign("sha256", Buffer.from(token.challenge), { key: key.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
  verifyAppleCompletionSignature(token.challenge, signature, publicKey);
  const claims = readAppleCompletionChallenge(token.challenge);
  return { intent, data: { intentId: intent.id, organizationId: f.org.id, nativeAttemptId: attemptId, keyFingerprint: fingerprint, origin,
    outcome: "NOT_STARTED", challengeDigest: appleEvidenceDigest(token.challenge), challenge: token.challenge, signature,
    issuedAt: new Date(claims.issuedAt), expiresAt: new Date(claims.expiresAt) } };
};
describeDb("UTC-naive completion clock under actual PostgreSQL session zones", () => {
  beforeEach(async () => { await resetDatabase(); vi.stubEnv("NEXTAUTH_SECRET", "synthetic-utc-completion-clock-secret-2026"); });
  afterEach(() => { vi.unstubAllEnvs(); });
  for (const zone of ["UTC", "Asia/Bishkek", "America/Los_Angeles"]) {
    it.each(["VALID", "EXPIRED", "FUTURE"] as const)(`${zone}: accepts only a currently valid %s device-key proof without weakening time bounds`, async (when) => {
      const f = await fixture(when);
      const insert = prisma.$transaction(async (db) => {
        await db.$queryRaw`SELECT set_config('TimeZone', ${zone}, true)`;
        const [state] = await db.$queryRaw<{ zone: string }[]>`SELECT current_setting('TimeZone') AS zone`;
        expect(state.zone).toBe(zone);
        return db.appleNativeCompletion.create({ data: f.data });
      });
      if (when === "VALID") await expect(insert).resolves.toMatchObject({ intentId: f.intent.id });
      else await expect(insert).rejects.toThrow("Native completion must match its enrolled winning attempt");
      expect(await prisma.appleNativeCompletion.count()).toBe(when === "VALID" ? 1 : 0);
      expect(await prisma.appleTransaction.count()).toBe(0); expect(await prisma.subscriptionPeriod.count()).toBe(0);
    });
  }
});
