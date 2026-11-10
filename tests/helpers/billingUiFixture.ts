import { createContractTerms, contractPlan } from "@/server/billing/contractTerms";
import { createTrialOffer } from "@/server/billing/trialPolicy";
import { extendSubscriptionMonths } from "@/server/billing/paymentMath";
import { PLAN_CODES, type PlanCode } from "@/lib/billing/plans";
import {
  EMPTY_SUBSCRIPTION_EXTRAS,
  subscriptionPrice,
  type SubscriptionExtras,
  type SubscriptionMonths,
} from "@/lib/billing/subscriptionPricing";
import type { SubscriptionQuote } from "@/components/billing/subscription-quote-summary";

export const billingUiStates = [
  "paidTrial",
  "trial",
  "paid",
  "lifetime",
  "manual",
  "pending",
  "creating",
  "review",
  "expiredTrial",
  "expiredPaid",
  "paused",
  "unavailable",
  "error",
] as const;
export type BillingUiState = (typeof billingUiStates)[number];
export const billingUiNow = new Date("2026-11-11T12:00:00Z");
export const billingUiTrialEnd = "2026-11-17T16:03:00.000Z";
export const billingUiPaidEnd = "2026-12-17T16:03:00.000Z";

/** Synthetic UI responses only; no database, credentials or transport is used. */
export function createBillingUiFixture(state: BillingUiState = "paidTrial") {
  const terms = createContractTerms("2026-11");
  const trialOffer = createTrialOffer(terms);
  const trialActive = state === "paidTrial" || state === "trial";
  const expiredTrial = state === "expiredTrial";
  const expiredPaid = state === "expiredPaid";
  const lifetime = state === "lifetime";
  const manual = state === "manual" || lifetime;
  const paused = state === "paused";
  const pendingStatus =
    state === "pending"
      ? "PENDING"
      : state === "creating"
        ? "CREATING"
        : state === "review"
          ? "REVIEW"
          : null;
  const plan: PlanCode = trialActive || expiredTrial ? "STARTER" : "BUSINESS";
  const entitlements = trialActive || expiredTrial ? trialOffer.entitlements : terms.plans[plan];
  const trialEndsAt = trialActive
    ? billingUiTrialEnd
    : expiredTrial
      ? "2020-11-17T16:03:00.000Z"
      : null;
  const currentPeriodEndsAt =
    state === "trial"
      ? billingUiTrialEnd
      : expiredTrial || expiredPaid
        ? "2020-11-17T16:03:00.000Z"
        : billingUiPaidEnd;
  const subscriptionActive = !expiredTrial && !expiredPaid && !paused && state !== "trial";
  const available = !["unavailable", "error"].includes(state);
  const canPurchase = available && !manual && !paused && !pendingStatus;
  const catalog = PLAN_CODES.map((code) => ({
    plan: code,
    planTier: code,
    amountMinor: terms.plans[code].monthlyPriceKgs * 100,
    monthlyPriceKgs: terms.plans[code].monthlyPriceKgs,
    limits: { ...terms.plans[code].limits, maxUsers: terms.plans[code].limits.maxActiveUsers },
    featureFlags: terms.plans[code].features,
  }));
  const quote = (selection: {
    plan: PlanCode;
    months: SubscriptionMonths;
    extras: SubscriptionExtras;
    action?: "RENEW" | "CHANGE";
  }): SubscriptionQuote => {
    const selected = contractPlan(terms, selection.plan, selection.extras);
    const price = subscriptionPrice(
      selected.monthlyPriceKgs * 100,
      selection.months,
      selection.extras,
    );
    const startsAt =
      state === "trial"
        ? billingUiTrialEnd
        : state === "paidTrial" || subscriptionActive
          ? billingUiPaidEnd
          : billingUiNow.toISOString();
    const endsAt = extendSubscriptionMonths(new Date(startsAt), 17, selection.months).toISOString();
    return {
      version: 1,
      catalogVersion: "2026-11",
      kind: "RENEWAL",
      organizationId: "synthetic-billing-ui",
      plan: selection.plan,
      extras: selection.extras,
      entitlements: selected,
      ...price,
      termAmountMinor: price.amountMinor,
      savingsMinor: price.fullAmountMinor - price.amountMinor,
      serviceValueMinor: price.amountMinor,
      creditMinor: 0,
      expectedPlan: plan,
      expectedPeriodEnd: currentPeriodEndsAt,
      sourcePeriodId: null,
      startsAt,
      endsAt,
      cycleStartsAt: startsAt,
      cycleEndsAt: endsAt,
      anchorDay: 17,
      effectiveTiming:
        state === "trial" ? "AFTER_TRIAL" : subscriptionActive ? "NEXT_PERIOD" : "IMMEDIATE",
      scheduledReduction: false,
      issuedAt: billingUiNow.toISOString(),
      expiresAt: "2099-01-01T00:00:00.000Z",
      quoteToken: `synthetic:${selection.plan}:${selection.months}:${selection.extras.stores}:${selection.extras.productPacks}`,
    };
  };
  const purchase = {
    ...quote({ plan, months: 1, extras: EMPTY_SUBSCRIPTION_EXTRAS }),
    startsAt: billingUiTrialEnd,
    endsAt: billingUiPaidEnd,
    effectiveTiming: "AFTER_TRIAL" as const,
  };
  const invoice = {
    id: "synthetic-invoice",
    provider: "GOPAY" as const,
    isTest: false,
    plan,
    amountMinor: terms.plans[plan].monthlyPriceKgs * 100,
    currency: "KGS",
    status: pendingStatus ?? "PAID",
    createdAt: billingUiNow.toISOString(),
    paidAt: pendingStatus ? null : billingUiNow.toISOString(),
    expiresAt: "2099-11-17T16:03:00.000Z",
    syncDelayed: false,
    checkoutUrl: state === "pending" ? "https://example.invalid/synthetic-checkout" : null,
    period: pendingStatus ? null : { startsAt: billingUiTrialEnd, endsAt: billingUiPaidEnd },
    purchase,
    sellerName: "Synthetic seller",
    termsVersion: "synthetic-ui-v1",
    termsUrl: "#synthetic-terms",
  };
  return {
    state,
    summary: {
      organizationId: "synthetic-billing-ui",
      plan,
      planTier: plan,
      subscriptionBillingMode: manual ? "MANUAL" : "SELF_SERVE",
      subscriptionStatus: paused ? "CANCELED" : expiredPaid ? "PAST_DUE" : "ACTIVE",
      lifetimeAccess: lifetime,
      billingCatalogVersion: "2026-11",
      pendingUpgradeRequest: null,
      trialOffer: trialActive || expiredTrial ? trialOffer : null,
      trialEndsAt,
      currentPeriodEndsAt,
      trialActive,
      trialExpired: expiredTrial,
      subscriptionActive,
      hasAccess: trialActive || subscriptionActive || lifetime,
      inGrace: false,
      graceEndsAt: null,
      limitState: "OK",
      limitExceeded: { stores: false, products: false, users: false },
      featureFlags: entitlements.features,
      monthlyPriceKgs: lifetime ? 0 : entitlements.monthlyPriceKgs,
      usage: { stores: 1, products: 37, users: 1 },
      limits: {
        maxStores: entitlements.limits.maxStores,
        maxProducts: entitlements.limits.maxProducts,
        maxUsers: entitlements.limits.maxActiveUsers,
      },
      planCatalog: catalog,
    },
    payment: {
      available,
      mode: "live",
      provider: "GOPAY",
      billingMode: manual ? "MANUAL" : "SELF_SERVE",
      accountPaused: paused,
      lifetimeAccess: lifetime,
      canPurchase,
      trialPreview: trialActive || expiredTrial,
      currentPlan: plan,
      catalogVersion: "2026-11",
      mayChangePlan: false,
      canChange: false,
      currentMonths: 1,
      currentExtras: EMPTY_SUBSCRIPTION_EXTRAS,
      catalog,
      sellerName: "Synthetic seller",
      termsVersion: "synthetic-ui-v1",
      termsUrl: "#synthetic-terms",
      pendingInvoice: pendingStatus ? invoice : null,
      scheduledSubscription:
        state === "paidTrial"
          ? {
              plan: "STARTER",
              months: 1,
              extras: EMPTY_SUBSCRIPTION_EXTRAS,
              startsAt: billingUiTrialEnd,
              endsAt: billingUiPaidEnd,
              entitlements: terms.plans.STARTER,
            }
          : null,
      paidUntil: currentPeriodEndsAt,
    },
    usage: lifetime
      ? [{ resource: "ai", limit: null, used: 0, reserved: 0, remaining: null, resetsAt: null }]
      : [
          {
            resource: "ai",
            limit: trialActive || expiredTrial ? 100 : 300,
            used: 8,
            reserved: 2,
            remaining: trialActive || expiredTrial ? 90 : 290,
            resetsAt: trialEndsAt ?? currentPeriodEndsAt,
          },
          {
            resource: "images",
            limit: trialActive || expiredTrial ? 3 : 10,
            used: 1,
            reserved: 0,
            remaining: trialActive || expiredTrial ? 2 : 9,
            resetsAt: trialEndsAt ?? currentPeriodEndsAt,
          },
        ],
    invoices: state === "paidTrial" || pendingStatus ? [invoice] : [],
    quote,
  };
}
