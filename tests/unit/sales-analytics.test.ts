import { describe, expect, it } from "vitest";

import { resolveSalesAnalyticsDateRange } from "@/server/services/salesAnalytics";

describe("sales analytics date range", () => {
  it("converts business-local date bounds to UTC for Asia/Bishkek", () => {
    const range = resolveSalesAnalyticsDateRange({
      dateFrom: "2026-06-20",
      dateTo: "2026-06-21",
    });

    expect(range.fromUtc.toISOString()).toBe("2026-06-19T18:00:00.000Z");
    expect(range.toUtcExclusive.toISOString()).toBe("2026-06-21T18:00:00.000Z");
    expect(range.dayCount).toBe(2);
  });

  it("rejects invalid or inverted ranges", () => {
    expect(() =>
      resolveSalesAnalyticsDateRange({ dateFrom: "2026-06-22", dateTo: "2026-06-20" }),
    ).toThrow("invalidInput");
    expect(() =>
      resolveSalesAnalyticsDateRange({ dateFrom: "2026/06/20", dateTo: "2026-06-20" }),
    ).toThrow("invalidInput");
  });
});
