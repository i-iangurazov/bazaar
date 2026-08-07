import { describe, expect, it } from "vitest";

import {
  addBusinessDays,
  businessDateKey,
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
    expect(businessDateKey(bounds.sevenDaysStart)).toBe("2026-07-16");
    expect(addBusinessDays(bounds.today, -6)).toBe("2026-07-16");
    expect(addBusinessDays(bounds.today, 1)).toBe("2026-07-23");
  });

  it("keeps POS date filters on the Bishkek calendar day at the UTC boundary", () => {
    expect(businessDateKey(new Date("2026-07-21T17:59:59.999Z"))).toBe("2026-07-21");
    expect(businessDateKey(new Date("2026-07-21T18:00:00.000Z"))).toBe("2026-07-22");
    expect(addBusinessDays("2026-07-22", -30)).toBe("2026-06-22");

    const from = businessDateOnlyToUtc("2026-07-22");
    const to = businessDateOnlyEndUtc("2026-07-22");
    expect(from.toISOString()).toBe("2026-07-21T18:00:00.000Z");
    expect(to.toISOString()).toBe("2026-07-22T17:59:59.999Z");
  });

  it("rejects malformed and impossible calendar dates", () => {
    expect(() => businessDateOnlyToUtc("2026/07/22")).toThrow("invalidDateOnly");
    expect(() => businessDateOnlyToUtc("2026-02-30")).toThrow("invalidDateOnly");
    expect(() => addBusinessDays("2026-07-22", 0.5)).toThrow("invalidBusinessDayOffset");
  });
});
