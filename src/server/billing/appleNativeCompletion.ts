import type { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { appleCompletionChallengeInputSchema, appleCompletionSubmitInputSchema, appleEvidenceDigest, assertFreshAppleCompletion,
  mintAppleCompletionChallenge, readAppleCompletionChallenge, verifyAppleCompletionSignature } from "./appleCompletionCrypto";
import { lockAppleOrganization } from "./appleConcurrency";
import { applyAppleDeferredOutcomeInTransaction, type AppleDeferredOutcomeAck } from "./appleDeferredOutcome";
import { assertAppleBillingEnvironmentWritable } from "./appleConfig";
import { appleReceiptVerifier, verifyAppleTransaction } from "./appleVerification";

const unavailable = () => new AppError("appleCompletionUnavailable", "CONFLICT", 409);
export type AppleNativeCompletionAck = ({ acknowledged: true; kind: "CANCELED"; canceled: true; recorded: false }) |
  (Extract<AppleDeferredOutcomeAck, { deferred: true }> & { kind: "DEFERRED" }) |
  { acknowledged: false; kind: "PENDING"; recorded: false } |
  { acknowledged: true; kind: "RECORDED"; recorded: true; status: "REVIEW" | "COMPLETED"; reason: string | null };

/** No session or case data: a challenge is useful only to the enrolled private key. */
export async function createAppleCompletionChallenge(raw: z.infer<typeof appleCompletionChallengeInputSchema>, origin: string) {
  const input = appleCompletionChallengeInputSchema.parse(raw);
  const intent = await prisma.applePurchaseIntent.findFirst({ where: { id: input.intentId, nativeAttemptId: input.attemptId.toLowerCase(),
    completionKeyFingerprint: input.keyFingerprint, completionOrigin: origin, completionPublicKey: { not: null }, authorizedAt: { not: null } }, select: { id: true } });
  if (!intent) throw unavailable();
  return mintAppleCompletionChallenge(input, origin);
}

export async function completeAppleNativeOutcome(raw: z.infer<typeof appleCompletionSubmitInputSchema>, origin: string): Promise<AppleNativeCompletionAck> {
  const input = appleCompletionSubmitInputSchema.parse(raw), claims = readAppleCompletionChallenge(input.challenge);
  if (claims.origin !== origin) throw unavailable();
  const seed = await prisma.applePurchaseIntent.findFirst({ where: { id: claims.intentId, nativeAttemptId: claims.attemptId,
    completionKeyFingerprint: claims.keyFingerprint, completionOrigin: origin, completionPublicKey: { not: null } } });
  if (!seed?.completionPublicKey) throw unavailable();
  verifyAppleCompletionSignature(input.challenge, input.signature, seed.completionPublicKey);
  if (claims.outcome === "DEFERRED" ? !input.signedTransactionInfo || !input.signedRenewalInfo ||
    appleEvidenceDigest(input.signedTransactionInfo) !== claims.transactionDigest || appleEvidenceDigest(input.signedRenewalInfo) !== claims.renewalDigest
    : Boolean(input.signedTransactionInfo || input.signedRenewalInfo)) throw unavailable();
  const transaction = input.signedTransactionInfo ? await verifyAppleTransaction(input.signedTransactionInfo) : null;
  const renewal = transaction && input.signedRenewalInfo ? await appleReceiptVerifier(transaction.data.environment).verifiedRenewal(input.signedRenewalInfo) : null;
  return prisma.$transaction(async (db) => {
    await lockAppleOrganization(db, seed.organizationId);
    const intent = await db.applePurchaseIntent.findUniqueOrThrow({ where: { id: seed.id } });
    if (intent.nativeAttemptId !== claims.attemptId || intent.completionKeyFingerprint !== claims.keyFingerprint ||
      intent.completionOrigin !== origin || intent.completionPublicKey !== seed.completionPublicKey || !intent.authorizedAt) throw unavailable();
    if (claims.outcome === "RECORDED_ONLY") assertFreshAppleCompletion(claims);
    const money = await db.appleTransaction.findMany({ where: { intentId: intent.id }, select: { status: true, lastIssue: true } });
    if (money.length) {
      const review = money.find((row) => row.status === "REVIEW");
      return { acknowledged: true, kind: "RECORDED", recorded: true, status: review ? "REVIEW" : "COMPLETED", reason: review?.lastIssue ?? null };
    }
    if (claims.outcome === "RECORDED_ONLY") return { acknowledged: false, kind: "PENDING", recorded: false };
    assertAppleBillingEnvironmentWritable(intent.environment);
    let completion = await db.appleNativeCompletion.findUnique({ where: { intentId: intent.id } });
    if (completion && (completion.nativeAttemptId !== claims.attemptId || completion.keyFingerprint !== claims.keyFingerprint ||
      completion.origin !== origin || completion.outcome !== claims.outcome || completion.transactionDigest !== claims.transactionDigest || completion.renewalDigest !== claims.renewalDigest))
      throw unavailable();
    if (!completion) {
      assertFreshAppleCompletion(claims);
      completion = await db.appleNativeCompletion.create({ data: { intentId: intent.id, organizationId: intent.organizationId,
        nativeAttemptId: claims.attemptId, keyFingerprint: claims.keyFingerprint, origin, outcome: claims.outcome,
        transactionDigest: claims.transactionDigest, renewalDigest: claims.renewalDigest, challengeDigest: appleEvidenceDigest(input.challenge),
        challenge: input.challenge, signature: input.signature, issuedAt: new Date(claims.issuedAt), expiresAt: new Date(claims.expiresAt) } });
    }
    if (claims.outcome === "DEFERRED") {
      if (!transaction || !renewal) throw unavailable();
      const result = await applyAppleDeferredOutcomeInTransaction(db, { id: intent.createdById, organizationId: intent.organizationId },
        { intentId: intent.id, attemptId: claims.attemptId }, transaction, renewal, completion.id);
      if (result.recorded) return { acknowledged: true, kind: "RECORDED", recorded: true, status: result.status, reason: result.reason };
      return { ...result, kind: "DEFERRED" };
    }
    const cancellable = intent.status === "CANCELED" || intent.status === "PENDING" ||
      (intent.status === "REVIEW" && intent.lastIssue === "applePurchasePendingVerification");
    if (!cancellable) throw unavailable();
    if (intent.status !== "CANCELED") await db.applePurchaseIntent.update({ where: { id: intent.id },
      data: { status: "CANCELED", pendingSlot: null, lastIssue: null } });
    return { acknowledged: true, kind: "CANCELED", canceled: true, recorded: false };
  });
}
