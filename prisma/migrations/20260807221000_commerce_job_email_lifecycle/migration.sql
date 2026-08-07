ALTER TYPE "MMarketLastSyncStatus" ADD VALUE 'COMPLETED_WITH_ERRORS';
ALTER TYPE "MMarketExportJobStatus" ADD VALUE 'COMPLETED_WITH_ERRORS';
ALTER TYPE "MMarketExportJobStatus" ADD VALUE 'TIMED_OUT';

ALTER TYPE "BakaiStoreExportJobStatus" ADD VALUE 'COMPLETED_WITH_ERRORS';
ALTER TYPE "BakaiStoreExportJobStatus" ADD VALUE 'TIMED_OUT';
ALTER TYPE "BakaiStoreLastSyncStatus" ADD VALUE 'COMPLETED_WITH_ERRORS';

ALTER TYPE "OMarketExportJobStatus" ADD VALUE 'COMPLETED_WITH_ERRORS';
ALTER TYPE "OMarketExportJobStatus" ADD VALUE 'TIMED_OUT';
ALTER TYPE "OMarketLastSyncStatus" ADD VALUE 'COMPLETED_WITH_ERRORS';

ALTER TYPE "CustomerOrderEmailStatus" ADD VALUE 'QUEUED';
ALTER TYPE "CustomerOrderEmailStatus" ADD VALUE 'PROCESSING';

ALTER TABLE "CustomerOrderEmailLog"
  ADD COLUMN "operationKey" VARCHAR(191),
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "CustomerOrderEmailLog_operationKey_key"
  ON "CustomerOrderEmailLog"("operationKey");
CREATE INDEX "CustomerOrderEmailLog_status_nextAttemptAt_createdAt_idx"
  ON "CustomerOrderEmailLog"("status", "nextAttemptAt", "createdAt");
