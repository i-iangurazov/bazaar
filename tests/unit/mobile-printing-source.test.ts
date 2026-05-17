import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const printingSource = readFileSync(
  join(process.cwd(), "src/app/(app)/settings/printing/page.tsx"),
  "utf8",
);

describe("mobile printing wizard source", () => {
  it("adds a mobile-only printing wizard without replacing desktop settings", () => {
    expect(printingSource).toContain("data-mobile-printing-wizard");
    expect(printingSource).toContain('className="space-y-4 md:hidden"');
    expect(printingSource).toContain('className="hidden space-y-6 md:block"');
    expect(printingSource).toContain("MobileWizardStep");
  });

  it("keeps QZ readiness honest and separates signing from local trust", () => {
    expect(printingSource).toContain("qzRequestSigningWorks");
    expect(printingSource).toContain("qzMobileReady");
    expect(printingSource).toContain('values.receiptPrintProvider === "QZ_TRAY"');
    expect(printingSource).toContain('qzStatus === "connected"');
    expect(printingSource).toContain("qzReceiptPrinterSelected");
    expect(printingSource).toContain("qzTrustStatus === \"trusted\"");
    expect(printingSource).toContain("qzTerminalProvisioned");
    expect(printingSource).toContain("qzSignedButUntrusted");
    expect(printingSource).toContain("qzClientProvisionNotice");
  });

  it("includes certificate, printer, template, preview, and test-print controls", () => {
    expect(printingSource).toContain('href="/api/qz/certificate"');
    expect(printingSource).toContain("qzCertificateFingerprint");
    expect(printingSource).toContain("receiptPrinterName");
    expect(printingSource).toContain("labelPrinterName");
    expect(printingSource).toContain("receiptPaperSize");
    expect(printingSource).toContain("labelLayoutOrder");
    expect(printingSource).toContain("labelWidthMm");
    expect(printingSource).toContain("labelHeightMm");
    expect(printingSource).toContain('handleTestPrint("receipt")');
    expect(printingSource).toContain('handleTestPrint("barcode")');
  });
});
