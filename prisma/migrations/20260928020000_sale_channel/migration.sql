-- Historical sales stay unrecorded. New-sale defaults belong to the create path.
CREATE TYPE "SaleChannel" AS ENUM ('IN_STORE', 'ONLINE');
ALTER TABLE "CustomerOrder" ADD COLUMN "saleChannel" "SaleChannel";
CREATE INDEX "CustomerOrder_commercial_channel_report_idx"
  ON "CustomerOrder" ("organizationId", "saleChannel", "storeId", status, "completedAt");
