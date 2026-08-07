-- Durable attempt ownership prevents timed-out workers from committing stale results.
ALTER TABLE "MMarketExportJob"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseToken" VARCHAR(64),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

ALTER TABLE "BakaiStoreExportJob"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseToken" VARCHAR(64),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

ALTER TABLE "OMarketExportJob"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseToken" VARCHAR(64),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

ALTER TABLE "ProductDescriptionGenerationJob"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseToken" VARCHAR(64),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

ALTER TABLE "ProductDescriptionGenerationJobItem"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseToken" VARCHAR(64),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

ALTER TABLE "CustomerOrderEmailLog"
  ADD COLUMN "leaseToken" VARCHAR(64),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "MMarketExportJob_status_leaseExpiresAt_idx"
  ON "MMarketExportJob"("status", "leaseExpiresAt");
CREATE INDEX "BakaiStoreExportJob_status_leaseExpiresAt_idx"
  ON "BakaiStoreExportJob"("status", "leaseExpiresAt");
CREATE INDEX "OMarketExportJob_status_leaseExpiresAt_idx"
  ON "OMarketExportJob"("status", "leaseExpiresAt");
CREATE INDEX "ProductDescriptionGenerationJob_status_leaseExpiresAt_idx"
  ON "ProductDescriptionGenerationJob"("status", "leaseExpiresAt");
CREATE INDEX "ProductDescriptionGenerationJobItem_status_leaseExpiresAt_idx"
  ON "ProductDescriptionGenerationJobItem"("status", "leaseExpiresAt");
CREATE INDEX "CustomerOrderEmailLog_status_leaseExpiresAt_idx"
  ON "CustomerOrderEmailLog"("status", "leaseExpiresAt");
