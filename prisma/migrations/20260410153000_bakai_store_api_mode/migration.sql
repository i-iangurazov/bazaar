-- CreateEnum
CREATE TYPE "BakaiStoreConnectionMode" AS ENUM ('TEMPLATE', 'API');

-- CreateEnum
CREATE TYPE "BakaiStoreJobType" AS ENUM ('TEMPLATE_EXPORT', 'API_SYNC');

-- CreateEnum
CREATE TYPE "BakaiStoreLastSyncStatus" AS ENUM ('SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "BakaiStoreIntegration"
ADD COLUMN "connectionMode" "BakaiStoreConnectionMode" NOT NULL DEFAULT 'TEMPLATE',
ADD COLUMN "apiTokenEncrypted" TEXT,
ADD COLUMN "lastSyncStatus" "BakaiStoreLastSyncStatus",
ADD COLUMN "lastConnectionCheckAt" TIMESTAMP(3),
ADD COLUMN "lastConnectionCheckSummary" TEXT;

-- AlterTable
ALTER TABLE "BakaiStoreExportJob"
ADD COLUMN "jobType" "BakaiStoreJobType" NOT NULL DEFAULT 'TEMPLATE_EXPORT',
ADD COLUMN "responseJson" JSONB,
ADD COLUMN "attemptedCount" INTEGER,
ADD COLUMN "succeededCount" INTEGER,
ADD COLUMN "failedCount" INTEGER,
ADD COLUMN "skippedCount" INTEGER;

-- CreateTable
CREATE TABLE "BakaiStoreBranchMapping" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "bakaiBranchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BakaiStoreBranchMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BakaiStoreProductSyncState" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "bakaiExternalRef" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncStatus" "BakaiStoreLastSyncStatus",
    "lastPayloadChecksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BakaiStoreProductSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BakaiStoreBranchMapping_orgId_storeId_key" ON "BakaiStoreBranchMapping"("orgId", "storeId");

-- CreateIndex
CREATE INDEX "BakaiStoreBranchMapping_orgId_storeId_idx" ON "BakaiStoreBranchMapping"("orgId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "BakaiStoreProductSyncState_orgId_productId_key" ON "BakaiStoreProductSyncState"("orgId", "productId");

-- CreateIndex
CREATE INDEX "BakaiStoreProductSyncState_orgId_productId_idx" ON "BakaiStoreProductSyncState"("orgId", "productId");

-- CreateIndex
CREATE INDEX "BakaiStoreProductSyncState_productId_idx" ON "BakaiStoreProductSyncState"("productId");

-- AddForeignKey
ALTER TABLE "BakaiStoreBranchMapping" ADD CONSTRAINT "BakaiStoreBranchMapping_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BakaiStoreBranchMapping" ADD CONSTRAINT "BakaiStoreBranchMapping_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BakaiStoreProductSyncState" ADD CONSTRAINT "BakaiStoreProductSyncState_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BakaiStoreProductSyncState" ADD CONSTRAINT "BakaiStoreProductSyncState_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
