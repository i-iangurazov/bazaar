import { describe, expect, it } from "vitest";

import {
  detectPhoneCountryCode,
  extractNationalPhoneDigits,
  formatInternationalPhone,
  formatNationalPhone,
  isCompleteInternationalPhone,
} from "@/lib/phoneCountries";

describe("phone country formatting", () => {
  it("formats Kyrgyz phone numbers with a three-part mask", () => {
    expect(formatNationalPhone("555123456", "KG")).toBe("555 123 456");
    expect(formatInternationalPhone("KG", "555123456")).toBe("+996 555 123 456");
  });

  it("formats US phone numbers with ten national digits", () => {
    expect(formatNationalPhone("5551234567", "US")).toBe("555 123 4567");
    expect(formatInternationalPhone("US", "5551234567")).toBe("+1 555 123 4567");
  });

  it("detects the country code from an international value", () => {
    expect(detectPhoneCountryCode("+44 7700 900123")).toBe("GB");
    expect(detectPhoneCountryCode("+996 555 123 456")).toBe("KG");
    expect(detectPhoneCountryCode("+7 901 123 4567", "RU")).toBe("RU");
  });

  it("extracts only national digits for the selected country", () => {
    expect(extractNationalPhoneDigits("+996 555 123 456", "KG")).toBe("555123456");
    expect(extractNationalPhoneDigits("+1 555 123 4567", "US")).toBe("5551234567");
  });

  it("validates complete international values", () => {
    expect(isCompleteInternationalPhone("+996 555 123 456")).toBe(true);
    expect(isCompleteInternationalPhone("+996 555")).toBe(false);
    expect(isCompleteInternationalPhone("555 123 456")).toBe(false);
  });
});
