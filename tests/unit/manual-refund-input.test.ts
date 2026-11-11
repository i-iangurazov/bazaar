import { describe, expect, it } from "vitest";
import {
  manualRefundBankDateValid,
  manualRefundBankOperationValid,
  parseManualRefundAmountMinor,
} from "@/lib/billing/manualRefundInput";

describe("manual bank refund amount entry", () => {
  it.each([
    ["68,50", 6850],
    ["68.5", 6850],
    ["0,01", 1],
    ["2000", 200000],
    [" 20.05 ", 2005],
    ["00068,5", 6850],
    ["21474836.47", 2147483647],
  ])("parses %s exactly in minor units", (draft, expected) => {
    expect(parseManualRefundAmountMinor(String(draft))).toBe(expected);
  });
  it.each([
    "",
    "0",
    "0.00",
    "-1",
    "+1",
    "68,",
    "68.",
    "68,505",
    "1,000",
    "1 000",
    "1,234.50",
    "1.2.3",
    ".5",
    "1e3",
    "Infinity",
    "21474836.48",
    "999999999999999999",
  ])("rejects %s without rounding or removing separators", (draft) => {
    expect(parseManualRefundAmountMinor(draft)).toBeNull();
  });
});

describe("manual refund bank document fields", () => {
  const paid = new Date("2026-11-10T19:00:00Z"); // 11 November in Bishkek.
  const now = new Date("2026-11-11T20:00:00Z"); // 12 November in Bishkek.
  it.each(["2026-11-11", "2026-11-12"])("accepts bank day %s", (value) => {
    expect(manualRefundBankDateValid(value, paid, now)).toBe(true);
  });
  it.each(["2026-11-10", "2026-11-13", "2026-02-30", "2026-13-01", "2026-1-12", ""])(
    "rejects invalid, pre-payment or future bank day %s",
    (value) => {
      expect(manualRefundBankDateValid(value, paid, now)).toBe(false);
    },
  );
  it("accepts a real leap day and rejects an invalid paid date", () => {
    expect(
      manualRefundBankDateValid(
        "2028-02-29",
        "2028-02-28T00:00:00Z",
        new Date("2028-03-01T00:00:00Z"),
      ),
    ).toBe(true);
    expect(manualRefundBankDateValid("2026-11-11", "invalid", now)).toBe(false);
  });
  it.each(["BANK-001", "  bank 001  ", "БАНК-123"])("accepts reference %s", (value) => {
    expect(manualRefundBankOperationValid(value)).toBe(true);
  });
  it.each(["", "ab", "a b", "a\tb", "abc\nxyz", "x".repeat(121)])(
    "rejects invalid reference %j",
    (value) => {
      expect(manualRefundBankOperationValid(value)).toBe(false);
    },
  );
});
