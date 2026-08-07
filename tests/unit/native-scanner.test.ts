import { beforeEach, describe, expect, it, vi } from "vitest";

const { scanBarcode } = vi.hoisted(() => ({ scanBarcode: vi.fn() }));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    isPluginAvailable: (name: string) => name === "CapacitorBarcodeScanner",
  },
}));

vi.mock("@capacitor/barcode-scanner", () => ({
  CapacitorBarcodeScanner: { scanBarcode },
  CapacitorBarcodeScannerAndroidScanningLibrary: { MLKIT: "mlkit" },
  CapacitorBarcodeScannerCameraDirection: { BACK: 1 },
  CapacitorBarcodeScannerScanOrientation: { ADAPTIVE: 3 },
  CapacitorBarcodeScannerTypeHint: { ALL: 17 },
}));

import { scanBarcodeNative } from "@/lib/native/scanner";

const labels = { instructions: "Scan", cancel: "Cancel", torchOn: "Off", torchOff: "On" };

describe("native barcode scanner", () => {
  beforeEach(() => scanBarcode.mockReset());

  it("normalizes a native scan for the existing Bazaar lookup flow", async () => {
    scanBarcode.mockResolvedValue({ ScanResult: "  123 456\n", format: 11 });
    await expect(scanBarcodeNative(labels)).resolves.toEqual({
      status: "scanned",
      value: "123456",
    });
    expect(scanBarcode).toHaveBeenCalledTimes(1);
  });

  it("classifies permission denial without exposing a provider error", async () => {
    scanBarcode.mockImplementationOnce(async () => {
      throw new Error("Camera permission denied by user");
    });
    await expect(scanBarcodeNative(labels)).resolves.toEqual({ status: "permission-denied" });
  });

  it("treats an empty/cancelled scan as a no-op", async () => {
    scanBarcode.mockResolvedValue({ ScanResult: "", format: 0 });
    await expect(scanBarcodeNative(labels)).resolves.toEqual({ status: "cancelled" });
  });
});
