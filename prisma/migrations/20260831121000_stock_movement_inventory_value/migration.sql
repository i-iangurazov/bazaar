-- Keep signed inventory-cost value separate from document totals and sales revenue.
ALTER TABLE "StockMovement"
ADD COLUMN "inventoryValueDeltaKgs" DECIMAL(18,6);

-- Only backfill movement families whose historical line total has unambiguous cost meaning.
UPDATE "StockMovement"
SET "inventoryValueDeltaKgs" = CASE
  WHEN "qtyDelta" = 0 THEN 0
  WHEN "type" = 'RECEIVE' AND "lineTotalKgs" IS NOT NULL
    THEN SIGN("qtyDelta") * ABS("lineTotalKgs")
  WHEN "type" = 'WRITE_OFF' AND "lineTotalKgs" IS NOT NULL
    THEN SIGN("qtyDelta") * ABS("lineTotalKgs")
  WHEN "type" = 'TRANSFER_OUT' AND "lineTotalKgs" IS NOT NULL
    THEN -ABS("lineTotalKgs")
  WHEN "type" = 'TRANSFER_IN' AND "lineTotalKgs" IS NOT NULL
    THEN ABS("lineTotalKgs")
  WHEN "type" = 'ADJUSTMENT'
    AND "referenceType" IN ('IMPORT_ROLLBACK', 'Product', 'ProductVariant')
    AND "lineTotalKgs" IS NOT NULL
    THEN SIGN("qtyDelta") * ABS("lineTotalKgs")
  ELSE NULL
END
WHERE "inventoryValueDeltaKgs" IS NULL;

ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_inventoryValueDelta_sign_check"
CHECK (
  "inventoryValueDeltaKgs" IS NULL
  OR "qtyDelta" = 0
  OR SIGN("inventoryValueDeltaKgs") = SIGN("qtyDelta")
);
