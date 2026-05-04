-- AlterTable
ALTER TABLE "CashDrawerMovement" ADD COLUMN     "currencyCode" TEXT,
ADD COLUMN     "currencyRateKgsPerUnit" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "CustomerOrder" ADD COLUMN     "currencyCode" TEXT,
ADD COLUMN     "currencyRateKgsPerUnit" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "FiscalReceipt" ADD COLUMN     "currencyCode" TEXT,
ADD COLUMN     "currencyRateKgsPerUnit" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "currencyCode" TEXT,
ADD COLUMN     "currencyRateKgsPerUnit" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "RefundRequest" ADD COLUMN     "currencyCode" TEXT,
ADD COLUMN     "currencyRateKgsPerUnit" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "RegisterShift" ADD COLUMN     "currencyCode" TEXT,
ADD COLUMN     "currencyRateKgsPerUnit" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "SalePayment" ADD COLUMN     "currencyCode" TEXT,
ADD COLUMN     "currencyRateKgsPerUnit" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "SaleReturn" ADD COLUMN     "currencyCode" TEXT,
ADD COLUMN     "currencyRateKgsPerUnit" DECIMAL(18,6);
