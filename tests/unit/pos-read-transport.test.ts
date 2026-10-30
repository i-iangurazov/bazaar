import { afterEach, expect, it, vi } from "vitest";
import { fetchPosRead, isInteractivePosRead } from "@/lib/pos-read-transport";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("isolates critical reads without timing out writes", () => {
  expect(isInteractivePosRead("query", "pos.shifts.current")).toBe(true);
  expect(isInteractivePosRead("query", "products.lookupScan")).toBe(true);
  expect(isInteractivePosRead("query", "products.list")).toBe(true);
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
  const assertion = expect(result).rejects.toThrow("readRequestTimeout");
  await vi.advanceTimersByTimeAsync(12_000);
  await assertion;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
  await fetchPosRead("/test");
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps the deadline while a response body stalls after successful headers", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url, options) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"result":'));
              options.signal.addEventListener("abort", () =>
                controller.error(new Error("aborted body")),
              );
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    ),
  );
  const result = fetchPosRead("/test");
  const assertion = expect(result).rejects.toThrow("readRequestTimeout");
  await vi.advanceTimersByTimeAsync(12_000);
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves the downloaded JSON, status and headers and removes its deadline", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response('{"error":{"code":403}}', {
          status: 403,
          headers: { "content-type": "application/json", "x-request-id": "read-123" },
        }),
    ),
  );
  const response = await fetchPosRead("/test");
  expect(response.status).toBe(403);
  expect(response.headers.get("x-request-id")).toBe("read-123");
  expect(await response.json()).toEqual({ error: { code: 403 } });
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels superseded reads without reporting a timeout or retaining timers", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("superseded")));
        }),
    ),
  );
  const result = fetchPosRead("/test", { signal: controller.signal });
  const assertion = expect(result).rejects.toThrow("superseded");
  controller.abort();
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});
