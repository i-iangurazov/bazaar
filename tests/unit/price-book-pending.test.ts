import { describe, expect, it, vi } from "vitest";
import {
  priceBookPendingKey,
  readPriceBookPending,
  savePriceBookPending,
} from "@/lib/priceBookPending";
const storage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  } as Storage;
};
const approval = {
  bookId: "book",
  change: {
    kind: "PRICES",
    entries: [{ productId: "product", retailPriceKgs: 0, wholesalePriceKgs: null }],
  },
  idempotencyKey: "same-request-key",
  preview: {
    kind: "PRICES",
    currencyCode: "KGS",
    openDocumentsPreserved: true,
    token: "server-signed-token",
    changedPositions: 10,
    preservedKinds: 0,
    listChangedPositions: 1,
    listPositions: 1,
    connectedStores: 10,
    version: 1,
    sample: [],
    listSample: [],
    stores: [],
  },
};
describe("pending price publication", () => {
  it("restores the same signed change and key repeatedly, isolated by organization and user", () => {
    const s = storage(),
      key = priceBookPendingKey("org", "owner");
    savePriceBookPending(s, key, approval);
    expect(readPriceBookPending(s, key)).toEqual(approval);
    expect(readPriceBookPending(s, key)).toEqual(approval);
    expect(readPriceBookPending(s, priceBookPendingKey("another", "owner"))).toBeNull();
    expect(readPriceBookPending(s, priceBookPendingKey("org", "cashier"))).toBeNull();
  });
  it("rejects corrupt, oversized, expired and malformed records", () => {
    const s = storage(),
      key = "pending";
    for (const raw of [
      "{",
      "x".repeat(3_000_001),
      JSON.stringify({ version: 1, createdAt: 0, approval }),
      JSON.stringify({
        version: 1,
        createdAt: Date.now(),
        approval: {
          ...approval,
          change: {
            kind: "PRICES",
            entries: [{ productId: "product", retailPriceKgs: -1, wholesalePriceKgs: null }],
          },
        },
      }),
    ]) {
      s.setItem(key, raw);
      expect(readPriceBookPending(s, key)).toBeNull();
      expect(s.getItem(key)).toBeNull();
    }
  });
  it("surfaces quota/write failure so a publication cannot start without recoverable state", () => {
    const s = storage();
    s.setItem = vi.fn(() => {
      throw new Error("quota");
    });
    expect(() => savePriceBookPending(s, "pending", approval)).toThrow("quota");
  });
});
