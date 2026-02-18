import { describe, expect, it } from "vitest";

import {
  buildGeneratedBarcodeCandidate,
  computeEan13CheckDigit,
  isValidEan13,
  resolveBarcodeRenderSpec,
  resolveUniqueGeneratedBarcode,
} from "@/server/services/barcodes";

describe("barcodes helpers", () => {
  it("computes EAN-13 check digit correctly", () => {
    expect(computeEan13CheckDigit("590123412345")).toBe("7");
    expect(isValidEan13("5901234123457")).toBe(true);
  });

  it("prefers EAN-13 rendering for valid numeric values", () => {
    const spec = resolveBarcodeRenderSpec("5901234123457");
    expect(spec).toEqual({ bcid: "ean13", text: "5901234123457" });
  });

  it("falls back to CODE128 for non EAN values", () => {
    const spec = resolveBarcodeRenderSpec("SKU-ABC-001");
    expect(spec).toEqual({ bcid: "code128", text: "SKU-ABC-001" });
  });

  it("resolves unique generated barcode under collisions", async () => {
    const taken = new Set<string>([
      buildGeneratedBarcodeCandidate({
        organizationId: "org-1",
        mode: "EAN13",
        sequence: 100,
      }),
      buildGeneratedBarcodeCandidate({
        organizationId: "org-1",
        mode: "EAN13",
        sequence: 101,
      }),
    ]);

    const resolved = await resolveUniqueGeneratedBarcode({
      organizationId: "org-1",
      mode: "EAN13",
      startSequence: 100,
      isTaken: async (value) => taken.has(value),
    });

    expect(taken.has(resolved)).toBe(false);
    expect(/^\d{13}$/.test(resolved)).toBe(true);
  });
});
