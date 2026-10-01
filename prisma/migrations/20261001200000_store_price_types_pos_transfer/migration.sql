ALTER TABLE "Store" ADD COLUMN "retailWholesaleEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StorePrice" ADD COLUMN "retailPriceKgs" DECIMAL(12,2), ADD COLUMN "wholesalePriceKgs" DECIMAL(12,2);
ALTER TABLE "StorePrice" ADD CONSTRAINT "StorePrice_additional_prices_nonnegative" CHECK (("retailPriceKgs" IS NULL OR "retailPriceKgs" >= 0) AND ("wholesalePriceKgs" IS NULL OR "wholesalePriceKgs" >= 0));
ALTER TABLE "CustomerOrder" ADD COLUMN "priceMode" TEXT NOT NULL DEFAULT 'RETAIL';
ALTER TABLE "CustomerOrderLine" ADD COLUMN "manualPrice" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "priceSource" TEXT NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "User" ADD COLUMN "canTransferStock" BOOLEAN NOT NULL DEFAULT false;
