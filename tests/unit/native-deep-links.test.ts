import { describe, expect, it } from "vitest";

import { parseNativeDeepLink } from "@/lib/native/deepLinks";
import { compareAppVersions } from "@/lib/native/version";

describe("native deep links", () => {
  it.each([
    ["bazaar://pos", "/pos/sell"],
    ["bazaar://orders/order_123", "/sales/orders/order_123"],
    ["bazaar://orders", "/sales/orders"],
    ["bazaar://products/product-1", "/products/product-1"],
    [
      "https://www.bazaar.kg/inventory/receiving?storeId=store-1",
      "/inventory/receiving?storeId=store-1",
    ],
    ["https://bazaar.kg/help/pos/make-sale", "/help/pos/make-sale"],
  ])("maps %s to an authorized in-app route", (input, expected) => {
    expect(parseNativeDeepLink(input)).toBe(expected);
  });

  it.each([
    "bazaar://unknown/delete-everything",
    "https://evil.example/products/1",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://www.bazaar.kg/api/mobile/devices",
    "bazaar://orders/%2F%2Fevil.example",
  ])("rejects unsafe or unsupported link %s", (input) => {
    expect(parseNativeDeepLink(input)).toBeNull();
  });
});

describe("native compatibility versions", () => {
  it("compares semantic version cores", () => {
    expect(compareAppVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareAppVersions("1.2.0", "1.1.9")).toBe(1);
    expect(compareAppVersions("1.0.9", "1.1.0")).toBe(-1);
    expect(compareAppVersions("2.0.0-beta.1", "1.9.9")).toBe(1);
  });
});
