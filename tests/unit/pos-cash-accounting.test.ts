import { describe, expect, it } from "vitest";

import {
  calculateCashDiscrepancyKgs,
  calculateExpectedCashKgs,
  resolveCashDifferenceStatus,
} from "@/server/services/posCashAccounting";

describe("pos cash accounting", () => {
  it("calculates expected cash from opening cash, cash sales, refunds and drawer movements", () => {
    expect(
      calculateExpectedCashKgs({
        openingCashKgs: 1_000,
        payInKgs: 250.5,
        payOutKgs: 100,
        cashSalesKgs: 2_450.25,
        cashRefundsKgs: 300.1,
      }),
    ).toBe(3_300.65);
  });

  it("calculates surplus and shortage against expected cash", () => {
    expect(calculateCashDiscrepancyKgs({ countedCashKgs: 3_310.65, expectedCashKgs: 3_300.65 })).toBe(10);
    expect(resolveCashDifferenceStatus(10)).toBe("SURPLUS");
    expect(resolveCashDifferenceStatus(-5)).toBe("SHORTAGE");
    expect(resolveCashDifferenceStatus(0)).toBe("BALANCED");
  });
});
