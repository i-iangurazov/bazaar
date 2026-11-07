import { afterEach, describe, expect, it, vi } from "vitest";
import { subscriptionPrice, subscriptionExtrasSchema } from "@/lib/billing/subscriptionPricing";
import { getPlanLimits, getPlanMonthlyPriceKgs } from "@/server/billing/planCatalog";
import { extendSubscriptionMonths } from "@/server/billing/paymentMath";
import { signPurchaseQuote, verifyPurchaseQuote, type PurchaseSnapshot } from "@/server/billing/purchaseSnapshot";

afterEach(() => vi.unstubAllEnvs());
describe("approved commercial terms: prepaid arithmetic and resource boundaries", () => {
  it.each([
    [2000, 1, 2000], [2000, 6, 11400], [2000, 12, 20400],
    [3500, 1, 3500], [3500, 6, 19950], [3500, 12, 35700],
    [5500, 1, 5500], [5500, 6, 31350], [5500, 12, 56100],
  ] as const)("%s KGS/month for %s months costs %s KGS", (monthly, months, total) => {
    expect(subscriptionPrice(monthly * 100, months).amountMinor).toBe(total * 100);
  });
  it("discounts add-ons on the same term, without multiplying product capacity by stores", () => {
    const extras = { stores: 1, productPacks: 1, userPacks: 0 };
    expect(subscriptionPrice(350000, 6, extras).amountMinor).toBe(2850000);
    expect(subscriptionPrice(350000, 12, extras).amountMinor).toBe(5100000);
    expect(getPlanLimits("BUSINESS", "2026-11", extras)).toEqual({ maxStores: 2, maxProducts: 6000, maxActiveUsers: 7 });
  });
  it("does not let legacy production overrides silently change the new public prices", () => {
    vi.stubEnv("PLAN_PRICE_STARTER_KGS", "1750");
    expect(getPlanMonthlyPriceKgs("STARTER", "2026-11")).toBe(2000);
    expect(getPlanMonthlyPriceKgs("STARTER")).toBe(2000);
    expect(getPlanMonthlyPriceKgs("STARTER", "2026-10")).toBe(1750);
    expect(getPlanLimits("BUSINESS", "2026-10").maxActiveUsers).toBe(10);
    expect(getPlanLimits("ENTERPRISE", "2026-10").maxActiveUsers).toBe(20);
    expect(getPlanLimits("BUSINESS", "2026-11").maxActiveUsers).toBe(5);
    expect(getPlanLimits("ENTERPRISE", "2026-11").maxActiveUsers).toBe(15);
  });
  it.each([-1, 0.5, NaN, Infinity, 101])("rejects invalid pack quantity %s", (quantity) => {
    expect(subscriptionExtrasSchema.safeParse({ stores: 0, productPacks: quantity, userPacks: 0 }).success).toBe(false);
  });
  it.each([
    ["2027-01-31T10:15:00Z", 1, "2027-02-28T10:15:00.000Z"],
    ["2028-01-31T10:15:00Z", 1, "2028-02-29T10:15:00.000Z"],
    ["2027-01-31T10:15:00Z", 6, "2027-07-31T10:15:00.000Z"],
    ["2028-02-29T10:15:00Z", 12, "2029-02-28T10:15:00.000Z"],
  ])("preserves calendar-month boundaries for %s + %s", (start, months, end) => {
    const date = new Date(start as string);
    expect(extendSubscriptionMonths(date, date.getUTCDate(), months as number).toISOString()).toBe(end);
  });
});

describe("tenant-bound expiring purchase quotes", () => {
  const snapshot: PurchaseSnapshot = {
    version: 1, catalogVersion: "2026-11", kind: "RENEWAL", plan: "STARTER", months: 6,
    extras: { stores: 0, productPacks: 0, userPacks: 0 }, monthlyMinor: 200000,
    discountBps: 500, fullAmountMinor: 1200000, amountMinor: 1140000, serviceValueMinor: 1140000,
    creditMinor: 0, organizationId: "tenant-a", expectedPlan: "STARTER", expectedPeriodEnd: null,
    sourcePeriodId: null, startsAt: "2027-01-31T00:00:00.000Z", endsAt: "2027-07-31T00:00:00.000Z",
    cycleStartsAt: "2027-01-31T00:00:00.000Z", cycleEndsAt: "2027-07-31T00:00:00.000Z", anchorDay: 31,
    issuedAt: "2027-01-31T00:00:00.000Z", expiresAt: "2027-01-31T00:15:00.000Z",
  };
  it("rejects amount tampering, a different organization and expired quotes", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "isolated-quote-signing-secret");
    const token = signPurchaseQuote(snapshot);
    const now = new Date("2027-01-31T00:01:00Z");
    expect(verifyPurchaseQuote(token, "tenant-a", now).amountMinor).toBe(1140000);
    expect(() => verifyPurchaseQuote(token, "tenant-b", now)).toThrow("billingQuoteChanged");
    expect(() => verifyPurchaseQuote(token, "tenant-a", new Date(snapshot.expiresAt))).toThrow("billingQuoteChanged");
    const [, signature] = token.split(".");
    const body = Buffer.from(JSON.stringify({ ...snapshot, amountMinor: 1 })).toString("base64url");
    expect(() => verifyPurchaseQuote(`${body}.${signature}`, "tenant-a", now)).toThrow("billingQuoteChanged");
  });
});
