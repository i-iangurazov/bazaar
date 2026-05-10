ALTER TABLE "CustomerOrder"
  ADD COLUMN "discountKgs" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "isDebt" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "debtCustomerName" TEXT,
  ADD COLUMN "debtSettledAt" TIMESTAMP(3),
  ADD COLUMN "debtSettledById" TEXT;

CREATE INDEX "CustomerOrder_organizationId_isDebt_debtSettledAt_idx"
  ON "CustomerOrder"("organizationId", "isDebt", "debtSettledAt");
