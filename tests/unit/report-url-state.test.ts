import { describe, expect, it } from "vitest";

import { reportUrlState } from "@/lib/reporting";

const now = new Date("2026-09-30T06:00:00Z");

describe("report URL state", () => {
  it("defaults to the sales report with the current period", () => {
    const state = reportUrlState("", "sales", now);
    expect(state.valid).toBe(true);
    expect(state.report).toBe("sales");
    expect(state.onlineChannel).toBe("ONLINE");
    expect(state.source).toBe("all");
    expect(state.dateFrom).toBe("2026-09-01");
    expect(state.dateTo).toBe("2026-09-30");
  });

  it("accepts online report filters and keeps them in the URL state", () => {
    const state = reportUrlState(
      "dateFrom=2026-09-01&dateTo=2026-09-30&report=online&onlineChannel=UNKNOWN&source=API&sort=amount&direction=asc&page=2",
      "sales",
      now,
    );
    expect(state.valid).toBe(true);
    expect(state.report).toBe("online");
    expect(state.onlineChannel).toBe("UNKNOWN");
    expect(state.source).toBe("API");
    expect(state.sort).toBe("amount");
    expect(state.direction).toBe("asc");
    expect(state.page).toBe(2);
  });

  it("still accepts the existing sales filters", () => {
    const state = reportUrlState("dateFrom=2026-09-01&dateTo=2026-09-30&saleChannel=ONLINE&view=products&sort=revenue", "sales", now);
    expect(state.valid).toBe(true);
    expect(state.report).toBe("sales");
    expect(state.saleChannel).toBe("ONLINE");
    expect(state.view).toBe("products");
    expect(state.sort).toBe("revenue");
  });

  it.each([
    "dateFrom=2026-09-01&dateTo=2026-09-30&report=unknown",
    "dateFrom=2026-09-01&dateTo=2026-09-30&onlineChannel=WRONG",
    "dateFrom=2026-09-01&dateTo=2026-09-30&source=PARTNERS",
    "dateFrom=2026-09-01&dateTo=2026-09-30&sort=bogus",
    "dateFrom=2026-09-01&dateTo=2026-09-30&notAKey=1",
  ])("rejects invalid query %s", (query) => {
    expect(reportUrlState(query, "sales", now).valid).toBe(false);
  });
});
