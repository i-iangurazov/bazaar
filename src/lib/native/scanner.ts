import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerAndroidScanningLibrary,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHint,
} from "@capacitor/barcode-scanner";

import { normalizeScanValue } from "@/lib/scanning/normalize";
import { isPluginAvailable } from "@/lib/native/platform";

export type NativeScanResult =
  | { status: "scanned"; value: string }
  | { status: "cancelled" }
  | { status: "permission-denied" }
  | { status: "unavailable" }
  | { status: "error" };

const isPermissionError = (message: string) =>
  /permission|denied|not authorized|restricted/i.test(message);

const isCancellation = (message: string) => /cancel|closed|dismiss/i.test(message);

export const scanBarcodeNative = async (labels: {
  instructions: string;
  cancel: string;
  torchOn: string;
  torchOff: string;
}): Promise<NativeScanResult> => {
  if (!isPluginAvailable("CapacitorBarcodeScanner")) {
    return { status: "unavailable" };
  }

  try {
    const result = await CapacitorBarcodeScanner.scanBarcode({
      hint: CapacitorBarcodeScannerTypeHint.ALL,
      scanInstructions: labels.instructions,
      scanButton: false,
      cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
      scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
      cancelButtonAccessibilityLabel: labels.cancel,
      torchButtonOnAccessibilityLabel: labels.torchOn,
      torchButtonOffAccessibilityLabel: labels.torchOff,
      android: { scanningLibrary: CapacitorBarcodeScannerAndroidScanningLibrary.MLKIT },
    });
    const value = normalizeScanValue(result.ScanResult);
    return value ? { status: "scanned", value } : { status: "cancelled" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isPermissionError(message)) return { status: "permission-denied" };
    if (isCancellation(message)) return { status: "cancelled" };
    return { status: "error" };
  }
};
