import type { Prisma } from "@prisma/client";
import { AppError } from "@/server/services/errors";

export type ApplePurchaseScope = "SUBSCRIPTION" | "WHATSAPP_PACK";
/** Caller holds Organization FOR UPDATE. Expiry releases the reservation, never erases the durable intent. */
export async function assertNoApplePurchaseConflict(db: Prisma.TransactionClient, organizationId: string,
  scope: ApplePurchaseScope, now = new Date(), ownIntentId?: string, allowAppleChange = false) {
  await db.applePurchaseIntent.updateMany({
    where: { organizationId, scope, status: "PENDING", authorizedAt: { not: null }, expiresAt: { lte: now } },
    data: { status: "REVIEW", pendingSlot: null, lastIssue: "applePurchasePendingVerification" },
  });
  await db.applePurchaseIntent.updateMany({
    where: { organizationId, scope, status: "PENDING", expiresAt: { lte: now } },
    data: { status: "EXPIRED", pendingSlot: null },
  });
  const pending = await db.applePurchaseIntent.findFirst({ where: { organizationId, scope,
    ...(ownIntentId ? { id: { not: ownIntentId } } : {}),
    OR: [{ pendingSlot: `${scope}:${organizationId}` }, { status: "REVIEW" }],
  } });
  if (pending) throw new AppError(pending.status === "REVIEW" ? "applePaymentNeedsReview" : "applePurchasePending", "CONFLICT", 409);
  const unresolvedReceipt = await db.appleTransaction.findFirst({ where: { organizationId, status: "REVIEW",
    productType: { in: scope === "SUBSCRIPTION" ? ["AUTO_RENEWABLE", "NON_RENEWING"] : ["CONSUMABLE"] },
  }, select: { id: true } });
  if (unresolvedReceipt) throw new AppError("applePaymentNeedsReview", "CONFLICT", 409);
  if (scope === "SUBSCRIPTION" && !allowAppleChange) {
    const chain = await db.appleSubscriptionChain.findFirst({ where: { organizationId,
      OR: [{ autoRenewEnabled: true }, { expiresAt: { gt: now } }, { graceExpiresAt: { gt: now } }],
    } });
    // Null renewal state is deliberately treated as unknown while coverage lasts.
    if (chain) throw new AppError("appleSubscriptionManagedByApple", "CONFLICT", 409);
  }
}

export async function lockAppleOrganization(db: Prisma.TransactionClient, organizationId: string) {
  // WhatsApp quota/refund paths already use this advisory lock. Always acquire
  // it before the shared row lock so gateway checkout and Apple cannot deadlock.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp:${organizationId}`}, 0))`;
  await db.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
}


/** Read-only mirror for paywall/settings; the checkout row lock enforces it again. */
export async function appleWebPurchaseBlock(db: Prisma.TransactionClient, organizationId: string, now = new Date(), scope: ApplePurchaseScope = "SUBSCRIPTION") {
  const [intent, chain, unresolvedReceipt] = await Promise.all([
    db.applePurchaseIntent.findFirst({ where: { organizationId, scope, OR: [
      { status: "REVIEW" }, { status: "PENDING", expiresAt: { gt: now } },
      { status: "PENDING", authorizedAt: { not: null } },
    ] }, orderBy: { createdAt: "desc" } }),
    scope === "SUBSCRIPTION" ? db.appleSubscriptionChain.findFirst({ where: { organizationId, OR: [
      { autoRenewEnabled: true }, { expiresAt: { gt: now } }, { graceExpiresAt: { gt: now } },
    ] }, orderBy: { expiresAt: "desc" } }) : Promise.resolve(null),
    db.appleTransaction.findFirst({ where: { organizationId, status: "REVIEW",
      productType: { in: scope === "SUBSCRIPTION" ? ["AUTO_RENEWABLE", "NON_RENEWING"] : ["CONSUMABLE"] },
    }, select: { id: true } }),
  ]);
  return { reason: unresolvedReceipt ? "applePaymentNeedsReview" : intent ? intent.status === "REVIEW" ? "applePaymentNeedsReview" : "applePurchasePending" :
    chain ? "appleSubscriptionManagedByApple" : null, chain };
}
