-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'CASHIER';

-- CreateEnum
CREATE TYPE "RegisterShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PosPaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "CashDrawerMovementType" AS ENUM ('PAY_IN', 'PAY_OUT');

-- CreateEnum
CREATE TYPE "PosReturnStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PosKkmStatus" AS ENUM ('NOT_SENT', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "OrganizationCounter"
  ADD COLUMN "posSaleNumber" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "posReturnNumber" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CustomerOrder"
  ADD COLUMN "registerId" TEXT,
  ADD COLUMN "shiftId" TEXT,
  ADD COLUMN "isPosSale" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "kkmStatus" "PosKkmStatus" NOT NULL DEFAULT 'NOT_SENT',
  ADD COLUMN "kkmReceiptId" TEXT,
  ADD COLUMN "kkmRawJson" JSONB;

-- CreateTable
CREATE TABLE "PosRegister" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PosRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegisterShift" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "registerId" TEXT NOT NULL,
  "status" "RegisterShiftStatus" NOT NULL DEFAULT 'OPEN',
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "openedById" TEXT NOT NULL,
  "closedAt" TIMESTAMP(3),
  "closedById" TEXT,
  "openingCashKgs" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "closingCashCountedKgs" DECIMAL(12,2),
  "expectedCashKgs" DECIMAL(12,2),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RegisterShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalePayment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "customerOrderId" TEXT NOT NULL,
  "saleReturnId" TEXT,
  "method" "PosPaymentMethod" NOT NULL,
  "amountKgs" DECIMAL(12,2) NOT NULL,
  "providerRef" TEXT,
  "isRefund" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,

  CONSTRAINT "SalePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashDrawerMovement" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "type" "CashDrawerMovementType" NOT NULL,
  "amountKgs" DECIMAL(12,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,

  CONSTRAINT "CashDrawerMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReturn" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "registerId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "originalSaleId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "status" "PosReturnStatus" NOT NULL DEFAULT 'DRAFT',
  "subtotalKgs" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalKgs" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "completedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "completedEventId" TEXT,
  "createdById" TEXT NOT NULL,
  "completedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReturnLine" (
  "id" TEXT NOT NULL,
  "saleReturnId" TEXT NOT NULL,
  "customerOrderLineId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "variantKey" TEXT NOT NULL DEFAULT 'BASE',
  "qty" INTEGER NOT NULL,
  "unitPriceKgs" DECIMAL(12,2) NOT NULL,
  "lineTotalKgs" DECIMAL(12,2) NOT NULL,
  "unitCostKgs" DECIMAL(12,2),
  "lineCostTotalKgs" DECIMAL(12,2),

  CONSTRAINT "SaleReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosRegister_storeId_code_key" ON "PosRegister"("storeId", "code");

-- CreateIndex
CREATE INDEX "PosRegister_organizationId_storeId_isActive_idx" ON "PosRegister"("organizationId", "storeId", "isActive");

-- CreateIndex
CREATE INDEX "RegisterShift_organizationId_storeId_status_openedAt_idx" ON "RegisterShift"("organizationId", "storeId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "RegisterShift_registerId_status_openedAt_idx" ON "RegisterShift"("registerId", "status", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RegisterShift_registerId_open_unique" ON "RegisterShift"("registerId") WHERE "status" = 'OPEN';

-- CreateIndex
CREATE INDEX "SalePayment_organizationId_storeId_createdAt_idx" ON "SalePayment"("organizationId", "storeId", "createdAt");

-- CreateIndex
CREATE INDEX "SalePayment_shiftId_createdAt_idx" ON "SalePayment"("shiftId", "createdAt");

-- CreateIndex
CREATE INDEX "SalePayment_customerOrderId_createdAt_idx" ON "SalePayment"("customerOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "CashDrawerMovement_organizationId_storeId_createdAt_idx" ON "CashDrawerMovement"("organizationId", "storeId", "createdAt");

-- CreateIndex
CREATE INDEX "CashDrawerMovement_shiftId_createdAt_idx" ON "CashDrawerMovement"("shiftId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReturn_organizationId_number_key" ON "SaleReturn"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReturn_completedEventId_key" ON "SaleReturn"("completedEventId");

-- CreateIndex
CREATE INDEX "SaleReturn_organizationId_storeId_status_createdAt_idx" ON "SaleReturn"("organizationId", "storeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SaleReturn_originalSaleId_createdAt_idx" ON "SaleReturn"("originalSaleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReturnLine_saleReturnId_customerOrderLineId_key" ON "SaleReturnLine"("saleReturnId", "customerOrderLineId");

-- CreateIndex
CREATE INDEX "SaleReturnLine_saleReturnId_idx" ON "SaleReturnLine"("saleReturnId");

-- CreateIndex
CREATE INDEX "SaleReturnLine_productId_variantId_idx" ON "SaleReturnLine"("productId", "variantId");

-- CreateIndex
CREATE INDEX "CustomerOrder_organizationId_isPosSale_createdAt_idx" ON "CustomerOrder"("organizationId", "isPosSale", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerOrder_shiftId_status_createdAt_idx" ON "CustomerOrder"("shiftId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "PosRegister"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "RegisterShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosRegister" ADD CONSTRAINT "PosRegister_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosRegister" ADD CONSTRAINT "PosRegister_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterShift" ADD CONSTRAINT "RegisterShift_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterShift" ADD CONSTRAINT "RegisterShift_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterShift" ADD CONSTRAINT "RegisterShift_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "PosRegister"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterShift" ADD CONSTRAINT "RegisterShift_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterShift" ADD CONSTRAINT "RegisterShift_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "RegisterShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "CustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_saleReturnId_fkey" FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawerMovement" ADD CONSTRAINT "CashDrawerMovement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawerMovement" ADD CONSTRAINT "CashDrawerMovement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawerMovement" ADD CONSTRAINT "CashDrawerMovement_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "RegisterShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawerMovement" ADD CONSTRAINT "CashDrawerMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "PosRegister"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "RegisterShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_originalSaleId_fkey" FOREIGN KEY ("originalSaleId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnLine" ADD CONSTRAINT "SaleReturnLine_saleReturnId_fkey" FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnLine" ADD CONSTRAINT "SaleReturnLine_customerOrderLineId_fkey" FOREIGN KEY ("customerOrderLineId") REFERENCES "CustomerOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnLine" ADD CONSTRAINT "SaleReturnLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnLine" ADD CONSTRAINT "SaleReturnLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
