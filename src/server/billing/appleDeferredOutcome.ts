import type { Prisma } from "@prisma/client";
import { AutoRenewStatus } from "@apple/app-store-server-library";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { assertAppleBillingActor, type AppleBillingActor } from "./applePayments";
import { lockAppleOrganization } from "./appleConcurrency";
import { appleDeferredOutcomeInputSchema, readAppleDeferredSource } from "./appleDeferredEvidence";
import { applyAppleRenewalInTransaction } from "./appleLifecycle";
import { appleReceiptVerifier, assertVerifiedAppleRenewal, assertVerifiedAppleTransaction, verifyAppleTransaction,
  type VerifiedAppleRenewal, type VerifiedAppleTransaction } from "./appleVerification";

export type AppleDeferredOutcomeAck = { acknowledged: true; deferred: true; recorded: false; scheduled: boolean; intentId: string; productId: string; effectiveAt: string } |
  { acknowledged: true; deferred: false; recorded: true; intentId: string; status: "REVIEW" | "COMPLETED"; reason: string | null };
const mismatch = () => new AppError("appleDeferredOutcomeMismatch", "CONFLICT", 409);

export async function recordAppleDeferredOutcome(actor: AppleBillingActor, raw: z.infer<typeof appleDeferredOutcomeInputSchema>) {
  const input = appleDeferredOutcomeInputSchema.parse(raw);
  await assertAppleBillingActor(actor);
  const transaction = await verifyAppleTransaction(input.signedTransactionInfo);
  const renewal = await appleReceiptVerifier(transaction.data.environment).verifiedRenewal(input.signedRenewalInfo);
  return applyAppleDeferredOutcome(actor, input, transaction, renewal);
}

/** The native winning invocation earned this terminal result. Its assertion is
 * trusted exactly like the existing native OS cancellation, never like money.
 * Both Apple JWS objects must independently match the frozen authorized source. */
export async function applyAppleDeferredOutcome(actor: AppleBillingActor, input: { intentId: string; attemptId: string },
  transaction: VerifiedAppleTransaction, verifiedRenewal: VerifiedAppleRenewal): Promise<AppleDeferredOutcomeAck> {
  return prisma.$transaction(async (db) => {
    await lockAppleOrganization(db, actor.organizationId);
    return applyAppleDeferredOutcomeInTransaction(db, actor, input, transaction, verifiedRenewal);
  });
}

/** Completion capability callers already hold the org lock and have consumed
 * the enrolled device's signed challenge in this same transaction. */
export async function applyAppleDeferredOutcomeInTransaction(db: Prisma.TransactionClient, actor: AppleBillingActor,
  input: { intentId: string; attemptId: string }, transaction: VerifiedAppleTransaction, verifiedRenewal: VerifiedAppleRenewal,
  completionId?: string): Promise<AppleDeferredOutcomeAck> {
  assertVerifiedAppleTransaction(transaction); assertVerifiedAppleRenewal(verifiedRenewal);
  const attemptId = z.string().uuid().parse(input.attemptId).toLowerCase();
    if (!completionId) await assertAppleBillingActor(actor, db);
    const intent = await db.applePurchaseIntent.findFirst({ where: { id: input.intentId, organizationId: actor.organizationId, createdById: actor.id } });
    if (!intent) throw new AppError("recordNotFound", "NOT_FOUND", 404);
    // Money has its own immutable resolution, including REVIEW. This ACK only
    // clears redundant native proof; it never claims a deferred change succeeded.
    const money = await db.appleTransaction.findMany({ where: { intentId: intent.id }, select: { status: true, lastIssue: true } });
    if (money.length) {
      const review = money.find((row) => row.status === "REVIEW");
      return { acknowledged: true, deferred: false, recorded: true, intentId: intent.id,
        status: review ? "REVIEW" : "COMPLETED", reason: review?.lastIssue ?? null };
    }
    if (!intent.authorizedAt || !intent.nativeAttemptId || intent.nativeAttemptId !== attemptId)
      throw new AppError("applePurchaseAttemptMismatch", "CONFLICT", 409);
    if (completionId) {
      const completion = await db.appleNativeCompletion.findFirst({ where: { id: completionId, intentId: intent.id, organizationId: actor.organizationId,
        nativeAttemptId: attemptId, keyFingerprint: intent.completionKeyFingerprint ?? "", outcome: "DEFERRED",
        transactionDigest: transaction.digest, renewalDigest: verifiedRenewal.digest } });
      if (!completion) throw new AppError("appleCompletionUnavailable", "CONFLICT", 409);
    } else if (intent.completionPublicKey) throw new AppError("appleCompletionRequired", "CONFLICT", 409);
    const d = transaction.data, renewal = verifiedRenewal.data, source = readAppleDeferredSource(intent.offerSnapshot);
    if (!source || intent.scope !== "SUBSCRIPTION" || intent.action !== "CHANGE" || intent.productType !== "AUTO_RENEWABLE" ||
      intent.purchaseAppAccountToken || transaction.productType !== "AUTO_RENEWABLE" || d.productId === intent.productId ||
      d.transactionId !== source.transactionId || d.originalTransactionId !== source.originalTransactionId || d.productId !== source.productId ||
      d.environment !== source.environment || d.environment !== intent.environment || d.appAccountToken !== intent.appAccountToken ||
      d.subscriptionGroupIdentifier !== source.subscriptionGroupId || d.expiresDate !== new Date(source.expiresAt).getTime() ||
      d.purchaseDate > intent.authorizedAt.getTime() || d.revocationDate || d.isUpgraded || d.inAppOwnershipType !== "PURCHASED" || (d.quantity ?? 1) !== 1 ||
      renewal.environment !== intent.environment || renewal.originalTransactionId !== source.originalTransactionId ||
      renewal.appAccountToken !== intent.appAccountToken || renewal.productId !== source.productId ||
      renewal.autoRenewStatus !== AutoRenewStatus.ON || renewal.autoRenewProductId !== intent.productId ||
      renewal.renewalDate !== d.expiresDate || renewal.signedDate < intent.authorizedAt.getTime() || renewal.signedDate >= d.expiresDate!) throw mismatch();
    const prior = await db.appleNativeDeferredOutcome.findUnique({ where: { intentId: intent.id } });
    if (prior) {
      if (prior.nativeAttemptId !== attemptId || prior.transactionDigest !== transaction.digest || prior.renewalDigest !== verifiedRenewal.digest) throw mismatch();
      const current = await db.appleSubscriptionChain.findUniqueOrThrow({ where: { id: prior.chainId } });
      const [old, period] = await Promise.all([db.appleTransaction.findUnique({ where: { id: prior.previousTransactionId } }),
        db.subscriptionPeriod.findUnique({ where: { appleTransactionId: prior.previousTransactionId } })]);
      return { acknowledged: true, deferred: true, recorded: false,
        scheduled: current.autoRenewEnabled === true && current.pendingProductId === intent.productId && prior.effectiveAt > new Date() &&
          old?.status === "GRANTED" && !old.revocationDate && !old.supersededAt && Boolean(period && !period.revokedAt && !period.dependencyRevokedAt),
        intentId: intent.id, productId: prior.productId, effectiveAt: prior.effectiveAt.toISOString() };
    }
    if (!(intent.status === "PENDING" || (intent.status === "REVIEW" && intent.lastIssue === "applePurchasePendingVerification"))) throw mismatch();
    // Serialize a raw source invalidation as well as normal org-locked payment
    // paths, so a historical result never reapplies stale renewal preference.
    await db.$queryRaw`SELECT id FROM "AppleTransaction" WHERE id=${source.transactionRowId} FOR UPDATE`;
    await db.$queryRaw`SELECT id FROM "SubscriptionPeriod" WHERE "appleTransactionId"=${source.transactionRowId} FOR UPDATE`;
    const [chain, previous, period] = await Promise.all([
      db.appleSubscriptionChain.findUnique({ where: { id: source.chainId } }),
      db.appleTransaction.findUnique({ where: { id: source.transactionRowId } }),
      db.subscriptionPeriod.findUnique({ where: { appleTransactionId: source.transactionRowId } }),
    ]);
    if (!chain || chain.organizationId !== actor.organizationId || chain.environment !== intent.environment ||
      chain.originalTransactionId !== source.originalTransactionId || chain.appAccountToken !== intent.appAccountToken ||
      !previous || previous.organizationId !== actor.organizationId || previous.environment !== d.environment || previous.transactionId !== d.transactionId ||
      previous.originalTransactionId !== d.originalTransactionId || previous.productId !== d.productId || previous.appAccountToken !== d.appAccountToken ||
      !["GRANTED", "REVOKED"].includes(previous.status) || previous.createdAt > intent.authorizedAt ||
      previous.purchaseDate.getTime() !== d.purchaseDate || previous.expiresDate?.getTime() !== d.expiresDate ||
      previous.quantity !== (d.quantity ?? 1) || (d.price !== undefined && previous.priceMillis !== BigInt(d.price)) ||
      (d.currency !== undefined && previous.currency !== d.currency) ||
      !period || period.organizationId !== actor.organizationId ||
      period.startsAt > intent.authorizedAt || period.endsAt.toISOString() !== source.expiresAt) throw mismatch();
    const invalidations = [previous.revocationDate, previous.supersededAt, period.revokedAt, period.dependencyRevokedAt].filter((date): date is Date => Boolean(date));
    if ((previous.status === "REVOKED" && !invalidations.length) || invalidations.some((date) => date.getTime() < intent.authorizedAt!.getTime() || date.getTime() < renewal.signedDate))
      throw mismatch();
    const historical = invalidations.length > 0;
    const frozenGroup = z.object({ appleProduct: z.object({ subscriptionGroupId: z.literal(source.subscriptionGroupId) }) }).safeParse(intent.offerSnapshot);
    if (!frozenGroup.success) throw mismatch();

    await db.appleNativeDeferredOutcome.create({ data: { intentId: intent.id, organizationId: actor.organizationId,
      nativeAttemptId: attemptId, actorId: actor.id, chainId: chain.id, previousTransactionId: previous.id,
      environment: d.environment, originalTransactionId: d.originalTransactionId, appAccountToken: d.appAccountToken,
      currentProductId: d.productId, productId: intent.productId, effectiveAt: new Date(d.expiresDate!), renewalSignedAt: new Date(renewal.signedDate),
      transactionDigest: transaction.digest, renewalDigest: verifiedRenewal.digest,
      signedTransactionInfo: transaction.signedTransactionInfo, signedRenewalInfo: verifiedRenewal.signedRenewalInfo } });
    if (!historical) await applyAppleRenewalInTransaction(db, verifiedRenewal, chain.id);
    // A newer preference may already have superseded this deferred choice.
    // Preserve it; the earned historical outcome resolves only this invocation.
    if (!historical && chain.lastSignedAt.getTime() <= renewal.signedDate) await db.appleSubscriptionChain.update({ where: { id: chain.id },
      data: { pendingProductId: intent.productId, pendingChangeOffer: intent.offerSnapshot as Prisma.InputJsonValue } });
    await db.applePurchaseIntent.update({ where: { id: intent.id }, data: { status: "COMPLETED", pendingSlot: null, lastIssue: null } });
    const current = await db.appleSubscriptionChain.findUniqueOrThrow({ where: { id: chain.id } });
    return { acknowledged: true, deferred: true, recorded: false,
      scheduled: !historical && current.autoRenewEnabled === true && current.pendingProductId === intent.productId && new Date(source.expiresAt) > new Date(),
      intentId: intent.id, productId: intent.productId, effectiveAt: source.expiresAt };
}
