ALTER TABLE "MMarketIncludedProduct"
ADD COLUMN IF NOT EXISTS "lastExportedAt" TIMESTAMP(3);
