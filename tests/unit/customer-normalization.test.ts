import { describe, expect, it } from "vitest";

import { normalizeCustomerPhone } from "@/server/services/customers";

describe("customer normalization", () => {
  it("removes spreadsheet text markers from phone numbers", () => {
    expect(normalizeCustomerPhone("'+447444415829")).toBe("+447444415829");
    expect(normalizeCustomerPhone("’+447444415829")).toBe("+447444415829");
    expect(normalizeCustomerPhone("\uFEFF+447444415829")).toBe("+447444415829");
  });
});
