import { describe, expect, it } from "vitest";
import { LIFETIME_ORGANIZATION_IDS } from "@/server/billing/lifetimeOrganizations";
import { subscriptionReminderContent } from "@/server/billing/reminderContent";
import {
  canRetrySubscriptionReminder,
  subscriptionReminderKey,
  subscriptionReminderState,
} from "@/server/billing/reminderPolicy";

const end = new Date("2027-02-01T00:00:00.000Z");
const now = new Date(end.getTime() - 2 * 86400000);
const org = () => ({
  id: "synthetic-reminder-org",
  subscriptionBillingMode: "SELF_SERVE",
  subscriptionStatus: "ACTIVE",
  currentPeriodEndsAt: end,
  trialEndsAt: null as Date | null,
  subscriptionContract: { catalogVersion: "2026-11", lifetimeAccess: false },
  subscriptionPeriods: [
    {
      endsAt: end,
      invoice: {
        status: "PAID",
        isTest: false,
        currency: "KGS",
        paidAt: new Date("2027-01-01"),
        providerPaymentId: "123",
        events: [{ state: "PAID", source: "RECONCILIATION" }],
      },
    },
  ],
});

describe("subscription reminder policy and frozen email copy", () => {
  it.each([
    [-4 * 86400000, null],
    [-3 * 86400000, "BEFORE_3"],
    [-86400000 - 1, "BEFORE_3"],
    [-86400000, "BEFORE_1"],
    [-1, "BEFORE_1"],
    [0, "GRACE"],
    [7 * 86400000 - 1, "GRACE"],
    [7 * 86400000, "READ_ONLY"],
  ] as const)("selects exactly one paid phase at end offset %s", (offset, kind) => {
    expect(subscriptionReminderState(org(), new Date(end.getTime() + offset))?.kind ?? null).toBe(
      kind,
    );
  });
  it("uses the unpaid trial boundary without granting or mentioning paid grace", () => {
    const trial = { ...org(), subscriptionPeriods: [], trialEndsAt: end };
    expect(subscriptionReminderState(trial, now)).toMatchObject({
      source: "TRIAL",
      kind: "BEFORE_3",
      graceEndsAt: null,
    });
    expect(subscriptionReminderState(trial, end)).toMatchObject({
      source: "TRIAL",
      kind: "READ_ONLY",
      graceEndsAt: null,
    });
  });
  it.each([
    { subscriptionBillingMode: "MANUAL" },
    { subscriptionStatus: "CANCELED" },
    { subscriptionContract: { catalogVersion: "2026-10", lifetimeAccess: false } },
    { subscriptionContract: { catalogVersion: "2026-11", lifetimeAccess: true } },
    { subscriptionContract: null },
  ])("excludes manual, legacy, canceled and lifetime contracts %j", (changes) => {
    expect(subscriptionReminderState({ ...org(), ...changes }, now)).toBeNull();
  });
  it.each([...LIFETIME_ORGANIZATION_IDS])("never reminds protected friend identity %s", (id) => {
    expect(subscriptionReminderState({ ...org(), id }, now)).toBeNull();
  });
  it.each([
    { status: "REVIEW" },
    { isTest: true },
    { currency: "USD" },
    { paidAt: null },
    { providerPaymentId: null },
    { events: [] },
  ])("does not remind from an unconfirmed paid tail %j", (change) => {
    const value = org();
    Object.assign(value.subscriptionPeriods[0].invoice, change);
    expect(subscriptionReminderState(value, now)).toBeNull();
  });
  it("does not notify a shorter trial after renewal or ignore a manual date extension", () => {
    const value = org();
    value.trialEndsAt = new Date(end.getTime() - 5 * 86400000);
    expect(subscriptionReminderState(value, now)?.source).toBe("PAID");
    value.currentPeriodEndsAt = new Date(end.getTime() + 86400000);
    expect(subscriptionReminderState(value, now)).toBeNull();
    expect(subscriptionReminderState({ ...value, subscriptionPeriods: [] }, now)).toBeNull();
  });
  it("uses stable per-owner, phase and access-boundary keys without recipient PII", () => {
    const state = subscriptionReminderState(org(), now)!;
    const key = subscriptionReminderKey("org", "owner", state);
    expect(subscriptionReminderKey("org", "owner", state)).toBe(key);
    expect(subscriptionReminderKey("org", "another-owner", state)).not.toBe(key);
    expect(subscriptionReminderKey("org", "owner", { ...state, kind: "BEFORE_1" })).not.toBe(key);
    expect(key).toMatch(/^subscription-reminder-v1-[a-f0-9]{64}$/);
  });
  it("stops retries before the provider's 24-hour idempotency retention expires", () => {
    expect(canRetrySubscriptionReminder(now, new Date(now.getTime() + 23 * 3600000 - 1))).toBe(
      true,
    );
    expect(canRetrySubscriptionReminder(now, new Date(now.getTime() + 23 * 3600000))).toBe(false);
  });
  it.each(["ru", "kg", "en"])(
    "produces escaped %s transactional text, a canonical billing link and no autocharge promise",
    (locale) => {
      for (const source of ["PAID", "TRIAL"] as const)
        for (const kind of ["BEFORE_3", "BEFORE_1", "GRACE", "READ_ONLY"] as const) {
          if (source === "TRIAL" && kind === "GRACE") continue;
          const copy = subscriptionReminderContent(
            {
              source,
              kind,
              accessEndsAt: end,
              graceEndsAt: source === "PAID" ? new Date(end.getTime() + 7 * 86400000) : null,
            },
            '<script>alert("x")</script>',
            locale,
          );
          expect(copy.locale).toBe(locale);
          expect(copy.html).not.toContain("<script>");
          expect(copy.html).toContain("https://bazaar.kg/billing");
          expect(copy.text).not.toMatch(/undefined|Invalid Date|\{(period|organization|date)\}/);
          expect(copy.html).not.toContain("unsubscribe");
        }
    },
  );
});
