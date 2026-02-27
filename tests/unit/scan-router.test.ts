import { describe, expect, it } from "vitest";

import { shouldSubmitFromKey } from "@/lib/scanning/scanRouter";

describe("shouldSubmitFromKey", () => {
  it("always submits on Enter when input is non-empty", () => {
    expect(
      shouldSubmitFromKey({
        key: "Enter",
        supportsTabSubmit: false,
        normalizedValue: "000123",
      }),
    ).toBe("enter");
  });

  it("submits on Tab only when enabled and above threshold", () => {
    expect(
      shouldSubmitFromKey({
        key: "Tab",
        supportsTabSubmit: true,
        tabSubmitMinLength: 1,
        normalizedValue: "7",
      }),
    ).toBe("tab");

    expect(
      shouldSubmitFromKey({
        key: "Tab",
        supportsTabSubmit: true,
        tabSubmitMinLength: 4,
        normalizedValue: "7",
      }),
    ).toBeNull();
  });
});
