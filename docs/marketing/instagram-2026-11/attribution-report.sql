-- Read-only, owner-operated report. Never export email, phone or password hashes.
-- Run only after the additive attribution migration has been explicitly deployed.
-- These are successful DB writes, not browser click events or ad-platform conversions.
WITH acquisition AS (
 SELECT id, "organizationId", "isOrgOwner", "createdAt", "signupAttribution" AS source
 FROM "User"
 WHERE "signupAttribution"->>'utm_campaign' = 'kg_store_launch_202611'
), grouped AS (
 SELECT source->>'utm_source' AS source, source->>'utm_medium' AS medium,
        source->>'utm_content' AS content, count(*) AS accounts_created,
        count(DISTINCT "organizationId") FILTER (WHERE "isOrgOwner" AND EXISTS (
          SELECT 1 FROM "Store" WHERE "Store"."organizationId" = acquisition."organizationId"
        )) AS registered_organizations
 FROM acquisition GROUP BY 1,2,3
)
SELECT * FROM grouped ORDER BY source, medium, content;

SELECT "signupAttribution"->>'utm_medium' AS medium,
       "signupAttribution"->>'utm_content' AS content,
       count(DISTINCT lower(trim(email))) AS access_requests
FROM "AccessRequest"
WHERE "signupAttribution"->>'utm_campaign' = 'kg_store_launch_202611'
GROUP BY 1,2 ORDER BY 1,2;
