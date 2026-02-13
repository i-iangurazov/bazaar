import { getLogger } from "@/server/logging";
import { isProductionRuntime } from "@/server/config/runtime";
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
  private readonly fallbackLimiter: MemoryRateLimiter;

  constructor(config: RateLimitConfig) {
    this.windowMs = config.windowMs;
    this.max = config.max;
    this.prefix = config.prefix;
    this.fallbackLimiter = new MemoryRateLimiter(config);
  }

  async consume(key: string) {
    const redis = getRedisPublisher();
    if (!redis) {
      if (isProductionRuntime()) {
        throw new Error("redisUnavailable");
      }
      return this.fallbackLimiter.consume(key);
    }

    const bucketKey = `${this.prefix}:${key}`;
    try {
      const result = await redis
        .multi()
        .incr(bucketKey)
        .pexpire(bucketKey, this.windowMs, "NX")
        .exec();

      const count = Array.isArray(result?.[0]) ? Number(result?.[0][1]) : 0;
      if (count > this.max) {
        throw new Error("rateLimited");
      }
    } catch (error) {
      if (isProductionRuntime()) {
        throw error;
      }
      return this.fallbackLimiter.consume(key);
    }
  }
}

export const createRateLimiter = (config: RateLimitConfig): RateLimiter => {
  const redis = getRedisPublisher();
  if (!redis) {
    const logger = getLogger();
    if (isProductionRuntime()) {
      logger.error({ prefix: config.prefix }, "Redis rate limiter unavailable in production.");
      throw new Error("redisUnavailable");
    }
    logger.warn({ prefix: config.prefix }, "Using in-memory rate limiter; Redis unavailable.");
    return new MemoryRateLimiter(config);
  }
  return new RedisRateLimiter(config);
};
