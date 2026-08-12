import { describe, expect, it } from "vitest";

import {
  normalizeCustomerImportAddress,
  normalizeCustomerPhone,
} from "@/server/services/customers";
import {
  isValidOptionalCustomerAddress,
  isValidOptionalCustomerPhone,
  normalizeCustomerContactAddress,
  normalizeCustomerContactPhone,
} from "@/lib/customerContact";

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

  it("normalizes valid international phones and rejects incomplete values", () => {
    expect(normalizeCustomerContactPhone("'+996 (555) 123-456")).toBe("+996555123456");
    expect(normalizeCustomerContactPhone("+33 1 42 68 53 00")).toBe("+33142685300");
    expect(isValidOptionalCustomerPhone(null)).toBe(true);
    expect(isValidOptionalCustomerPhone("+996 555")).toBe(false);
    expect(isValidOptionalCustomerPhone("555 123 456")).toBe(false);
  });

  it("normalizes valid addresses and rejects one-character, punctuation-only, or control values", () => {
    expect(normalizeCustomerContactAddress("  Bishkek,  Chui  1  ")).toBe("Bishkek, Chui 1");
    expect(isValidOptionalCustomerAddress("")).toBe(true);
    expect(normalizeCustomerContactAddress("я")).toBeNull();
    expect(isValidOptionalCustomerAddress("я")).toBe(false);
    expect(isValidOptionalCustomerAddress("---")).toBe(false);
    expect(isValidOptionalCustomerAddress("Bishkek\u0000Chui 1")).toBe(false);
  });
});
