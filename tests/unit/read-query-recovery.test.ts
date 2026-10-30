import { afterEach, expect, it, vi } from "vitest";
import { createAppQueryClient } from "@/lib/query-client";
import { fetchAppRead } from "@/lib/pos-read-transport";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("ends a stalled application read once and permits a successful explicit retry", async () => {
  vi.useFakeTimers();
  const client = createAppQueryClient();
  const fetcher = vi.fn(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const queryFn = async () => (await fetchAppRead("/api/trpc/stores.list")).json();
  const pending = client.fetchQuery({ queryKey: ["recovery"], queryFn });
  const assertion = expect(pending).rejects.toThrow("readRequestTimeout");
  await vi.advanceTimersByTimeAsync(30_000);
  await assertion;
  expect(fetcher).toHaveBeenCalledOnce();
  fetcher.mockImplementationOnce(async () => new Response('{"stores":[]}'));
  await expect(client.fetchQuery({ queryKey: ["recovery"], queryFn })).resolves.toEqual({
    stores: [],
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  client.clear();
  expect(vi.getTimerCount()).toBe(0);
});

it("retains the existing single retry for transient failures", async () => {
  vi.useFakeTimers();
  const client = createAppQueryClient();
  const queryFn = vi
    .fn()
    .mockRejectedValueOnce(new Error("temporary network failure"))
    .mockResolvedValueOnce("recovered");
  const pending = client.fetchQuery({ queryKey: ["transient"], queryFn });
  await vi.advanceTimersByTimeAsync(1_000);
  await expect(pending).resolves.toBe("recovered");
  expect(queryFn).toHaveBeenCalledTimes(2);
  client.clear();
});
