BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Expand only. Old writers may continue inserting NULL. Historical values are
-- classified and populated by the bounded operational backfill, never by DDL.
ALTER TABLE "StockMovement"
  ADD COLUMN IF NOT EXISTS "inventoryValueDeltaKgs" DECIMAL(18,6),
  ADD COLUMN IF NOT EXISTS "inventoryValueStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "inventoryValueReason" TEXT,
  ADD COLUMN IF NOT EXISTS "inventoryValueUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ledgerRecordedAt" TIMESTAMP(3);

-- Existing rows remain NULL; post-expand inserts from both old and new clients
-- receive a database-clock watermark without a trigger or historical rewrite.
-- Prisma DateTime values are persisted as UTC timestamp-without-time-zone values,
-- so the database default must explicitly use UTC as well. Otherwise a non-UTC
-- PostgreSQL TimeZone makes old-writer rows appear hours newer than application
-- valuation watermarks and can double-apply already projected baseline stock.
ALTER TABLE "StockMovement"
  ALTER COLUMN "ledgerRecordedAt" SET DEFAULT (clock_timestamp() AT TIME ZONE 'UTC');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'StockMovement_inventoryValueDelta_compat_sign_check'
      AND conrelid = '"StockMovement"'::regclass
  ) THEN
    ALTER TABLE "StockMovement"
      ADD CONSTRAINT "StockMovement_inventoryValueDelta_compat_sign_check"
      CHECK (
        "inventoryValueDeltaKgs" IS NULL
        OR "qtyDelta" = 0
        OR ("qtyDelta" > 0 AND "inventoryValueDeltaKgs" > 0)
        OR (
          "qtyDelta" > 0
          AND "inventoryValueDeltaKgs" = 0
          AND "inventoryValueStatus" = 'EXPLICIT_ZERO'
          AND NULLIF(BTRIM("inventoryValueReason"), '') IS NOT NULL
        )
        OR ("qtyDelta" < 0 AND "inventoryValueDeltaKgs" <= 0)
      ) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN "StockMovement"."inventoryValueDeltaKgs" IS
  'Signed cost-ledger value. NULL is permitted during expand/rollback compatibility and is explicitly unreconciled.';
COMMENT ON COLUMN "StockMovement"."inventoryValueStatus" IS
  'PRECISE, EXPLICIT_ZERO, LEGACY_EVIDENCE, NOT_APPLICABLE, or REVIEW_REQUIRED; NULL identifies an untouched old-writer row.';

COMMIT;
