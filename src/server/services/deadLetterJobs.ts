import { randomUUID } from "node:crypto";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";
import { retryJob, withJobLock, type JobPayload } from "@/server/jobs";
import { getLogger } from "@/server/logging";

const writeDeadLetterActionAudit = async (input: {
  client: Parameters<typeof writeAuditLog>[0];
  organizationId: string;
  jobOrganizationId?: string | null;
  actorId: string;
  action: "JOB_RETRY_STARTED" | "JOB_RETRY" | "JOB_RETRY_FAILED" | "JOB_RESOLVE";
  job: { id: string; jobName: string; attempts: number };
  updated: { attempts: number; resolvedAt: Date | null };
  before: unknown;
  after: unknown;
  requestId: string;
}) => {
  if (input.jobOrganizationId === null) {
    getLogger(input.requestId).info(
      {
        actorId: input.actorId,
        action: input.action,
        entity: "GlobalDeadLetterJob",
        entityId: input.job.id,
        jobName: input.job.jobName,
        attemptsBefore: input.job.attempts,
        attemptsAfter: input.updated.attempts,
        resolved: Boolean(input.updated.resolvedAt),
      },
      "platform global dead-letter action",
    );
    return;
  }
  await writeAuditLog(input.client, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: input.action,
    entity: "DeadLetterJob",
    entityId: input.job.id,
    before: toJson(input.before),
    after: toJson(input.after),
    requestId: input.requestId,
  });
};

export const listDeadLetterJobs = async (input: { organizationId: string | null }) =>
  prisma.deadLetterJob.findMany({
    where: { organizationId: input.organizationId },
    orderBy: { lastErrorAt: "desc" },
    select: {
      id: true,
      organizationId: true,
      jobName: true,
      attempts: true,
      lastError: true,
      lastErrorAt: true,
      resolvedAt: true,
      resolvedById: true,
      retryAttemptId: true,
      retryStartedAt: true,
      createdAt: true,
      updatedAt: true,
      resolvedBy: { select: { id: true, name: true, email: true } },
    },
  });

export const retryDeadLetterJob = async (input: {
  jobId: string;
  actorId: string;
  organizationId: string;
  jobOrganizationId?: string | null;
  requestId: string;
}) => {
  const organizationId = input.jobOrganizationId === null ? null : input.organizationId;
  const retryAttemptId = randomUUID();
  // Commit the claim before invoking a handler. A crash or uncertain final write
  // leaves the claim in place; no timer can decide whether an external effect ran.
  const job = await prisma.$transaction(async (tx) => {
    const job = await tx.deadLetterJob.findFirst({
      where: {
        id: input.jobId,
        organizationId,
      },
    });
    if (!job) {
      throw new AppError("jobNotFound", "NOT_FOUND", 404);
    }
    if (job.resolvedAt) {
      throw new AppError("jobAlreadyResolved", "CONFLICT", 409);
    }
    if (job.retryAttemptId) {
      throw new AppError("jobRetryInProgress", "CONFLICT", 409);
    }
    const retryStartedAt = new Date();
    const claimed = await tx.deadLetterJob.updateMany({
      where: { id: job.id, organizationId, resolvedAt: null, retryAttemptId: null },
      data: {
        retryAttemptId,
        retryStartedAt,
      },
    });
    if (claimed.count !== 1) throw new AppError("jobRetryInProgress", "CONFLICT", 409);
    const updated = await tx.deadLetterJob.findUniqueOrThrow({ where: { id: job.id } });
    await writeDeadLetterActionAudit({
      client: tx,
      organizationId: input.organizationId,
      jobOrganizationId: input.jobOrganizationId,
      actorId: input.actorId,
      action: "JOB_RETRY_STARTED",
      job,
      updated,
      before: job,
      after: updated,
      requestId: input.requestId,
    });

    return updated;
  });

  const payload = job.payload as JobPayload | undefined;
  // No database transaction spans the handler or its internal retry delays.
  // Unexpected runner failures intentionally retain the durable unknown claim.
  const { result, attempts, error } = await retryJob(
    job.jobName,
    payload ?? undefined,
    async () => {
      const ownsClaim = await prisma.deadLetterJob.count({
        where: { id: job.id, organizationId, resolvedAt: null, retryAttemptId },
      });
      if (ownsClaim !== 1) throw new AppError("jobRetryStateChanged", "CONFLICT", 409);
    },
  );
  const succeeded = result?.status === "ok";
  const errorMessage =
    error instanceof Error
      ? error.message
      : result?.status === "skipped"
        ? `Job skipped: ${typeof result.details?.reason === "string" ? result.details.reason : "unspecified"}`
        : "jobFailed";

  return prisma.$transaction(async (tx) => {
    const completed = await tx.deadLetterJob.updateMany({
      where: { id: job.id, organizationId, resolvedAt: null, retryAttemptId },
      data: {
        attempts: { increment: attempts },
        retryAttemptId: null,
        retryStartedAt: null,
        ...(succeeded
          ? { resolvedAt: new Date(), resolvedById: input.actorId }
          : { lastError: errorMessage, lastErrorAt: new Date() }),
      },
    });
    if (completed.count !== 1) throw new AppError("jobRetryStateChanged", "CONFLICT", 409);
    const updated = await tx.deadLetterJob.findUniqueOrThrow({ where: { id: job.id } });
    await writeDeadLetterActionAudit({
      client: tx,
      organizationId: input.organizationId,
      jobOrganizationId: input.jobOrganizationId,
      actorId: input.actorId,
      action: succeeded ? "JOB_RETRY" : "JOB_RETRY_FAILED",
      job,
      updated,
      before: job,
      after: updated,
      requestId: input.requestId,
    });
    return { status: succeeded ? ("resolved" as const) : ("failed" as const), job: updated };
  });
};

export const resolveDeadLetterJob = async (input: {
  jobId: string;
  actorId: string;
  organizationId: string;
  jobOrganizationId?: string | null;
  requestId: string;
}) => {
  const where = {
    id: input.jobId,
    organizationId: input.jobOrganizationId === null ? null : input.organizationId,
  };
  const candidate = await prisma.deadLetterJob.findFirst({ where });
  if (!candidate) throw new AppError("jobNotFound", "NOT_FOUND", 404);
  if (candidate.resolvedAt) return candidate;
  const locked = await withJobLock(candidate.jobName, () =>
    prisma.$transaction(async (tx) => {
      const job = await tx.deadLetterJob.findFirst({
        where,
      });
      if (!job) {
        throw new AppError("jobNotFound", "NOT_FOUND", 404);
      }
      if (job.resolvedAt) {
        return job;
      }
      const resolved = await tx.deadLetterJob.updateMany({
        where: {
          id: job.id,
          organizationId: job.organizationId,
          resolvedAt: null,
          retryAttemptId: job.retryAttemptId,
        },
        data: {
          resolvedAt: new Date(),
          resolvedById: input.actorId,
          retryAttemptId: null,
          retryStartedAt: null,
        },
      });
      const updated = await tx.deadLetterJob.findUniqueOrThrow({ where: { id: job.id } });
      if (resolved.count !== 1) {
        if (updated.resolvedAt) return updated;
        throw new AppError("jobRetryStateChanged", "CONFLICT", 409);
      }

      await writeDeadLetterActionAudit({
        client: tx,
        organizationId: input.organizationId,
        jobOrganizationId: input.jobOrganizationId,
        actorId: input.actorId,
        action: "JOB_RESOLVE",
        job,
        updated,
        before: job,
        after: updated,
        requestId: input.requestId,
      });

      return updated;
    }),
  );
  if (!locked.acquired) throw new AppError("jobRetryInProgress", "CONFLICT", 409);
  return locked.value;
};
