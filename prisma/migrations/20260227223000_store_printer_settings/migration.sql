-- CreateEnum
CREATE TYPE "PrinterPrintMode" AS ENUM ('PDF', 'CONNECTOR');

-- CreateTable
CREATE TABLE "StorePrinterSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "receiptPrintMode" "PrinterPrintMode" NOT NULL DEFAULT 'PDF',
    "labelPrintMode" "PrinterPrintMode" NOT NULL DEFAULT 'PDF',
    "receiptPrinterModel" TEXT DEFAULT 'XP-P501A',
    "labelPrinterModel" TEXT DEFAULT 'XP-365B',
    "connectorDeviceId" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorePrinterSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorePrinterSettings_storeId_key" ON "StorePrinterSettings"("storeId");

-- CreateIndex
CREATE INDEX "StorePrinterSettings_organizationId_storeId_idx" ON "StorePrinterSettings"("organizationId", "storeId");

-- CreateIndex
CREATE INDEX "StorePrinterSettings_connectorDeviceId_idx" ON "StorePrinterSettings"("connectorDeviceId");

-- AddForeignKey
ALTER TABLE "StorePrinterSettings" ADD CONSTRAINT "StorePrinterSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorePrinterSettings" ADD CONSTRAINT "StorePrinterSettings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorePrinterSettings" ADD CONSTRAINT "StorePrinterSettings_connectorDeviceId_fkey" FOREIGN KEY ("connectorDeviceId") REFERENCES "KkmConnectorDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorePrinterSettings" ADD CONSTRAINT "StorePrinterSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
