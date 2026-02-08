import { isProductionRuntime } from "@/server/config/runtime";
import { getLogger } from "@/server/logging";
import { getRedisPublisher } from "@/server/redis";

export type RateLimitConfig = {
  windowMs: number;
  max: number;
  prefix: string;
};

export type RateLimiter = {
  consume: (key: string) => Promise<void> | void;
};

class MemoryRateLimiter implements RateLimiter {
  private readonly store = new Map<string, { count: number; resetAt: number }>();
  private readonly windowMs: number;
  private readonly max: number;

  constructor(config: RateLimitConfig) {
    this.windowMs = config.windowMs;
    this.max = config.max;
  }

  consume(key: string) {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || entry.resetAt <= now) {
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    if (entry.count >= this.max) {
      throw new Error("rateLimited");
    }
    entry.count += 1;
    this.store.set(key, entry);
  }
}

class RedisRateLimiter implements RateLimiter {
  private readonly windowMs: number;
  private readonly max: number;
  private readonly prefix: string;

  constructor(config: RateLimitConfig) {
    this.windowMs = config.windowMs;
    this.max = config.max;
    this.prefix = config.prefix;
  }

  async consume(key: string) {
    const redis = getRedisPublisher();
    if (!redis) {
      if (isProductionRuntime()) {
        throw new Error("redisUnavailable");
      }
      return new MemoryRateLimiter({ windowMs: this.windowMs, max: this.max, prefix: this.prefix }).consume(
        key,
      );
    }

    const bucketKey = `${this.prefix}:${key}`;
    const result = await redis
      .multi()
      .incr(bucketKey)
      .pexpire(bucketKey, this.windowMs, "NX")
      .exec();

    const count = Array.isArray(result?.[0]) ? Number(result?.[0][1]) : 0;
    if (count > this.max) {
      throw new Error("rateLimited");
    }
  }
}

export const createRateLimiter = (config: RateLimitConfig): RateLimiter => {
  const redis = getRedisPublisher();
  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("REDIS_URL is required for rate limiting in production.");
    }
    const logger = getLogger();
    logger.warn({ prefix: config.prefix }, "Using in-memory rate limiter; Redis not configured.");
    return new MemoryRateLimiter(config);
  }
  return new RedisRateLimiter(config);
};
