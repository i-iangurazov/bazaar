import { describe, expect, it } from "vitest";

import {
  readAuthorizedReportStoreId,
  reportStoreRouteNeedsCanonicalization,
  writeReportStoreRouteState,
} from "@/lib/reportsRouteState";

describe("reports route state", () => {
  const authorizedStoreIds = ["store-primary", "store-secondary"];

  it("accepts only a store in the loaded authorized store set", () => {
    expect(
      readAuthorizedReportStoreId(
        new URLSearchParams("storeId=store-secondary"),
        authorizedStoreIds,
      ),
    ).toBe("store-secondary");
    expect(
      readAuthorizedReportStoreId(new URLSearchParams("storeId=store-foreign"), authorizedStoreIds),
    ).toBe("");
    expect(readAuthorizedReportStoreId(new URLSearchParams(), authorizedStoreIds)).toBe("");
  });

  it("marks only non-empty unauthorized store parameters for canonicalization", () => {
    expect(
      reportStoreRouteNeedsCanonicalization(
        new URLSearchParams("storeId=store-foreign"),
        authorizedStoreIds,
      ),
    ).toBe(true);
    expect(
      reportStoreRouteNeedsCanonicalization(
        new URLSearchParams("storeId=store-primary"),
        authorizedStoreIds,
      ),
    ).toBe(false);
    expect(reportStoreRouteNeedsCanonicalization(new URLSearchParams(), authorizedStoreIds)).toBe(
      false,
    );
  });

  it("preserves unrelated report query state while setting or clearing the store", () => {
    expect(writeReportStoreRouteState("preset=last7&view=stock", "store-secondary")).toBe(
      "preset=last7&view=stock&storeId=store-secondary",
    );
    expect(writeReportStoreRouteState("preset=last7&storeId=store-secondary&view=stock", "")).toBe(
      "preset=last7&view=stock",
    );
  });
});
