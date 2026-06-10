import { describe, expect, it } from "vitest";

import { moneyInputsEqual, moneyToMinorUnits, parseMoneyInput } from "@/lib/moneyInput";

describe("money input parsing", () => {
  it("normalizes cashier-entered and formatted KGS values", () => {
    expect(parseMoneyInput("8 545,00 сом")).toBe(8545);
    expect(parseMoneyInput("8545")).toBe(8545);
    expect(parseMoneyInput("8545.00")).toBe(8545);
    expect(parseMoneyInput("8,545.00 KGS")).toBe(8545);
    expect(parseMoneyInput("8.545,00")).toBe(8545);
  });

  it("rejects invalid or negative values without producing NaN", () => {
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("-10")).toBeNull();
    expect(parseMoneyInput("сом")).toBeNull();
  });

  it("compares equivalent display values by minor units", () => {
    expect(moneyInputsEqual("8 545,00 сом", "8545")).toBe(true);
    expect(moneyInputsEqual("8545.004", "8545")).toBe(true);
    expect(moneyInputsEqual("8545.02", "8545")).toBe(false);
    expect(moneyToMinorUnits(8545.005)).toBe(854501);
  });
});
