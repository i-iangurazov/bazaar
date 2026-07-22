import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";
import { retryJob, type JobPayload } from "@/server/jobs";

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
}) =>
  prisma.$transaction(async (tx) => {
    const job = await tx.deadLetterJob.findFirst({
      where: {
        id: input.jobId,
        organizationId: input.jobOrganizationId === null ? null : input.organizationId,
      },
    });
    if (!job) {
      throw new AppError("jobNotFound", "NOT_FOUND", 404);
    }
    if (job.resolvedAt) {
      throw new AppError("jobAlreadyResolved", "CONFLICT", 409);
    }

    const payload = job.payload as JobPayload | undefined;
    const { result, attempts, error } = await retryJob(job.jobName, payload ?? undefined);

    if (result) {
      const updated = await tx.deadLetterJob.update({
        where: { id: job.id },
        data: {
          resolvedAt: new Date(),
          resolvedById: input.actorId,
        },
      });

      await writeAuditLog(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "JOB_RETRY",
        entity: "DeadLetterJob",
        entityId: job.id,
        before: toJson(job),
        after: toJson(updated),
        requestId: input.requestId,
      });

      return { status: "resolved" as const, job: updated };
    }

    const errorMessage = error instanceof Error ? error.message : "jobFailed";
    const updated = await tx.deadLetterJob.update({
      where: { id: job.id },
      data: {
        attempts: job.attempts + attempts,
        lastError: errorMessage,
        lastErrorAt: new Date(),
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "JOB_RETRY_FAILED",
      entity: "DeadLetterJob",
      entityId: job.id,
      before: toJson(job),
      after: toJson(updated),
      requestId: input.requestId,
    });

    return { status: "failed" as const, job: updated };
  });

export const resolveDeadLetterJob = async (input: {
  jobId: string;
  actorId: string;
  organizationId: string;
  jobOrganizationId?: string | null;
  requestId: string;
}) =>
  prisma.$transaction(async (tx) => {
    const job = await tx.deadLetterJob.findFirst({
      where: {
        id: input.jobId,
        organizationId: input.jobOrganizationId === null ? null : input.organizationId,
      },
    });
    if (!job) {
      throw new AppError("jobNotFound", "NOT_FOUND", 404);
    }
    if (job.resolvedAt) {
      return job;
    }
    const updated = await tx.deadLetterJob.update({
      where: { id: job.id },
      data: {
        resolvedAt: new Date(),
        resolvedById: input.actorId,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "JOB_RESOLVE",
      entity: "DeadLetterJob",
      entityId: job.id,
      before: toJson(job),
      after: toJson(updated),
      requestId: input.requestId,
    });

    return updated;
  });
