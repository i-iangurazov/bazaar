ALTER TABLE "PurchaseOrderLine"
  ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

WITH ranked_lines AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "purchaseOrderId"
      ORDER BY "id" ASC
    ) - 1 AS "nextPosition"
  FROM "PurchaseOrderLine"
)
UPDATE "PurchaseOrderLine" line
SET "position" = ranked_lines."nextPosition"
FROM ranked_lines
WHERE ranked_lines."id" = line."id";

CREATE INDEX "PurchaseOrderLine_purchaseOrderId_position_idx"
  ON "PurchaseOrderLine"("purchaseOrderId", "position");
