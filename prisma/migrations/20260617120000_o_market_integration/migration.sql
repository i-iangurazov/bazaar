-- CreateEnum
CREATE TYPE "OMarketIntegrationStatus" AS ENUM ('DISABLED', 'DRAFT', 'READY', 'ERROR');

-- CreateEnum
CREATE TYPE "OMarketExportJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "OMarketJobType" AS ENUM ('PRODUCT_EXPORT', 'STOCK_PRICE_SYNC', 'FULL_SYNC');

-- CreateEnum
CREATE TYPE "OMarketLastSyncStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "OMarketIntegration" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "status" "OMarketIntegrationStatus" NOT NULL DEFAULT 'DISABLED',
    "baseUrl" TEXT NOT NULL DEFAULT 'https://api-market.o.kg',
    "apiTokenEncrypted" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" "OMarketLastSyncStatus",
    "lastConnectionCheckAt" TIMESTAMP(3),
    "lastConnectionCheckSummary" TEXT,
    "lastErrorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OMarketIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OMarketStoreMapping" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "oMarketLocationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OMarketStoreMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OMarketCategoryMapping" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "bazaarCategory" TEXT NOT NULL,
    "oMarketCategoryId" INTEGER NOT NULL,
    "oMarketCategoryName" TEXT,
    "attributesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OMarketCategoryMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OMarketExportJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT,
    "jobType" "OMarketJobType" NOT NULL DEFAULT 'PRODUCT_EXPORT',
    "status" "OMarketExportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "requestedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "payloadStatsJson" JSONB,
    "errorReportJson" JSONB,
    "responseJson" JSONB,
    "attemptedCount" INTEGER,
    "succeededCount" INTEGER,
    "failedCount" INTEGER,
    "skippedCount" INTEGER,
    "requestIdempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OMarketExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OMarketIncludedProduct" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT,
    "productId" TEXT NOT NULL,
    "discountType" TEXT,
    "discountValue" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastExportedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OMarketIncludedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OMarketProductSyncState" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT,
    "productId" TEXT NOT NULL,
    "oMarketProductId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncStatus" "OMarketLastSyncStatus",
    "lastPayloadChecksum" TEXT,
    "lastErrorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OMarketProductSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OMarketIntegration_orgId_key" ON "OMarketIntegration"("orgId");

-- CreateIndex
CREATE INDEX "OMarketIntegration_orgId_status_updatedAt_idx" ON "OMarketIntegration"("orgId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OMarketStoreMapping_orgId_storeId_key" ON "OMarketStoreMapping"("orgId", "storeId");

-- CreateIndex
CREATE INDEX "OMarketStoreMapping_orgId_storeId_idx" ON "OMarketStoreMapping"("orgId", "storeId");

-- CreateIndex
CREATE INDEX "OMarketStoreMapping_orgId_oMarketLocationId_idx" ON "OMarketStoreMapping"("orgId", "oMarketLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "OMarketCategoryMapping_orgId_bazaarCategory_key" ON "OMarketCategoryMapping"("orgId", "bazaarCategory");

-- CreateIndex
CREATE INDEX "OMarketCategoryMapping_orgId_oMarketCategoryId_idx" ON "OMarketCategoryMapping"("orgId", "oMarketCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "OMarketExportJob_requestIdempotencyKey_key" ON "OMarketExportJob"("requestIdempotencyKey");

-- CreateIndex
CREATE INDEX "OMarketExportJob_orgId_createdAt_idx" ON "OMarketExportJob"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "OMarketExportJob_orgId_storeId_createdAt_idx" ON "OMarketExportJob"("orgId", "storeId", "createdAt");

-- CreateIndex
CREATE INDEX "OMarketExportJob_orgId_status_createdAt_idx" ON "OMarketExportJob"("orgId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OMarketIncludedProduct_orgId_storeId_productId_key" ON "OMarketIncludedProduct"("orgId", "storeId", "productId");

-- CreateIndex
CREATE INDEX "OMarketIncludedProduct_orgId_productId_idx" ON "OMarketIncludedProduct"("orgId", "productId");

-- CreateIndex
CREATE INDEX "OMarketIncludedProduct_orgId_storeId_productId_idx" ON "OMarketIncludedProduct"("orgId", "storeId", "productId");

-- CreateIndex
CREATE INDEX "OMarketIncludedProduct_productId_idx" ON "OMarketIncludedProduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "OMarketProductSyncState_orgId_storeId_productId_key" ON "OMarketProductSyncState"("orgId", "storeId", "productId");

-- CreateIndex
CREATE INDEX "OMarketProductSyncState_orgId_productId_idx" ON "OMarketProductSyncState"("orgId", "productId");

-- CreateIndex
CREATE INDEX "OMarketProductSyncState_orgId_storeId_productId_idx" ON "OMarketProductSyncState"("orgId", "storeId", "productId");

-- CreateIndex
CREATE INDEX "OMarketProductSyncState_productId_idx" ON "OMarketProductSyncState"("productId");

-- AddForeignKey
ALTER TABLE "OMarketIntegration" ADD CONSTRAINT "OMarketIntegration_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OMarketStoreMapping" ADD CONSTRAINT "OMarketStoreMapping_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OMarketStoreMapping" ADD CONSTRAINT "OMarketStoreMapping_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OMarketCategoryMapping" ADD CONSTRAINT "OMarketCategoryMapping_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OMarketExportJob" ADD CONSTRAINT "OMarketExportJob_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OMarketExportJob" ADD CONSTRAINT "OMarketExportJob_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OMarketExportJob" ADD CONSTRAINT "OMarketExportJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OMarketIncludedProduct" ADD CONSTRAINT "OMarketIncludedProduct_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OMarketIncludedProduct" ADD CONSTRAINT "OMarketIncludedProduct_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OMarketIncludedProduct" ADD CONSTRAINT "OMarketIncludedProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OMarketProductSyncState" ADD CONSTRAINT "OMarketProductSyncState_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OMarketProductSyncState" ADD CONSTRAINT "OMarketProductSyncState_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OMarketProductSyncState" ADD CONSTRAINT "OMarketProductSyncState_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
