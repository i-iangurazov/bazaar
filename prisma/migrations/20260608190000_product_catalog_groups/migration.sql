-- Product catalog groups let selected stores share product visibility while
-- preserving store-specific stock in InventorySnapshot.
-- Backfill creates one catalog per existing store, so current production
-- visibility remains separated until stores are explicitly grouped.

CREATE TABLE "ProductCatalog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductCatalog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Store" ADD COLUMN "productCatalogId" TEXT;

INSERT INTO "ProductCatalog" ("id", "organizationId", "name", "createdAt", "updatedAt")
SELECT
  'catalog_' || "id",
  "organizationId",
  "name",
  "createdAt",
  "updatedAt"
FROM "Store"
WHERE "productCatalogId" IS NULL;

UPDATE "Store"
SET "productCatalogId" = 'catalog_' || "id"
WHERE "productCatalogId" IS NULL;

CREATE INDEX "ProductCatalog_organizationId_idx"
  ON "ProductCatalog"("organizationId");

CREATE INDEX "ProductCatalog_organizationId_name_idx"
  ON "ProductCatalog"("organizationId", "name");

CREATE INDEX "Store_organizationId_productCatalogId_idx"
  ON "Store"("organizationId", "productCatalogId");

ALTER TABLE "ProductCatalog"
  ADD CONSTRAINT "ProductCatalog_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Store"
  ADD CONSTRAINT "Store_productCatalogId_fkey"
  FOREIGN KEY ("productCatalogId") REFERENCES "ProductCatalog"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
