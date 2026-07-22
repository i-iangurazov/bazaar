-- Phase B2 Migration 1: additive operation identity and exact external order field.
-- The scoped external-order unique constraint is intentionally deferred until
-- the checked-in collision detector and backfill have completed without errors.

CREATE TYPE "OperationRequestStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

CREATE TYPE "OperationRequestPrincipalType" AS ENUM ('AUTHENTICATED_USER', 'API_KEY', 'ANONYMOUS_CATALOG');

ALTER TABLE "CustomerOrder"
ADD COLUMN "externalOrderId" VARCHAR(160);

CREATE INDEX "CustomerOrder_external_identity_idx"
ON "CustomerOrder"("organizationId", "storeId", "source", "externalOrderId");

CREATE TABLE "OperationRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT,
    "scope" VARCHAR(120) NOT NULL,
    "principalType" "OperationRequestPrincipalType" NOT NULL,
    "principalKey" VARCHAR(220) NOT NULL,
    "idempotencyKey" VARCHAR(256) NOT NULL,
    "requestFingerprint" CHAR(64) NOT NULL,
    "status" "OperationRequestStatus" NOT NULL DEFAULT 'PROCESSING',
    "responseStatus" INTEGER,
    "responseCode" VARCHAR(120),
    "response" JSONB,
    "responseBytes" INTEGER,
    "resourceType" VARCHAR(80),
    "resourceId" VARCHAR(191),
    "errorClassification" VARCHAR(120),
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "processingStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" VARCHAR(64),
    "leaseExpiresAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperationRequest_scope_principal_key_uq"
ON "OperationRequest"("organizationId", "scope", "principalKey", "idempotencyKey");

CREATE INDEX "OperationRequest_org_status_created_idx"
ON "OperationRequest"("organizationId", "status", "createdAt");

CREATE INDEX "OperationRequest_store_status_created_idx"
ON "OperationRequest"("storeId", "status", "createdAt");

CREATE INDEX "OperationRequest_expires_idx"
ON "OperationRequest"("expiresAt");

CREATE INDEX "OperationRequest_lease_expires_idx"
ON "OperationRequest"("leaseExpiresAt");

CREATE INDEX "OperationRequest_resource_idx"
ON "OperationRequest"("resourceType", "resourceId");

ALTER TABLE "OperationRequest"
ADD CONSTRAINT "OperationRequest_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OperationRequest"
ADD CONSTRAINT "OperationRequest_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
