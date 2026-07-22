import { describe, expect, it } from "vitest";

import {
  businessDateOnlyEndUtc,
  businessDateOnlyToUtc,
  resolveBusinessDayBounds,
} from "@/lib/timezone";

describe("Bishkek business time boundaries", () => {
  it("converts date-only bounds independently of the server timezone", () => {
    expect(businessDateOnlyToUtc("2026-07-22").toISOString()).toBe("2026-07-21T18:00:00.000Z");
    expect(businessDateOnlyEndUtc("2026-07-22").toISOString()).toBe("2026-07-22T17:59:59.999Z");
  });

  it("resolves current, previous, and seven-day bounds from Bishkek local time", () => {
    const bounds = resolveBusinessDayBounds(new Date("2026-07-22T06:00:00.000Z"));
    expect(bounds.today).toBe("2026-07-22");
    expect(bounds.todayStart.toISOString()).toBe("2026-07-21T18:00:00.000Z");
    expect(bounds.tomorrowStart.toISOString()).toBe("2026-07-22T18:00:00.000Z");
    expect(bounds.yesterdayStart.toISOString()).toBe("2026-07-20T18:00:00.000Z");
    expect(bounds.sevenDaysStart.toISOString()).toBe("2026-07-15T18:00:00.000Z");
  });

  it("rejects malformed and impossible calendar dates", () => {
    expect(() => businessDateOnlyToUtc("2026/07/22")).toThrow("invalidDateOnly");
    expect(() => businessDateOnlyToUtc("2026-02-30")).toThrow("invalidDateOnly");
  });
});
