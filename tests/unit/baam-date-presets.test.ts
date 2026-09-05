import { describe, expect, it } from "vitest";
import { baamPresetRange } from "@/lib/baamDatePresets";

describe("BAAM complete business-calendar presets", () => {
  it("uses two complete calendar months rather than a rolling sixty days", () => {
    expect(baamPresetRange("last2Months", "2026-09-05")).toEqual({ dateFrom: "2026-07-01", dateTo: "2026-08-31" });
  });
  it("crosses the year and includes leap-day in the prior month", () => {
    expect(baamPresetRange("last2Months", "2026-01-01")).toEqual({ dateFrom: "2025-11-01", dateTo: "2025-12-31" });
    expect(baamPresetRange("lastMonth", "2024-03-31")).toEqual({ dateFrom: "2024-02-01", dateTo: "2024-02-29" });
  });
  it("excludes the incomplete current day from rolling day presets", () => {
    expect(baamPresetRange("last7", "2026-01-03")).toEqual({ dateFrom: "2025-12-27", dateTo: "2026-01-02" });
    expect(baamPresetRange("last30", "2024-03-01")).toEqual({ dateFrom: "2024-01-31", dateTo: "2024-02-29" });
  });
  it("includes today when this month is explicitly selected", () => {
    expect(baamPresetRange("thisMonth", "2026-09-05")).toEqual({ dateFrom: "2026-09-01", dateTo: "2026-09-05" });
  });
});
