-- Add RETURN movement type for POS returns
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'RETURN';

-- Ensure one active POS draft per register + cashier to avoid race-created duplicates
WITH ranked_pos_drafts AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "registerId", "createdById"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS rn
  FROM "CustomerOrder"
  WHERE "isPosSale" = true
    AND "status" = 'DRAFT'
    AND "registerId" IS NOT NULL
)
UPDATE "CustomerOrder"
SET
  "status" = 'CANCELED',
  "updatedAt" = NOW()
WHERE "id" IN (
  SELECT "id"
  FROM ranked_pos_drafts
  WHERE rn > 1
);

CREATE UNIQUE INDEX "CustomerOrder_pos_active_draft_unique"
  ON "CustomerOrder" ("registerId", "createdById")
  WHERE "isPosSale" = true
    AND "status" = 'DRAFT'
    AND "registerId" IS NOT NULL;
