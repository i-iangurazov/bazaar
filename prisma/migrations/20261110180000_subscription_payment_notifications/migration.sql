BEGIN;

CREATE TABLE "SubscriptionPaymentNotification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT,
  "invoiceId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "kind" VARCHAR(24) NOT NULL,
  "operationKey" VARCHAR(191) NOT NULL UNIQUE,
  "recipientEmail" TEXT NOT NULL,
  "recipientLocale" VARCHAR(8) NOT NULL,
  "senderEmail" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "html" TEXT NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "firstAttemptAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" VARCHAR(64),
  "leaseExpiresAt" TIMESTAMP(3),
  "providerMessageId" TEXT UNIQUE,
  "acceptedAt" TIMESTAMP(3),
  "deliveryStatus" VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
  "deliveryEventAt" TIMESTAMP(3),
  "deliveryEventKey" VARCHAR(256),
  "deliveredAt" TIMESTAMP(3),
  "lastIssue" VARCHAR(128),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubscriptionPaymentNotification_invoice_org_fkey" FOREIGN KEY ("invoiceId", "organizationId")
    REFERENCES "SubscriptionInvoice"("id", "organizationId") ON DELETE RESTRICT,
  CONSTRAINT "SubscriptionPaymentNotification_kind_check" CHECK ("kind" IN ('PAYMENT_CONFIRMED','ACCESS_RESTORED')),
  CONSTRAINT "SubscriptionPaymentNotification_status_check" CHECK ("status" IN ('QUEUED','PROCESSING','ACCEPTED','CANCELED','FAILED')),
  CONSTRAINT "SubscriptionPaymentNotification_delivery_check" CHECK ("deliveryStatus" IN
    ('QUEUED','SENDING','ACCEPTED','DEFERRED','DELIVERED','BOUNCED','DROPPED','SUPPRESSED','COMPLAINED','FAILED','CANCELLED')),
  CONSTRAINT "SubscriptionPaymentNotification_attempt_check" CHECK ("attemptCount" BETWEEN 0 AND 5),
  CONSTRAINT "SubscriptionPaymentNotification_locale_check" CHECK ("recipientLocale" IN ('ru','kg','en')),
  CONSTRAINT "SubscriptionPaymentNotification_lease_check" CHECK (
    ("status"='PROCESSING' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    OR ("status"<>'PROCESSING' AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL)),
  CONSTRAINT "SubscriptionPaymentNotification_accepted_check" CHECK (
    "status"<>'ACCEPTED' OR ("providerMessageId" IS NOT NULL AND "acceptedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "SubscriptionPaymentNotification_invoiceId_ownerId_key" ON "SubscriptionPaymentNotification"("invoiceId","ownerId");
CREATE INDEX "SubscriptionPaymentNotification_status_nextAttemptAt_idx" ON "SubscriptionPaymentNotification"("status","nextAttemptAt");
CREATE INDEX "SubscriptionPaymentNotification_status_leaseExpiresAt_idx" ON "SubscriptionPaymentNotification"("status","leaseExpiresAt");

-- The payload and deduplication window survive worker crashes unchanged. A
-- provider's acceptance is recorded separately from delivery to the mailbox.
CREATE FUNCTION "protectSubscriptionPaymentNotification"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."organizationId",NEW."invoiceId",NEW."ownerId",NEW."kind",NEW."operationKey",NEW."recipientEmail",NEW."recipientLocale",NEW."senderEmail",NEW."subject",NEW."text",NEW."html",NEW."createdAt")
    IS DISTINCT FROM ROW(OLD."organizationId",OLD."invoiceId",OLD."ownerId",OLD."kind",OLD."operationKey",OLD."recipientEmail",OLD."recipientLocale",OLD."senderEmail",OLD."subject",OLD."text",OLD."html",OLD."createdAt")
    OR (OLD."firstAttemptAt" IS NOT NULL AND NEW."firstAttemptAt" IS DISTINCT FROM OLD."firstAttemptAt")
    OR (OLD."providerMessageId" IS NOT NULL AND NEW."providerMessageId" IS DISTINCT FROM OLD."providerMessageId")
    OR (OLD."acceptedAt" IS NOT NULL AND NEW."acceptedAt" IS DISTINCT FROM OLD."acceptedAt")
    OR (OLD."status"='ACCEPTED' AND NEW."status"<>'ACCEPTED') THEN
    RAISE EXCEPTION 'Subscription payment notification payload and provider identity are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "SubscriptionPaymentNotification_payload_guard" BEFORE UPDATE ON "SubscriptionPaymentNotification"
FOR EACH ROW EXECUTE FUNCTION "protectSubscriptionPaymentNotification"();

COMMIT;
