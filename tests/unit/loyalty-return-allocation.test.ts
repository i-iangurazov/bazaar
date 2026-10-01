import { describe, expect, it } from "vitest";
import { cumulativeReturnPoints } from "@/server/services/loyalty/returnAllocation";

describe("original receipt point allocation", () => {
  it("reverses one of three earned points for one of three equal units", () => {
    for (const returnedQty of [1, 2, 3]) expect(cumulativeReturnPoints(3, [{ weightKgs: "61.10", qty: 3, returnedQty }])).toBe(returnedQty);
  });
  it("uses original money weights and exact cumulative floors across lines", () => {
    expect(cumulativeReturnPoints(47, [{ weightKgs: "300", qty: 3, returnedQty: 1 }, { weightKgs: "650", qty: 7, returnedQty: 2 }])).toBe(14);
    expect(cumulativeReturnPoints(47, [{ weightKgs: "300", qty: 3, returnedQty: 3 }, { weightKgs: "650", qty: 7, returnedQty: 7 }])).toBe(47);
    expect(cumulativeReturnPoints(0, [{ weightKgs: "950", qty: 1, returnedQty: 1 }])).toBe(0);
  });
});
