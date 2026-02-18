-- Add CONNECTOR mode for KKM
ALTER TYPE "KkmMode" ADD VALUE IF NOT EXISTS 'CONNECTOR';

DO $$
BEGIN
  CREATE TYPE "FiscalReceiptStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SENT', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "FiscalReceiptStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

DO $$
BEGIN
  CREATE TYPE "RefundRequestStatus" AS ENUM ('OPEN', 'RESOLVED', 'CANCELED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "KkmConnectorDevice" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "pairedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KkmConnectorDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "KkmConnectorDevice_tokenHash_key"
  ON "KkmConnectorDevice" ("tokenHash");
CREATE INDEX IF NOT EXISTS "KkmConnectorDevice_organizationId_storeId_isActive_idx"
  ON "KkmConnectorDevice" ("organizationId", "storeId", "isActive");

CREATE TABLE IF NOT EXISTS "KkmConnectorPairingCode" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KkmConnectorPairingCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "KkmConnectorPairingCode_code_key"
  ON "KkmConnectorPairingCode" ("code");
CREATE INDEX IF NOT EXISTS "KkmConnectorPairingCode_organizationId_storeId_expiresAt_idx"
  ON "KkmConnectorPairingCode" ("organizationId", "storeId", "expiresAt");

CREATE TABLE IF NOT EXISTS "FiscalReceipt" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "customerOrderId" TEXT NOT NULL,
  "status" "FiscalReceiptStatus" NOT NULL DEFAULT 'QUEUED',
  "mode" "KkmMode" NOT NULL DEFAULT 'EXPORT_ONLY',
  "providerKey" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "nextAttemptAt" TIMESTAMP(3),
  "providerReceiptId" TEXT,
  "fiscalNumber" TEXT,
  "qr" TEXT,
  "connectorDeviceId" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FiscalReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FiscalReceipt_idempotencyKey_key"
  ON "FiscalReceipt" ("idempotencyKey");
CREATE INDEX IF NOT EXISTS "FiscalReceipt_organizationId_storeId_status_createdAt_idx"
  ON "FiscalReceipt" ("organizationId", "storeId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "FiscalReceipt_storeId_status_createdAt_idx"
  ON "FiscalReceipt" ("storeId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "FiscalReceipt_connectorDeviceId_status_createdAt_idx"
  ON "FiscalReceipt" ("connectorDeviceId", "status", "createdAt");

CREATE TABLE IF NOT EXISTS "RefundRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "saleReturnId" TEXT NOT NULL,
  "originalSaleId" TEXT NOT NULL,
  "status" "RefundRequestStatus" NOT NULL DEFAULT 'OPEN',
  "paymentMethod" "PosPaymentMethod" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RefundRequest_saleReturnId_key"
  ON "RefundRequest" ("saleReturnId");
CREATE INDEX IF NOT EXISTS "RefundRequest_organizationId_storeId_status_createdAt_idx"
  ON "RefundRequest" ("organizationId", "storeId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "RefundRequest_saleReturnId_idx"
  ON "RefundRequest" ("saleReturnId");
CREATE INDEX IF NOT EXISTS "RefundRequest_originalSaleId_idx"
  ON "RefundRequest" ("originalSaleId");

DO $$
BEGIN
  ALTER TABLE "KkmConnectorDevice"
    ADD CONSTRAINT "KkmConnectorDevice_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "KkmConnectorDevice"
    ADD CONSTRAINT "KkmConnectorDevice_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "KkmConnectorPairingCode"
    ADD CONSTRAINT "KkmConnectorPairingCode_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "KkmConnectorPairingCode"
    ADD CONSTRAINT "KkmConnectorPairingCode_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "KkmConnectorPairingCode"
    ADD CONSTRAINT "KkmConnectorPairingCode_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "FiscalReceipt"
    ADD CONSTRAINT "FiscalReceipt_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "FiscalReceipt"
    ADD CONSTRAINT "FiscalReceipt_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "FiscalReceipt"
    ADD CONSTRAINT "FiscalReceipt_customerOrderId_fkey"
    FOREIGN KEY ("customerOrderId") REFERENCES "CustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "FiscalReceipt"
    ADD CONSTRAINT "FiscalReceipt_connectorDeviceId_fkey"
    FOREIGN KEY ("connectorDeviceId") REFERENCES "KkmConnectorDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "RefundRequest"
    ADD CONSTRAINT "RefundRequest_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "RefundRequest"
    ADD CONSTRAINT "RefundRequest_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "RefundRequest"
    ADD CONSTRAINT "RefundRequest_saleReturnId_fkey"
    FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "RefundRequest"
    ADD CONSTRAINT "RefundRequest_originalSaleId_fkey"
    FOREIGN KEY ("originalSaleId") REFERENCES "CustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "RefundRequest"
    ADD CONSTRAINT "RefundRequest_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "RefundRequest"
    ADD CONSTRAINT "RefundRequest_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
