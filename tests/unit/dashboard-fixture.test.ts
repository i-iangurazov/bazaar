import { describe, expect, it } from "vitest";

import { dashboardFixtureExpectation } from "../../scripts/ux/dashboard-fixture";

describe("dashboard fixture business dates", () => {
  it.each([
    {
      name: "counts a sale immediately before Bishkek midnight",
      completedAt: "2026-11-10T17:59:59Z",
      now: "2026-11-10T17:59:59.999Z",
      saleBusinessDate: "2026-11-10",
      currentBusinessDate: "2026-11-10",
      todaySales: 217,
      todayReceipts: 1,
    },
    {
      name: "keeps the sale on yesterday when the check crosses midnight",
      completedAt: "2026-11-10T17:59:59Z",
      now: "2026-11-10T18:00:00Z",
      saleBusinessDate: "2026-11-10",
      currentBusinessDate: "2026-11-11",
      todaySales: 0,
      todayReceipts: 0,
    },
    {
      name: "counts a sale completed exactly at Bishkek midnight on the new day",
      completedAt: "2026-11-10T18:00:00Z",
      now: "2026-11-10T18:00:01Z",
      saleBusinessDate: "2026-11-11",
      currentBusinessDate: "2026-11-11",
      todaySales: 217,
      todayReceipts: 1,
    },
  ])("$name", ({ name: _name, completedAt, now, ...expected }) => {
    expect(
      dashboardFixtureExpectation({ completedAt, now: new Date(now), saleTotal: 217 }),
    ).toEqual(expected);
  });

  it("accepts an actual Date completion and preserves its historical day", () => {
    expect(
      dashboardFixtureExpectation({
        completedAt: new Date("2026-11-10T23:59:59+06:00"),
        now: new Date("2026-11-11T00:02:00+06:00"),
        saleTotal: 217,
      }),
    ).toEqual({
      saleBusinessDate: "2026-11-10",
      currentBusinessDate: "2026-11-11",
      todaySales: 0,
      todayReceipts: 0,
    });
  });

  it.each([
    { completedAt: "invalid", now: new Date("2026-11-10T18:00:00Z") },
    { completedAt: "2026-11-10T17:59:59Z", now: new Date("invalid") },
  ])("rejects invalid dates instead of silently expecting zero", (input) => {
    expect(() => dashboardFixtureExpectation({ ...input, saleTotal: 217 })).toThrow(RangeError);
  });
});
