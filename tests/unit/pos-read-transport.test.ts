import { afterEach, expect, it, vi } from "vitest";
import { fetchPosRead, isInteractivePosRead } from "@/lib/pos-read-transport";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("isolates critical reads without timing out writes", () => {
  expect(isInteractivePosRead("query", "pos.shifts.current")).toBe(true);
  expect(isInteractivePosRead("query", "products.lookupScan")).toBe(true);
  expect(isInteractivePosRead("mutation", "pos.sales.complete")).toBe(false);
  expect(isInteractivePosRead("query", "products.bootstrap")).toBe(false);
});
it("aborts a stalled read and clears the timer after success", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    ),
  );
  const result = fetchPosRead("/test");
  const assertion = expect(result).rejects.toThrow("aborted");
  await vi.advanceTimersByTimeAsync(12_000);
  await assertion;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
  await fetchPosRead("/test");
  expect(vi.getTimerCount()).toBe(0);
});
