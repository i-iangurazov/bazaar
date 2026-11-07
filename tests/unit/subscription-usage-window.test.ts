import { describe, expect, it, vi } from "vitest";
vi.mock("@/server/db/prisma", () => ({ prisma: {} }));
import { usageWindow } from "@/server/billing/subscriptionUsage";

describe("subscription quota calendar", () => {
  it("keeps prepaid trial usage outside the future paid month and resets at its actual start", () => {
    const input = { resource: "ai" as const, origin: new Date("2026-11-10T10:00:00Z"),
      trialOrigin: new Date("2026-10-27T10:00:00Z"), paidEnd: new Date("2027-11-10T10:00:00Z"), anchorDay: 10 };
    const trial = usageWindow({ ...input, now: new Date("2026-11-01T10:00:00Z") });
    expect(trial.startsAt.toISOString()).toBe("2026-10-27T10:00:00.000Z");
    expect(trial.endsAt.toISOString()).toBe("2026-11-10T10:00:00.000Z");
    const paid = usageWindow({ ...input, now: input.origin });
    expect(paid.startsAt.toISOString()).toBe("2026-11-10T10:00:00.000Z");
    expect(paid.endsAt.toISOString()).toBe("2026-12-10T10:00:00.000Z");
  });
  it.each([
    ["2027-02-28T10:00:00Z", "2027-02-28T10:00:00.000Z", "2027-03-31T10:00:00.000Z"],
    ["2027-03-30T10:00:00Z", "2027-02-28T10:00:00.000Z", "2027-03-31T10:00:00.000Z"],
    ["2027-03-31T10:00:00Z", "2027-03-31T10:00:00.000Z", "2027-04-30T10:00:00.000Z"],
  ])("restores a month-end anchor at %s", (now, start, end) => {
    const window = usageWindow({ resource: "ai", now: new Date(now), origin: new Date("2027-01-31T10:00:00Z") });
    expect(window.startsAt.toISOString()).toBe(start);
    expect(window.endsAt.toISOString()).toBe(end);
  });
  it("does not grant a new quota during grace after a prepaid term", () => {
    const window = usageWindow({ resource: "images", now: new Date("2028-02-02T00:00:00Z"),
      origin: new Date("2027-01-31T10:00:00Z"), paidEnd: new Date("2028-01-31T10:00:00Z") });
    expect(window.startsAt.toISOString()).toBe("2027-12-31T10:00:00.000Z");
    expect(window.endsAt.toISOString()).toBe("2028-01-31T10:00:00.000Z");
  });
  it("resets exchange budgets at midnight in Bishkek", () => {
    const window = usageWindow({ resource: "marketplaceRunsDaily", now: new Date("2027-01-02T19:00:00Z"),
      origin: new Date("2027-01-01T00:00:00Z") });
    expect(window.startsAt.toISOString()).toBe("2027-01-02T18:00:00.000Z");
    expect(window.endsAt.toISOString()).toBe("2027-01-03T18:00:00.000Z");
  });
});
