DO $$
BEGIN
  CREATE TYPE "MarkingMode" AS ENUM ('OFF', 'OPTIONAL', 'REQUIRED_ON_SALE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "MarkingCodeStatus" AS ENUM ('CAPTURED', 'VOIDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "TaxReferenceDocumentType" AS ENUM ('PURCHASE', 'TRANSFER', 'SALE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "ExportType" ADD VALUE IF NOT EXISTS 'RECEIPTS_REGISTRY';
ALTER TYPE "ExportType" ADD VALUE IF NOT EXISTS 'SHIFT_X_REPORT';
ALTER TYPE "ExportType" ADD VALUE IF NOT EXISTS 'SHIFT_Z_REPORT';
ALTER TYPE "ExportType" ADD VALUE IF NOT EXISTS 'SALES_BY_DAY';
ALTER TYPE "ExportType" ADD VALUE IF NOT EXISTS 'SALES_BY_ITEM';
ALTER TYPE "ExportType" ADD VALUE IF NOT EXISTS 'RETURNS_BY_DAY';
ALTER TYPE "ExportType" ADD VALUE IF NOT EXISTS 'RETURNS_BY_ITEM';
ALTER TYPE "ExportType" ADD VALUE IF NOT EXISTS 'CASH_DRAWER_MOVEMENTS';
ALTER TYPE "ExportType" ADD VALUE IF NOT EXISTS 'MARKING_SALES_REGISTRY';
ALTER TYPE "ExportType" ADD VALUE IF NOT EXISTS 'ETTN_REFERENCES';
ALTER TYPE "ExportType" ADD VALUE IF NOT EXISTS 'ESF_REFERENCES';

ALTER TABLE "StoreComplianceProfile"
  ADD COLUMN IF NOT EXISTS "markingMode" "MarkingMode" NOT NULL DEFAULT 'OFF';

CREATE TABLE IF NOT EXISTS "MarkingCodeCapture" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "saleLineId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" "MarkingCodeStatus" NOT NULL DEFAULT 'CAPTURED',
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "capturedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarkingCodeCapture_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MarkingCodeCapture_saleLineId_code_key"
  ON "MarkingCodeCapture" ("saleLineId", "code");
CREATE INDEX IF NOT EXISTS "MarkingCodeCapture_organizationId_storeId_capturedAt_idx"
  ON "MarkingCodeCapture" ("organizationId", "storeId", "capturedAt");
CREATE INDEX IF NOT EXISTS "MarkingCodeCapture_saleId_saleLineId_status_idx"
  ON "MarkingCodeCapture" ("saleId", "saleLineId", "status");

CREATE TABLE IF NOT EXISTS "EttnReference" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "documentType" "TaxReferenceDocumentType" NOT NULL,
  "documentId" TEXT NOT NULL,
  "ettnNumber" TEXT NOT NULL,
  "ettnDate" TIMESTAMP(3),
  "notes" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EttnReference_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EttnReference_organizationId_storeId_documentType_createdAt_idx"
  ON "EttnReference" ("organizationId", "storeId", "documentType", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "EttnReference_organizationId_storeId_documentType_documentId_key"
  ON "EttnReference" ("organizationId", "storeId", "documentType", "documentId");
CREATE INDEX IF NOT EXISTS "EttnReference_documentType_documentId_idx"
  ON "EttnReference" ("documentType", "documentId");

CREATE TABLE IF NOT EXISTS "EsfReference" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "documentType" "TaxReferenceDocumentType" NOT NULL,
  "documentId" TEXT NOT NULL,
  "esfNumber" TEXT NOT NULL,
  "esfDate" TIMESTAMP(3),
  "counterpartyName" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EsfReference_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EsfReference_organizationId_storeId_documentType_createdAt_idx"
  ON "EsfReference" ("organizationId", "storeId", "documentType", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "EsfReference_organizationId_storeId_documentType_documentId_key"
  ON "EsfReference" ("organizationId", "storeId", "documentType", "documentId");
CREATE INDEX IF NOT EXISTS "EsfReference_documentType_documentId_idx"
  ON "EsfReference" ("documentType", "documentId");

DO $$
BEGIN
  ALTER TABLE "MarkingCodeCapture"
    ADD CONSTRAINT "MarkingCodeCapture_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "MarkingCodeCapture"
    ADD CONSTRAINT "MarkingCodeCapture_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "MarkingCodeCapture"
    ADD CONSTRAINT "MarkingCodeCapture_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "CustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "MarkingCodeCapture"
    ADD CONSTRAINT "MarkingCodeCapture_saleLineId_fkey"
    FOREIGN KEY ("saleLineId") REFERENCES "CustomerOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "MarkingCodeCapture"
    ADD CONSTRAINT "MarkingCodeCapture_capturedById_fkey"
    FOREIGN KEY ("capturedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "EttnReference"
    ADD CONSTRAINT "EttnReference_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "EttnReference"
    ADD CONSTRAINT "EttnReference_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "EttnReference"
    ADD CONSTRAINT "EttnReference_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "EsfReference"
    ADD CONSTRAINT "EsfReference_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "EsfReference"
    ADD CONSTRAINT "EsfReference_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "EsfReference"
    ADD CONSTRAINT "EsfReference_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
