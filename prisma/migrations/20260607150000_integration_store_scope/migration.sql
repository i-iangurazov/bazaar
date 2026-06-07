-- Store-scoped integration selection and job context.
-- Existing single-store organizations keep their previous included-product selections.
-- Multi-store organizations must explicitly reselect products for each integration store before syncing.

ALTER TABLE "MMarketExportJob" ADD COLUMN "storeId" TEXT;
ALTER TABLE "MMarketIncludedProduct" ADD COLUMN "storeId" TEXT;
ALTER TABLE "BakaiStoreExportJob" ADD COLUMN "storeId" TEXT;
ALTER TABLE "BakaiStoreIncludedProduct" ADD COLUMN "storeId" TEXT;
ALTER TABLE "BakaiStoreProductSyncState" ADD COLUMN "storeId" TEXT;

WITH single_store AS (
  SELECT "organizationId", MIN("id") AS "storeId"
  FROM "Store"
  GROUP BY "organizationId"
  HAVING COUNT(*) = 1
)
UPDATE "MMarketIncludedProduct" included
SET "storeId" = single_store."storeId"
FROM single_store
WHERE included."orgId" = single_store."organizationId"
  AND included."storeId" IS NULL;

WITH single_store AS (
  SELECT "organizationId", MIN("id") AS "storeId"
  FROM "Store"
  GROUP BY "organizationId"
  HAVING COUNT(*) = 1
)
UPDATE "BakaiStoreIncludedProduct" included
SET "storeId" = single_store."storeId"
FROM single_store
WHERE included."orgId" = single_store."organizationId"
  AND included."storeId" IS NULL;

WITH single_store AS (
  SELECT "organizationId", MIN("id") AS "storeId"
  FROM "Store"
  GROUP BY "organizationId"
  HAVING COUNT(*) = 1
)
UPDATE "BakaiStoreProductSyncState" sync_state
SET "storeId" = single_store."storeId"
FROM single_store
WHERE sync_state."orgId" = single_store."organizationId"
  AND sync_state."storeId" IS NULL;

DROP INDEX IF EXISTS "MMarketIncludedProduct_orgId_productId_key";
DROP INDEX IF EXISTS "BakaiStoreIncludedProduct_orgId_productId_key";
DROP INDEX IF EXISTS "BakaiStoreProductSyncState_orgId_productId_key";

CREATE UNIQUE INDEX "MMarketIncludedProduct_orgId_storeId_productId_key"
ON "MMarketIncludedProduct"("orgId", "storeId", "productId");

CREATE INDEX "MMarketExportJob_orgId_storeId_createdAt_idx"
ON "MMarketExportJob"("orgId", "storeId", "createdAt");

CREATE INDEX "MMarketIncludedProduct_orgId_storeId_productId_idx"
ON "MMarketIncludedProduct"("orgId", "storeId", "productId");

CREATE UNIQUE INDEX "BakaiStoreIncludedProduct_orgId_storeId_productId_key"
ON "BakaiStoreIncludedProduct"("orgId", "storeId", "productId");

CREATE INDEX "BakaiStoreExportJob_orgId_storeId_createdAt_idx"
ON "BakaiStoreExportJob"("orgId", "storeId", "createdAt");

CREATE INDEX "BakaiStoreIncludedProduct_orgId_storeId_productId_idx"
ON "BakaiStoreIncludedProduct"("orgId", "storeId", "productId");

CREATE UNIQUE INDEX "BakaiStoreProductSyncState_orgId_storeId_productId_key"
ON "BakaiStoreProductSyncState"("orgId", "storeId", "productId");

CREATE INDEX "BakaiStoreProductSyncState_orgId_storeId_productId_idx"
ON "BakaiStoreProductSyncState"("orgId", "storeId", "productId");

ALTER TABLE "MMarketExportJob"
ADD CONSTRAINT "MMarketExportJob_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MMarketIncludedProduct"
ADD CONSTRAINT "MMarketIncludedProduct_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BakaiStoreExportJob"
ADD CONSTRAINT "BakaiStoreExportJob_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BakaiStoreIncludedProduct"
ADD CONSTRAINT "BakaiStoreIncludedProduct_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BakaiStoreProductSyncState"
ADD CONSTRAINT "BakaiStoreProductSyncState_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
