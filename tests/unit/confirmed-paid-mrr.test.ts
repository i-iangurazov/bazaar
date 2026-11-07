import { describe, expect, it } from "vitest";
import { summarizeConfirmedPaidMrr } from "@/server/billing/paidMrr";
import { LIFETIME_ORGANIZATION_IDS } from "@/server/billing/lifetimeOrganizations";

const now = new Date("2027-07-01T00:00:00.000Z");
const org = (id = "paid-org") => ({
  id,
  subscriptionStatus: "ACTIVE",
  subscriptionContract: { lifetimeAccess: false },
});
const period = (id = "period-1", organizationId = "paid-org") => ({
  id,
  organizationId,
  startsAt: new Date("2027-01-01T00:00:00.000Z"),
  endsAt: new Date("2028-01-01T00:00:00.000Z"),
  createdAt: new Date("2027-01-01T00:00:00.000Z"),
  purchaseSnapshot: {
    version: 1,
    catalogVersion: "2026-11",
    kind: "RENEWAL",
    plan: "BUSINESS",
    months: 12,
    extras: { stores: 1, productPacks: 1, userPacks: 0 },
    monthlyMinor: 500000,
    discountBps: 1500,
    fullAmountMinor: 6000000,
    amountMinor: 5100000,
    serviceValueMinor: 5100000,
    creditMinor: 0,
    organizationId,
    expectedPlan: "BUSINESS",
    expectedPeriodEnd: null,
    sourcePeriodId: null,
    startsAt: "2027-01-01T00:00:00.000Z",
    endsAt: "2028-01-01T00:00:00.000Z",
    cycleStartsAt: "2027-01-01T00:00:00.000Z",
    cycleEndsAt: "2028-01-01T00:00:00.000Z",
    anchorDay: 1,
    issuedAt: "2027-01-01T00:00:00.000Z",
    expiresAt: "2027-01-01T00:15:00.000Z",
  } as unknown,
  invoice: {
    organizationId,
    status: "PAID",
    isTest: false,
    currency: "KGS",
    paidAt: new Date("2027-01-01T00:00:00.000Z"),
    providerPaymentId: "123",
    amountMinor: 5100000,
    events: [{ state: "PAID", source: "CALLBACK" }],
  },
});

describe("confirmed paid MRR from current verified contracts", () => {
  it("uses actual annual discounted money including add-ons, not legacy list price", () => {
    expect(summarizeConfirmedPaidMrr([org()], [period()], now)).toEqual({
      organizationsPaid: 1,
      confirmedPaidMrrKgs: 4250,
    });
  });
  it("normalizes a half-year prepayment once and does not count future renewals yet", () => {
    const p = period();
    const snapshot = p.purchaseSnapshot as Record<string, unknown>;
    Object.assign(snapshot, { months: 6, discountBps: 500, amountMinor: 2850000 });
    p.invoice.amountMinor = 2850000;
    const future = period("future");
    future.startsAt = new Date("2028-01-01T00:00:00.000Z");
    expect(summarizeConfirmedPaidMrr([org()], [p, future], now)).toEqual({
      organizationsPaid: 1,
      confirmedPaidMrrKgs: 4750,
    });
  });
  it("counts only the replacement monthly value after an upgrade, without double-counting overlapping periods or treating the top-up as full revenue", () => {
    const upgraded = period("upgrade");
    upgraded.startsAt = new Date("2027-06-01T00:00:00.000Z");
    upgraded.invoice.amountMinor = 765000;
    Object.assign(upgraded.purchaseSnapshot as object, {
      kind: "UPGRADE",
      monthlyMinor: 650000,
      amountMinor: 765000,
      creditMinor: 1000000,
    });
    expect(summarizeConfirmedPaidMrr([org()], [period(), upgraded], now)).toEqual({
      organizationsPaid: 1,
      confirmedPaidMrrKgs: 5525,
    });
  });
  it("supports original one-month paid invoices without a v2 snapshot", () => {
    const p = period();
    p.purchaseSnapshot = null;
    p.invoice.amountMinor = 175000;
    expect(summarizeConfirmedPaidMrr([org()], [p], now)).toEqual({
      organizationsPaid: 1,
      confirmedPaidMrrKgs: 1750,
    });
  });
  it("does not invent revenue from manual ACTIVE access", () => {
    expect(summarizeConfirmedPaidMrr([org()], [], now)).toEqual({
      organizationsPaid: 0,
      confirmedPaidMrrKgs: 0,
    });
  });
  it.each([
    { status: "REVIEW" },
    { status: "RESOLVED" },
    { status: "PENDING" },
    { status: "FAILED" },
    { isTest: true },
    { currency: "USD" },
    { paidAt: null },
    { providerPaymentId: null },
    { amountMinor: 0 },
    { events: [] },
    { events: [{ state: "PAID", source: "MANUAL" }] },
    { organizationId: "other-org" },
  ])("excludes unverified, test, reviewed and mismatched invoice %j", (change) => {
    const p = period();
    Object.assign(p.invoice, change);
    expect(summarizeConfirmedPaidMrr([org()], [p], now)).toEqual({
      organizationsPaid: 0,
      confirmedPaidMrrKgs: 0,
    });
  });
  it("does not fall back to an earlier paid period when the current upgrade is under refund review", () => {
    const current = period("current");
    current.startsAt = new Date("2027-06-01T00:00:00.000Z");
    current.invoice.status = "REVIEW";
    expect(summarizeConfirmedPaidMrr([org()], [period(), current], now)).toEqual({
      organizationsPaid: 0,
      confirmedPaidMrrKgs: 0,
    });
  });
  it.each(["PAST_DUE", "CANCELED"])(
    "excludes inactive %s access even with historical payment",
    (status) => {
      expect(
        summarizeConfirmedPaidMrr([{ ...org(), subscriptionStatus: status }], [period()], now)
          .organizationsPaid,
      ).toBe(0);
    },
  );
  it("excludes every protected lifetime identity and a contract lifetime grant after renaming", () => {
    const id = [...LIFETIME_ORGANIZATION_IDS][0]!;
    expect(
      summarizeConfirmedPaidMrr([org(id)], [period("friend", id)], now).organizationsPaid,
    ).toBe(0);
    expect(
      summarizeConfirmedPaidMrr(
        [{ ...org(), subscriptionContract: { lifetimeAccess: true } }],
        [period()],
        now,
      ).organizationsPaid,
    ).toBe(0);
  });
  it("excludes an expired period at its exact end and malformed snapshots", () => {
    const p = period();
    p.endsAt = now;
    expect(summarizeConfirmedPaidMrr([org()], [p], now).organizationsPaid).toBe(0);
    p.endsAt = new Date("2028-01-01T00:00:00.000Z");
    p.purchaseSnapshot = { version: 0 };
    expect(summarizeConfirmedPaidMrr([org()], [p], now).organizationsPaid).toBe(0);
  });
});
