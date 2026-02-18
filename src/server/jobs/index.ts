import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { isProductionRuntime } from "@/server/config/runtime";
import { prisma } from "@/server/db/prisma";
import { getLogger } from "@/server/logging";
import { getRedisPublisher } from "@/server/redis";
import {
  jobDurationMs,
  jobsCompletedTotal,
  incrementCounter,
  incrementGauge,
  decrementGauge,
  jobsFailedTotal,
  jobsInflight,
  jobsSkippedTotal,
  jobsRetriedTotal,
  observeHistogram,
  redisOperationDurationMs,
  redisOperationsTotal,
} from "@/server/metrics/metrics";

type InMemoryLock = {
  ownerToken: string;
  expiresAt: number;
};

type LockHandle = {
  name: string;
  ownerToken: string;
  ttlMs: number;
};

const lockStore = new Map<string, InMemoryLock>();

const buildLockKey = (name: string) => `job-lock:${name}`;

const compareAndDeleteScript = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const compareAndPexpireScript = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`;

const recordRedisOperationMetric = (
  operation: "lock_set" | "lock_renew" | "lock_release",
  status: "ok" | "error",
  startedAt: number,
) => {
  incrementCounter(redisOperationsTotal, { operation, status });
  observeHistogram(redisOperationDurationMs, { operation }, Date.now() - startedAt);
};

const acquireLock = async (name: string, ttlMs: number): Promise<LockHandle | null> => {
  const logger = getLogger();
  const now = Date.now();
  const redis = getRedisPublisher();
  const ownerToken = randomUUID();

  if (redis) {
    const lockKey = buildLockKey(name);
    const startedAt = Date.now();
    try {
      const result = await redis.set(lockKey, ownerToken, "PX", ttlMs, "NX");
      recordRedisOperationMetric("lock_set", "ok", startedAt);
      if (result === "OK") {
        return { name, ownerToken, ttlMs };
      }
      return null;
    } catch (error) {
      recordRedisOperationMetric("lock_set", "error", startedAt);
      if (isProductionRuntime()) {
        throw error;
      }
      logger.warn({ job: name, error }, "redis lock unavailable; falling back to in-memory lock");
    }
  }

  if (isProductionRuntime()) {
    throw new Error("redisLockUnavailable");
  }

  const existing = lockStore.get(name);
  if (existing && existing.expiresAt > now) {
    return null;
  }
  lockStore.set(name, { ownerToken, expiresAt: now + ttlMs });
  return { name, ownerToken, ttlMs };
};

const renewLock = async (lock: LockHandle) => {
  const redis = getRedisPublisher();
  const logger = getLogger();
  if (redis) {
    const startedAt = Date.now();
    try {
      const result = await redis.eval(
        compareAndPexpireScript,
        1,
        buildLockKey(lock.name),
        lock.ownerToken,
        String(lock.ttlMs),
      );
      recordRedisOperationMetric("lock_renew", "ok", startedAt);
      return result === 1;
    } catch (error) {
      recordRedisOperationMetric("lock_renew", "error", startedAt);
      if (isProductionRuntime()) {
        throw error;
      }
      logger.warn({ job: lock.name, error }, "redis lock renew unavailable; renewing in-memory lock only");
    }
  }
  if (isProductionRuntime() && !redis) {
    throw new Error("redisLockUnavailable");
  }
  const current = lockStore.get(lock.name);
  if (!current || current.ownerToken !== lock.ownerToken || current.expiresAt <= Date.now()) {
    return false;
  }
  lockStore.set(lock.name, {
    ownerToken: lock.ownerToken,
    expiresAt: Date.now() + lock.ttlMs,
  });
  return true;
};

const releaseLock = async (lock: LockHandle) => {
  const redis = getRedisPublisher();
  const logger = getLogger();
  if (redis) {
    const startedAt = Date.now();
    try {
      await redis.eval(compareAndDeleteScript, 1, buildLockKey(lock.name), lock.ownerToken);
      recordRedisOperationMetric("lock_release", "ok", startedAt);
    } catch (error) {
      recordRedisOperationMetric("lock_release", "error", startedAt);
      if (isProductionRuntime()) {
        throw error;
      }
      logger.warn({ job: lock.name, error }, "redis unlock unavailable; releasing in-memory lock only");
    }
  }
  if (isProductionRuntime() && !redis) {
    throw new Error("redisLockUnavailable");
  }
  const current = lockStore.get(lock.name);
  if (current?.ownerToken === lock.ownerToken) {
    lockStore.delete(lock.name);
  }
};

export type JobResult = {
  job: string;
  status: "ok" | "skipped";
  details?: Record<string, unknown>;
};

export type JobPayload = Prisma.InputJsonValue | null | undefined;

export type JobDefinition = {
  handler: (payload?: JobPayload) => Promise<JobResult>;
  maxAttempts?: number;
  baseDelayMs?: number;
};

const cleanupIdempotencyKeys = async (): Promise<JobResult> => {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const result = await prisma.idempotencyKey.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return {
    job: "cleanup-idempotency-keys",
    status: "ok",
    details: { deleted: result.count },
  };
};

const jobs: Record<string, JobDefinition> = {
  "cleanup-idempotency-keys": {
    handler: cleanupIdempotencyKeys,
    maxAttempts: 3,
    baseDelayMs: 1000,
  },
};

export const registerJob = (name: string, definition: JobDefinition) => {
  jobs[name] = definition;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const executeJob = async (
  name: string,
  payload?: JobPayload,
): Promise<{ result: JobResult | null; attempts: number; error?: unknown }> => {
  const logger = getLogger();
  const definition = jobs[name];
  if (!definition) {
    return { result: { job: name, status: "skipped", details: { reason: "unknown" } }, attempts: 0 };
  }

  const maxAttempts = definition.maxAttempts ?? 3;
  const baseDelayMs = definition.baseDelayMs ?? 1000;

  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      if (attempts > 1) {
        incrementCounter(jobsRetriedTotal, { job: name });
      }
      const result = await definition.handler(payload);
      logger.info({ job: name, attempts }, "job completed");
      return { result, attempts };
    } catch (error) {
      logger.warn({ job: name, attempts, error }, "job attempt failed");
      if (attempts >= maxAttempts) {
        return { result: null, attempts, error };
      }
      const delay = baseDelayMs * Math.pow(2, attempts - 1);
      await sleep(delay);
    }
  }

  return { result: null, attempts, error: new Error("jobFailed") };
};

export const runJob = async (name: string, payload?: JobPayload): Promise<JobResult> => {
  const logger = getLogger();
  const job = jobs[name];
  if (!job) {
    incrementCounter(jobsSkippedTotal, { job: name, reason: "unknown" });
    return { job: name, status: "skipped", details: { reason: "unknown" } };
  }

  const lock = await acquireLock(name, 5 * 60 * 1000);
  if (!lock) {
    incrementCounter(jobsSkippedTotal, { job: name, reason: "locked" });
    return { job: name, status: "skipped", details: { reason: "locked" } };
  }
  const startedAt = Date.now();
  const renewEveryMs = Math.max(5_000, Math.floor(lock.ttlMs / 3));
  let lockRenewTimer: NodeJS.Timeout | null = setInterval(() => {
    void renewLock(lock).catch((error) => {
      logger.warn({ job: name, error }, "job lock renew failed");
    });
  }, renewEveryMs);
  lockRenewTimer.unref?.();

  try {
    incrementGauge(jobsInflight, undefined, 1);
    const { result, attempts, error } = await executeJob(name, payload);
    if (result) {
      incrementCounter(jobsCompletedTotal, { job: name, status: result.status });
      return result;
    }

    incrementCounter(jobsFailedTotal, { job: name });
    incrementCounter(jobsSkippedTotal, { job: name, reason: "failed" });
    const errorMessage = error instanceof Error ? error.message : "jobFailed";
    const organizationId =
      payload && typeof payload === "object" && "organizationId" in payload
        ? String((payload as Record<string, unknown>).organizationId ?? "")
        : null;

    await prisma.deadLetterJob.create({
      data: {
        organizationId: organizationId || undefined,
        jobName: name,
        payload: payload ?? undefined,
        attempts,
        lastError: errorMessage,
        lastErrorAt: new Date(),
      },
    });
    logger.error({ job: name, attempts, error }, "job failed; dead letter created");
    return { job: name, status: "skipped", details: { reason: "failed" } };
  } finally {
    if (lockRenewTimer) {
      clearInterval(lockRenewTimer);
      lockRenewTimer = null;
    }
    decrementGauge(jobsInflight, undefined, 1);
    observeHistogram(jobDurationMs, { job: name }, Date.now() - startedAt);
    await releaseLock(lock);
  }
};

export const listJobs = () => Object.keys(jobs);

export const retryJob = async (jobName: string, payload?: JobPayload) => {
  const { result, attempts, error } = await executeJob(jobName, payload);
  if (result) {
    return { result, attempts, error: null };
  }
  return { result: null, attempts, error };
};

export const registerJobForTests = (name: string, handler: JobDefinition["handler"]) => {
  if (process.env.NODE_ENV !== "test") {
    return;
  }
  jobs[name] = {
    handler,
    maxAttempts: 2,
    baseDelayMs: 1,
  };
};
