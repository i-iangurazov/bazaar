// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBaamVoice } from "@/components/baam-voice";

class Recorder {
  static isTypeSupported = (mime: string) => mime === "audio/webm;codecs=opus";
  state = "inactive";
  onstop?: () => void;
  onerror?: () => void;
  ondataavailable?: (event: { data: Blob }) => void;
  static latest: Recorder;
  constructor() {
    Recorder.latest = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["recorded audio"]) });
      this.onstop?.();
    });
  }
}
const release = vi.fn(),
  acquire = vi.fn();
const stream = () => ({ getTracks: () => [{ stop: release }] }) as unknown as MediaStream;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("MediaRecorder", Recorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: acquire },
  });
  acquire.mockResolvedValue(stream());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("BAAM recording lifecycle", () => {
  it("starts once on double press, flushes recording and releases its microphone", async () => {
    const send = vi.fn().mockResolvedValue(undefined),
      error = vi.fn();
    const hook = renderHook(() => useBaamVoice(send, error));
    await act(async () => {
      await Promise.all([hook.result.current.start(), hook.result.current.start()]);
    });
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(hook.result.current.recording).toBe(true);
    await act(async () => hook.result.current.stop());
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0][0] as Blob).size).toBeGreaterThan(0);
    expect(release).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
  it("cancels without uploading and can record again", async () => {
    const send = vi.fn();
    const hook = renderHook(() => useBaamVoice(send, vi.fn()));
    await act(async () => hook.result.current.start());
    await act(async () => hook.result.current.stop(true));
    expect(send).not.toHaveBeenCalled();
    await act(async () => hook.result.current.start());
    expect(acquire).toHaveBeenCalledTimes(2);
    await act(async () => hook.result.current.stop(true));
  });
  it("releases a microphone that resolves after cancellation or unmount", async () => {
    let allow!: (s: MediaStream) => void;
    acquire.mockReturnValue(
      new Promise<MediaStream>((r) => {
        allow = r;
      }),
    );
    const send = vi.fn(),
      error = vi.fn();
    const hook = renderHook(() => useBaamVoice(send, error));
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.start();
    });
    act(() => hook.result.current.stop(true));
    hook.unmount();
    await act(async () => {
      allow(stream());
      await pending;
    });
    expect(release).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
  it.each([
    ["NotAllowedError", "micDenied"],
    ["NotFoundError", "micMissing"],
  ])("reports %s and leaves text input possible", async (name, code) => {
    acquire.mockRejectedValue(new DOMException("Denied", name));
    const error = vi.fn();
    const hook = renderHook(() => useBaamVoice(vi.fn(), error));
    await act(async () => hook.result.current.start());
    expect(error).toHaveBeenCalledWith(code);
    expect(hook.result.current.requesting).toBe(false);
    expect(hook.result.current.recording).toBe(false);
  });
  it("ends an unanswered permission request and cleans up a late grant", async () => {
    vi.useFakeTimers();
    let allow!: (s: MediaStream) => void;
    acquire.mockReturnValue(
      new Promise<MediaStream>((r) => {
        allow = r;
      }),
    );
    const error = vi.fn();
    const hook = renderHook(() => useBaamVoice(vi.fn(), error));
    act(() => {
      void hook.result.current.start();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20001);
    });
    expect(error).toHaveBeenCalledWith("micTimeout");
    expect(hook.result.current.requesting).toBe(false);
    await act(async () => allow(stream()));
    expect(release).toHaveBeenCalled();
  });
  it("automatically stops before 90 seconds", async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const hook = renderHook(() => useBaamVoice(send, vi.fn()));
    await act(async () => hook.result.current.start());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(89000);
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(hook.result.current.recording).toBe(false);
  });
});
