import Redis from "ioredis";

import { isProductionRuntime } from "@/server/config/runtime";
import { getLogger } from "@/server/logging";

type RedisState = {
  publisher: Redis | null;
  subscriber: Redis | null;
  warnedMissing: boolean;
  warnedError: boolean;
  readinessCheck: Promise<void> | null;
};

const globalForRedis = globalThis as typeof globalThis & {
  __bazaarRedisState?: RedisState;
};

const state: RedisState = globalForRedis.__bazaarRedisState ?? {
  publisher: null,
  subscriber: null,
  warnedMissing: false,
  warnedError: false,
  readinessCheck: null,
};

if (!globalForRedis.__bazaarRedisState) {
  globalForRedis.__bazaarRedisState = state;
}

const toLogError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
};

const getRedisUrl = () => {
  const url = process.env.REDIS_URL ?? "";
  if (!url && isProductionRuntime()) {
    throw new Error("REDIS_URL is required in production.");
  }
  if (url && /^https?:\/\//i.test(url)) {
    throw new Error("REDIS_URL must use redis:// or rediss:// (Upstash REST URL is not supported here).");
  }
  return url;
};

export const assertRedisConfigured = () => {
  getRedisUrl();
};

const createClient = (role: "publisher" | "subscriber") => {
  const url = getRedisUrl();
  const logger = getLogger();
  if (!url) {
    if (!state.warnedMissing) {
      state.warnedMissing = true;
      logger.warn("REDIS_URL is not set; falling back to in-memory realtime and rate limiting.");
    }
    return null;
  }

  try {
    const client = new Redis(url, {
      // Subscriber is connected explicitly before SUBSCRIBE to avoid INFO checks in subscriber mode.
      lazyConnect: role === "subscriber",
      maxRetriesPerRequest: role === "subscriber" ? null : 2,
      connectTimeout: 3_000,
      commandTimeout: 5_000,
      // Subscriber connections should not run INFO-based ready checks after SUBSCRIBE.
      enableReadyCheck: role !== "subscriber",
      // Queue commands until socket is writable; bounded by connect/command timeout and retry strategy.
      enableOfflineQueue: true,
      retryStrategy: (attempt) => {
        if (attempt > 8) {
          return null;
        }
        return Math.min(1_500, 100 * attempt);
      },
    });

    client.on("error", (error) => {
      if (!state.warnedError) {
        state.warnedError = true;
        logger.warn({ error: toLogError(error), role }, "Redis connection error.");
      }
    });
    client.on("ready", () => {
      state.warnedError = false;
      state.readinessCheck = null;
    });
    client.on("end", () => {
      state.readinessCheck = null;
      if (role === "publisher") {
        state.publisher = null;
      } else {
        state.subscriber = null;
      }
    });

    return client;
  } catch (error) {
    if (isProductionRuntime()) {
      throw error;
    }
    if (!state.warnedError) {
      state.warnedError = true;
      logger.warn({ error: toLogError(error), role }, "Redis client init failed; falling back to in-memory behavior.");
    }
    return null;
  }
};

export const getRedisPublisher = () => {
  if (state.publisher?.status === "end") {
    state.publisher = null;
  }
  if (!state.publisher) {
    state.publisher = createClient("publisher");
  }
  return state.publisher;
};

export const getRedisSubscriber = () => {
  if (state.subscriber?.status === "end") {
    state.subscriber = null;
  }
  if (!state.subscriber) {
    state.subscriber = createClient("subscriber");
  }
  return state.subscriber;
};

export const redisConfigured = () => Boolean(getRedisUrl());

export const assertRedisReady = async () => {
  const url = getRedisUrl();
  if (!url || !isProductionRuntime()) {
    return;
  }

  if (state.readinessCheck) {
    return state.readinessCheck;
  }

  state.readinessCheck = (async () => {
    let client = getRedisPublisher();
    if (!client) {
      throw new Error("REDIS_URL is configured but Redis publisher is unavailable.");
    }
    try {
      if (client.status === "end") {
        state.publisher = null;
        client = getRedisPublisher();
      }
      if (!client) {
        throw new Error("REDIS_URL is configured but Redis publisher is unavailable.");
      }
      if (client.status === "wait") {
        await client.connect();
      }
      await client.ping();
    } catch {
      state.publisher = null;
      throw new Error("REDIS_URL is configured but Redis is unreachable in production.");
    }
  })();

  try {
    await state.readinessCheck;
  } catch (error) {
    state.readinessCheck = null;
    throw error;
  }
};
