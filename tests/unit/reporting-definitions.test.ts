import { describe, expect, it } from "vitest";
import { mapSalesTotals, reportPeriod } from "@/server/services/reporting/sales";

describe("reporting definitions", () => {
  it("uses exclusive Bishkek boundaries and compares identical elapsed durations", () => {
    const p = reportPeriod("2026-09-02", "2026-09-03", new Date("2026-09-03T06:00:00Z"));
    expect(p.from.toISOString()).toBe("2026-09-01T18:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-09-03T18:00:00.000Z");
    expect(p.previousFrom.toISOString()).toBe("2026-08-30T18:00:00.000Z");
    expect(p.previousUntil.toISOString()).toBe("2026-09-01T06:00:00.000Z");
    expect(p.partial).toBe(true);
    expect(+p.previousUntil - +p.previousFrom).toBe(+p.until - +p.from);
  });
  it("does not compare a future period with an invented elapsed interval", () => {
    const p = reportPeriod("2027-01-01", "2027-01-31", new Date("2026-09-03T06:00:00Z"));
    expect(p.comparisonAvailable).toBe(false);
    expect(+p.until).toBe(+p.from);
    expect(+p.previousUntil).toBe(+p.previousFrom);
  });
  it.each([
    ["2026-02-29", "2026-03-01"],
    ["2026-09-03", "2026-09-02"],
    ["2025-01-01", "2026-09-02"],
  ])("rejects invalid range %s — %s", (from, to) => {
    expect(() => reportPeriod(from, to)).toThrow("invalidInput");
  });
  it("distinguishes known zero from missing cost and undefined ratios", () => {
    expect(
      mapSalesTotals({ lineCount: 1, netSalesKgs: 100, knownCostKgs: 0, unknownCostLines: 0 }),
    ).toMatchObject({
      costKgs: 0,
      grossProfitKgs: 100,
      marginPercent: 100,
      markupPercent: null,
      coveragePercent: 100,
    });
    expect(mapSalesTotals({ lineCount: 1, netSalesKgs: 100, unknownCostLines: 1 })).toMatchObject({
      costKgs: null,
      grossProfitKgs: null,
      marginPercent: null,
      markupPercent: null,
      coveragePercent: 0,
    });
    expect(mapSalesTotals()).toMatchObject({
      averageReceiptKgs: null,
      marginPercent: null,
      coveragePercent: null,
    });
  });
});
