-- CreateEnum
CREATE TYPE "BakaiStoreIntegrationStatus" AS ENUM ('DISABLED', 'DRAFT', 'READY', 'ERROR');

-- CreateEnum
CREATE TYPE "BakaiStoreExportJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "BakaiStoreIntegration" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "status" "BakaiStoreIntegrationStatus" NOT NULL DEFAULT 'DISABLED',
    "templateFileName" TEXT,
    "templateMimeType" TEXT,
    "templateFileSize" INTEGER,
    "templateStoragePath" TEXT,
    "templateSchemaJson" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "lastErrorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BakaiStoreIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BakaiStoreStockMapping" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "columnKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BakaiStoreStockMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BakaiStoreExportJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "status" "BakaiStoreExportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "requestedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "fileName" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "storagePath" TEXT,
    "payloadStatsJson" JSONB,
    "errorReportJson" JSONB,
    "requestIdempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BakaiStoreExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BakaiStoreIncludedProduct" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "discountPercent" DECIMAL(5,2),
    "discountAmount" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastExportedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BakaiStoreIncludedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BakaiStoreIntegration_orgId_key" ON "BakaiStoreIntegration"("orgId");

-- CreateIndex
CREATE INDEX "BakaiStoreIntegration_orgId_status_updatedAt_idx" ON "BakaiStoreIntegration"("orgId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BakaiStoreStockMapping_orgId_storeId_key" ON "BakaiStoreStockMapping"("orgId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "BakaiStoreStockMapping_orgId_columnKey_key" ON "BakaiStoreStockMapping"("orgId", "columnKey");

-- CreateIndex
CREATE INDEX "BakaiStoreStockMapping_orgId_storeId_idx" ON "BakaiStoreStockMapping"("orgId", "storeId");

-- CreateIndex
CREATE INDEX "BakaiStoreStockMapping_orgId_columnKey_idx" ON "BakaiStoreStockMapping"("orgId", "columnKey");

-- CreateIndex
CREATE UNIQUE INDEX "BakaiStoreExportJob_requestIdempotencyKey_key" ON "BakaiStoreExportJob"("requestIdempotencyKey");

-- CreateIndex
CREATE INDEX "BakaiStoreExportJob_orgId_createdAt_idx" ON "BakaiStoreExportJob"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "BakaiStoreExportJob_orgId_status_createdAt_idx" ON "BakaiStoreExportJob"("orgId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BakaiStoreIncludedProduct_orgId_productId_key" ON "BakaiStoreIncludedProduct"("orgId", "productId");

-- CreateIndex
CREATE INDEX "BakaiStoreIncludedProduct_orgId_productId_idx" ON "BakaiStoreIncludedProduct"("orgId", "productId");

-- CreateIndex
CREATE INDEX "BakaiStoreIncludedProduct_productId_idx" ON "BakaiStoreIncludedProduct"("productId");

-- AddForeignKey
ALTER TABLE "BakaiStoreIntegration" ADD CONSTRAINT "BakaiStoreIntegration_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BakaiStoreStockMapping" ADD CONSTRAINT "BakaiStoreStockMapping_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BakaiStoreStockMapping" ADD CONSTRAINT "BakaiStoreStockMapping_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BakaiStoreExportJob" ADD CONSTRAINT "BakaiStoreExportJob_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BakaiStoreExportJob" ADD CONSTRAINT "BakaiStoreExportJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BakaiStoreIncludedProduct" ADD CONSTRAINT "BakaiStoreIncludedProduct_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BakaiStoreIncludedProduct" ADD CONSTRAINT "BakaiStoreIncludedProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
