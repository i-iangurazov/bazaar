-- CreateEnum
CREATE TYPE "MMarketIntegrationStatus" AS ENUM ('DISABLED', 'READY', 'ERROR');

-- CreateEnum
CREATE TYPE "MMarketEnvironment" AS ENUM ('DEV', 'PROD');

-- CreateEnum
CREATE TYPE "MMarketLastSyncStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "MMarketExportJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'RATE_LIMITED');

-- CreateTable
CREATE TABLE "MMarketIntegration" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "status" "MMarketIntegrationStatus" NOT NULL DEFAULT 'DISABLED',
    "environment" "MMarketEnvironment" NOT NULL DEFAULT 'DEV',
    "apiTokenEncrypted" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" "MMarketLastSyncStatus",
    "lastErrorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MMarketIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MMarketBranchMapping" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "mmarketBranchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MMarketBranchMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MMarketExportJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" "MMarketEnvironment" NOT NULL,
    "status" "MMarketExportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "requestedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "payloadStatsJson" JSONB,
    "errorReportJson" JSONB,
    "requestIdempotencyKey" TEXT NOT NULL,
    "responseJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MMarketExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MMarketIntegration_orgId_key" ON "MMarketIntegration"("orgId");

-- CreateIndex
CREATE INDEX "MMarketIntegration_orgId_status_updatedAt_idx" ON "MMarketIntegration"("orgId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MMarketBranchMapping_orgId_storeId_key" ON "MMarketBranchMapping"("orgId", "storeId");

-- CreateIndex
CREATE INDEX "MMarketBranchMapping_orgId_storeId_idx" ON "MMarketBranchMapping"("orgId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "MMarketExportJob_requestIdempotencyKey_key" ON "MMarketExportJob"("requestIdempotencyKey");

-- CreateIndex
CREATE INDEX "MMarketExportJob_orgId_createdAt_idx" ON "MMarketExportJob"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "MMarketExportJob_orgId_status_createdAt_idx" ON "MMarketExportJob"("orgId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "MMarketIntegration" ADD CONSTRAINT "MMarketIntegration_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MMarketBranchMapping" ADD CONSTRAINT "MMarketBranchMapping_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MMarketBranchMapping" ADD CONSTRAINT "MMarketBranchMapping_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MMarketExportJob" ADD CONSTRAINT "MMarketExportJob_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MMarketExportJob" ADD CONSTRAINT "MMarketExportJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
