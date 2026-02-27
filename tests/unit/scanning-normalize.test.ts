import { describe, expect, it } from "vitest";

import { normalizeScanValue } from "@/lib/scanning/normalize";

describe("normalizeScanValue", () => {
  it("keeps leading zeros while trimming and removing spaces", () => {
    expect(normalizeScanValue("  00 0123  ")).toBe("000123");
  });

  it("strips non-printable characters", () => {
    expect(normalizeScanValue("\u0002ABC-123\u0003\n")).toBe("ABC-123");
  });
});
