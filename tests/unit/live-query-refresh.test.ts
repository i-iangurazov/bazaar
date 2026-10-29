import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { liveQueryRefreshOptions } from "@/lib/live-query";

describe("live stock refresh and consecutive inline saves", () => {
  it("does not release an awaiting save before its stock revision is refreshed", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["stock"];
    client.setQueryData(key, { onHand: 3, version: 1 });
    const reads: Array<{ signal: AbortSignal | undefined; finish: (value: { onHand: number; version: number }) => void }> = [];
    const observer = new QueryObserver(client, {
      queryKey: key, staleTime: Infinity,
      queryFn: ({ signal }) => new Promise<{ onHand: number; version: number }>((finish) => reads.push({ signal, finish })),
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      let saveFinished = false;
      const afterSave = client.invalidateQueries({ queryKey: key }).then(() => { saveFinished = true; });
      const liveEvent = client.invalidateQueries({ queryKey: key }, liveQueryRefreshOptions);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(saveFinished).toBe(false);
      expect(reads).toHaveLength(1);
      expect(reads[0].signal?.aborted).toBe(false);
      reads[0].finish({ onHand: 7, version: 2 });
      await Promise.all([afterSave, liveEvent]);
      expect(client.getQueryData(key)).toEqual({ onHand: 7, version: 2 });
    } finally { unsubscribe(); client.clear(); }
  });

  it("still replaces a read started before a write, and protects its replacement from SSE", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["stock"];
    client.setQueryData(key, { onHand: 3, version: 1 });
    const reads: Array<{ signal: AbortSignal | undefined; finish: (value: number) => void }> = [];
    const observer = new QueryObserver(client, {
      queryKey: key, staleTime: Infinity,
      queryFn: ({ signal }) => new Promise<number>((finish) => reads.push({ signal, finish })),
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      const beforeWrite = client.invalidateQueries({ queryKey: key });
      const afterWrite = client.invalidateQueries({ queryKey: key });
      const liveEvent = client.invalidateQueries({ queryKey: key }, liveQueryRefreshOptions);
      expect(reads).toHaveLength(2);
      expect(reads[0].signal?.aborted).toBe(true);
      expect(reads[1].signal?.aborted).toBe(false);
      reads[1].finish(2);
      await Promise.all([beforeWrite, afterWrite, liveEvent]);
      reads[0].finish(1);
      await Promise.resolve();
      expect(client.getQueryData(key)).toBe(2);
    } finally { unsubscribe(); client.clear(); }
  });
});
