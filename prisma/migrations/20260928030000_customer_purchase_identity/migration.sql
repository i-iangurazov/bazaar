-- Preserve historical contact snapshots without guessing a customer identity.
ALTER TABLE "CustomerOrder" ADD COLUMN "customerId" TEXT;
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CustomerOrder_customer_report_idx"
  ON "CustomerOrder" ("organizationId", "customerId", "storeId", status, "completedAt");
