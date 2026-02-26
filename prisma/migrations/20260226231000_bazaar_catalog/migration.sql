-- CreateEnum
CREATE TYPE "CustomerOrderSource" AS ENUM ('MANUAL', 'CATALOG');

-- CreateEnum
CREATE TYPE "BazaarCatalogStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "BazaarCatalogFontFamily" AS ENUM ('NotoSans', 'Inter', 'System');

-- CreateEnum
CREATE TYPE "BazaarCatalogHeaderStyle" AS ENUM ('COMPACT', 'STANDARD');

-- AlterTable
ALTER TABLE "CustomerOrder" ADD COLUMN "source" "CustomerOrderSource" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "BazaarCatalogImage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BazaarCatalogImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BazaarCatalog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" "BazaarCatalogStatus" NOT NULL DEFAULT 'DRAFT',
    "slug" TEXT NOT NULL,
    "publicUrlPath" TEXT NOT NULL,
    "title" TEXT,
    "logoImageId" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT '#2a6be4',
    "fontFamily" "BazaarCatalogFontFamily" NOT NULL DEFAULT 'NotoSans',
    "headerStyle" "BazaarCatalogHeaderStyle" NOT NULL DEFAULT 'STANDARD',
    "publishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BazaarCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerOrder_organizationId_source_createdAt_idx" ON "CustomerOrder"("organizationId", "source", "createdAt");

-- CreateIndex
CREATE INDEX "BazaarCatalogImage_organizationId_createdAt_idx" ON "BazaarCatalogImage"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BazaarCatalog_storeId_key" ON "BazaarCatalog"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "BazaarCatalog_slug_key" ON "BazaarCatalog"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "BazaarCatalog_organizationId_storeId_key" ON "BazaarCatalog"("organizationId", "storeId");

-- CreateIndex
CREATE INDEX "BazaarCatalog_organizationId_status_updatedAt_idx" ON "BazaarCatalog"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "BazaarCatalog_organizationId_slug_idx" ON "BazaarCatalog"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "BazaarCatalog_storeId_status_idx" ON "BazaarCatalog"("storeId", "status");

-- AddForeignKey
ALTER TABLE "BazaarCatalogImage" ADD CONSTRAINT "BazaarCatalogImage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BazaarCatalog" ADD CONSTRAINT "BazaarCatalog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BazaarCatalog" ADD CONSTRAINT "BazaarCatalog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BazaarCatalog" ADD CONSTRAINT "BazaarCatalog_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BazaarCatalog" ADD CONSTRAINT "BazaarCatalog_logoImageId_fkey" FOREIGN KEY ("logoImageId") REFERENCES "BazaarCatalogImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
