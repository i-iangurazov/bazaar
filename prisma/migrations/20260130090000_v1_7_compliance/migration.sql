-- Create enums
CREATE TYPE "KkmMode" AS ENUM ('OFF', 'EXPORT_ONLY', 'ADAPTER');
CREATE TYPE "ExportJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');
CREATE TYPE "ExportType" AS ENUM ('SALES_SUMMARY', 'STOCK_MOVEMENTS', 'PURCHASES', 'INVENTORY_ON_HAND', 'PERIOD_CLOSE_REPORT', 'RECEIPTS_FOR_KKM');

-- Create StoreComplianceProfile
CREATE TABLE "StoreComplianceProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "defaultLocale" TEXT,
    "taxRegime" TEXT,
    "enableKkm" BOOLEAN NOT NULL DEFAULT false,
    "kkmMode" "KkmMode" NOT NULL DEFAULT 'OFF',
    "enableEsf" BOOLEAN NOT NULL DEFAULT false,
    "enableEttn" BOOLEAN NOT NULL DEFAULT false,
    "enableMarking" BOOLEAN NOT NULL DEFAULT false,
    "kkmProviderKey" TEXT,
    "kkmSettings" JSONB,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreComplianceProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoreComplianceProfile_storeId_key" ON "StoreComplianceProfile"("storeId");
CREATE INDEX "StoreComplianceProfile_organizationId_storeId_idx" ON "StoreComplianceProfile"("organizationId", "storeId");

ALTER TABLE "StoreComplianceProfile" ADD CONSTRAINT "StoreComplianceProfile_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoreComplianceProfile" ADD CONSTRAINT "StoreComplianceProfile_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoreComplianceProfile" ADD CONSTRAINT "StoreComplianceProfile_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create ProductComplianceFlags
CREATE TABLE "ProductComplianceFlags" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "requiresMarking" BOOLEAN NOT NULL DEFAULT false,
    "requiresEttn" BOOLEAN NOT NULL DEFAULT false,
    "markingType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductComplianceFlags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductComplianceFlags_productId_key" ON "ProductComplianceFlags"("productId");
CREATE INDEX "ProductComplianceFlags_organizationId_productId_idx" ON "ProductComplianceFlags"("organizationId", "productId");

ALTER TABLE "ProductComplianceFlags" ADD CONSTRAINT "ProductComplianceFlags_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductComplianceFlags" ADD CONSTRAINT "ProductComplianceFlags_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create ExportJob
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" "ExportType" NOT NULL,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "fileName" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "storagePath" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExportJob_organizationId_storeId_createdAt_idx" ON "ExportJob"("organizationId", "storeId", "createdAt");
CREATE INDEX "ExportJob_status_createdAt_idx" ON "ExportJob"("status", "createdAt");

ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create PeriodClose
CREATE TABLE "PeriodClose" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT NOT NULL,
    "snapshotHash" TEXT,
    "totals" JSONB,

    CONSTRAINT "PeriodClose_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PeriodClose_organizationId_storeId_periodStart_periodEnd_key" ON "PeriodClose"("organizationId", "storeId", "periodStart", "periodEnd");
CREATE INDEX "PeriodClose_organizationId_storeId_closedAt_idx" ON "PeriodClose"("organizationId", "storeId", "closedAt");

ALTER TABLE "PeriodClose" ADD CONSTRAINT "PeriodClose_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PeriodClose" ADD CONSTRAINT "PeriodClose_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PeriodClose" ADD CONSTRAINT "PeriodClose_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
