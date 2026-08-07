import { describe, expect, it } from "vitest";

import {
  buildPosFilterHref,
  readPosDateParam,
  readPosEnumParam,
  readPosPageParam,
} from "@/lib/posUrlFilters";

describe("POS URL filters", () => {
  it("keeps unrelated route context while replacing filters", () => {
    expect(
      buildPosFilterHref("/pos/history", "registerId=reg-1&q=old&page=3", {
        q: "new value",
        page: null,
        status: "CANCELED",
      }),
    ).toBe("/pos/history?registerId=reg-1&q=new+value&status=CANCELED");
  });

  it("rejects invalid enum, page, and calendar values", () => {
    const params = new URLSearchParams("status=UNKNOWN&page=-2&from=2026-02-30");
    expect(readPosEnumParam(params, "status", ["ALL", "SENT"] as const, "ALL")).toBe("ALL");
    expect(readPosPageParam(params, "page")).toBe(1);
    expect(readPosDateParam(params, "from", "2026-07-01")).toBe("2026-07-01");
  });

  it("restores valid filter values", () => {
    const params = new URLSearchParams("status=SENT&page=4&from=2026-07-22");
    expect(readPosEnumParam(params, "status", ["ALL", "SENT"] as const, "ALL")).toBe("SENT");
    expect(readPosPageParam(params, "page")).toBe(4);
    expect(readPosDateParam(params, "from", "")).toBe("2026-07-22");
  });
});
