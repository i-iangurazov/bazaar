import { describe, expect, it } from "vitest";

import { normalizeLoginPhone } from "@/lib/loginPhone";

describe("login phone normalization", () => {
  it.each([
    "+996 555 123 456", "(0555) 123-456", "555123456", "996555123456", "00996555123456",
  ])("normalizes %s to one Kyrgyz login identity", (phone) => {
    expect(normalizeLoginPhone(phone)).toBe("+996555123456");
  });

  it("keeps complete international numbers distinct", () => {
    expect(normalizeLoginPhone("+44 7700 900123")).toBe("+447700900123");
  });

  it.each([
    "", "1234", "+9960555123456", "555123456 ext 2", "555123456+", "+0000000000", "user@example.invalid",
  ])("rejects an invalid or ambiguous identifier %s", (phone) => {
    expect(normalizeLoginPhone(phone)).toBeNull();
  });
});
