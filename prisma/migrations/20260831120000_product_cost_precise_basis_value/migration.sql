-- Persist the inventory value independently from the two-decimal average projection.
-- This prevents repeated receipts and document corrections from compounding rounding loss.
ALTER TABLE "ProductCost"
ADD COLUMN "costBasisValueKgs" DECIMAL(18,6) NOT NULL DEFAULT 0;

UPDATE "ProductCost"
SET "costBasisValueKgs" = ROUND("avgCostKgs" * "costBasisQty", 6);

ALTER TABLE "ProductCost"
ADD CONSTRAINT "ProductCost_costBasisQty_nonnegative_check"
CHECK ("costBasisQty" >= 0),
ADD CONSTRAINT "ProductCost_costBasisValueKgs_nonnegative_check"
CHECK ("costBasisValueKgs" >= 0),
ADD CONSTRAINT "ProductCost_emptyBasis_zeroValue_check"
CHECK ("costBasisQty" <> 0 OR "costBasisValueKgs" = 0);
