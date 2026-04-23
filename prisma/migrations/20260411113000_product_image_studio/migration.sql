-- CreateEnum
CREATE TYPE "ProductImageStudioJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProductImageStudioBackground" AS ENUM ('WHITE', 'LIGHT_GRAY');

-- CreateEnum
CREATE TYPE "ProductImageStudioOutputFormat" AS ENUM ('SQUARE');

-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN "isAiGenerated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProductImageStudioJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT,
    "createdById" TEXT NOT NULL,
    "status" "ProductImageStudioJobStatus" NOT NULL DEFAULT 'QUEUED',
    "sourceImageUrl" TEXT NOT NULL,
    "sourceImageMimeType" TEXT NOT NULL,
    "sourceImageBytes" INTEGER,
    "outputImageUrl" TEXT,
    "outputImageMimeType" TEXT,
    "outputImageBytes" INTEGER,
    "backgroundMode" "ProductImageStudioBackground" NOT NULL,
    "outputFormat" "ProductImageStudioOutputFormat" NOT NULL DEFAULT 'SQUARE',
    "centered" BOOLEAN NOT NULL DEFAULT true,
    "improveVisibility" BOOLEAN NOT NULL DEFAULT true,
    "softShadow" BOOLEAN NOT NULL DEFAULT false,
    "tighterCrop" BOOLEAN NOT NULL DEFAULT false,
    "brighterPresentation" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL,
    "providerJobId" TEXT,
    "requestPrompt" TEXT,
    "providerRequestJson" JSONB,
    "providerResponseJson" JSONB,
    "errorMessage" TEXT,
    "savedProductImageId" TEXT,
    "savedAsPrimary" BOOLEAN NOT NULL DEFAULT false,
    "savedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ProductImageStudioJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductImageStudioJob_organizationId_createdAt_idx" ON "ProductImageStudioJob"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductImageStudioJob_organizationId_status_createdAt_idx" ON "ProductImageStudioJob"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ProductImageStudioJob_productId_createdAt_idx" ON "ProductImageStudioJob"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductImageStudioJob_createdById_createdAt_idx" ON "ProductImageStudioJob"("createdById", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductImageStudioJob" ADD CONSTRAINT "ProductImageStudioJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImageStudioJob" ADD CONSTRAINT "ProductImageStudioJob_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImageStudioJob" ADD CONSTRAINT "ProductImageStudioJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
