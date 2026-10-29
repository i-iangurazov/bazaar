import { describe, expect, it } from "vitest";
import { resolveStoreSellingPrice } from "@/server/services/storeSellingPrice";

describe("store selling price precedence", () => {
  it("preserves ordinary retail, including zero, before wholesale fallback", () => {
    for (const standard of [325, 0]) {
      expect(
        resolveStoreSellingPrice({ enabled: true, mode: "RETAIL", standard, wholesale: 300 }),
      ).toEqual({ price: standard, source: "STANDARD" });
    }
    expect(
      resolveStoreSellingPrice({
        enabled: true,
        mode: "RETAIL",
        standard: 325,
        retail: 350,
        wholesale: 300,
      }),
    ).toEqual({ price: 350, source: "RETAIL" });
  });

  it("keeps wholesale mode and the legacy fallback when no ordinary price exists", () => {
    expect(
      resolveStoreSellingPrice({ enabled: true, mode: "WHOLESALE", standard: 325, wholesale: 0 }),
    ).toEqual({ price: 0, source: "WHOLESALE" });
    expect(
      resolveStoreSellingPrice({ enabled: true, mode: "RETAIL", standard: null, wholesale: 300 }),
    ).toEqual({ price: 300, source: "WHOLESALE" });
    expect(
      resolveStoreSellingPrice({
        enabled: true,
        mode: "RETAIL",
        standard: 0,
        preferStandard: false,
        wholesale: 300,
      }),
    ).toEqual({ price: 300, source: "WHOLESALE" });
    expect(
      resolveStoreSellingPrice({
        enabled: false,
        mode: "RETAIL",
        standard: 325,
        retail: 350,
        wholesale: 300,
      }),
    ).toEqual({ price: 325, source: "STANDARD" });
  });
});
