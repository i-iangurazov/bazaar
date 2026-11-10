import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContractTerms, contractPlan } from "@/server/billing/contractTerms";
import type { PurchaseSnapshot } from "@/server/billing/purchaseSnapshot";
import type { getOrganizationPlan } from "@/server/services/planLimits";
import { createTrialOffer } from "@/server/billing/trialPolicy";
import { EMPTY_SUBSCRIPTION_EXTRAS } from "@/lib/billing/subscriptionPricing";

const mocks = vi.hoisted(() => ({
  organization: vi.fn(),
  scheduled: vi.fn(),
  invoice: vi.fn(),
  selectionReady: vi.fn(),
}));
vi.mock("@/server/db/prisma", () => ({
  prisma: {
    subscriptionPeriod: { findMany: mocks.scheduled },
    subscriptionInvoice: { findUniqueOrThrow: mocks.invoice },
  },
}));
vi.mock("@/server/services/planLimits", () => ({ getOrganizationPlan: mocks.organization }));
vi.mock("@/server/billing/subscriptionPreparation", async (original) => ({
  ...(await original<typeof import("@/server/billing/subscriptionPreparation")>()),
  assertSubscriptionSelectionReady: mocks.selectionReady,
}));

import { getSubscriptionQuote } from "@/server/billing/subscriptionQuotes";
import {
  assertScheduledSubscriptionCompatibility,
  subscriptionEntitlementReduction,
  hasSubscriptionEntitlementReduction,
} from "@/server/billing/subscriptionPreparation";

const start = new Date("2027-01-01T00:00:00.000Z");
const end = new Date("2028-01-01T00:00:00.000Z");
const now = new Date((start.getTime() + end.getTime()) / 2);
const terms = createContractTerms("2026-11");
const selection = {
  plan: "BUSINESS" as const,
  months: 12 as const,
  extras: EMPTY_SUBSCRIPTION_EXTRAS,
  action: "CHANGE" as const,
};
function snapshot(plan: "STARTER" | "BUSINESS" | "ENTERPRISE" = "STARTER"): PurchaseSnapshot {
  return {
    version: 1,
    catalogVersion: "2026-11",
    kind: "RENEWAL",
    plan,
    months: 12,
    extras: { ...EMPTY_SUBSCRIPTION_EXTRAS },
    monthlyMinor: 200_000,
    discountBps: 1500,
    fullAmountMinor: 2_400_000,
    amountMinor: 2_040_000,
    serviceValueMinor: 2_040_000,
    creditMinor: 0,
    organizationId: "org",
    expectedPlan: plan,
    expectedPeriodEnd: null,
    sourcePeriodId: null,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    cycleStartsAt: start.toISOString(),
    cycleEndsAt: end.toISOString(),
    anchorDay: 1,
    issuedAt: start.toISOString(),
    expiresAt: new Date(start.getTime() + 900_000).toISOString(),
    entitlements: contractPlan(terms, plan),
  };
}
function organization() {
  return {
    id: "org",
    lifetimeAccess: false,
    subscriptionBillingMode: "SELF_SERVE",
    subscriptionStatus: "ACTIVE",
    billingCatalogVersion: "2026-11",
    contractTerms: terms,
    storedPlan: "STARTER",
    plan: "STARTER",
    currentPeriodEndsAt: end,
    trialEndsAt: null,
    billingAnchorDay: 1,
    trialOffer: null,
    entitlements: terms.plans.STARTER,
    activeSubscriptionPeriod: {
      id: "current",
      invoiceId: "first",
      startsAt: start,
      endsAt: end,
      plan: "STARTER",
      purchaseSnapshot: snapshot(),
    },
  };
}
function scheduled(plan: "STARTER" | "BUSINESS" | "ENTERPRISE", offset = 0) {
  const startsAt = new Date(Date.UTC(2028 + offset, 0, 1));
  const endsAt = new Date(Date.UTC(2029 + offset, 0, 1));
  return {
    plan,
    startsAt,
    endsAt,
    purchaseSnapshot: {
      ...snapshot(plan),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    },
  };
}
const db = {
  subscriptionPeriod: { findMany: mocks.scheduled },
} as unknown as Prisma.TransactionClient;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.stubEnv("NEXTAUTH_SECRET", "synthetic-subscription-quote-lifecycle-key");
  mocks.organization.mockResolvedValue(organization());
  mocks.scheduled.mockResolvedValue([]);
  mocks.invoice.mockResolvedValue({ amountMinor: 2_040_000 });
  mocks.selectionReady.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("subscription quote lifecycle and prepaid compatibility", () => {
  it("quotes a current annual upgrade with term savings separate from the prorated amount due", async () => {
    const quote = await getSubscriptionQuote("org", selection);
    expect(quote).toMatchObject({
      kind: "UPGRADE",
      months: 12,
      amountMinor: 765_000,
      serviceValueMinor: 1_785_000,
      creditMinor: 1_020_000,
      fullAmountMinor: 4_200_000,
      termAmountMinor: 3_570_000,
      savingsMinor: 630_000,
      startsAt: now.toISOString(),
      endsAt: end.toISOString(),
      effectiveTiming: "IMMEDIATE",
      scheduledReduction: false,
    });
  });

  it("allows a current upgrade when every already-paid future grant includes the chosen features and limits", async () => {
    mocks.scheduled.mockResolvedValue([scheduled("BUSINESS"), scheduled("ENTERPRISE", 1)]);
    const quote = await getSubscriptionQuote("org", selection);
    expect(quote.endsAt).toBe(end.toISOString());
    expect(quote.amountMinor).toBe(765_000);
    expect(mocks.scheduled).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org", startsAt: { gt: now } },
      }),
    );
  });

  it("checks the entire prepaid chain and identifies the first incompatible future period", async () => {
    const incompatible = scheduled("STARTER", 1);
    mocks.scheduled.mockResolvedValue([scheduled("ENTERPRISE"), incompatible]);
    await expect(getSubscriptionQuote("org", selection)).rejects.toMatchObject({
      message: "billingScheduledChangeExists",
      code: "CONFLICT",
      details: {
        scheduledSubscription: {
          plan: "STARTER",
          startsAt: incompatible.startsAt.toISOString(),
          endsAt: incompatible.endsAt.toISOString(),
        },
        conflictingLimits: ["maxProducts", "maxActiveUsers"],
        conflictingFeatures: expect.arrayContaining(["analytics"]),
        conflictingUsage: expect.arrayContaining(["ai", "images"]),
      },
    });
  });

  it("uses frozen entitlements rather than assuming the future plan label guarantees capacity", async () => {
    const future = scheduled("ENTERPRISE");
    future.purchaseSnapshot.entitlements!.limits.maxStores = 1;
    mocks.scheduled.mockResolvedValue([future]);
    await expect(
      getSubscriptionQuote("org", {
        ...selection,
        extras: { stores: 1, productPacks: 0, userPacks: 0 },
      }),
    ).rejects.toMatchObject({
      message: "billingScheduledChangeExists",
      details: { conflictingLimits: ["maxStores"] },
    });
  });

  it.each([1, 6, 12] as const)(
    "keeps the unexpired trial intact before a %s-month purchase",
    async (months) => {
      const trialEnd = new Date(now.getTime() + 7 * 86_400_000);
      mocks.organization.mockResolvedValue({
        ...organization(),
        trialOffer: createTrialOffer(terms),
        trialEndsAt: trialEnd,
        currentPeriodEndsAt: trialEnd,
        activeSubscriptionPeriod: null,
      });
      const quote = await getSubscriptionQuote("org", { ...selection, months, action: "RENEW" });
      expect(quote.startsAt).toBe(trialEnd.toISOString());
      expect(quote.effectiveTiming).toBe("AFTER_TRIAL");
      expect(quote.scheduledReduction).toBe(false);
      expect(new Date(quote.endsAt).getUTCMonth()).toBe((trialEnd.getUTCMonth() + months) % 12);
      expect(quote.savingsMinor).toBe(quote.fullAmountMinor - quote.amountMinor);
    },
  );

  it("appends an early renewal after the entire prepaid tail without shortening current access", async () => {
    const tail = new Date("2029-01-01T00:00:00.000Z");
    mocks.organization.mockResolvedValue({ ...organization(), currentPeriodEndsAt: tail });
    const quote = await getSubscriptionQuote("org", { ...selection, months: 6, action: "RENEW" });
    expect(quote).toMatchObject({
      startsAt: tail.toISOString(),
      endsAt: "2029-07-01T00:00:00.000Z",
      effectiveTiming: "NEXT_PERIOD",
      scheduledReduction: false,
    });
  });

  it("shows the next-period reduction while preserving the current paid grant", async () => {
    const org = organization();
    mocks.organization.mockResolvedValue({
      ...org,
      plan: "ENTERPRISE",
      storedPlan: "ENTERPRISE",
      entitlements: terms.plans.ENTERPRISE,
      activeSubscriptionPeriod: { ...org.activeSubscriptionPeriod, plan: "ENTERPRISE" },
    });
    const quote = await getSubscriptionQuote("org", {
      ...selection,
      plan: "STARTER",
      months: 1,
      action: "RENEW",
    });
    expect(quote).toMatchObject({
      effectiveTiming: "NEXT_PERIOD",
      scheduledReduction: true,
      startsAt: end.toISOString(),
      amountMinor: 200_000,
    });
  });

  it("starts an expired renewal at confirmation-time preview, without billing the elapsed gap", async () => {
    const expired = new Date(now.getTime() - 10 * 86_400_000);
    mocks.organization.mockResolvedValue({
      ...organization(),
      currentPeriodEndsAt: expired,
      activeSubscriptionPeriod: null,
    });
    const quote = await getSubscriptionQuote("org", { ...selection, months: 1, action: "RENEW" });
    expect(quote.startsAt).toBe(now.toISOString());
    expect(quote.effectiveTiming).toBe("IMMEDIATE");
    expect(quote.amountMinor).toBe(350_000);
  });

  it("does not allow a cheaper current plan or reduced capacity under the upgrade action", async () => {
    const org = organization();
    mocks.organization.mockResolvedValue({
      ...org,
      entitlements: terms.plans.ENTERPRISE,
      activeSubscriptionPeriod: {
        ...org.activeSubscriptionPeriod,
        plan: "ENTERPRISE",
        purchaseSnapshot: snapshot("ENTERPRISE"),
      },
    });
    await expect(getSubscriptionQuote("org", selection)).rejects.toThrow(
      "billingDowngradeNextPeriod",
    );
  });
});

describe("frozen grant comparisons", () => {
  it("treats unlimited quota as a grant and does not compare price or marketing tier labels", () => {
    const current = {
      ...terms.plans.BUSINESS,
      usageLimits: { ...terms.plans.BUSINESS.usageLimits, ai: null },
    };
    expect(subscriptionEntitlementReduction(current, terms.plans.ENTERPRISE).usage).toEqual(["ai"]);
    const next = {
      ...terms.plans.STARTER,
      features: { ...current.features },
      limits: { ...current.limits },
      usageLimits: { ...current.usageLimits },
      monthlyPriceKgs: 1,
    };
    expect(
      hasSubscriptionEntitlementReduction(subscriptionEntitlementReduction(current, next)),
    ).toBe(false);
  });

  it("rejects a stricter archived-product counting contract even when numeric limits are equal", async () => {
    const org = organization() as unknown as Awaited<ReturnType<typeof getOrganizationPlan>>;
    const future = scheduled("BUSINESS");
    future.purchaseSnapshot.entitlements!.countArchivedProducts = true;
    mocks.scheduled.mockResolvedValue([future]);
    await expect(
      assertScheduledSubscriptionCompatibility(org, terms.plans.BUSINESS, db, now),
    ).rejects.toMatchObject({ details: { countsArchivedProducts: true } });
  });
});
