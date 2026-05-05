-- Non-destructive store scoping tables.
-- StoreProduct records which master products are available in each store.
-- UserStoreAccess records explicit store assignments for non-admin users.

CREATE TABLE "UserStoreAccess" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserStoreAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoreProduct" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "assignedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StoreProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserStoreAccess_userId_storeId_key" ON "UserStoreAccess"("userId", "storeId");
CREATE INDEX "UserStoreAccess_organizationId_userId_idx" ON "UserStoreAccess"("organizationId", "userId");
CREATE INDEX "UserStoreAccess_organizationId_storeId_idx" ON "UserStoreAccess"("organizationId", "storeId");

CREATE UNIQUE INDEX "StoreProduct_storeId_productId_key" ON "StoreProduct"("storeId", "productId");
CREATE INDEX "StoreProduct_organizationId_storeId_isActive_idx" ON "StoreProduct"("organizationId", "storeId", "isActive");
CREATE INDEX "StoreProduct_organizationId_productId_isActive_idx" ON "StoreProduct"("organizationId", "productId", "isActive");

ALTER TABLE "UserStoreAccess"
  ADD CONSTRAINT "UserStoreAccess_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserStoreAccess"
  ADD CONSTRAINT "UserStoreAccess_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserStoreAccess"
  ADD CONSTRAINT "UserStoreAccess_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StoreProduct"
  ADD CONSTRAINT "StoreProduct_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StoreProduct"
  ADD CONSTRAINT "StoreProduct_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StoreProduct"
  ADD CONSTRAINT "StoreProduct_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StoreProduct"
  ADD CONSTRAINT "StoreProduct_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve existing access for non-admin users. Admin/owner access remains role-based.
INSERT INTO "UserStoreAccess" ("id", "organizationId", "userId", "storeId", "createdAt", "updatedAt")
SELECT
  'usa_' || md5(u."id" || ':' || s."id"),
  u."organizationId",
  u."id",
  s."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
JOIN "Store" s ON s."organizationId" = u."organizationId"
WHERE u."organizationId" IS NOT NULL
  AND u."role" IN ('MANAGER', 'STAFF', 'CASHIER')
ON CONFLICT ("userId", "storeId") DO NOTHING;

-- Single-store organizations keep their historical behavior: every product belongs to that store.
INSERT INTO "StoreProduct" ("id", "organizationId", "storeId", "productId", "isActive", "createdAt", "updatedAt")
SELECT
  'sp_' || md5(s."id" || ':' || p."id"),
  p."organizationId",
  s."id",
  p."id",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Product" p
JOIN "Store" s ON s."organizationId" = p."organizationId"
JOIN (
  SELECT "organizationId", COUNT(*) AS store_count
  FROM "Store"
  GROUP BY "organizationId"
) store_counts ON store_counts."organizationId" = p."organizationId"
WHERE store_counts.store_count = 1
ON CONFLICT ("storeId", "productId") DO UPDATE SET
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

-- Multi-store backfill only uses concrete store evidence. This avoids making a new
-- store inherit products solely because old code created empty snapshots everywhere.
WITH evidence AS (
  SELECT DISTINCT s."organizationId", s."id" AS "storeId", p."id" AS "productId"
  FROM "InventorySnapshot" i
  JOIN "Store" s ON s."id" = i."storeId"
  JOIN "Product" p ON p."id" = i."productId" AND p."organizationId" = s."organizationId"
  WHERE i."onHand" <> 0 OR i."onOrder" <> 0

  UNION
  SELECT DISTINCT s."organizationId", sm."storeId", sm."productId"
  FROM "StockMovement" sm
  JOIN "Store" s ON s."id" = sm."storeId"
  JOIN "Product" p ON p."id" = sm."productId" AND p."organizationId" = s."organizationId"

  UNION
  SELECT DISTINCT sp."organizationId", sp."storeId", sp."productId"
  FROM "StorePrice" sp

  UNION
  SELECT DISTINCT s."organizationId", rp."storeId", rp."productId"
  FROM "ReorderPolicy" rp
  JOIN "Store" s ON s."id" = rp."storeId"
  JOIN "Product" p ON p."id" = rp."productId" AND p."organizationId" = s."organizationId"

  UNION
  SELECT DISTINCT s."organizationId", po."storeId", pol."productId"
  FROM "PurchaseOrderLine" pol
  JOIN "PurchaseOrder" po ON po."id" = pol."purchaseOrderId"
  JOIN "Store" s ON s."id" = po."storeId"
  JOIN "Product" p ON p."id" = pol."productId" AND p."organizationId" = s."organizationId"

  UNION
  SELECT DISTINCT co."organizationId", co."storeId", col."productId"
  FROM "CustomerOrderLine" col
  JOIN "CustomerOrder" co ON co."id" = col."customerOrderId"
  WHERE co."storeId" IS NOT NULL
),
single_snapshot AS (
  SELECT p."organizationId", MIN(i."storeId") AS "storeId", i."productId"
  FROM "InventorySnapshot" i
  JOIN "Product" p ON p."id" = i."productId"
  GROUP BY p."organizationId", i."productId"
  HAVING COUNT(DISTINCT i."storeId") = 1
),
assignments AS (
  SELECT * FROM evidence
  UNION
  SELECT * FROM single_snapshot
)
INSERT INTO "StoreProduct" ("id", "organizationId", "storeId", "productId", "isActive", "createdAt", "updatedAt")
SELECT
  'sp_' || md5(a."storeId" || ':' || a."productId"),
  a."organizationId",
  a."storeId",
  a."productId",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM assignments a
JOIN "Store" s ON s."id" = a."storeId" AND s."organizationId" = a."organizationId"
JOIN "Product" p ON p."id" = a."productId" AND p."organizationId" = a."organizationId"
ON CONFLICT ("storeId", "productId") DO UPDATE SET
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;
