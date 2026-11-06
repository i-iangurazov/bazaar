import { describe, expect, it, vi } from "vitest";
import { PriceAutosaveQueue, type PriceSaveReceipt } from "@/lib/priceAutosaveQueue";
import { readPriceAutosavePending, savePriceAutosavePending } from "@/lib/productPriceAutosave";
const version = "a".repeat(64),
  next = "b".repeat(64);
const context = { unitId: "each", currencyCode: "KGS" as const, currencyRateKgsPerUnit: 1 };
const request = {
  ...context,
  productId: "p",
  storeId: "s",
  expectedVersion: version,
  idempotencyKey: "request-key",
  prices: [{ retailPriceKgs: 900 }],
};
const receipt = (prices = request.prices): PriceSaveReceipt => ({
  status: "SAVED",
  version: next,
  prices,
  changed: true,
});
function fixture() {
  const options = {
    productId: "p",
    storeId: "s",
    version,
    context: () => context,
    collect: vi.fn(() => request.prices),
    hasDirty: vi.fn(() => true),
    save: vi.fn().mockResolvedValue(receipt()),
    reconcile: vi.fn().mockResolvedValue(receipt()),
    persist: vi.fn(),
    acknowledge: vi.fn(),
    restore: vi.fn(),
    refresh: vi.fn().mockResolvedValue(next),
    onSaved: vi.fn(),
    onState: vi.fn(),
  };
  return { q: new PriceAutosaveQueue(options), o: options };
}
describe("serialized price autosave", () => {
  it("persists the exact request before transmission and acknowledges only a successful server reply", async () => {
    const { q, o } = fixture();
    o.save.mockImplementation(async (r) => {
      expect(o.persist).toHaveBeenCalledWith(r);
      expect(o.acknowledge).not.toHaveBeenCalled();
      return receipt();
    });
    expect(await q.save()).toBe(true);
    expect(o.acknowledge).toHaveBeenCalledWith(request.prices, receipt());
    expect(o.onSaved).toHaveBeenCalledWith(next);
    expect(o.persist).toHaveBeenLastCalledWith(null);
  });
  it("serializes rapid edits and uses the confirmed version for the next write", async () => {
    const { q, o } = fixture();
    let complete!: (r: PriceSaveReceipt) => void;
    o.save.mockImplementationOnce(
      () =>
        new Promise((r) => {
          complete = r;
        }),
    );
    const first = q.save();
    o.collect.mockReturnValue([{ retailPriceKgs: 1100 }]);
    const second = q.save();
    expect(o.save).toHaveBeenCalledTimes(1);
    complete(receipt());
    await Promise.all([first, second]);
    expect(o.save).toHaveBeenCalledTimes(2);
    expect(o.save.mock.calls[1][0]).toMatchObject({
      expectedVersion: next,
      prices: [{ retailPriceKgs: 1100 }],
    });
  });
  it("retries an unknown outcome with the same payload and key", async () => {
    const { q, o } = fixture();
    o.save.mockRejectedValueOnce(new Error("offline"));
    expect(await q.save()).toBe(false);
    expect(o.persist).not.toHaveBeenCalledWith(null);
    await q.save();
    expect(o.save.mock.calls[1][0]).toEqual(o.save.mock.calls[0][0]);
  });
  it("does not silently rebase a stale edit after another user changes the price", async () => {
    const { q, o } = fixture();
    o.save.mockRejectedValueOnce(
      Object.assign(new Error("priceAutosaveConflict"), { data: { code: "CONFLICT" } }),
    );
    expect(await q.save()).toBe(false);
    q.syncVersion(next);
    expect(await q.save()).toBe(false);
    expect(o.save).toHaveBeenCalledTimes(1);
    await q.reload();
    await q.save();
    expect(o.save.mock.calls[1][0].expectedVersion).toBe(next);
  });
  it("recovers a committed receipt using current prices instead of restoring stale receipt values", async () => {
    const { q, o } = fixture();
    o.refresh.mockResolvedValue("c".repeat(64));
    await q.recover(request);
    expect(o.acknowledge).not.toHaveBeenCalled();
    expect(o.restore).not.toHaveBeenCalled();
    expect(o.onSaved).toHaveBeenCalledWith("c".repeat(64));
  });
  it("restores an uncommitted draft only after closing the original request", async () => {
    const { q, o } = fixture();
    o.reconcile.mockResolvedValue({ status: "CANCELED" });
    await q.recover(request);
    expect(o.restore).toHaveBeenCalledWith(request.prices);
    await q.save();
    expect(o.save.mock.calls[0][0].idempotencyKey).not.toBe(request.idempotencyKey);
  });
  it("preserves the recovery key when a scope unmounts after an unknown response", async () => {
    const { q, o } = fixture();
    let reject!: (e: Error) => void;
    o.save.mockImplementationOnce(
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    );
    const running = q.save();
    q.dispose();
    reject(new Error("offline"));
    await running;
    expect(o.persist).not.toHaveBeenCalledWith(null);
    expect(o.acknowledge).not.toHaveBeenCalled();
  });
  it("does not transmit if recovery storage fails; ordinary full-form save remains possible", async () => {
    const { q, o } = fixture();
    o.persist.mockImplementation(() => {
      throw new Error("quota");
    });
    expect(await q.save()).toBe(false);
    expect(o.save).not.toHaveBeenCalled();
    expect(await q.flushManual()).toBe(true);
  });
  it("does not start a separate price write for an ordinary manual form submit", async () => {
    const { q, o } = fixture();
    expect(await q.flushManual()).toBe(true);
    expect(o.save).not.toHaveBeenCalled();
  });
  it("does not acknowledge an old context after a concurrent currency change", async () => {
    const { q, o } = fixture();
    let complete!: (r: PriceSaveReceipt) => void;
    o.save.mockImplementationOnce(
      () =>
        new Promise((r) => {
          complete = r;
        }),
    );
    const running = q.save();
    q.invalidate(new Error("priceAutosaveConflict"));
    complete(receipt());
    expect(await running).toBe(false);
    expect(o.acknowledge).not.toHaveBeenCalled();
  });
});
it("keeps reconciliation retryable if fetching current prices fails after finding a receipt", async () => {
  const { q, o } = fixture();
  o.refresh.mockRejectedValueOnce(new Error("offline"));
  expect(await q.recover(request)).toBe(false);
  expect(q.unresolved).toBe(true);
  expect(o.persist).not.toHaveBeenCalledWith(null);
  expect(await q.save()).toBe(true);
  expect(o.reconcile).toHaveBeenCalledTimes(2);
  expect(o.save).not.toHaveBeenCalled();
  expect(o.acknowledge).not.toHaveBeenCalled();
});
it("unblocks explicit price reload after a context changed during a save", async () => {
  const { q, o } = fixture();
  let complete!: (r: PriceSaveReceipt) => void;
  o.save.mockImplementationOnce(
    () =>
      new Promise((r) => {
        complete = r;
      }),
  );
  const running = q.save();
  q.invalidate(new Error("priceAutosaveConflict"));
  complete(receipt());
  await running;
  expect(o.onState).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: "conflict", pending: false }),
  );
  expect(await q.reload()).toBe(true);
});
it("can reconcile an unknown save after a concurrent context change instead of becoming stuck", async () => {
  const { q, o } = fixture();
  let reject!: (e: Error) => void;
  o.save.mockImplementationOnce(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  const running = q.save();
  q.invalidate(new Error("priceAutosaveConflict"));
  reject(new Error("offline"));
  await running;
  expect(await q.save()).toBe(true);
  expect(o.reconcile).toHaveBeenCalledTimes(1);
  expect(o.refresh).toHaveBeenCalledTimes(1);
  expect(o.acknowledge).not.toHaveBeenCalled();
});
it.each(["UNAUTHORIZED", "FORBIDDEN", "TOO_MANY_REQUESTS"])(
  "retains an unknown receipt across %s before an idempotent replay lookup",
  async (code) => {
    const { q, o } = fixture();
    o.save.mockRejectedValueOnce(Object.assign(new Error("blocked"), { data: { code } }));
    expect(await q.save()).toBe(false);
    expect(q.unresolved).toBe(true);
    const original = o.save.mock.calls[0][0];
    o.collect.mockReturnValue([]);
    await q.save();
    expect(o.save.mock.calls[1][0]).toEqual(original);
  },
);
describe("price recovery record", () => {
  it("validates the scope and rejects an expired or malformed request", () => {
    const values = new Map<string, string>();
    const storage = {
      get length() {
        return values.size;
      },
      clear: () => {
        values.clear();
      },
      key: (i: number) => [...values.keys()][i] ?? null,
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    } as Storage;
    savePriceAutosavePending(storage, "key", request);
    expect(readPriceAutosavePending(storage, "key", "p", "s")).toEqual(request);
    expect(readPriceAutosavePending(storage, "key", "other", "s")).toBeNull();
    values.set("key", JSON.stringify({ version: 1, at: 0, request }));
    expect(readPriceAutosavePending(storage, "key", "p", "s")).toBeNull();
  });
});
