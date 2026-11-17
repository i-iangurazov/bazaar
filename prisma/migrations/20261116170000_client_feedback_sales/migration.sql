-- Client feedback 2026-11-16: employee attribution and completed-sale corrections.

-- R3: separate the operator who completed the sale from the author who created it.
ALTER TABLE "CustomerOrder" ADD COLUMN "completedById" TEXT;
ALTER TABLE "CustomerOrder"
  ADD CONSTRAINT "CustomerOrder_completedById_fkey"
  FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "CustomerOrder_employee_created_idx"
  ON "CustomerOrder"("organizationId", "createdById", "createdAt");

-- R7: a returned line may be accepted into sellable stock or kept aside.
ALTER TABLE "SaleReturnLine" ADD COLUMN "restock" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "OrganizationCounter" ADD COLUMN "salesCorrectionNumber" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "SalesOrderCorrection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "originalOrderId" TEXT NOT NULL,
  "saleReturnId" TEXT,
  "additionOrderId" TEXT,
  "shiftId" TEXT,
  "reason" VARCHAR(500) NOT NULL,
  "notes" TEXT,
  "returnedKgs" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "addedKgs" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "refundKgs" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "chargeKgs" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "restock" BOOLEAN NOT NULL DEFAULT true,
  "paymentMethod" "PosPaymentMethod",
  "before" JSONB,
  "after" JSONB,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesOrderCorrection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesOrderCorrection_saleReturnId_key"
  ON "SalesOrderCorrection"("saleReturnId");
CREATE UNIQUE INDEX "SalesOrderCorrection_additionOrderId_key"
  ON "SalesOrderCorrection"("additionOrderId");
CREATE UNIQUE INDEX "SalesOrderCorrection_organizationId_number_key"
  ON "SalesOrderCorrection"("organizationId", "number");
CREATE INDEX "SalesOrderCorrection_originalOrderId_createdAt_idx"
  ON "SalesOrderCorrection"("originalOrderId", "createdAt");
CREATE INDEX "SalesOrderCorrection_organizationId_storeId_createdAt_idx"
  ON "SalesOrderCorrection"("organizationId", "storeId", "createdAt");
CREATE INDEX "SalesOrderCorrection_createdById_createdAt_idx"
  ON "SalesOrderCorrection"("createdById", "createdAt");

ALTER TABLE "SalesOrderCorrection"
  ADD CONSTRAINT "SalesOrderCorrection_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesOrderCorrection"
  ADD CONSTRAINT "SalesOrderCorrection_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesOrderCorrection"
  ADD CONSTRAINT "SalesOrderCorrection_originalOrderId_fkey"
  FOREIGN KEY ("originalOrderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesOrderCorrection"
  ADD CONSTRAINT "SalesOrderCorrection_additionOrderId_fkey"
  FOREIGN KEY ("additionOrderId") REFERENCES "CustomerOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesOrderCorrection"
  ADD CONSTRAINT "SalesOrderCorrection_saleReturnId_fkey"
  FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturn"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesOrderCorrection"
  ADD CONSTRAINT "SalesOrderCorrection_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "RegisterShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesOrderCorrection"
  ADD CONSTRAINT "SalesOrderCorrection_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
