import { pathToFileURL } from "node:url";
import { CustomerOrderSource, type Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import {
  analyzeBazaarExternalIdentityRows,
  type BazaarExternalIdentityAudit,
  type BazaarExternalIdentityAuditIssue,
  type BazaarExternalIdentityAuditRow,
  parseLegacyBazaarExternalIdNotes,
  tryNormalizeBazaarExternalOrderId,
} from "@/server/services/bazaarExternalIdentity";

const WRITE_CONFIRMATION = "BACKFILL_BAZAAR_EXTERNAL_ORDER_IDS";
const WRITE_ENV_FLAG = "ALLOW_BAZAAR_EXTERNAL_ID_BACKFILL_WRITE";
const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 1_000;

type BackfillMode = "dry-run" | "write";

export type BazaarExternalIdBackfillOptions = {
  mode: BackfillMode;
  batchSize: number;
};

export type BazaarExternalIdBackfillEvent =
  | {
      type: "scan_progress";
      scannedCount: number;
      batchCount: number;
    }
  | {
      type: "backfill_candidate";
      orderId: string;
      organizationId: string;
      storeId: string;
      source: "API";
      externalIdDigest: string;
    }
  | ({ type: "audit_issue" } & BazaarExternalIdentityAuditIssue)
  | {
      type: "write_progress";
      processedCount: number;
      writtenCount: number;
      batchCount: number;
    }
  | {
      type: "summary";
      mode: BackfillMode;
      status: "clean" | "blocked" | "completed";
      scannedCount: number;
      candidateCount: number;
      alreadyPopulatedCount: number;
      withoutIdentityCount: number;
      issueCount: number;
      writtenCount: number;
    }
  | {
      type: "error";
      code: string;
    };

export type BazaarExternalIdBackfillResult = Extract<
  BazaarExternalIdBackfillEvent,
  { type: "summary" }
>;

export class BazaarExternalIdBackfillError extends Error {
  constructor(public readonly safeCode: string) {
    super(safeCode);
  }
}

const positiveBatchSize = (value: string) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_BATCH_SIZE) {
    throw new BazaarExternalIdBackfillError("INVALID_BATCH_SIZE");
  }
  return parsed;
};

export const parseBazaarExternalIdBackfillOptions = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): BazaarExternalIdBackfillOptions => {
  let mode: BackfillMode | null = null;
  let batchSize = DEFAULT_BATCH_SIZE;
  let confirmation: string | null = null;

  for (const arg of argv) {
    if (arg === "--dry-run") {
      if (mode) throw new BazaarExternalIdBackfillError("MODE_MUST_BE_EXCLUSIVE");
      mode = "dry-run";
    } else if (arg === "--write") {
      if (mode) throw new BazaarExternalIdBackfillError("MODE_MUST_BE_EXCLUSIVE");
      mode = "write";
    } else if (arg.startsWith("--batch-size=")) {
      batchSize = positiveBatchSize(arg.slice("--batch-size=".length));
    } else if (arg.startsWith("--confirm-write=")) {
      confirmation = arg.slice("--confirm-write=".length);
    } else {
      throw new BazaarExternalIdBackfillError("UNKNOWN_ARGUMENT");
    }
  }

  if (!mode) throw new BazaarExternalIdBackfillError("MODE_REQUIRED");
  if (mode === "dry-run" && confirmation) {
    throw new BazaarExternalIdBackfillError("DRY_RUN_CONFIRMATION_FORBIDDEN");
  }
  if (mode === "write") {
    if (confirmation !== WRITE_CONFIRMATION) {
      throw new BazaarExternalIdBackfillError("WRITE_CONFIRMATION_REQUIRED");
    }
    if (env[WRITE_ENV_FLAG] !== "1") {
      throw new BazaarExternalIdBackfillError("WRITE_ENV_FLAG_REQUIRED");
    }
  }

  return { mode, batchSize };
};

const scanRows = async (
  client: PrismaClient,
  batchSize: number,
  emit: (event: BazaarExternalIdBackfillEvent) => void,
) => {
  const rows: BazaarExternalIdentityAuditRow[] = [];
  let cursor: string | null = null;
  let batchCount = 0;

  while (true) {
    const batch: BazaarExternalIdentityAuditRow[] = await client.customerOrder.findMany({
      where: { source: CustomerOrderSource.API },
      select: {
        id: true,
        organizationId: true,
        storeId: true,
        notes: true,
        externalOrderId: true,
      },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!batch.length) break;
    rows.push(...batch);
    cursor = batch.at(-1)?.id ?? null;
    batchCount += 1;
    emit({ type: "scan_progress", scannedCount: rows.length, batchCount });
    if (batch.length < batchSize) break;
  }

  return rows;
};

const emitAuditIssues = (
  audit: BazaarExternalIdentityAudit,
  emit: (event: BazaarExternalIdBackfillEvent) => void,
) => {
  for (const issue of audit.issues) {
    emit({ type: "audit_issue", ...issue });
  }
};

const emitBackfillCandidates = (
  audit: BazaarExternalIdentityAudit,
  emit: (event: BazaarExternalIdBackfillEvent) => void,
) => {
  for (const candidate of audit.candidates) {
    emit({
      type: "backfill_candidate",
      orderId: candidate.orderId,
      organizationId: candidate.organizationId,
      storeId: candidate.storeId,
      source: "API",
      externalIdDigest: candidate.externalIdDigest,
    });
  }
};

const summary = (input: {
  mode: BackfillMode;
  status: BazaarExternalIdBackfillResult["status"];
  audit: BazaarExternalIdentityAudit;
  writtenCount: number;
}): BazaarExternalIdBackfillResult => ({
  type: "summary",
  mode: input.mode,
  status: input.status,
  scannedCount: input.audit.scannedCount,
  candidateCount: input.audit.candidateCount,
  alreadyPopulatedCount: input.audit.alreadyPopulatedCount,
  withoutIdentityCount: input.audit.withoutIdentityCount,
  issueCount: input.audit.issueCount,
  writtenCount: input.writtenCount,
});

export const verifyBazaarExternalIdBackfillCandidateInsideTransaction = async (
  tx: Prisma.TransactionClient,
  candidate: BazaarExternalIdentityAudit["candidates"][number],
) => {
  const current = await tx.customerOrder.findFirst({
    where: {
      id: candidate.orderId,
      organizationId: candidate.organizationId,
      storeId: candidate.storeId,
      source: CustomerOrderSource.API,
    },
    select: { externalOrderId: true, notes: true },
  });
  if (!current) throw new BazaarExternalIdBackfillError("WRITE_TARGET_DRIFT");
  if (current.externalOrderId !== null) {
    const normalized = tryNormalizeBazaarExternalOrderId(current.externalOrderId);
    if (!normalized.ok || normalized.value !== candidate.externalOrderId) {
      throw new BazaarExternalIdBackfillError("WRITE_TARGET_DRIFT");
    }
    return false;
  }

  const parsedLegacyIdentity = parseLegacyBazaarExternalIdNotes(current.notes);
  if (
    parsedLegacyIdentity.kind !== "value" ||
    parsedLegacyIdentity.value !== candidate.externalOrderId
  ) {
    throw new BazaarExternalIdBackfillError("WRITE_TARGET_DRIFT");
  }

  const updated = await tx.customerOrder.updateMany({
    where: {
      id: candidate.orderId,
      organizationId: candidate.organizationId,
      storeId: candidate.storeId,
      source: CustomerOrderSource.API,
      externalOrderId: null,
    },
    data: { externalOrderId: candidate.externalOrderId },
  });
  if (updated.count !== 1) throw new BazaarExternalIdBackfillError("WRITE_TARGET_DRIFT");
  return true;
};

export const runBazaarExternalIdBackfill = async (
  options: BazaarExternalIdBackfillOptions,
  dependencies: {
    client?: PrismaClient;
    emit?: (event: BazaarExternalIdBackfillEvent) => void;
  } = {},
): Promise<BazaarExternalIdBackfillResult> => {
  const client = dependencies.client ?? prisma;
  const emit = dependencies.emit ?? (() => undefined);
  const rows = await scanRows(client, options.batchSize, emit);
  const audit = analyzeBazaarExternalIdentityRows(rows);
  emitBackfillCandidates(audit, emit);
  emitAuditIssues(audit, emit);

  if (audit.issueCount > 0) {
    const result = summary({ mode: options.mode, status: "blocked", audit, writtenCount: 0 });
    emit(result);
    return result;
  }
  if (options.mode === "dry-run") {
    const result = summary({ mode: options.mode, status: "clean", audit, writtenCount: 0 });
    emit(result);
    return result;
  }

  let writtenCount = 0;
  let processedCount = 0;
  let batchCount = 0;
  for (let offset = 0; offset < audit.candidates.length; offset += options.batchSize) {
    const candidates = audit.candidates.slice(offset, offset + options.batchSize);
    const writtenInBatch = await client.$transaction(async (tx) => {
      let count = 0;
      for (const candidate of candidates) {
        if (await verifyBazaarExternalIdBackfillCandidateInsideTransaction(tx, candidate)) {
          count += 1;
        }
      }
      return count;
    });
    writtenCount += writtenInBatch;
    processedCount += candidates.length;
    batchCount += 1;
    emit({ type: "write_progress", processedCount, writtenCount, batchCount });
  }

  const verificationRows = await scanRows(client, options.batchSize, () => undefined);
  const verification = analyzeBazaarExternalIdentityRows(verificationRows);
  if (verification.issueCount > 0 || verification.candidateCount > 0) {
    throw new BazaarExternalIdBackfillError("POST_WRITE_VERIFICATION_FAILED");
  }

  const result = summary({
    mode: options.mode,
    status: "completed",
    audit: verification,
    writtenCount,
  });
  emit(result);
  return result;
};

const emitJsonLine = (event: BazaarExternalIdBackfillEvent) => {
  process.stdout.write(`${JSON.stringify(event)}\n`);
};

const main = async () => {
  try {
    const options = parseBazaarExternalIdBackfillOptions(process.argv.slice(2));
    const result = await runBazaarExternalIdBackfill(options, { emit: emitJsonLine });
    if (result.status === "blocked") process.exitCode = 2;
  } catch (error) {
    emitJsonLine({
      type: "error",
      code:
        error instanceof BazaarExternalIdBackfillError
          ? error.safeCode
          : "UNEXPECTED_BACKFILL_FAILURE",
    });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  void main();
}
