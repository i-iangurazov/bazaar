-- Rebuild M-Market opt-in state from explicit audit log actions.
-- This removes legacy backfilled rows and keeps only products that users
-- explicitly left in export via the M-Market selection UI.

DELETE FROM "MMarketIncludedProduct";

WITH selection_events AS (
  SELECT
    log."organizationId" AS "orgId",
    log."createdAt",
    log."id" AS "auditId",
    (log."after" ->> 'included')::boolean AS "included",
    jsonb_array_elements_text(COALESCE(log."after" -> 'productIds', '[]'::jsonb)) AS "productId"
  FROM "AuditLog" log
  WHERE log."action" = 'MMARKET_PRODUCT_SELECTION_UPDATED'
),
ranked_events AS (
  SELECT
    event."orgId",
    event."productId",
    event."included",
    ROW_NUMBER() OVER (
      PARTITION BY event."orgId", event."productId"
      ORDER BY event."createdAt" DESC, event."auditId" DESC
    ) AS "rn"
  FROM selection_events event
),
final_selected AS (
  SELECT
    ranked."orgId",
    ranked."productId"
  FROM ranked_events ranked
  WHERE ranked."rn" = 1
    AND ranked."included" = true
)
INSERT INTO "MMarketIncludedProduct" ("id", "orgId", "productId", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || final."orgId" || final."productId"),
  final."orgId",
  final."productId",
  NOW(),
  NOW()
FROM final_selected final
JOIN "Product" product
  ON product."id" = final."productId"
 AND product."organizationId" = final."orgId"
 AND product."isDeleted" = false;
