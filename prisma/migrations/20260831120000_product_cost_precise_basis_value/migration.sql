BEGIN;

-- Legacy ProductCost.costBasisQty represented cumulative receiving activity (and
-- was sometimes forced to 1 for a display-only manual cost). It cannot safely be
-- copied into the new current-inventory basis. Refuse to invent a value for
-- positive stock that has no positive cost, then rebuild the basis from physical
-- organization-wide on-hand and the legacy two-decimal unit-cost projection.
DO $$
DECLARE
  unsafe_scope_count integer;
BEGIN
  WITH physical_stock AS (
    SELECT
      product."organizationId",
      snapshot."productId",
      snapshot."variantKey",
      SUM(snapshot."onHand")::integer AS quantity
    FROM "InventorySnapshot" snapshot
    JOIN "Product" product ON product."id" = snapshot."productId"
    GROUP BY product."organizationId", snapshot."productId", snapshot."variantKey"
  )
  SELECT COUNT(*)
  INTO unsafe_scope_count
  FROM physical_stock stock
  LEFT JOIN "ProductCost" cost
    ON cost."organizationId" = stock."organizationId"
   AND cost."productId" = stock."productId"
   AND cost."variantKey" = stock."variantKey"
  WHERE stock.quantity < 0
     OR (stock.quantity > 0 AND (cost."id" IS NULL OR cost."avgCostKgs" <= 0));

  IF unsafe_scope_count > 0 THEN
    RAISE EXCEPTION
      'D-009 preflight failed: % inventory cost scope(s) have negative stock or positive stock without a positive cost basis. Reconcile them before migration.',
      unsafe_scope_count;
  END IF;
END $$;

ALTER TABLE "ProductCost"
ADD COLUMN IF NOT EXISTS "costBasisValueKgs" DECIMAL(18,6) NOT NULL DEFAULT 0;

WITH physical_stock AS (
  SELECT
    product."organizationId",
    snapshot."productId",
    snapshot."variantKey",
    SUM(snapshot."onHand")::integer AS quantity
  FROM "InventorySnapshot" snapshot
  JOIN "Product" product ON product."id" = snapshot."productId"
  GROUP BY product."organizationId", snapshot."productId", snapshot."variantKey"
)
UPDATE "ProductCost" cost
SET
  "costBasisQty" = stock.quantity,
  "costBasisValueKgs" = ROUND(cost."avgCostKgs" * stock.quantity, 6)
FROM physical_stock stock
WHERE cost."organizationId" = stock."organizationId"
  AND cost."productId" = stock."productId"
  AND cost."variantKey" = stock."variantKey";

UPDATE "ProductCost" cost
SET "costBasisQty" = 0,
    "costBasisValueKgs" = 0
WHERE NOT EXISTS (
  SELECT 1
  FROM "InventorySnapshot" snapshot
  JOIN "Product" product ON product."id" = snapshot."productId"
  WHERE product."organizationId" = cost."organizationId"
    AND snapshot."productId" = cost."productId"
    AND snapshot."variantKey" = cost."variantKey"
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ProductCost_costBasisQty_nonnegative_check'
      AND conrelid = '"ProductCost"'::regclass
  ) THEN
    ALTER TABLE "ProductCost"
    ADD CONSTRAINT "ProductCost_costBasisQty_nonnegative_check"
    CHECK ("costBasisQty" >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ProductCost_costBasisValueKgs_nonnegative_check'
      AND conrelid = '"ProductCost"'::regclass
  ) THEN
    ALTER TABLE "ProductCost"
    ADD CONSTRAINT "ProductCost_costBasisValueKgs_nonnegative_check"
    CHECK ("costBasisValueKgs" >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ProductCost_emptyBasis_zeroValue_check'
      AND conrelid = '"ProductCost"'::regclass
  ) THEN
    ALTER TABLE "ProductCost"
    ADD CONSTRAINT "ProductCost_emptyBasis_zeroValue_check"
    CHECK ("costBasisQty" <> 0 OR "costBasisValueKgs" = 0) NOT VALID;
  END IF;
END $$;

ALTER TABLE "ProductCost" VALIDATE CONSTRAINT "ProductCost_costBasisQty_nonnegative_check";
ALTER TABLE "ProductCost" VALIDATE CONSTRAINT "ProductCost_costBasisValueKgs_nonnegative_check";
ALTER TABLE "ProductCost" VALIDATE CONSTRAINT "ProductCost_emptyBasis_zeroValue_check";

COMMIT;
