-- Owner-operated SELECT only. Bind parameters, never interpolate values:
-- $1 cohort start (inclusive), $2 cohort end (exclusive), $3 observation time,
-- $4 exact campaign label, e.g. profile or kg_store_launch_202611.
-- No emails, names, phone numbers, organization IDs, tokens or amounts leave DB.
-- This is first-touch attribution, not proof of a paid click or current MRR.
WITH settings AS (
  SELECT $1::timestamptz AS cohort_start, $2::timestamptz AS cohort_end,
         $3::timestamptz AS observed_at, $4::text AS campaign
  WHERE $1::timestamptz < $2::timestamptz
    AND $2::timestamptz <= $3::timestamptz
    AND $4::text ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$'
), cohort AS (
  SELECT u.id, u."organizationId" AS organization_id,
         u."createdAt" AS account_created_at, u."isOrgOwner" AS is_owner,
         u."signupAttribution" AS source, s.observed_at
  FROM "User" u CROSS JOIN settings s
  WHERE u."createdAt" >= s.cohort_start AND u."createdAt" < s.cohort_end
    AND u."signupAttribution"->>'utm_campaign' = s.campaign
), facts AS (
  SELECT c.*,
    c.is_owner AND c.id = (
      SELECT u.id FROM "User" u WHERE u."organizationId" = c.organization_id AND u."isOrgOwner"
      ORDER BY u."createdAt", u.id LIMIT 1
    ) AND EXISTS (
      SELECT 1 FROM "Store" s WHERE s."organizationId" = c.organization_id
        AND s."createdAt" <= c.observed_at
    ) AS registered,
    EXISTS (
      SELECT 1 FROM "Product" p WHERE p."organizationId" = c.organization_id
        AND p."createdAt" >= c.account_created_at AND p."createdAt" <= c.observed_at
    ) AS has_products,
    EXISTS (
      SELECT 1 FROM "StockMovement" m JOIN "Store" s ON s.id = m."storeId"
      WHERE s."organizationId" = c.organization_id
        AND m."createdAt" >= c.account_created_at AND m."createdAt" <= c.observed_at
        AND ((m.type = 'RECEIVE' AND m."qtyDelta" > 0)
          OR (m.type = 'SALE' AND m."qtyDelta" < 0))
    ) AS has_stock_operation,
    EXISTS (
      SELECT 1 FROM "CustomerOrder" o WHERE o."organizationId" = c.organization_id
        AND o."isPosSale" AND o.status = 'COMPLETED'
        AND o."completedAt" >= c.account_created_at AND o."completedAt" <= c.observed_at
    ) AS has_completed_sale,
    EXISTS (
      SELECT 1 FROM "SubscriptionInvoice" i
      JOIN "SubscriptionPeriod" p ON p."invoiceId" = i.id
        AND p."organizationId" = i."organizationId"
      WHERE i."organizationId" = c.organization_id AND i.status = 'PAID'
        AND NOT i."isTest" AND i.currency = 'KGS' AND i."amountMinor" > 0
        AND i."providerPaymentId" IS NOT NULL
        AND i."paidAt" >= c.account_created_at AND i."paidAt" <= c.observed_at
        AND EXISTS (
          SELECT 1 FROM "SubscriptionPaymentEvent" e WHERE e."invoiceId" = i.id
            AND e.state = 'PAID' AND e.source IN ('CALLBACK', 'RECONCILIATION')
            AND e."createdAt" <= c.observed_at
        )
    ) AS has_confirmed_payment
  FROM cohort c
)
SELECT source->>'utm_source' AS source, source->>'utm_medium' AS medium,
       source->>'utm_campaign' AS campaign, source->>'utm_content' AS content,
       count(*)::int AS accounts_created,
       (count(DISTINCT organization_id) FILTER (WHERE registered))::int AS registered_businesses,
       (count(DISTINCT organization_id) FILTER (WHERE registered AND has_products))::int AS businesses_with_products,
       (count(DISTINCT organization_id) FILTER (WHERE registered AND has_stock_operation))::int AS businesses_with_stock_operations,
       (count(DISTINCT organization_id) FILTER (WHERE registered AND has_completed_sale))::int AS businesses_with_completed_sales,
       (count(DISTINCT organization_id) FILTER (WHERE registered AND has_confirmed_payment))::int AS confirmed_paying_businesses
FROM facts GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4;
