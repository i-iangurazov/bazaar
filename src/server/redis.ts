import Redis from "ioredis";

import { isProductionRuntime } from "@/server/config/runtime";
import { getLogger } from "@/server/logging";

type RedisState = {
  publisher: Redis | null;
  subscriber: Redis | null;
  warnedMissing: boolean;
  warnedError: boolean;
  fatalRedisError: Error | null;
};

const globalForRedis = globalThis as typeof globalThis & {
  __bazaarRedisState?: RedisState;
};

const state: RedisState = globalForRedis.__bazaarRedisState ?? {
  publisher: null,
  subscriber: null,
  warnedMissing: false,
  warnedError: false,
  fatalRedisError: null,
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
      maxRetriesPerRequest: role === "subscriber" ? null : 1,
      connectTimeout: 1_000,
      commandTimeout: 2_000,
      // Subscriber connections should not run INFO-based ready checks after SUBSCRIBE.
      enableReadyCheck: role !== "subscriber",
      // Subscriber should queue SUBSCRIBE until ready; publisher remains fail-fast.
      enableOfflineQueue: role === "subscriber",
      retryStrategy: (attempt) => (attempt > 1 ? null : 100),
    });

    client.on("error", (error) => {
      state.fatalRedisError = error instanceof Error ? error : new Error(String(error));
      if (!state.warnedError) {
        state.warnedError = true;
        logger.warn({ error: toLogError(error), role }, "Redis connection error.");
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
  if (isProductionRuntime() && state.fatalRedisError) {
    throw state.fatalRedisError;
  }
  if (!state.publisher) {
    state.publisher = createClient("publisher");
  }
  return state.publisher;
};

export const getRedisSubscriber = () => {
  if (isProductionRuntime() && state.fatalRedisError) {
    throw state.fatalRedisError;
  }
  if (!state.subscriber) {
    state.subscriber = createClient("subscriber");
  }
  return state.subscriber;
};

export const redisConfigured = () => Boolean(getRedisUrl());
