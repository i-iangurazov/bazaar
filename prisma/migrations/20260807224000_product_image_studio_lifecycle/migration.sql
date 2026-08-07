-- Add durable attempt ownership and active-request deduplication for Image Studio jobs.
ALTER TABLE "ProductImageStudioJob"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseToken" VARCHAR(64),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "activeDedupeKey" VARCHAR(64),
  ADD COLUMN "startedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "ProductImageStudioJob_activeDedupeKey_key"
  ON "ProductImageStudioJob"("activeDedupeKey");
CREATE INDEX "ProductImageStudioJob_status_leaseExpiresAt_idx"
  ON "ProductImageStudioJob"("status", "leaseExpiresAt");
