BEGIN;
CREATE TABLE "SubscriptionReminder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "source" VARCHAR(16) NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "accessEndsAt" TIMESTAMP(3) NOT NULL,
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
  "providerMessageId" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "lastIssue" VARCHAR(128),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubscriptionReminder_phase_check" CHECK (
    "source" IN ('PAID','TRIAL') AND "kind" IN ('BEFORE_3','BEFORE_1','GRACE','READ_ONLY')
    AND NOT ("source"='TRIAL' AND "kind"='GRACE')),
  CONSTRAINT "SubscriptionReminder_status_check" CHECK ("status" IN ('QUEUED','PROCESSING','ACCEPTED','CANCELED','FAILED')),
  CONSTRAINT "SubscriptionReminder_attempt_check" CHECK ("attemptCount" BETWEEN 0 AND 5),
  CONSTRAINT "SubscriptionReminder_lease_check" CHECK (
    ("status"='PROCESSING' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    OR ("status"<>'PROCESSING' AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL))
);
CREATE UNIQUE INDEX "SubscriptionReminder_org_owner_phase_key" ON "SubscriptionReminder" ("organizationId","ownerId","source","accessEndsAt","kind");
CREATE INDEX "SubscriptionReminder_status_nextAttemptAt_idx" ON "SubscriptionReminder" ("status","nextAttemptAt");
CREATE INDEX "SubscriptionReminder_status_leaseExpiresAt_idx" ON "SubscriptionReminder" ("status","leaseExpiresAt");
CREATE FUNCTION "protectSubscriptionReminderPayload"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."organizationId",NEW."ownerId",NEW."source",NEW."kind",NEW."accessEndsAt",NEW."operationKey",NEW."recipientEmail",NEW."recipientLocale",NEW."senderEmail",NEW."subject",NEW."text",NEW."html",NEW."createdAt")
    IS DISTINCT FROM ROW(OLD."organizationId",OLD."ownerId",OLD."source",OLD."kind",OLD."accessEndsAt",OLD."operationKey",OLD."recipientEmail",OLD."recipientLocale",OLD."senderEmail",OLD."subject",OLD."text",OLD."html",OLD."createdAt")
    OR (OLD."firstAttemptAt" IS NOT NULL AND NEW."firstAttemptAt" IS DISTINCT FROM OLD."firstAttemptAt")
    OR (OLD."status"='ACCEPTED' AND NEW."status"<>'ACCEPTED') THEN
    RAISE EXCEPTION 'Subscription reminder payload and idempotency window are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "SubscriptionReminder_payload_guard" BEFORE UPDATE ON "SubscriptionReminder"
FOR EACH ROW EXECUTE FUNCTION "protectSubscriptionReminderPayload"();
COMMIT;
