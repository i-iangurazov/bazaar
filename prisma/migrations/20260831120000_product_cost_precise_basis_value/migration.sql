BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Expand only. The existing avgCostKgs/costBasisQty columns retain their legacy
-- meaning so the old application can continue to read and write during a rolling
-- deployment or after an application rollback. Precise current-inventory state is
-- deliberately stored in separate nullable columns.
ALTER TABLE "ProductCost"
  ALTER COLUMN "avgCostKgs" SET DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "preciseAvgCostKgs" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "preciseCostBasisQty" INTEGER,
  ADD COLUMN IF NOT EXISTS "costBasisValueKgs" DECIMAL(18,6),
  ADD COLUMN IF NOT EXISTS "valuationStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "valuationUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "valuationLegacyUpdatedAt" TIMESTAMP(3);

COMMENT ON COLUMN "ProductCost"."preciseAvgCostKgs" IS
  'Nullable precise-basis projection. NULL means the scope has not been reconciled by the new valuation writer.';
COMMENT ON COLUMN "ProductCost"."preciseCostBasisQty" IS
  'Nullable current physical quantity for the precise valuation basis; legacy costBasisQty is preserved for old writers.';
COMMENT ON COLUMN "ProductCost"."costBasisValueKgs" IS
  'Nullable six-decimal current inventory value. Historical population is performed only by the bounded operational backfill.';

COMMIT;
