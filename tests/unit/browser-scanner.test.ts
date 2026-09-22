// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
  getUserMedia: vi.fn(),
  trackStop: vi.fn(),
  decoderStop: vi.fn(),
}));
vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromStream = mocks.decode;
  },
}));
import { startBrowserScanner } from "@/lib/scanning/browser-scanner";

describe("browser camera lifetime", () => {
  const stream = { getTracks: () => [{ stop: mocks.trackStop }] } as unknown as MediaStream;
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: mocks.getUserMedia },
    });
    mocks.getUserMedia.mockResolvedValue(stream);
    mocks.decode.mockResolvedValue({ stop: mocks.decoderStop });
  });
  afterEach(() => vi.useRealTimers());
  const setup = () => {
    const input = {
      video: document.createElement("video"),
      facingMode: "environment" as const,
      onScan: vi.fn(),
      onError: vi.fn(),
      onReady: vi.fn(),
    };
    return { ...input, stop: startBrowserScanner(input) };
  };
  it("preserves leading zeroes, accepts one frame, and releases the camera", async () => {
    const s = setup();
    await vi.waitFor(() => expect(s.onReady).toHaveBeenCalledOnce());
    const callback = mocks.decode.mock.calls[0][2];
    const result = { getText: () => "0123456789012" };
    callback(result, undefined, { stop: mocks.decoderStop });
    callback(result, undefined, { stop: mocks.decoderStop });
    expect(s.onScan).toHaveBeenCalledTimes(1);
    expect(s.onScan).toHaveBeenCalledWith("0123456789012");
    expect(mocks.trackStop).toHaveBeenCalled();
    s.stop();
  });
  it("releases a stream granted after close without starting the decoder", async () => {
    let grant!: (stream: MediaStream) => void;
    mocks.getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const s = setup();
    s.stop();
    grant(stream);
    await vi.waitFor(() => expect(mocks.trackStop).toHaveBeenCalled());
    expect(mocks.decode).not.toHaveBeenCalled();
    expect(s.onScan).not.toHaveBeenCalled();
  });
  it("reports denial and allows a later session to open", async () => {
    mocks.getUserMedia.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
    const s = setup();
    await vi.waitFor(() => expect(s.onError).toHaveBeenCalledWith("cameraPermissionDenied"));
    s.stop();
    const reopened = setup();
    await vi.waitFor(() => expect(reopened.onReady).toHaveBeenCalled());
    reopened.stop();
    expect(mocks.trackStop).toHaveBeenCalled();
  });
  it("bounds initialization and releases a late stream after timeout", async () => {
    vi.useFakeTimers();
    let grant!: (stream: MediaStream) => void;
    mocks.getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const s = setup();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.onError).toHaveBeenCalledWith("scannerUnavailable");
    grant(stream);
    await Promise.resolve();
    expect(mocks.trackStop).toHaveBeenCalled();
    s.stop();
  });
});
