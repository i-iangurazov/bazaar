import { randomUUID } from "node:crypto";
import { Prisma, type AppleServerNotification } from "@prisma/client";
import { AutoRenewStatus, GetTransactionHistoryVersion, Order, type JWSRenewalInfoDecodedPayload } from "@apple/app-store-server-library";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { appleBillingConfig } from "./appleConfig";
import { appleApiClient, appleReceiptVerifier, type AppleReceiptVerifier } from "./appleVerification";
import { applyAppleTransaction, appleManagedOffer, recomputeAppleCoverage } from "./applePayments";
import { lockAppleOrganization } from "./appleConcurrency";

/** Renewal state is accepted only after the official verifier checks its JWS. */
export async function applyAppleSignedRenewal(signedRenewalInfo: string, verifier: AppleReceiptVerifier) {
  const renewal = await verifier.renewal(signedRenewalInfo);
  if (!renewal.originalTransactionId || !renewal.environment || !renewal.signedDate || renewal.signedDate > Date.now() + 300_000 ||
    ![AutoRenewStatus.ON, AutoRenewStatus.OFF].includes(renewal.autoRenewStatus as AutoRenewStatus))
    throw new AppError("appleInvalidTransaction", "BAD_REQUEST", 400);
  return applyVerifiedRenewal(renewal);
}
async function applyVerifiedRenewal(renewal: JWSRenewalInfoDecodedPayload) {
  const seed = await prisma.appleSubscriptionChain.findUnique({ where: { environment_originalTransactionId: {
    environment: String(renewal.environment), originalTransactionId: renewal.originalTransactionId! } } });
  if (!seed) throw new AppError("appleIntentMissing", "CONFLICT", 409);
  return prisma.$transaction(async (db) => {
    await lockAppleOrganization(db, seed.organizationId);
    const chain = await db.appleSubscriptionChain.findUniqueOrThrow({ where: { id: seed.id } });
    if (renewal.appAccountToken && renewal.appAccountToken.toLowerCase() !== chain.appAccountToken)
      throw new AppError("applePurchaseOrganizationMismatch", "FORBIDDEN", 403);
    if (new Date(renewal.signedDate!) < chain.lastSignedAt) return;
    const grace = renewal.gracePeriodExpiresDate;
    if (grace !== undefined && (!Number.isSafeInteger(grace) || grace < 1 || grace > 8_640_000_000_000_000))
      throw new AppError("appleInvalidTransaction", "BAD_REQUEST", 400);
    const pendingProductId = renewal.autoRenewStatus === AutoRenewStatus.ON && renewal.autoRenewProductId &&
      renewal.autoRenewProductId !== (renewal.productId ?? chain.productId) ? renewal.autoRenewProductId : null;
    let pendingChangeOffer: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
    let issue: string | null = null;
    if (pendingProductId) {
      try { pendingChangeOffer = JSON.parse(JSON.stringify((await appleManagedOffer(db, chain, pendingProductId)).offer)) as Prisma.InputJsonValue; }
      catch (error) { if (!(error instanceof AppError)) throw error; issue = error.message; }
    }
    // Signed future preference replaces expired local reservations; its frozen
    // limits remain enforced until Apple confirms another preference or renewal.
    await db.applePurchaseIntent.updateMany({ where: { organizationId: chain.organizationId, scope: "SUBSCRIPTION", action: "CHANGE",
      authorizedAt: { not: null, lte: new Date(renewal.signedDate!) }, status: { in: ["PENDING", "REVIEW"] } }, data: { status: "COMPLETED", pendingSlot: null, lastIssue: null } });
    await db.appleSubscriptionChain.update({ where: { id: chain.id }, data: {
      autoRenewEnabled: renewal.autoRenewStatus === AutoRenewStatus.ON,
      graceExpiresAt: grace ? new Date(grace) : null, lastSignedAt: new Date(renewal.signedDate!),
      pendingProductId, pendingChangeOffer, lastIssue: issue, nextCheckAt: new Date(Date.now() + 15 * 60_000),
    } });
    await recomputeAppleCoverage(db, chain.organizationId);
  });
}

export async function acceptAppleServerNotification(signedPayload: string) {
  for (const environment of ["Production", "Sandbox"] as const) {
    let decoded;
    try { decoded = await appleReceiptVerifier(environment).notification(signedPayload); } catch { continue; }
    const notification = await prisma.appleServerNotification.upsert({ where: { id: decoded.notificationUUID! }, update: {}, create: {
      id: decoded.notificationUUID!, environment, notificationType: decoded.notificationType!, subtype: decoded.subtype,
      signedPayload, signedAt: new Date(decoded.signedDate!),
    } });
    if (notification.signedPayload !== signedPayload || notification.environment !== environment)
      throw new AppError("applePurchaseBindingMismatch", "CONFLICT", 409);
    // Durable evidence is saved before acknowledging Apple. Transient processing
    // failure is retried by the recovery job, not hidden by a provider redirect.
    await processAppleServerNotification(notification);
    return { accepted: true as const, notificationId: notification.id };
  }
  throw new AppError("appleInvalidTransaction", "BAD_REQUEST", 400);
}
async function processAppleServerNotification(seed: AppleServerNotification) {
  if (seed.status === "PROCESSED") return;
  const token = randomUUID();
  const now = new Date();
  const claim = await prisma.appleServerNotification.updateMany({ where: { id: seed.id, status: { not: "PROCESSED" },
    OR: [{ processingUntil: null }, { processingUntil: { lte: now } }] }, data: {
    processingToken: token, processingUntil: new Date(now.getTime() + 120_000), attemptCount: { increment: 1 } } });
  if (!claim.count) return;
  try {
    const verifier = appleReceiptVerifier(seed.environment as "Production" | "Sandbox");
    const decoded = await verifier.notification(seed.signedPayload);
    if (decoded.data?.signedTransactionInfo) await applyAppleTransaction(await verifier.transaction(decoded.data.signedTransactionInfo), { source: "NOTIFICATION" });
    if (decoded.data?.signedRenewalInfo) await applyAppleSignedRenewal(decoded.data.signedRenewalInfo, verifier);
    // TEST and informational notifications do not create grants. Unknown types
    // remain visible; they are not interpreted as purchase or refund signals.
    await prisma.appleServerNotification.updateMany({ where: { id: seed.id, processingToken: token }, data: {
      status: "PROCESSED", processingToken: null, processingUntil: null, lastIssue: null } });
  } catch (error) {
    await prisma.appleServerNotification.updateMany({ where: { id: seed.id, processingToken: token }, data: {
      status: "PENDING", processingToken: null, processingUntil: null,
      nextAttemptAt: new Date(Date.now() + Math.min(86_400_000, 60_000 * 2 ** Math.min(seed.attemptCount, 10))),
      lastIssue: error instanceof AppError ? error.message : "appleReconciliationUnavailable" } });
  }
}

async function reconcileAppleChain(id: string) {
  const token = randomUUID(), now = new Date();
  const claim = await prisma.appleSubscriptionChain.updateMany({ where: { id, nextCheckAt: { lte: now },
    OR: [{ processingUntil: null }, { processingUntil: { lte: now } }] }, data: { processingToken: token, processingUntil: new Date(now.getTime() + 180_000) } });
  if (!claim.count) return;
  const chain = await prisma.appleSubscriptionChain.findUniqueOrThrow({ where: { id } });
  try {
    const api = appleApiClient(chain.environment);
    const verifier = appleReceiptVerifier(chain.environment as "Production" | "Sandbox");
    let revision: string | null = null;
    // No per-run truncation: every page is consumed before the next-check marker
    // advances. A crash repeats safely through transaction IDs and observations.
    for (let page = 0; ; page++) {
      if (page > 1000) throw new AppError("appleHistoryNeedsReview", "CONFLICT", 409);
      const history = await api.getTransactionHistory(chain.originalTransactionId, revision, { sort: Order.ASCENDING }, GetTransactionHistoryVersion.V2);
      for (const signed of history.signedTransactions ?? []) {
        const receipt = await verifier.transaction(signed);
        // History can include other subscription groups/accounts; the original
        // binding and appAccountToken are checked independently for every row.
        if (receipt.data.appAccountToken === chain.appAccountToken) await applyAppleTransaction(receipt, { organizationId: chain.organizationId, source: "RECONCILIATION" });
      }
      if (!history.hasMore) break;
      if (!history.revision || history.revision === revision) throw new AppError("appleReconciliationUnavailable", "CONFLICT", 409);
      revision = history.revision;
      await prisma.appleSubscriptionChain.updateMany({ where: { id, processingToken: token }, data: { processingUntil: new Date(Date.now() + 180_000) } });
    }
    const status = await api.getAllSubscriptionStatuses(chain.originalTransactionId);
    for (const group of status.data ?? []) for (const tx of group.lastTransactions ?? []) {
      if (tx.originalTransactionId && tx.originalTransactionId !== chain.originalTransactionId) continue;
      if (tx.signedTransactionInfo) {
        const receipt = await verifier.transaction(tx.signedTransactionInfo);
        if (receipt.data.appAccountToken !== chain.appAccountToken || receipt.data.originalTransactionId !== chain.originalTransactionId) continue;
        await applyAppleTransaction(receipt, { organizationId: chain.organizationId, source: "RECONCILIATION" });
      }
      if (tx.signedRenewalInfo) {
        const info = await verifier.renewal(tx.signedRenewalInfo);
        if (info.originalTransactionId !== chain.originalTransactionId || (info.appAccountToken && info.appAccountToken.toLowerCase() !== chain.appAccountToken)) continue;
        await applyAppleSignedRenewal(tx.signedRenewalInfo, verifier);
      }
    }
    // Server notification history recovers delivery gaps (up to Apple's retained
    // history), including renewal preference changes not present in transactions.
    let pagination: string | null = null;
    const startDate = Math.max(now.getTime() - 179 * 86_400_000, (chain.lastCheckedAt?.getTime() ?? now.getTime() - 179 * 86_400_000) - 86_400_000);
    for (let page = 0; ; page++) {
      if (page > 1000) throw new AppError("appleHistoryNeedsReview", "CONFLICT", 409);
      const history = await api.getNotificationHistory(pagination, { startDate, endDate: now.getTime(), transactionId: chain.originalTransactionId });
      for (const item of history.notificationHistory ?? []) if (item.signedPayload) await acceptAppleServerNotification(item.signedPayload);
      if (!history.hasMore) break;
      if (!history.paginationToken || history.paginationToken === pagination) throw new AppError("appleReconciliationUnavailable", "CONFLICT", 409);
      pagination = history.paginationToken;
    }
    await prisma.appleSubscriptionChain.updateMany({ where: { id, processingToken: token }, data: {
      processingToken: null, processingUntil: null, lastCheckedAt: now, lastIssue: null,
      nextCheckAt: new Date(Date.now() + 15 * 60_000) } });
  } catch (error) {
    await prisma.appleSubscriptionChain.updateMany({ where: { id, processingToken: token }, data: {
      processingToken: null, processingUntil: null, lastIssue: error instanceof AppError ? error.message : "appleReconciliationUnavailable",
      nextCheckAt: new Date(Date.now() + 5 * 60_000) } });
  }
}
async function reconcileAppleTransaction(id: string) {
  const token = randomUUID(), now = new Date();
  const claim = await prisma.appleTransaction.updateMany({ where: { id, nextCheckAt: { lte: now },
    OR: [{ processingUntil: null }, { processingUntil: { lte: now } }] }, data: { processingToken: token, processingUntil: new Date(now.getTime() + 120_000) } });
  if (!claim.count) return;
  const row = await prisma.appleTransaction.findUniqueOrThrow({ where: { id } });
  try {
    const response = await appleApiClient(row.environment).getTransactionInfo(row.transactionId);
    if (!response.signedTransactionInfo) throw new AppError("appleReconciliationUnavailable", "CONFLICT", 409);
    const receipt = await appleReceiptVerifier(row.environment as "Production" | "Sandbox").transaction(response.signedTransactionInfo);
    await applyAppleTransaction(receipt, { organizationId: row.organizationId, source: "RECONCILIATION" });
    await prisma.appleTransaction.updateMany({ where: { id, processingToken: token }, data: {
      processingToken: null, processingUntil: null, nextCheckAt: new Date(Date.now() + 86_400_000) } });
  } catch (error) {
    await prisma.appleTransaction.updateMany({ where: { id, processingToken: token }, data: {
      processingToken: null, processingUntil: null, nextCheckAt: new Date(Date.now() + 15 * 60_000),
      lastIssue: error instanceof AppError ? error.message : "appleReconciliationUnavailable" } });
  }
}
export async function reconcileAppleBilling() {
  const now = new Date();
  const notifications = await prisma.appleServerNotification.findMany({ where: { status: "PENDING", nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: "asc" }, take: 30 });
  for (const notification of notifications) await processAppleServerNotification(notification);
  await prisma.applePurchaseIntent.updateMany({ where: { status: "PENDING", authorizedAt: { not: null }, expiresAt: { lte: now } },
    data: { status: "REVIEW", pendingSlot: null, lastIssue: "applePurchasePendingVerification" } });
  await prisma.applePurchaseIntent.updateMany({ where: { status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED", pendingSlot: null } });
  if (!appleBillingConfig().apiReady) return { notifications: notifications.length, chains: 0, transactions: 0, apiReady: false };
  const chains = await prisma.appleSubscriptionChain.findMany({ where: { nextCheckAt: { lte: now } }, orderBy: { nextCheckAt: "asc" }, take: 10 });
  for (const chain of chains) await reconcileAppleChain(chain.id);
  const transactions = await prisma.appleTransaction.findMany({ where: { nextCheckAt: { lte: now } }, orderBy: { nextCheckAt: "asc" }, take: 20 });
  for (const row of transactions) await reconcileAppleTransaction(row.id);
  return { notifications: notifications.length, chains: chains.length, transactions: transactions.length, apiReady: true };
}
