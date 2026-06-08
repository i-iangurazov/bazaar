-- Add optional movement line metadata for printable receiving and transfer documents.
-- Existing stock movement rows remain valid; new receiving rows can store source order
-- and cost totals without changing inventory balances.

ALTER TABLE "StockMovement"
  ADD COLUMN "linePosition" INTEGER,
  ADD COLUMN "unitCostKgs" DECIMAL(12, 2),
  ADD COLUMN "lineTotalKgs" DECIMAL(12, 2);

CREATE INDEX "StockMovement_reference_linePosition_idx"
  ON "StockMovement"("referenceType", "referenceId", "linePosition");
