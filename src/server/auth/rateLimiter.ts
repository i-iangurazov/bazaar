import { createHash } from "node:crypto";

import { createRateLimiter } from "@/server/middleware/rateLimiter";
import { isProductionRuntime } from "@/server/config/runtime";
import { getRedisPublisher } from "@/server/redis";

export const loginRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 15,
  prefix: "login",
});

const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60_000;
const LOGIN_BACKOFF_BASE_MS = 1_000;
const LOGIN_BACKOFF_MAX_MS = 60_000;
const LOGIN_BACKOFF_START_ATTEMPT = 5;
const LOGIN_LOCKOUT_ATTEMPT = 10;

const hashValue = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 20);

const keyParts = (email: string, ip: string) => {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedIp = ip.trim() || "unknown";
  const emailHash = hashValue(normalizedEmail);
  const ipHash = hashValue(normalizedIp);
  return {
    userFailKey: `auth:login:fail:user:${emailHash}`,
    pairFailKey: `auth:login:fail:pair:${emailHash}:${ipHash}`,
    lockKey: `auth:login:lock:user:${emailHash}`,
    backoffKey: `auth:login:backoff:pair:${emailHash}:${ipHash}`,
  };
};

type MemoryEntry = {
  value: string;
  expiresAt: number;
};

const memoryStore = new Map<string, MemoryEntry>();

const readMemory = (key: string) => {
  const now = Date.now();
  const current = memoryStore.get(key);
  if (!current) {
    return null;
  }
  if (current.expiresAt <= now) {
    memoryStore.delete(key);
    return null;
  }
  return current.value;
};

const writeMemory = (key: string, value: string, ttlMs: number) => {
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlMs });
};

const incrMemory = (key: string, ttlMs: number) => {
  const now = Date.now();
  const current = memoryStore.get(key);
  if (!current || current.expiresAt <= now) {
    memoryStore.set(key, { value: "1", expiresAt: now + ttlMs });
    return 1;
  }
  const next = Number(current.value) + 1;
  memoryStore.set(key, { value: String(next), expiresAt: current.expiresAt });
  return next;
};

const deleteMemory = (...keys: string[]) => {
  keys.forEach((key) => memoryStore.delete(key));
};

const resolveBackoffMs = (attempts: number) => {
  if (attempts < LOGIN_BACKOFF_START_ATTEMPT) {
    return 0;
  }
  const exponent = attempts - LOGIN_BACKOFF_START_ATTEMPT;
  return Math.min(LOGIN_BACKOFF_MAX_MS, LOGIN_BACKOFF_BASE_MS * 2 ** exponent);
};

export const assertLoginAttemptAllowed = async (input: { email: string; ip: string }) => {
  const redis = getRedisPublisher();
  const { lockKey, backoffKey } = keyParts(input.email, input.ip);
  const now = Date.now();
  if (redis) {
    const [lockedUntilRaw, backoffUntilRaw] = await redis.mget(lockKey, backoffKey);
    if (lockedUntilRaw && Number(lockedUntilRaw) > now) {
      throw new Error("loginLocked");
    }
    if (backoffUntilRaw && Number(backoffUntilRaw) > now) {
      throw new Error("loginBackoff");
    }
    return;
  }

  if (isProductionRuntime()) {
    throw new Error("redisUnavailable");
  }

  const lockedUntil = Number(readMemory(lockKey) ?? "0");
  if (lockedUntil > now) {
    throw new Error("loginLocked");
  }
  const backoffUntil = Number(readMemory(backoffKey) ?? "0");
  if (backoffUntil > now) {
    throw new Error("loginBackoff");
  }
};

export const registerLoginFailure = async (input: { email: string; ip: string }) => {
  const redis = getRedisPublisher();
  const { userFailKey, pairFailKey, lockKey, backoffKey } = keyParts(input.email, input.ip);
  const now = Date.now();

  if (redis) {
    const result = await redis
      .multi()
      .incr(userFailKey)
      .pexpire(userFailKey, LOGIN_FAILURE_WINDOW_MS, "NX")
      .incr(pairFailKey)
      .pexpire(pairFailKey, LOGIN_FAILURE_WINDOW_MS, "NX")
      .exec();
    const userAttempts = Number(Array.isArray(result?.[0]) ? result?.[0][1] : 1);
    const pairAttempts = Number(Array.isArray(result?.[2]) ? result?.[2][1] : 1);
    const maxAttempts = Math.max(userAttempts, pairAttempts);

    if (maxAttempts >= LOGIN_LOCKOUT_ATTEMPT) {
      const lockedUntil = now + LOGIN_LOCKOUT_WINDOW_MS;
      await redis.set(lockKey, String(lockedUntil), "PX", LOGIN_LOCKOUT_WINDOW_MS);
      return;
    }

    const backoffMs = resolveBackoffMs(maxAttempts);
    if (backoffMs > 0) {
      const backoffUntil = now + backoffMs;
      await redis.set(backoffKey, String(backoffUntil), "PX", backoffMs);
    }
    return;
  }

  if (isProductionRuntime()) {
    throw new Error("redisUnavailable");
  }

  const userAttempts = incrMemory(userFailKey, LOGIN_FAILURE_WINDOW_MS);
  const pairAttempts = incrMemory(pairFailKey, LOGIN_FAILURE_WINDOW_MS);
  const maxAttempts = Math.max(userAttempts, pairAttempts);
  if (maxAttempts >= LOGIN_LOCKOUT_ATTEMPT) {
    writeMemory(lockKey, String(now + LOGIN_LOCKOUT_WINDOW_MS), LOGIN_LOCKOUT_WINDOW_MS);
    return;
  }
  const backoffMs = resolveBackoffMs(maxAttempts);
  if (backoffMs > 0) {
    writeMemory(backoffKey, String(now + backoffMs), backoffMs);
  }
};

export const clearLoginFailures = async (input: { email: string; ip: string }) => {
  const redis = getRedisPublisher();
  const { userFailKey, pairFailKey, lockKey, backoffKey } = keyParts(input.email, input.ip);
  if (redis) {
    await redis.del(userFailKey, pairFailKey, lockKey, backoffKey);
    return;
  }
  if (isProductionRuntime()) {
    throw new Error("redisUnavailable");
  }
  deleteMemory(userFailKey, pairFailKey, lockKey, backoffKey);
};
