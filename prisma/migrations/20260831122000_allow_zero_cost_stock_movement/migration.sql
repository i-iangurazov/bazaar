-- Zero-cost inventory is valid and has no sign; non-zero values must follow quantity direction.
ALTER TABLE "StockMovement"
DROP CONSTRAINT "StockMovement_inventoryValueDelta_sign_check";

ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_inventoryValueDelta_sign_check"
CHECK (
  "inventoryValueDeltaKgs" IS NULL
  OR "inventoryValueDeltaKgs" = 0
  OR "qtyDelta" = 0
  OR SIGN("inventoryValueDeltaKgs") = SIGN("qtyDelta")
);
