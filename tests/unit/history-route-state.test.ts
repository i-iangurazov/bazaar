import { describe, expect, it } from "vitest";

import {
  readHistoryPagination,
  readStockCountHistoryRouteState,
  writeHistoryPagination,
  writeStockCountHistoryRouteState,
} from "@/lib/inventory/historyRouteState";

describe("history route state", () => {
  it("accepts only positive pages and supported page sizes", () => {
    expect(readHistoryPagination(new URLSearchParams("page=2&pageSize=50"))).toEqual({
      page: 2,
      pageSize: 50,
    });
    expect(readHistoryPagination(new URLSearchParams("page=-1&pageSize=500"))).toEqual({
      page: 1,
      pageSize: 25,
    });
  });

  it("validates stock-count store and status route state", () => {
    expect(
      readStockCountHistoryRouteState(
        new URLSearchParams("page=3&pageSize=10&storeId=store-1&status=APPLIED"),
      ),
    ).toEqual({ page: 3, pageSize: 10, storeId: "store-1", status: "APPLIED" });
    expect(readStockCountHistoryRouteState(new URLSearchParams("status=INVALID"))).toEqual({
      page: 1,
      pageSize: 25,
      storeId: "",
      status: "ALL",
    });
  });

  it("preserves unrelated query state while writing durable history state", () => {
    expect(
      writeHistoryPagination("tab=products&page=1", {
        page: 2,
        pageSize: 100,
      }),
    ).toBe("tab=products&page=2&pageSize=100");

    const filtered = new URLSearchParams(
      writeStockCountHistoryRouteState("tour=counts", {
        page: 2,
        pageSize: 10,
        storeId: "store-2",
        status: "IN_PROGRESS",
      }),
    );
    expect(Object.fromEntries(filtered)).toEqual({
      tour: "counts",
      page: "2",
      pageSize: "10",
      storeId: "store-2",
      status: "IN_PROGRESS",
    });

    const allStatuses = new URLSearchParams(
      writeStockCountHistoryRouteState(filtered.toString(), {
        page: 1,
        pageSize: 25,
        storeId: "store-2",
        status: "ALL",
      }),
    );
    expect(allStatuses.has("status")).toBe(false);
  });
});
