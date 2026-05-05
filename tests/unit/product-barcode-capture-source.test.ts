import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("product barcode capture source", () => {
  it("keeps product create/edit barcode fields scanner friendly", async () => {
    const source = await readSource("src/components/product-form.tsx");

    expect(source).toContain("normalizeScanValue");
    expect(source).toContain("const minimumProductBarcodeLength = 4");
    expect(source).toContain("const handleBarcodeInputKeyDown");
    expect(source).toContain("event.key !== \"Enter\"");
    expect(source).toContain("event.preventDefault()");
    expect(source).toContain("onKeyDown={handleBarcodeInputKeyDown}");
    expect(source).toContain("barcodeTooShort");
  });

  it("runs barcode conflict diagnostics during quick create too", async () => {
    const source = await readSource("src/components/product-form.tsx");

    expect(source).toContain("compactCreate");
    expect(source).toContain("? deferredDuplicateDiagnosticsInput.barcodes.length > 0");
    expect(source).toContain("duplicateExactBarcodesTitle");
    expect(source).toContain("href={`/products/${match.id}`}");
  });

  it("preloads scanned unknown barcodes into new product create", async () => {
    const source = await readSource("src/app/(app)/products/new/page.tsx");

    expect(source).toContain("searchParams?.get(\"barcode\")");
    expect(source).toContain("barcodes: barcode ? [barcode] : []");
  });
});
