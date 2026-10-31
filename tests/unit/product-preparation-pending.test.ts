import { describe, expect, it } from "vitest";
import {
  productPreparationPendingKey,
  readProductPreparationPending,
  saveProductPreparationPending,
} from "@/lib/productPreparationPending";

function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  } as Storage;
}
const request = {
  change: {
    productId: "p",
    sourceStoreId: "source",
    targetStoreIds: ["target"],
    addToAssortment: true,
    prices: "MISSING" as const,
  },
  token: "signed-token",
  idempotencyKey: "saved-original-key",
};
describe("product preparation recovery", () => {
  it("restores the exact operation after remount and isolates user, organization and card", () => {
    const storage = memory(),
      key = productPreparationPendingKey("org", "user", "p");
    saveProductPreparationPending(storage, key, request);
    expect(readProductPreparationPending(storage, key, "p")).toEqual(request);
    for (const other of [
      productPreparationPendingKey("other", "user", "p"),
      productPreparationPendingKey("org", "other", "p"),
      productPreparationPendingKey("org", "user", "other"),
    ])
      expect(readProductPreparationPending(storage, other, "p")).toBeNull();
    expect(readProductPreparationPending(storage, key, "another-card")).toBeNull();
  });
  it("discards corrupted, expired and oversized storage without making a request", () => {
    const storage = memory();
    for (const value of [
      "bad-json",
      "x".repeat(20_001),
      JSON.stringify({ version: 1, createdAt: 0, request }),
      JSON.stringify({ version: 2, createdAt: Date.now(), request }),
    ]) {
      storage.setItem("k", value);
      expect(readProductPreparationPending(storage, "k", "p")).toBeNull();
      expect(storage.getItem("k")).toBeNull();
    }
  });
  it("does not accept a source as its own destination or a missing source for a price copy", () => {
    const storage = memory();
    expect(() =>
      saveProductPreparationPending(storage, "k", {
        ...request,
        change: { ...request.change, targetStoreIds: ["source"] },
      }),
    ).toThrow();
    expect(() =>
      saveProductPreparationPending(storage, "k", {
        ...request,
        change: { ...request.change, sourceStoreId: undefined },
      }),
    ).toThrow();
    expect(storage.getItem("k")).toBeNull();
  });
});
