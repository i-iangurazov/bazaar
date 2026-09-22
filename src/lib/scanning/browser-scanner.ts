import { normalizeScanValue } from "@/lib/scanning/normalize";

export type CameraError = "cameraPermissionDenied" | "cameraNotFound" | "scannerUnavailable";

// Own the stream, including permission responses that arrive after cancellation.
export function startBrowserScanner(input: {
  video: HTMLVideoElement;
  facingMode: "environment" | "user";
  onScan: (value: string) => void;
  onReady: () => void;
  onError: (error: CameraError) => void;
}) {
  let stopped = false;
  let stream: MediaStream | undefined;
  let controls: { stop: () => void } | undefined;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    controls?.stop();
    stream?.getTracks().forEach((track) => track.stop());
    input.video.srcObject = null;
  };
  const fail = (error: CameraError) => {
    if (stopped) return;
    stop();
    input.onError(error);
  };
  const timer = setTimeout(() => fail("scannerUnavailable"), 20_000);
  void (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return fail("scannerUnavailable");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: input.facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (stopped) {
        stop();
        return;
      }
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);
      if (stopped) {
        stop();
        return;
      }
      const hints = new Map([
        [
          DecodeHintType.POSSIBLE_FORMATS,
          [
            BarcodeFormat.EAN_13,
            BarcodeFormat.EAN_8,
            // EAN-13 also decodes UPC-A. Keep its leading zero instead of ZXing stripping it.
            BarcodeFormat.UPC_E,
            BarcodeFormat.CODE_128,
            BarcodeFormat.QR_CODE,
            BarcodeFormat.DATA_MATRIX,
          ],
        ],
      ]);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
      controls = await reader.decodeFromStream(
        stream,
        input.video,
        (result, _error, activeControls) => {
          if (!result || stopped) return;
          const value = normalizeScanValue(result.getText());
          if (!value) return;
          activeControls.stop();
          stop();
          input.onScan(value);
        },
      );
      if (stopped) {
        stop();
        return;
      }
      clearTimeout(timer);
      input.onReady();
    } catch (error) {
      const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
      fail(
        name === "NotAllowedError" || name === "SecurityError"
          ? "cameraPermissionDenied"
          : name === "NotFoundError"
            ? "cameraNotFound"
            : "scannerUnavailable",
      );
    }
  })();
  return stop;
}
