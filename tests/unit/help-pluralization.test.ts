import { describe, expect, it } from "vitest";

import { formatGuideCount } from "@/content/help/ui";

describe("Bazaar Guide article count localization", () => {
  it.each([
    [1, "1 инструкция"],
    [2, "2 инструкции"],
    [5, "5 инструкций"],
    [21, "21 инструкция"],
    [24, "24 инструкции"],
    [11, "11 инструкций"],
  ] as const)("uses Russian plural rules for %i", (count, expected) => {
    expect(formatGuideCount(count, "ru")).toBe(expected);
  });

  it("keeps Kyrgyz and English labels grammatically stable", () => {
    expect(formatGuideCount(1, "kg")).toBe("1 нускама");
    expect(formatGuideCount(4, "kg")).toBe("4 нускама");
    expect(formatGuideCount(1, "en")).toBe("1 guide");
    expect(formatGuideCount(4, "en")).toBe("4 guides");
  });
});
