import { gzipSync } from "node:zlib";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  decodePriceBookSnapshot,
  encodePriceBookSnapshot,
} from "@/server/services/priceBookSnapshot";

describe("price book recovery snapshots", () => {
  it("round trips Unicode, decimals and dates across compressed chunks", async () => {
    const state = {
      book: { id: "test-book", version: 7 },
      prices: Array.from({ length: 1200 }, (_, id) => ({
        id,
        name: `Кыргызча / Русский / 中文 ${id} ${"🙂".repeat(60)}`,
        value: new Prisma.Decimal("123.40"),
        updatedAt: new Date("2026-10-29T12:34:56.123Z"),
      })),
      types: [{ retail: "0", wholesale: null }],
      items: [{ shared: true }],
    };
    const encoded = await encodePriceBookSnapshot(state);
    expect(await decodePriceBookSnapshot(encoded, "ndjson-gzip-v2")).toEqual(
      JSON.parse(JSON.stringify(state)),
    );
  });

  it("supports empty snapshots and the existing gzip format", async () => {
    const state = { prices: [], types: [], items: [], version: 1 };
    expect(
      await decodePriceBookSnapshot(await encodePriceBookSnapshot(state), "ndjson-gzip-v2"),
    ).toEqual(state);
    expect(await decodePriceBookSnapshot(gzipSync(JSON.stringify(state)), "gzip-json-v1")).toEqual(
      state,
    );
  });

  it("fails closed on corrupt, truncated, unknown or oversized snapshots", async () => {
    const encoded = await encodePriceBookSnapshot({
      prices: [{ text: "x".repeat(1000) }],
      types: [],
      items: [],
    });
    for (const [data, format, limit] of [
      [Buffer.from("broken"), "ndjson-gzip-v2", 4096],
      [encoded.subarray(0, encoded.length - 3), "ndjson-gzip-v2", 4096],
      [encoded, "unknown", 4096],
      [encoded, "ndjson-gzip-v2", 128],
      [gzipSync("{}"), "ndjson-gzip-v2", 4096],
      [gzipSync('{"prices":[],"types":[],"items":[]}\n["bad",{}]\n'), "ndjson-gzip-v2", 4096],
      [gzipSync("x".repeat(1000)), "gzip-json-v1", 128],
    ] as const) {
      await expect(decodePriceBookSnapshot(data, format, limit)).rejects.toThrow(
        "priceBookSnapshotUnavailable",
      );
    }
  });
});
