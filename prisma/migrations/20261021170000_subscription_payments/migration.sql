-- CreateEnum
CREATE TYPE "SubscriptionBillingMode" AS ENUM ('MANUAL', 'SELF_SERVE');

-- CreateEnum
CREATE TYPE "SubscriptionInvoiceStatus" AS ENUM ('CREATING', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REVIEW', 'RESOLVED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "billingAnchorDay" INTEGER,
ADD COLUMN     "subscriptionBillingMode" "SubscriptionBillingMode" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "SubscriptionInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "pendingSlot" TEXT,
    "plan" "OrganizationPlan" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KGS',
    "status" "SubscriptionInvoiceStatus" NOT NULL DEFAULT 'CREATING',
    "merchantId" TEXT NOT NULL,
    "isTest" BOOLEAN NOT NULL,
    "providerPaymentId" TEXT,
    "checkoutUrl" TEXT,
    "termsVersion" TEXT NOT NULL,
    "termsUrl" TEXT NOT NULL,
    "sellerName" TEXT NOT NULL,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingToken" TEXT,
    "processingUntil" TIMESTAMP(3),
    "lastIssue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPaymentEvent" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPeriod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "plan" "OrganizationPlan" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_pendingSlot_key" ON "SubscriptionInvoice"("pendingSlot");

-- CreateIndex
CREATE INDEX "SubscriptionInvoice_status_nextCheckAt_idx" ON "SubscriptionInvoice"("status", "nextCheckAt");

-- CreateIndex
CREATE INDEX "SubscriptionInvoice_organizationId_createdAt_id_idx" ON "SubscriptionInvoice"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_organizationId_idempotencyKey_key" ON "SubscriptionInvoice"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_id_organizationId_key" ON "SubscriptionInvoice"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_merchantId_isTest_providerPaymentId_key" ON "SubscriptionInvoice"("merchantId", "isTest", "providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPaymentEvent_deduplicationKey_key" ON "SubscriptionPaymentEvent"("deduplicationKey");

-- CreateIndex
CREATE INDEX "SubscriptionPaymentEvent_invoiceId_createdAt_idx" ON "SubscriptionPaymentEvent"("invoiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPeriod_invoiceId_key" ON "SubscriptionPeriod"("invoiceId");

-- CreateIndex
CREATE INDEX "SubscriptionPeriod_organizationId_endsAt_idx" ON "SubscriptionPeriod"("organizationId", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPeriod_invoiceId_organizationId_key" ON "SubscriptionPeriod"("invoiceId", "organizationId");

-- AddForeignKey
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPaymentEvent" ADD CONSTRAINT "SubscriptionPaymentEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SubscriptionInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPeriod" ADD CONSTRAINT "SubscriptionPeriod_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPeriod" ADD CONSTRAINT "SubscriptionPeriod_invoiceId_organizationId_fkey" FOREIGN KEY ("invoiceId", "organizationId") REFERENCES "SubscriptionInvoice"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial snapshots and tenant/slot invariants also hold outside application code.
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_billingAnchorDay_check"
  CHECK ("billingAnchorDay" IS NULL OR "billingAnchorDay" BETWEEN 1 AND 31);
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_money_check"
  CHECK ("amountMinor" > 0 AND "currency" = 'KGS');
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_slot_check"
  CHECK (("pendingSlot" IS NULL OR "pendingSlot" = "organizationId")
    AND ("status" NOT IN ('CREATING', 'PENDING') OR "pendingSlot" IS NOT NULL)
    AND ("status" NOT IN ('PAID', 'FAILED', 'EXPIRED', 'RESOLVED') OR "pendingSlot" IS NULL));
ALTER TABLE "SubscriptionPeriod" ADD CONSTRAINT "SubscriptionPeriod_dates_check"
  CHECK ("endsAt" > "startsAt");

CREATE FUNCTION "protectSubscriptionInvoiceSnapshot"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."id", NEW."organizationId", NEW."createdById", NEW."idempotencyKey", NEW."plan", NEW."amountMinor", NEW."currency", NEW."merchantId", NEW."isTest", NEW."termsVersion", NEW."termsUrl", NEW."sellerName", NEW."termsAcceptedAt", NEW."expiresAt", NEW."createdAt")
    IS DISTINCT FROM
     ROW(OLD."id", OLD."organizationId", OLD."createdById", OLD."idempotencyKey", OLD."plan", OLD."amountMinor", OLD."currency", OLD."merchantId", OLD."isTest", OLD."termsVersion", OLD."termsUrl", OLD."sellerName", OLD."termsAcceptedAt", OLD."expiresAt", OLD."createdAt") THEN
    RAISE EXCEPTION 'Subscription invoice financial snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."providerPaymentId" IS NOT NULL AND NEW."providerPaymentId" IS DISTINCT FROM OLD."providerPaymentId" THEN
    RAISE EXCEPTION 'Subscription payment binding is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SubscriptionInvoice_snapshot_guard" BEFORE UPDATE ON "SubscriptionInvoice"
  FOR EACH ROW EXECUTE FUNCTION "protectSubscriptionInvoiceSnapshot"();
