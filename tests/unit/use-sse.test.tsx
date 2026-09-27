// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSse } from "@/lib/useSse";

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  close = vi.fn();
  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useSse connection state", () => {
  it("reports disconnections and calls the recovery callback after every reconnect", () => {
    const recover = vi.fn();
    const { result } = renderHook(() => useSse({}, { onConnect: recover }));
    const source = FakeEventSource.instances[0];
    expect(source.url).toBe("/api/sse");
    expect(result.current).toBe(false);
    act(() => source.dispatchEvent(new Event("open")));
    expect(result.current).toBe(true);
    expect(recover).toHaveBeenCalledTimes(1);
    act(() => source.dispatchEvent(new Event("error")));
    expect(result.current).toBe(false);
    act(() => source.dispatchEvent(new Event("open")));
    expect(result.current).toBe(true);
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it("uses current event handlers and recovery context without reconnecting on render", () => {
    const first = vi.fn();
    const second = vi.fn();
    const recoverFirst = vi.fn();
    const recoverSecond = vi.fn();
    const { rerender } = renderHook(
      ({ handler, recover }) => useSse({ "sale.completed": handler }, { onConnect: recover }),
      { initialProps: { handler: first, recover: recoverFirst } },
    );
    const source = FakeEventSource.instances[0];
    rerender({ handler: second, recover: recoverSecond });
    act(() => {
      source.dispatchEvent(new Event("open"));
      source.dispatchEvent(
        new MessageEvent("sale.completed", { data: JSON.stringify({ registerId: "register-b" }) }),
      );
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(first).not.toHaveBeenCalled();
    expect(recoverFirst).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ registerId: "register-b" });
    expect(recoverSecond).toHaveBeenCalledTimes(1);
  });

  it("removes connection listeners and closes the stream on unmount", () => {
    const handler = vi.fn();
    const recover = vi.fn();
    const { unmount } = renderHook(() =>
      useSse({ "shift.updated": handler }, { onConnect: recover }),
    );
    const source = FakeEventSource.instances[0];
    unmount();
    act(() => {
      source.dispatchEvent(new Event("open"));
      source.dispatchEvent(new MessageEvent("shift.updated", { data: "{}" }));
    });
    expect(source.close).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
  });
});

describe("useSse delivery health", () => {
  const health = (source: FakeEventSource, healthy: boolean) => {
    act(() =>
      source.dispatchEvent(
        new MessageEvent("connection.health", {
          data: JSON.stringify({ healthy }),
        }),
      ),
    );
  };

  it("requires server delivery health before reducing polling, and falls back on Redis failure", () => {
    const recover = vi.fn();
    const { result } = renderHook(() => useSse({}, { monitorHealth: true, onConnect: recover }));
    const source = FakeEventSource.instances[0];
    expect(source.url).toBe("/api/sse?health=1");
    act(() => source.dispatchEvent(new Event("open")));
    expect(result.current).toBe(false);
    health(source, true);
    expect(result.current).toBe(true);
    expect(recover).toHaveBeenCalledTimes(1);
    health(source, true);
    expect(recover).toHaveBeenCalledTimes(1);
    health(source, false);
    expect(result.current).toBe(false);
    health(source, true);
    expect(recover).toHaveBeenCalledTimes(2);
    act(() => source.dispatchEvent(new Event("error")));
    expect(result.current).toBe(false);
  });

  it("restores polling when the stream stalls even if the browser reports no error", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSse({}, { monitorHealth: true }));
    const source = FakeEventSource.instances[0];
    health(source, true);
    act(() => vi.advanceTimersByTime(30_000));
    health(source, true);
    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current).toBe(false);
  });

  it("treats malformed health messages as unhealthy", () => {
    const { result } = renderHook(() => useSse({}, { monitorHealth: true }));
    const source = FakeEventSource.instances[0];
    health(source, true);
    act(() => source.dispatchEvent(new MessageEvent("connection.health", { data: "invalid" })));
    expect(result.current).toBe(false);
  });
});
