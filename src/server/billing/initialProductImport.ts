import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { assertProductImportAccess } from "./coreAccess";
import { reserveSubscriptionUsage, settleSubscriptionUsageBatch } from "./subscriptionUsage";
import { AppError } from "@/server/services/errors";

const usageKey = "initial-product-import";
const usageDigest = createHash("sha256").update(usageKey).digest("hex");
export type InitialImportChunkInput = { sessionId: string; chunkIndex: number };

// Renew only a server-owned session reservation. A stale upload can resume, but
// the organization-unique session cannot become a second initial import.
async function reserveSessionUsage(tx: Prisma.TransactionClient, organizationId: string) {
  const row = await tx.subscriptionUsageReservation.findUnique({
    where: {
      organizationId_resource_operationKey: {
        organizationId,
        resource: "initialImport",
        operationKey: usageDigest,
      },
    },
  });
  if (row?.state === "COMMITTED")
    throw new AppError("billingUsageAlreadyCompleted", "CONFLICT", 409);
  if (row?.state === "RESERVED") {
    await tx.subscriptionUsageReservation.update({
      where: { id: row.id },
      data: {
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    return;
  }
  await reserveSubscriptionUsage(
    { organizationId, resource: "initialImport", operationKey: usageKey },
    new Date(),
    tx,
  );
}

export async function startInitialProductImport(input: {
  organizationId: string;
  actorId: string;
  rowCounts: number[];
}) {
  const { org, initialOnly } = await assertProductImportAccess(input.organizationId);
  if (!initialOnly) throw new AppError("invalidInput", "BAD_REQUEST", 400);
  const totalRows = input.rowCounts.reduce((sum, count) => sum + count, 0);
  if (
    !input.rowCounts.length ||
    input.rowCounts.length > 100 ||
    input.rowCounts.some((count) => !Number.isSafeInteger(count) || count < 1 || count > 1000) ||
    totalRows > org.entitlements.limits.maxProducts
  )
    throw new AppError("importTooLarge", "BAD_REQUEST", 400);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${input.organizationId} FOR UPDATE`;
    const existing = await tx.initialProductImportSession.findUnique({
      where: { organizationId: input.organizationId },
      include: { chunks: true },
    });
    if (existing) {
      if (existing.completedAt) throw new AppError("billingUsageAlreadyCompleted", "CONFLICT", 409);
      if (JSON.stringify(existing.rowCounts) !== JSON.stringify(input.rowCounts))
        throw new AppError("initialImportSessionMismatch", "CONFLICT", 409);
      await reserveSessionUsage(tx, input.organizationId);
      return {
        sessionId: existing.id,
        completedChunks: existing.chunks.map((chunk) => chunk.chunkIndex),
      };
    }
    await reserveSessionUsage(tx, input.organizationId);
    const session = await tx.initialProductImportSession.create({
      data: {
        organizationId: input.organizationId,
        createdById: input.actorId,
        rowCounts: input.rowCounts,
        totalRows,
      },
    });
    return { sessionId: session.id, completedChunks: [] as number[] };
  });
}

export async function getInitialProductImportStatus(organizationId: string) {
  const session = await prisma.initialProductImportSession.findUnique({
    where: { organizationId },
    include: { chunks: { select: { chunkIndex: true } } },
  });
  return session
    ? {
        sessionId: session.id,
        rowCounts: session.rowCounts as number[],
        completedChunks: session.chunks.map((chunk) => chunk.chunkIndex),
        complete: Boolean(session.completedAt),
      }
    : null;
}

export async function checkInitialProductImportChunk(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    chunk: InitialImportChunkInput;
    rowCount: number;
    payloadHash: string;
  },
) {
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${input.organizationId} FOR UPDATE`;
  const session = await tx.initialProductImportSession.findFirst({
    where: { id: input.chunk.sessionId, organizationId: input.organizationId },
  });
  const rowCounts = session?.rowCounts as number[] | undefined;
  if (!session || !rowCounts || rowCounts[input.chunk.chunkIndex] !== input.rowCount)
    throw new AppError("initialImportSessionMismatch", "CONFLICT", 409);
  const prior = await tx.initialProductImportChunk.findUnique({
    where: {
      sessionId_chunkIndex: {
        sessionId: session.id,
        chunkIndex: input.chunk.chunkIndex,
      },
    },
  });
  if (prior) {
    if (prior.payloadHash !== input.payloadHash)
      throw new AppError("initialImportChunkChanged", "CONFLICT", 409);
    return prior;
  }
  if (session.completedAt) throw new AppError("billingUsageAlreadyCompleted", "CONFLICT", 409);
  await reserveSessionUsage(tx, input.organizationId);
  return null;
}

export async function recordInitialProductImportChunk(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    chunk: InitialImportChunkInput;
    rowCount: number;
    payloadHash: string;
    batchId: string;
    summary: Prisma.InputJsonValue;
  },
) {
  await tx.initialProductImportChunk.create({
    data: {
      sessionId: input.chunk.sessionId,
      chunkIndex: input.chunk.chunkIndex,
      rowCount: input.rowCount,
      payloadHash: input.payloadHash,
      batchId: input.batchId,
      summary: input.summary,
    },
  });
  const session = await tx.initialProductImportSession.findUniqueOrThrow({
    where: { id: input.chunk.sessionId },
  });
  const completed = await tx.initialProductImportChunk.count({ where: { sessionId: session.id } });
  if (completed === (session.rowCounts as number[]).length) {
    await settleSubscriptionUsageBatch(
      {
        organizationId: input.organizationId,
        resource: "initialImport",
        operationKeys: [usageKey],
        success: true,
      },
      tx,
    );
    await tx.initialProductImportSession.update({
      where: { id: session.id },
      data: { completedAt: new Date() },
    });
  }
}
