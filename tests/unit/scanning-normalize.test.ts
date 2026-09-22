import { describe, expect, it } from "vitest";

import { equivalentRetailBarcode, normalizeScanValue } from "@/lib/scanning/normalize";

describe("normalizeScanValue", () => {
  it("keeps leading zeros while trimming and removing spaces", () => {
    expect(normalizeScanValue("  00 0123  ")).toBe("000123");
  });

  it("strips non-printable characters", () => {
    expect(normalizeScanValue("\u0002ABC-123\u0003\n")).toBe("ABC-123");
  });
});

it("resolves UPC/EAN equivalence without dropping stored leading zeroes", () => {
  expect(equivalentRetailBarcode("0012345678905")).toBe("012345678905");
  expect(equivalentRetailBarcode("012345678905")).toBe("0012345678905");
  expect(equivalentRetailBarcode("0012345678906")).toBeNull();
  expect(normalizeScanValue("0012345678905")).toBe("0012345678905");
});
