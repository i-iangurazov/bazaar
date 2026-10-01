-- Keep the original StorePrice contract readable by the previous application.
-- Additional price types do not create or freeze a standard-price override.
CREATE TABLE "StorePriceTypes" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id"),
  "storeId" TEXT NOT NULL REFERENCES "Store"("id"),
  "productId" TEXT NOT NULL REFERENCES "Product"("id"),
  "variantId" TEXT REFERENCES "ProductVariant"("id"),
  "variantKey" TEXT NOT NULL DEFAULT 'BASE',
  "retailPriceKgs" DECIMAL(12,2),
  "wholesalePriceKgs" DECIMAL(12,2),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedById" TEXT REFERENCES "User"("id"),
  CONSTRAINT "StorePriceTypes_nonnegative" CHECK (("retailPriceKgs" IS NULL OR "retailPriceKgs" >= 0) AND ("wholesalePriceKgs" IS NULL OR "wholesalePriceKgs" >= 0))
);
CREATE UNIQUE INDEX "StorePriceTypes_organizationId_storeId_productId_variantKey_key" ON "StorePriceTypes"("organizationId","storeId","productId","variantKey");
CREATE INDEX "StorePriceTypes_storeId_productId_idx" ON "StorePriceTypes"("storeId","productId");
INSERT INTO "StorePriceTypes" ("id","organizationId","storeId","productId","variantId","variantKey","retailPriceKgs","wholesalePriceKgs","updatedAt","updatedById")
SELECT "id","organizationId","storeId","productId","variantId","variantKey","retailPriceKgs","wholesalePriceKgs","updatedAt","updatedById" FROM "StorePrice"
WHERE "retailPriceKgs" IS NOT NULL OR "wholesalePriceKgs" IS NOT NULL;
-- NULL standard rows can only have been created after the preceding, unreleased
-- migration. Their extra prices are preserved above; no old override is removed.
DELETE FROM "StorePrice" WHERE "priceKgs" IS NULL AND "discountType" IS NULL;
UPDATE "StorePrice" s SET "priceKgs" = COALESCE(p."basePriceKgs",0) FROM "Product" p WHERE p.id = s."productId" AND s."priceKgs" IS NULL;
ALTER TABLE "StorePrice" ALTER COLUMN "priceKgs" SET NOT NULL;
