import type { Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { getLogger } from "@/server/logging";
import { getRedisPublisher } from "@/server/redis";
import {
  incrementCounter,
  incrementGauge,
  decrementGauge,
  jobsFailedTotal,
  jobsInflight,
  jobsRetriedTotal,
} from "@/server/metrics/metrics";

const lockStore = new Map<string, number>();

const acquireLock = async (name: string, ttlMs: number) => {
  const redis = getRedisPublisher();
  const now = Date.now();

  if (redis) {
    const lockKey = `job-lock:${name}`;
    const result = await redis.set(lockKey, String(now), "PX", ttlMs, "NX");
    return result === "OK";
  }

  const existing = lockStore.get(name);
  if (existing && existing > now) {
    return false;
  }
  lockStore.set(name, now + ttlMs);
  return true;
};

const releaseLock = async (name: string) => {
  const redis = getRedisPublisher();
  if (redis) {
    await redis.del(`job-lock:${name}`);
  }
  lockStore.delete(name);
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
    return { job: name, status: "skipped", details: { reason: "unknown" } };
  }

  const locked = await acquireLock(name, 5 * 60 * 1000);
  if (!locked) {
    return { job: name, status: "skipped", details: { reason: "locked" } };
  }

  try {
    incrementGauge(jobsInflight, undefined, 1);
    const { result, attempts, error } = await executeJob(name, payload);
    if (result) {
      return result;
    }

    incrementCounter(jobsFailedTotal, { job: name });
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
    decrementGauge(jobsInflight, undefined, 1);
    await releaseLock(name);
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
