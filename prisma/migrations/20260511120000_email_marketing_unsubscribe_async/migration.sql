ALTER TABLE "Customer" ADD COLUMN "emailMarketingUnsubscribedAt" TIMESTAMP(3);

CREATE INDEX "Customer_storeId_emailMarketingUnsubscribedAt_idx" ON "Customer"("storeId", "emailMarketingUnsubscribedAt");
