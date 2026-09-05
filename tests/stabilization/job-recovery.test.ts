import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// Static job imports are blocked before the shared registry loads. Only synthetic
// handlers registered below execute; no provider, scheduler or commerce job runs.
vi.mock("@/server/jobs/emailMarketing", () => ({
  EMAIL_CAMPAIGN_RECONCILE_JOB_NAME: "blocked-email-reconcile",
  EMAIL_CAMPAIGN_SEND_JOB_NAME: "blocked-email-send",
  runEmailCampaignReconcileJob: () => {
    throw new Error("Excluded real job");
  },
  runEmailCampaignSendJob: () => {
    throw new Error("Excluded real job");
  },
}));
vi.mock("@/server/jobs/customerOrderFollowUps", () => ({
  CUSTOMER_ORDER_FOLLOW_UP_JOB_NAME: "blocked-follow-up",
  runCustomerOrderFollowUpJob: () => {
    throw new Error("Excluded real job");
  },
}));
vi.mock("@/server/jobs/orderConfirmationEmails", () => ({
  ORDER_CONFIRMATION_EMAIL_JOB_NAME: "blocked-order-email",
  runOrderConfirmationEmailJob: () => {
    throw new Error("Excluded real job");
  },
}));

import { prisma } from "@/server/db/prisma";
import * as jobRunner from "@/server/jobs";
import { getRedisPublisher } from "@/server/redis";
import { registerJob, retryJob, runJob, type JobDefinition } from "@/server/jobs";
import { retryDeadLetterJob, resolveDeadLetterJob } from "@/server/services/deadLetterJobs";
import { cleanupCommerceFixtures, createCommerceFixtures, type CommerceFixtures } from "./fixtures";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("durable synthetic job recovery with PostgreSQL and Redis", () => {
  let fixture: CommerceFixtures;
  let failAuditAction: string | null = null;
  const names = new Set<string>();
  beforeAll(async () => {
    expect(await getRedisPublisher()!.ping()).toBe("PONG");
    prisma.$use(async (params, next) => {
      if (
        params.model === "AuditLog" &&
        params.action === "create" &&
        params.args?.data?.action === failAuditAction
      ) {
        throw new Error("Synthetic audit commit failure");
      }
      return next(params);
    });
  });
  beforeEach(async () => {
    fixture = await createCommerceFixtures(prisma);
  });
  afterEach(async () => {
    failAuditAction = null;
    vi.restoreAllMocks();
    if (!fixture) return;
    await prisma.deadLetterJob.deleteMany({
      where: { organizationId: { in: [fixture.tenants.a.org.id, fixture.tenants.b.org.id] } },
    });
    for (const name of names) await getRedisPublisher()!.del(`job-lock:${name}`);
    names.clear();
    await cleanupCommerceFixtures(prisma, fixture);
  });
  afterAll(async () => {
    await getRedisPublisher()?.quit();
  });

  const syntheticJob = (handler: JobDefinition["handler"], suffix = "job") => {
    const name = `${fixture.prefix}-${suffix}-${randomUUID()}`;
    names.add(name);
    registerJob(name, { handler, maxAttempts: 2, baseDelayMs: 1 });
    return name;
  };
  const deadLetter = (jobName: string) =>
    prisma.deadLetterJob.create({
      data: {
        organizationId: fixture.tenants.a.org.id,
        jobName,
        payload: { organizationId: fixture.tenants.a.org.id, synthetic: true },
        attempts: 2,
        lastError: "Synthetic exhausted failure",
      },
    });
  const retryInput = (jobId: string) => ({
    jobId,
    actorId: fixture.tenants.a.users.ADMIN.id,
    organizationId: fixture.tenants.a.org.id,
    requestId: randomUUID(),
  });

  test("exhaustion persists one recoverable failure and a successful retry accounts for its attempt", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("Synthetic provider failure"));
    const name = syntheticJob(handler);
    expect(await runJob(name, { organizationId: fixture.tenants.a.org.id })).toMatchObject({
      status: "skipped",
      details: { reason: "failed" },
    });
    expect(handler).toHaveBeenCalledTimes(2);
    const job = await prisma.deadLetterJob.findFirstOrThrow({ where: { jobName: name } });
    expect(job).toMatchObject({
      attempts: 2,
      lastError: "Synthetic provider failure",
      resolvedAt: null,
    });
    handler.mockResolvedValue({ job: name, status: "ok" });
    const result = await retryDeadLetterJob(retryInput(job.id));
    expect(result).toMatchObject({ status: "resolved", job: { attempts: 3 } });
    expect(result.job.resolvedAt).toBeInstanceOf(Date);
    await expect(retryDeadLetterJob(retryInput(job.id))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(handler).toHaveBeenCalledTimes(3);
    expect(await prisma.deadLetterJob.count({ where: { jobName: name } })).toBe(1);
  });

  test.each(["failed", "unknown"])(
    "a skipped %s outcome cannot resolve a dead letter",
    async (reason) => {
      const handler = vi.fn(async () => ({
        job: "synthetic",
        status: "skipped" as const,
        details: { reason },
      }));
      const job = await deadLetter(syntheticJob(handler));
      const result = await retryDeadLetterJob(retryInput(job.id));
      expect(result).toMatchObject({ status: "failed", job: { resolvedAt: null, attempts: 3 } });
      expect(handler).toHaveBeenCalledTimes(1);
    },
  );

  test("an unregistered job remains unresolved without inventing an execution attempt", async () => {
    const job = await deadLetter(`${fixture.prefix}-unregistered`);
    expect(await retryDeadLetterJob(retryInput(job.id))).toMatchObject({
      status: "failed",
      job: { resolvedAt: null, attempts: 2 },
    });
  });

  test("two concurrent retries of the same row invoke its callback only once", async () => {
    const entered = deferred();
    const release = deferred();
    let calls = 0;
    const name = syntheticJob(async () => {
      calls += 1;
      if (calls === 1) {
        entered.resolve();
        await release.promise;
      }
      return { job: "synthetic", status: "ok" };
    });
    const job = await deadLetter(name);
    const first = retryDeadLetterJob(retryInput(job.id));
    let second: PromiseSettledResult<Awaited<typeof first>> | undefined;
    try {
      await entered.promise;
      [second] = await Promise.allSettled([retryDeadLetterJob(retryInput(job.id))]);
    } finally {
      release.resolve();
      await first;
    }
    expect(calls).toBe(1);
    expect(second).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
  });

  test("manual retries honor the normal runner's Redis owner lock", async () => {
    const entered = deferred();
    const release = deferred();
    let calls = 0;
    const name = syntheticJob(async () => {
      calls += 1;
      if (calls === 1) {
        entered.resolve();
        await release.promise;
      }
      return { job: "synthetic", status: "ok" };
    });
    const running = runJob(name);
    let retry;
    try {
      await entered.promise;
      expect(await getRedisPublisher()!.get(`job-lock:${name}`)).toBeTruthy();
      retry = await retryJob(name);
    } finally {
      release.resolve();
      await running;
    }
    expect(calls).toBe(1);
    expect(retry).toMatchObject({
      attempts: 0,
      result: { status: "skipped", details: { reason: "locked" } },
    });
    expect(await getRedisPublisher()!.get(`job-lock:${name}`)).toBeNull();
  });

  test("a foreign tenant cannot retry or resolve another tenant's failure", async () => {
    const handler = vi.fn(async () => ({ job: "synthetic", status: "ok" as const }));
    const job = await deadLetter(syntheticJob(handler));
    const input = {
      ...retryInput(job.id),
      organizationId: fixture.tenants.b.org.id,
      actorId: fixture.tenants.b.users.ADMIN.id,
    };
    await expect(retryDeadLetterJob(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(resolveDeadLetterJob(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(handler).not.toHaveBeenCalled();
    expect(await prisma.deadLetterJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      attempts: 2,
      resolvedAt: null,
    });
  });

  test("an exhausted retry preserves the row and counts actual attempts", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("Synthetic repeated failure"));
    const job = await deadLetter(syntheticJob(handler));
    expect(await retryDeadLetterJob(retryInput(job.id))).toMatchObject({
      status: "failed",
      job: { attempts: 4, resolvedAt: null, lastError: "Synthetic repeated failure" },
    });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(await prisma.deadLetterJob.count({ where: { jobName: job.jobName } })).toBe(1);
  });

  test("the retry claim is committed and queryable while its handler is still running", async () => {
    const entered = deferred();
    const release = deferred();
    const job = await deadLetter(
      syntheticJob(async () => {
        entered.resolve();
        await release.promise;
        return { job: "synthetic", status: "ok" };
      }),
    );
    const running = retryDeadLetterJob(retryInput(job.id));
    try {
      await entered.promise;
      const persisted = await prisma.deadLetterJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(persisted.retryAttemptId).toEqual(expect.any(String));
      expect(persisted.retryStartedAt).toBeInstanceOf(Date);
      expect(persisted.resolvedAt).toBeNull();
      // A separate transaction can obtain the row lock before the handler ends.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT id FROM "DeadLetterJob" WHERE id = ${job.id} FOR UPDATE NOWAIT`;
      });
    } finally {
      release.resolve();
      await running;
    }
  });

  test("failed claim persistence rolls back ownership and never invokes the handler", async () => {
    const handler = vi.fn(async () => ({ job: "synthetic", status: "ok" as const }));
    const job = await deadLetter(syntheticJob(handler));
    failAuditAction = "JOB_RETRY_STARTED";
    try {
      await expect(retryDeadLetterJob(retryInput(job.id))).rejects.toThrow(
        "Synthetic audit commit failure",
      );
    } finally {
      failAuditAction = null;
    }
    expect(handler).not.toHaveBeenCalled();
    expect(await prisma.deadLetterJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      retryAttemptId: null,
      retryStartedAt: null,
      attempts: 2,
      resolvedAt: null,
    });
    expect(await retryDeadLetterJob(retryInput(job.id))).toMatchObject({ status: "resolved" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("a failed completion commit retains an uncertain claim until manual reconciliation", async () => {
    const handler = vi.fn(async () => ({ job: "synthetic", status: "ok" as const }));
    const job = await deadLetter(syntheticJob(handler));
    failAuditAction = "JOB_RETRY";
    try {
      await expect(retryDeadLetterJob(retryInput(job.id))).rejects.toThrow(
        "Synthetic audit commit failure",
      );
    } finally {
      failAuditAction = null;
    }
    const uncertain = await prisma.deadLetterJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(uncertain).toMatchObject({
      resolvedAt: null,
      attempts: 2,
      retryAttemptId: expect.any(String),
      retryStartedAt: expect.any(Date),
    });
    await expect(retryDeadLetterJob(retryInput(job.id))).rejects.toMatchObject({
      message: "jobRetryInProgress",
      code: "CONFLICT",
    });
    expect(handler).toHaveBeenCalledTimes(1);
    const resolved = await resolveDeadLetterJob(retryInput(job.id));
    expect(resolved).toMatchObject({
      retryAttemptId: null,
      retryStartedAt: null,
      resolvedAt: expect.any(Date),
    });
    await expect(retryDeadLetterJob(retryInput(job.id))).rejects.toMatchObject({
      message: "jobAlreadyResolved",
    });
    const actions = await prisma.auditLog.findMany({
      where: { entityId: job.id },
      select: { action: true },
    });
    expect(actions.map((entry) => entry.action).sort()).toEqual([
      "JOB_RESOLVE",
      "JOB_RETRY_STARTED",
    ]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("an old interrupted claim never expires into an automatic replay", async () => {
    const handler = vi.fn(async () => ({ job: "synthetic", status: "ok" as const }));
    const job = await deadLetter(syntheticJob(handler));
    await prisma.deadLetterJob.update({
      where: { id: job.id },
      data: {
        retryAttemptId: randomUUID(),
        retryStartedAt: new Date("2000-01-01T00:00:00Z"),
      },
    });
    await expect(retryDeadLetterJob(retryInput(job.id))).rejects.toMatchObject({
      message: "jobRetryInProgress",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  test("manual resolution cannot clear a claim while its handler owns the job lock", async () => {
    const entered = deferred();
    const release = deferred();
    const job = await deadLetter(
      syntheticJob(async () => {
        entered.resolve();
        await release.promise;
        return { job: "synthetic", status: "ok" };
      }),
    );
    const running = retryDeadLetterJob(retryInput(job.id));
    try {
      await entered.promise;
      await expect(resolveDeadLetterJob(retryInput(job.id))).rejects.toMatchObject({
        message: "jobRetryInProgress",
        code: "CONFLICT",
      });
      expect(await prisma.deadLetterJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject(
        {
          resolvedAt: null,
          retryAttemptId: expect.any(String),
        },
      );
    } finally {
      release.resolve();
    }
    expect(await running).toMatchObject({
      status: "resolved",
      job: { attempts: 3, retryAttemptId: null },
    });
  });

  test("a claim resolved in the dispatch gap is rechecked after acquiring the job lock", async () => {
    const handler = vi.fn(async () => ({ job: "synthetic", status: "ok" as const }));
    const job = await deadLetter(syntheticJob(handler));
    const dispatch = jobRunner.retryJob;
    // Deterministic scheduling hook only: the claim, resolution, lock and guard
    // execute against the real PostgreSQL/Redis services.
    vi.spyOn(jobRunner, "retryJob").mockImplementationOnce(async (...args) => {
      await resolveDeadLetterJob(retryInput(job.id));
      return dispatch(...args);
    });
    await expect(retryDeadLetterJob(retryInput(job.id))).rejects.toMatchObject({
      message: "jobRetryStateChanged",
    });
    expect(handler).not.toHaveBeenCalled();
    expect(await prisma.deadLetterJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      resolvedAt: expect.any(Date),
      attempts: 2,
      retryAttemptId: null,
    });
  });

  test("completion is fenced against a different durable attempt owner", async () => {
    const entered = deferred();
    const release = deferred();
    const job = await deadLetter(
      syntheticJob(async () => {
        entered.resolve();
        await release.promise;
        return { job: "synthetic", status: "ok" };
      }),
    );
    const settled = Promise.allSettled([retryDeadLetterJob(retryInput(job.id))]);
    const replacementAttemptId = randomUUID();
    try {
      await entered.promise;
      // Synthetic out-of-band recovery action models a changed durable owner.
      await prisma.deadLetterJob.update({
        where: { id: job.id },
        data: { retryAttemptId: replacementAttemptId },
      });
    } finally {
      release.resolve();
    }
    expect(await settled).toMatchObject([
      { status: "rejected", reason: { message: "jobRetryStateChanged" } },
    ]);
    expect(await prisma.deadLetterJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      resolvedAt: null,
      attempts: 2,
      retryAttemptId: replacementAttemptId,
    });
  });

  test("a normal job cannot run while a manual retry owns its Redis lock", async () => {
    const entered = deferred();
    const release = deferred();
    const handler = vi.fn(async () => {
      entered.resolve();
      await release.promise;
      return { job: "synthetic", status: "ok" as const };
    });
    const name = syntheticJob(handler);
    const running = retryJob(name);
    try {
      await entered.promise;
      expect(await runJob(name)).toMatchObject({
        status: "skipped",
        details: { reason: "locked" },
      });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
      await running;
    }
  });
});
