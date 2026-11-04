// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  readTransferPreparationPending as read,
  saveTransferPreparationPending as save,
  transferPreparationPendingKey as key,
} from "@/lib/transferPreparationPending";
const request = {
  change: {
    fromStoreId: "warehouse",
    toStoreId: "shop",
    selections: [{ productId: "p", sourceKey: "store:warehouse" }],
    lines: [{ productId: "p" }],
    prices: "MISSING" as const,
  },
  token: "signed-preview",
  idempotencyKey: "request-key-1",
};
beforeEach(() => sessionStorage.clear());
describe("transfer recovery storage", () => {
  it("round-trips the reviewed request under a user and direction scoped key", () => {
    const id = key("org", "user", "warehouse", "shop");
    save(sessionStorage, id, request);
    expect(read(sessionStorage, id, "warehouse", "shop")).toEqual(request);
    expect(key("org", "user", "shop", "warehouse")).not.toBe(id);
    expect(key("org", "another", "warehouse", "shop")).not.toBe(id);
  });
  it("rejects another recipient and discards malformed or stale records", () => {
    save(sessionStorage, "key", request);
    expect(read(sessionStorage, "key", "warehouse", "other")).toBeNull();
    for (const raw of [
      "invalid",
      JSON.stringify({ version: 1, createdAt: 0, request }),
      JSON.stringify({
        version: 1,
        createdAt: Date.now(),
        request: { ...request, change: { ...request.change, prices: "REPLACE" } },
      }),
    ]) {
      sessionStorage.setItem("key", raw);
      expect(read(sessionStorage, "key", "warehouse", "shop")).toBeNull();
      expect(sessionStorage.getItem("key")).toBeNull();
    }
  });
  it("retains all 500 selected rows for recovery", () => {
    const lines = Array.from({ length: 500 }, (_, i) => ({ productId: `product-${i}` }));
    const large = {
      ...request,
      change: {
        ...request.change,
        lines,
        selections: lines.map((l) => ({ ...l, sourceKey: "store:warehouse" })),
      },
    };
    save(sessionStorage, "key", large);
    expect(read(sessionStorage, "key", "warehouse", "shop")).toEqual(large);
  });
});
