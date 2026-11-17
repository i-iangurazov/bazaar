-- BZR-01/BZR-02: explicit settlement state for corrections and manual refunds.
-- Historical payments remain actual money; historical refund requests have no
-- recorded amount and no shift until a resolver confirms or cancels them.

CREATE TYPE "SalePaymentSettlement" AS ENUM ('ACTUAL', 'OFFSET', 'PENDING', 'VOID');

ALTER TABLE "SalePayment"
  ADD COLUMN "settlementStatus" "SalePaymentSettlement" NOT NULL DEFAULT 'ACTUAL',
  ADD COLUMN "refundRequestId" TEXT;

ALTER TABLE "RefundRequest"
  ADD COLUMN "amountKgs" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "shiftId" TEXT;

ALTER TABLE "SalesOrderCorrection"
  ADD COLUMN "offsetKgs" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "SalePayment_refundRequestId_key"
  ON "SalePayment"("refundRequestId");

ALTER TABLE "SalePayment"
  ADD CONSTRAINT "SalePayment_refundRequestId_fkey"
  FOREIGN KEY ("refundRequestId") REFERENCES "RefundRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RefundRequest"
  ADD CONSTRAINT "RefundRequest_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "RegisterShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
