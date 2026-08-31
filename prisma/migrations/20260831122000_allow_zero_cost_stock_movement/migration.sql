BEGIN;

ALTER TABLE "StockMovement"
DROP CONSTRAINT IF EXISTS "StockMovement_inventoryValueDelta_sign_check";

-- NOT VALID preserves identifiable legacy rows while enforcing D-009 for every
-- new movement immediately. Positive zero-cost stock is permitted only when the
-- durable movement note contains the marker written after deliberate confirmation.
ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_inventoryValueDelta_sign_check"
CHECK (
  "qtyDelta" = 0
  OR (
    "qtyDelta" > 0
    AND "inventoryValueDeltaKgs" IS NOT NULL
    AND "inventoryValueDeltaKgs" >= 0
    AND (
      "inventoryValueDeltaKgs" <> 0
      OR COALESCE("note", '') LIKE '%[ZERO_COST_REASON] %'
    )
  )
  OR (
    "qtyDelta" < 0
    AND (
      "inventoryValueDeltaKgs" IS NULL
      OR "inventoryValueDeltaKgs" <= 0
    )
  )
) NOT VALID;

COMMIT;
