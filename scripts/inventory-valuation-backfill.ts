import { pathToFileURL } from "node:url";

import { prisma } from "@/server/db/prisma";
import { runInventoryValuationBackfill } from "@/server/services/inventoryValuationBackfill";

const WRITE_CONFIRMATION = "BACKFILL_INVENTORY_VALUATION";
const WRITE_ENV_FLAG = "ALLOW_INVENTORY_VALUATION_BACKFILL_WRITE";
const DEFAULT_BATCH_SIZE = 100;

type BackfillCliMode = "dry-run" | "write";

export type InventoryValuationBackfillCliOptions = {
  mode: BackfillCliMode;
  runId: string;
  organizationId?: string;
  batchSize: number;
  maxBatches?: number;
  writerDrainEvidence?: string;
};

export class InventoryValuationBackfillCliError extends Error {
  constructor(public readonly safeCode: string) {
    super(safeCode);
  }
}

const positiveInteger = (value: string, max: number, code: string) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new InventoryValuationBackfillCliError(code);
  }
  return parsed;
};

export const parseInventoryValuationBackfillCliOptions = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): InventoryValuationBackfillCliOptions => {
  let mode: BackfillCliMode | null = null;
  let runId: string | null = null;
  let organizationId: string | undefined;
  let batchSize = DEFAULT_BATCH_SIZE;
  let maxBatches: number | undefined;
  let writeConfirmation: string | null = null;
  let writersDrained = false;
  let writerDrainEvidence: string | undefined;

  for (const arg of argv) {
    if (arg === "--") {
      continue;
    } else if (arg === "--dry-run") {
      if (mode) throw new InventoryValuationBackfillCliError("MODE_MUST_BE_EXCLUSIVE");
      mode = "dry-run";
    } else if (arg === "--write") {
      if (mode) throw new InventoryValuationBackfillCliError("MODE_MUST_BE_EXCLUSIVE");
      mode = "write";
    } else if (arg.startsWith("--run-id=")) {
      runId = arg.slice("--run-id=".length);
    } else if (arg.startsWith("--organization-id=")) {
      organizationId = arg.slice("--organization-id=".length);
    } else if (arg.startsWith("--batch-size=")) {
      batchSize = positiveInteger(arg.slice("--batch-size=".length), 500, "BATCH_SIZE_INVALID");
    } else if (arg.startsWith("--max-batches=")) {
      maxBatches = positiveInteger(
        arg.slice("--max-batches=".length),
        10_000,
        "MAX_BATCHES_INVALID",
      );
    } else if (arg.startsWith("--confirm-write=")) {
      writeConfirmation = arg.slice("--confirm-write=".length);
    } else if (arg === "--confirm-writers-drained") {
      writersDrained = true;
    } else if (arg.startsWith("--writer-drain-evidence=")) {
      writerDrainEvidence = arg.slice("--writer-drain-evidence=".length);
    } else {
      throw new InventoryValuationBackfillCliError("UNKNOWN_ARGUMENT");
    }
  }

  if (!mode) throw new InventoryValuationBackfillCliError("MODE_REQUIRED");
  if (!runId || !/^[A-Za-z0-9._:-]{1,120}$/.test(runId)) {
    throw new InventoryValuationBackfillCliError("RUN_ID_INVALID");
  }
  if (organizationId !== undefined && (!organizationId || organizationId.length > 120)) {
    throw new InventoryValuationBackfillCliError("ORGANIZATION_ID_INVALID");
  }
  if (mode === "dry-run") {
    if (writeConfirmation || writersDrained || writerDrainEvidence) {
      throw new InventoryValuationBackfillCliError("DRY_RUN_WRITE_CONFIRMATION_FORBIDDEN");
    }
  } else {
    if (writeConfirmation !== WRITE_CONFIRMATION) {
      throw new InventoryValuationBackfillCliError("WRITE_CONFIRMATION_REQUIRED");
    }
    if (!writersDrained) {
      throw new InventoryValuationBackfillCliError("WRITER_DRAIN_CONFIRMATION_REQUIRED");
    }
    if (!writerDrainEvidence || writerDrainEvidence.trim().length < 10) {
      throw new InventoryValuationBackfillCliError("WRITER_DRAIN_EVIDENCE_REQUIRED");
    }
    if (env[WRITE_ENV_FLAG] !== "1") {
      throw new InventoryValuationBackfillCliError("WRITE_ENV_FLAG_REQUIRED");
    }
  }

  return { mode, runId, organizationId, batchSize, maxBatches, writerDrainEvidence };
};

const emit = (value: unknown) => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const main = async () => {
  try {
    const options = parseInventoryValuationBackfillCliOptions(process.argv.slice(2));
    const result = await runInventoryValuationBackfill(prisma, {
      runId: options.runId,
      organizationId: options.organizationId,
      batchSize: options.batchSize,
      maxBatches: options.maxBatches,
      dryRun: options.mode === "dry-run",
      writerDrainConfirmed: options.mode === "write",
      writerDrainEvidence: options.writerDrainEvidence,
    });
    emit({ type: "inventory_valuation_backfill_result", ...result });
    if (result.mode === "APPLY" && Object.values(result.after).some((count) => count > 0)) {
      process.exitCode = 2;
    }
  } catch (error) {
    emit({
      type: "inventory_valuation_backfill_error",
      code:
        error instanceof InventoryValuationBackfillCliError
          ? error.safeCode
          : error instanceof Error && /^BACKFILL_[A-Z_]+$/.test(error.message)
            ? error.message
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
