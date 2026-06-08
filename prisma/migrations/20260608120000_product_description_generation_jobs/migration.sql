CREATE TYPE "ProductDescriptionGenerationSource" AS ENUM ('PRODUCTS_PAGE', 'M_MARKET', 'BAKAI_STORE');

CREATE TYPE "ProductDescriptionGenerationJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'DONE', 'DONE_WITH_ERRORS', 'FAILED', 'CANCELLED');

CREATE TYPE "ProductDescriptionGenerationItemStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'SKIPPED', 'CANCELLED');

CREATE TABLE "ProductDescriptionGenerationJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT,
    "createdById" TEXT NOT NULL,
    "source" "ProductDescriptionGenerationSource" NOT NULL,
    "status" "ProductDescriptionGenerationJobStatus" NOT NULL DEFAULT 'QUEUED',
    "locale" TEXT,
    "overwriteExisting" BOOLEAN NOT NULL DEFAULT false,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductDescriptionGenerationJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductDescriptionGenerationJobItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "ProductDescriptionGenerationItemStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "generatedDescription" TEXT,
    "previousDescription" TEXT,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductDescriptionGenerationJobItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductDescriptionGenerationJobItem_jobId_productId_key" ON "ProductDescriptionGenerationJobItem"("jobId", "productId");

CREATE INDEX "ProductDescriptionGenerationJob_organizationId_createdAt_idx" ON "ProductDescriptionGenerationJob"("organizationId", "createdAt");
CREATE INDEX "ProductDescriptionGenerationJob_organizationId_status_createdAt_idx" ON "ProductDescriptionGenerationJob"("organizationId", "status", "createdAt");
CREATE INDEX "ProductDescriptionGenerationJob_organizationId_storeId_createdAt_idx" ON "ProductDescriptionGenerationJob"("organizationId", "storeId", "createdAt");
CREATE INDEX "ProductDescriptionGenerationJob_createdById_createdAt_idx" ON "ProductDescriptionGenerationJob"("createdById", "createdAt");

CREATE INDEX "ProductDescriptionGenerationJobItem_organizationId_jobId_status_idx" ON "ProductDescriptionGenerationJobItem"("organizationId", "jobId", "status");
CREATE INDEX "ProductDescriptionGenerationJobItem_organizationId_productId_createdAt_idx" ON "ProductDescriptionGenerationJobItem"("organizationId", "productId", "createdAt");
CREATE INDEX "ProductDescriptionGenerationJobItem_jobId_status_createdAt_idx" ON "ProductDescriptionGenerationJobItem"("jobId", "status", "createdAt");

ALTER TABLE "ProductDescriptionGenerationJob"
  ADD CONSTRAINT "ProductDescriptionGenerationJob_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductDescriptionGenerationJob"
  ADD CONSTRAINT "ProductDescriptionGenerationJob_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductDescriptionGenerationJob"
  ADD CONSTRAINT "ProductDescriptionGenerationJob_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductDescriptionGenerationJobItem"
  ADD CONSTRAINT "ProductDescriptionGenerationJobItem_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductDescriptionGenerationJobItem"
  ADD CONSTRAINT "ProductDescriptionGenerationJobItem_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "ProductDescriptionGenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductDescriptionGenerationJobItem"
  ADD CONSTRAINT "ProductDescriptionGenerationJobItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
