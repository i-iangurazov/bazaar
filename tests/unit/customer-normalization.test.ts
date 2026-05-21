import { describe, expect, it } from "vitest";

import {
  normalizeCustomerImportAddress,
  normalizeCustomerPhone,
} from "@/server/services/customers";

describe("customer normalization", () => {
  it("removes spreadsheet text markers from phone numbers", () => {
    expect(normalizeCustomerPhone("'+447444415829")).toBe("+447444415829");
    expect(normalizeCustomerPhone("’+447444415829")).toBe("+447444415829");
    expect(normalizeCustomerPhone("\uFEFF+447444415829")).toBe("+447444415829");
  });

  it("combines split import address fields into one customer address", () => {
    expect(
      normalizeCustomerImportAddress({
        address1: "Default Address Address1",
        address2: "Default Address Address2",
        address: "Address",
        city: "Bishkek",
        province: "Chuy",
        country: "KG",
        zip: "720000",
      }),
    ).toBe(
      "Default Address Address1, Default Address Address2, Address, Bishkek, Chuy, KG, 720000",
    );
  });
});
