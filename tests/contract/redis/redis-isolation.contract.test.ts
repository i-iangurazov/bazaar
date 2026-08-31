import Redis from "ioredis";
import { describe, expect, it } from "vitest";

import { getRedisKeyPrefix, getRedisPublisher } from "@/server/redis";

describe("isolated Redis contract lane", () => {
  it("writes only through the run-scoped application namespace", async () => {
    const redisUrl = process.env.REDIS_URL;
    const runId = process.env.BAZAAR_TEST_RUN_ID;
    if (!redisUrl || !runId) {
      throw new Error("Redis contract setup did not preserve the validated Redis target.");
    }

    const expectedPrefix = `bazaar:test:${runId}:`;
    const logicalKey = `contract:namespace:${runId}`;
    const value = `probe:${runId}`;
    const publisher = getRedisPublisher();
    if (!publisher) {
      throw new Error("Validated Redis contract target did not create a publisher.");
    }
    const rawClient = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 3_000,
      commandTimeout: 5_000,
      enableReadyCheck: true,
    });

    expect(getRedisKeyPrefix()).toBe(expectedPrefix);

    try {
      await publisher.set(logicalKey, value);
      await expect(rawClient.get(`${expectedPrefix}${logicalKey}`)).resolves.toBe(value);
      await expect(rawClient.get(logicalKey)).resolves.toBeNull();
      await publisher.del(logicalKey);
      await expect(rawClient.get(`${expectedPrefix}${logicalKey}`)).resolves.toBeNull();
    } finally {
      await Promise.allSettled([
        rawClient.del(`${expectedPrefix}${logicalKey}`),
        rawClient.del(logicalKey),
      ]);
      await Promise.allSettled([publisher.quit(), rawClient.quit()]);
    }
  });
});
