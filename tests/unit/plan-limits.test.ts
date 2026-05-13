import { describe, expect, it } from "vitest";

import { resolveOrganizationAccessState } from "@/server/services/planLimits";

describe("organization access state", () => {
  const now = new Date("2026-05-13T12:00:00.000Z");
  const past = new Date("2026-05-12T12:00:00.000Z");
  const future = new Date("2026-05-14T12:00:00.000Z");

  it("does not let an expired trial block an active approved enterprise plan", () => {
    expect(
      resolveOrganizationAccessState(
        {
          plan: "ENTERPRISE",
          subscriptionStatus: "ACTIVE",
          trialEndsAt: past,
          currentPeriodEndsAt: past,
        },
        now,
      ),
    ).toMatchObject({
      subscriptionActive: true,
      trialActive: false,
      trialExpired: false,
      hasAccess: true,
    });
  });

  it("blocks a trial-only starter account after trial and period end", () => {
    expect(
      resolveOrganizationAccessState(
        {
          plan: "STARTER",
          subscriptionStatus: "ACTIVE",
          trialEndsAt: past,
          currentPeriodEndsAt: past,
        },
        now,
      ),
    ).toMatchObject({
      subscriptionActive: false,
      trialActive: false,
      trialExpired: true,
      hasAccess: false,
    });
  });

  it("keeps starter access when there is an active paid period after trial", () => {
    expect(
      resolveOrganizationAccessState(
        {
          plan: "STARTER",
          subscriptionStatus: "ACTIVE",
          trialEndsAt: past,
          currentPeriodEndsAt: future,
        },
        now,
      ),
    ).toMatchObject({
      subscriptionActive: true,
      trialExpired: false,
      hasAccess: true,
    });
  });

  it("keeps trial access before trial expiry without marking it as paid subscription", () => {
    expect(
      resolveOrganizationAccessState(
        {
          plan: "STARTER",
          subscriptionStatus: "ACTIVE",
          trialEndsAt: future,
          currentPeriodEndsAt: future,
        },
        now,
      ),
    ).toMatchObject({
      subscriptionActive: false,
      trialActive: true,
      trialExpired: false,
      hasAccess: true,
    });
  });

  it("blocks inactive paid statuses even when plan is upgraded", () => {
    expect(
      resolveOrganizationAccessState(
        {
          plan: "ENTERPRISE",
          subscriptionStatus: "PAST_DUE",
          trialEndsAt: past,
          currentPeriodEndsAt: future,
        },
        now,
      ),
    ).toMatchObject({
      subscriptionActive: false,
      trialActive: false,
      trialExpired: true,
      hasAccess: false,
    });
  });
});
