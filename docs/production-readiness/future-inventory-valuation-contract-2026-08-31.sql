-- REVIEW TEMPLATE ONLY — NOT A PRISMA MIGRATION — DO NOT DEPLOY IN THE 2026-08-31 RELEASE.
-- Convert this into a separately reviewed future contract migration only after every
-- prerequisite in cost-basis-migration-rollout-2026-08-31.md has been independently proven.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $$
DECLARE
  unexplained_movement_rows bigint;
  incomplete_cost_scopes bigint;
  review_rows bigint;
  completed_clean_runs bigint;
BEGIN
  SELECT COUNT(*)
    INTO unexplained_movement_rows
    FROM "StockMovement"
   WHERE "inventoryValueDeltaKgs" IS NULL
      OR NULLIF(BTRIM("inventoryValueStatus"), '') IS NULL;

  SELECT COUNT(*)
    INTO incomplete_cost_scopes
    FROM "ProductCost"
   WHERE "preciseAvgCostKgs" IS NULL
      OR "preciseCostBasisQty" IS NULL
      OR "costBasisValueKgs" IS NULL
      OR NULLIF(BTRIM("valuationStatus"), '') IS NULL
      OR "valuationUpdatedAt" IS NULL
      OR "valuationLegacyUpdatedAt" IS NULL;

  SELECT
    (SELECT COUNT(*) FROM "StockMovement" WHERE "inventoryValueStatus" = 'REVIEW_REQUIRED')
    + (SELECT COUNT(*) FROM "ProductCost" WHERE "valuationStatus" = 'REVIEW_REQUIRED')
    INTO review_rows;

  SELECT COUNT(*)
    INTO completed_clean_runs
    FROM "InventoryValuationBackfillRun"
   WHERE status = 'COMPLETED'
     AND phase = 'COMPLETE'
     AND COALESCE(("afterJson" ->> 'unclassifiedMovements')::integer, -1) = 0
     AND COALESCE(("afterJson" ->> 'reviewMovements')::integer, -1) = 0
     AND COALESCE(("afterJson" ->> 'unreconciledCostScopes')::integer, -1) = 0
     AND COALESCE(("afterJson" ->> 'reviewCostScopes')::integer, -1) = 0;

  IF unexplained_movement_rows <> 0 THEN
    RAISE EXCEPTION 'contract blocked: % unexplained movement rows', unexplained_movement_rows;
  END IF;
  IF incomplete_cost_scopes <> 0 THEN
    RAISE EXCEPTION 'contract blocked: % incomplete ProductCost scopes', incomplete_cost_scopes;
  END IF;
  IF review_rows <> 0 THEN
    RAISE EXCEPTION 'contract blocked: % current review rows', review_rows;
  END IF;
  IF completed_clean_runs = 0 THEN
    RAISE EXCEPTION 'contract blocked: no retained clean completed backfill run';
  END IF;
END $$;

ALTER TABLE "StockMovement"
  VALIDATE CONSTRAINT "StockMovement_inventoryValueDelta_compat_sign_check";

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_inventoryValueDelta_contract_nn"
    CHECK ("inventoryValueDeltaKgs" IS NOT NULL) NOT VALID,
  ADD CONSTRAINT "StockMovement_inventoryValueStatus_contract_nn"
    CHECK ("inventoryValueStatus" IS NOT NULL) NOT VALID;

ALTER TABLE "StockMovement"
  VALIDATE CONSTRAINT "StockMovement_inventoryValueDelta_contract_nn";
ALTER TABLE "StockMovement"
  VALIDATE CONSTRAINT "StockMovement_inventoryValueStatus_contract_nn";

ALTER TABLE "StockMovement"
  ALTER COLUMN "inventoryValueDeltaKgs" SET NOT NULL,
  ALTER COLUMN "inventoryValueStatus" SET NOT NULL;

ALTER TABLE "ProductCost"
  ADD CONSTRAINT "ProductCost_preciseAvgCost_contract_nn"
    CHECK ("preciseAvgCostKgs" IS NOT NULL) NOT VALID,
  ADD CONSTRAINT "ProductCost_preciseCostBasisQty_contract_nn"
    CHECK ("preciseCostBasisQty" IS NOT NULL) NOT VALID,
  ADD CONSTRAINT "ProductCost_costBasisValue_contract_nn"
    CHECK ("costBasisValueKgs" IS NOT NULL) NOT VALID,
  ADD CONSTRAINT "ProductCost_valuationStatus_contract_nn"
    CHECK ("valuationStatus" IS NOT NULL) NOT VALID;

ALTER TABLE "ProductCost" VALIDATE CONSTRAINT "ProductCost_preciseAvgCost_contract_nn";
ALTER TABLE "ProductCost" VALIDATE CONSTRAINT "ProductCost_preciseCostBasisQty_contract_nn";
ALTER TABLE "ProductCost" VALIDATE CONSTRAINT "ProductCost_costBasisValue_contract_nn";
ALTER TABLE "ProductCost" VALIDATE CONSTRAINT "ProductCost_valuationStatus_contract_nn";

ALTER TABLE "ProductCost"
  ALTER COLUMN "preciseAvgCostKgs" SET NOT NULL,
  ALTER COLUMN "preciseCostBasisQty" SET NOT NULL,
  ALTER COLUMN "costBasisValueKgs" SET NOT NULL,
  ALTER COLUMN "valuationStatus" SET NOT NULL;

-- Keep avgCostKgs, costBasisQty, and every other legacy column. Their eventual
-- retirement is a separate contract decision with a separately proven rollback.

COMMIT;
