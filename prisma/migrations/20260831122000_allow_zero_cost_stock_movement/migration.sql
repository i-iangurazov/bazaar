BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Durable checkpoint metadata for the operational backfill. The only foreign
-- key joins these two new tables; no existing table is scanned or constrained,
-- so old application instances remain rollback-compatible.
CREATE TABLE IF NOT EXISTS "InventoryValuationBackfillRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "phase" TEXT NOT NULL,
  "algorithmVersion" TEXT NOT NULL,
  "batchSize" INTEGER NOT NULL,
  "highWaterRecordedAt" TIMESTAMP(3),
  "highWaterMovementId" TEXT,
  "highWaterProductCostId" TEXT,
  "cursorRecordedAt" TIMESTAMP(3),
  "cursorMovementId" TEXT,
  "cursorProductId" TEXT,
  "cursorVariantKey" TEXT,
  "writerDrainConfirmedAt" TIMESTAMP(3),
  "writerDrainEvidenceJson" JSONB,
  "batchCount" INTEGER NOT NULL DEFAULT 0,
  "movementScannedRows" INTEGER NOT NULL DEFAULT 0,
  "movementUpdatedRows" INTEGER NOT NULL DEFAULT 0,
  "movementReviewRows" INTEGER NOT NULL DEFAULT 0,
  "scopeScannedRows" INTEGER NOT NULL DEFAULT 0,
  "scopeUpdatedRows" INTEGER NOT NULL DEFAULT 0,
  "scopeReviewRows" INTEGER NOT NULL DEFAULT 0,
  "scannedRows" INTEGER NOT NULL DEFAULT 0,
  "updatedRows" INTEGER NOT NULL DEFAULT 0,
  "reviewRows" INTEGER NOT NULL DEFAULT 0,
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "InventoryValuationBackfillRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InventoryValuationBackfillIssue" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "evidenceJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InventoryValuationBackfillIssue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryValuationBackfillIssue_run_entity_key"
    UNIQUE ("runId", "entityType", "entityId"),
  CONSTRAINT "InventoryValuationBackfillIssue_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "InventoryValuationBackfillRun"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Strict NOT NULL/sign/zero-cost constraints are intentionally absent here.
-- They belong to the documented future contract release after old writers are
-- drained and reconciliation reports no unexplained NULL values.

COMMIT;
