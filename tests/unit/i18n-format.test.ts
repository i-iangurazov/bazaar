import { describe, expect, it } from "vitest";

import { formatCurrencyKGS, formatDate, formatDateTime } from "@/lib/i18nFormat";

describe("localized report formatting", () => {
  it("keeps the report currency consumer localized for every supported locale", () => {
    expect(formatCurrencyKGS(160.92, "en")).toMatch(/KGS\s*160\.92/);
    expect(formatCurrencyKGS(160.92, "ru")).toBe("160,92\u00a0KGS");
    expect(formatCurrencyKGS(160.92, "kg")).toBe("160,92\u00a0сом");
  });

  it("keeps report timestamps on the Bishkek business-day boundary", () => {
    const value = "2026-08-30T18:00:00.000Z";

    expect(formatDateTime(value, "en")).toBe("Aug 31, 2026, 12:00 AM");
    expect(formatDateTime(value, "ru")).toBe("31 авг. 2026 г., 00:00");
    expect(formatDate(value, "kg")).toBe("2026-ж. 31-авг.");
    expect(formatDateTime(value, "kg")).toBe("2026-ж. 31-авг. 00:00");
  });
});
