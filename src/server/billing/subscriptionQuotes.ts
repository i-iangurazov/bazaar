import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPlanRank } from "@/lib/billing/plans";
import {
  EMPTY_SUBSCRIPTION_EXTRAS,
  subscriptionSelectionSchema,
  subscriptionPrice,
} from "@/lib/billing/subscriptionPricing";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { getOrganizationPlan } from "@/server/services/planLimits";
import { contractPlan } from "./contractTerms";
import { extendSubscriptionMonths, kgsToMinor } from "./paymentMath";
import { readPurchaseSnapshot, signPurchaseQuote, type PurchaseSnapshot } from "./purchaseSnapshot";
import {
  assertScheduledSubscriptionCompatibility,
  assertSubscriptionSelectionReady,
  hasSubscriptionEntitlementReduction,
  subscriptionEntitlementReduction,
} from "./subscriptionPreparation";

export const subscriptionQuoteInputSchema = subscriptionSelectionSchema.extend({
  action: z.enum(["RENEW", "CHANGE"]).default("RENEW"),
});
export type SubscriptionQuoteInput = z.infer<typeof subscriptionQuoteInputSchema>;
const prorate = (amount: number, remaining: number, duration: number) =>
  Number(
    (BigInt(amount) * BigInt(remaining) + BigInt(Math.floor(duration / 2))) / BigInt(duration),
  );

async function calculateSubscriptionQuoteDetails(
  organizationId: string,
  input: SubscriptionQuoteInput,
  db: Prisma.TransactionClient = prisma,
  now = new Date(),
) {
  const org = await getOrganizationPlan(organizationId, db);
  if (org.lifetimeAccess) throw new AppError("billingLifetimeProtected", "FORBIDDEN", 403);
  if (org.subscriptionBillingMode !== "SELF_SERVE" || org.subscriptionStatus === "CANCELED")
    throw new AppError("billingManualAccess", "FORBIDDEN", 403);
  const version = org.billingCatalogVersion;
  const selectedTerms = contractPlan(org.contractTerms, input.plan, input.extras);
  const basePrice = kgsToMinor(selectedTerms.monthlyPriceKgs);
  const start = new Date(
    Math.max(
      now.getTime(),
      org.currentPeriodEndsAt?.getTime() ?? 0,
      org.trialEndsAt?.getTime() ?? 0,
    ),
  );
  const anchorDay =
    org.currentPeriodEndsAt?.getTime() === start.getTime() && org.billingAnchorDay
      ? org.billingAnchorDay
      : start.getUTCDate();
  const price = subscriptionPrice(basePrice, input.months, input.extras);
  const end = extendSubscriptionMonths(start, anchorDay, input.months);
  const base: PurchaseSnapshot = {
    entitlements: selectedTerms,
    version: 1,
    catalogVersion: version,
    kind: "RENEWAL",
    plan: input.plan,
    months: input.months,
    extras: input.extras,
    monthlyMinor: price.monthlyMinor,
    discountBps: price.discountBps,
    fullAmountMinor: price.fullAmountMinor,
    amountMinor: price.amountMinor,
    serviceValueMinor: price.amountMinor,
    creditMinor: 0,
    organizationId,
    expectedPlan: org.storedPlan,
    expectedPeriodEnd: org.currentPeriodEndsAt?.toISOString() ?? null,
    sourcePeriodId: null,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    cycleStartsAt: start.toISOString(),
    cycleEndsAt: end.toISOString(),
    anchorDay,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
  };
  if (input.action === "RENEW") {
    await assertSubscriptionSelectionReady(org, selectedTerms, db);
    return { snapshot: base, organization: org };
  }
  const period = org.activeSubscriptionPeriod;
  if (!period || period.endsAt <= now) throw new AppError("billingNoActivePeriod", "CONFLICT", 409);
  const prior = readPurchaseSnapshot(period.purchaseSnapshot);
  const oldExtras = prior?.extras ?? EMPTY_SUBSCRIPTION_EXTRAS;
  const oldLimits = (prior?.entitlements ?? contractPlan(org.contractTerms, period.plan, oldExtras))
    .limits;
  const newLimits = selectedTerms.limits;
  if (
    getPlanRank(input.plan) < getPlanRank(period.plan) ||
    newLimits.maxStores < oldLimits.maxStores ||
    newLimits.maxProducts < oldLimits.maxProducts ||
    newLimits.maxActiveUsers < oldLimits.maxActiveUsers
  )
    throw new AppError("billingDowngradeNextPeriod", "CONFLICT", 409);
  await assertScheduledSubscriptionCompatibility(org, selectedTerms, db, now);
  const invoice = await db.subscriptionInvoice.findUniqueOrThrow({
    where: { id: period.invoiceId },
  });
  const months = prior?.months ?? 1;
  const cycleStart = new Date(prior?.cycleStartsAt ?? period.startsAt);
  const cycleEnd = new Date(prior?.cycleEndsAt ?? period.endsAt);
  const remaining = period.endsAt.getTime() - now.getTime();
  const value = subscriptionPrice(basePrice, months, input.extras);
  const serviceValueMinor = prorate(
    value.amountMinor,
    remaining,
    cycleEnd.getTime() - cycleStart.getTime(),
  );
  const creditMinor = prorate(
    prior?.serviceValueMinor ?? invoice.amountMinor,
    remaining,
    period.endsAt.getTime() - period.startsAt.getTime(),
  );
  const due = serviceValueMinor - creditMinor;
  if (due <= 0) throw new AppError("billingNoPaidChange", "CONFLICT", 409);
  const snapshot: PurchaseSnapshot = {
    ...base,
    kind: "UPGRADE",
    months,
    monthlyMinor: value.monthlyMinor,
    discountBps: value.discountBps,
    fullAmountMinor: value.fullAmountMinor,
    amountMinor: due,
    serviceValueMinor,
    creditMinor,
    sourcePeriodId: period.id,
    startsAt: now.toISOString(),
    endsAt: period.endsAt.toISOString(),
    cycleStartsAt: cycleStart.toISOString(),
    cycleEndsAt: cycleEnd.toISOString(),
    anchorDay: prior?.anchorDay ?? org.billingAnchorDay ?? cycleStart.getUTCDate(),
  };
  return { snapshot, organization: org };
}

export async function calculateSubscriptionQuote(
  organizationId: string,
  input: SubscriptionQuoteInput,
  db: Prisma.TransactionClient = prisma,
  now = new Date(),
): Promise<PurchaseSnapshot> {
  return (await calculateSubscriptionQuoteDetails(organizationId, input, db, now)).snapshot;
}

export async function getSubscriptionQuote(organizationId: string, input: SubscriptionQuoteInput) {
  const now = new Date();
  const { snapshot, organization } = await calculateSubscriptionQuoteDetails(
    organizationId,
    input,
    prisma,
    now,
  );
  const entitlements =
    snapshot.entitlements ??
    contractPlan(organization.contractTerms, snapshot.plan, snapshot.extras);
  // Presentation amounts are calculated on the server. Upgrade savings refer
  // to the whole original term, never the difference between a term and a top-up.
  const termAmountMinor = subscriptionPrice(snapshot.monthlyMinor, snapshot.months).amountMinor;
  const effectiveTiming =
    snapshot.kind === "UPGRADE" || new Date(snapshot.startsAt) <= now
      ? ("IMMEDIATE" as const)
      : organization.trialOffer &&
          !organization.activeSubscriptionPeriod &&
          organization.trialEndsAt?.toISOString() === snapshot.startsAt
        ? ("AFTER_TRIAL" as const)
        : ("NEXT_PERIOD" as const);
  const scheduledReduction =
    snapshot.kind === "RENEWAL" &&
    Boolean(organization.activeSubscriptionPeriod) &&
    hasSubscriptionEntitlementReduction(
      subscriptionEntitlementReduction(organization.entitlements, entitlements),
    );
  return {
    ...snapshot,
    entitlements,
    termAmountMinor,
    savingsMinor: snapshot.fullAmountMinor - termAmountMinor,
    effectiveTiming,
    scheduledReduction,
    quoteToken: signPurchaseQuote(snapshot),
  };
}
