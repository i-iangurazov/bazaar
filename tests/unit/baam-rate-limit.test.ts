import { describe, expect, it } from "vitest";
import { readRedisCounterResults } from "@/server/middleware/rateLimiter";

describe("Redis transaction result safety for protected requests", () => {
  it("accepts counters with either newly attached or already existing expirations", () => {
    expect(readRedisCounterResults([[null, 3], [null, 1], [null, 5], [null, 0]], 2)).toEqual([3, 5]);
  });
  it.each([
    null,
    [],
    [[null, 1]],
    [[new Error("WRONGTYPE"), null], [null, 1]],
    [[null, 1], [new Error("NOPERM"), null]],
    [[null, null], [null, 1]],
    [[null, Number.NaN], [null, 1]],
    [[null, Infinity], [null, 1]],
    [[null, 0], [null, 1]],
    [[null, Number.MAX_SAFE_INTEGER + 1], [null, 1]],
    [[null, 1], [null, null]],
  ].map(reply => ({ reply })))("rejects unavailable or failed atomic counter replies: $reply", ({ reply }) => {
    expect(() => readRedisCounterResults(reply, 1)).toThrow("redisUnavailable");
  });
  it("rejects a failure of either counter in the login account/IP pair transaction", () => {
    expect(() => readRedisCounterResults([[null, 5], [null, 1], [new Error("WRONGTYPE"), null], [null, 0]], 2)).toThrow("redisUnavailable");
  });
});
