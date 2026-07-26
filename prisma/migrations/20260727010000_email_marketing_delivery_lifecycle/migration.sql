-- Durable, explainable Email Marketing recipient lifecycle.
-- Legacy enum values remain available so this migration is additive and rollback-safe.

ALTER TYPE "EmailCampaignStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
ALTER TYPE "EmailCampaignStatus" ADD VALUE IF NOT EXISTS 'AWAITING_EVENTS';
ALTER TYPE "EmailCampaignStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "EmailCampaignStatus" ADD VALUE IF NOT EXISTS 'COMPLETED_WITH_ERRORS';
ALTER TYPE "EmailCampaignStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TYPE "EmailCampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
ALTER TYPE "EmailCampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'SENDING';
ALTER TYPE "EmailCampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED';
ALTER TYPE "EmailCampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'DEFERRED';
ALTER TYPE "EmailCampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "EmailCampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'BOUNCED';
ALTER TYPE "EmailCampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'DROPPED';
ALTER TYPE "EmailCampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'SUPPRESSED';
ALTER TYPE "EmailCampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'COMPLAINED';
ALTER TYPE "EmailCampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

CREATE TYPE "EmailDeliveryErrorCategory" AS ENUM (
  'NONE',
  'PROVIDER_TIMEOUT',
  'RATE_LIMIT',
  'PROVIDER_TEMPORARY',
  'RECIPIENT_TEMPORARY',
  'HARD_BOUNCE',
  'INVALID_ADDRESS',
  'SUPPRESSED',
  'UNSUBSCRIBED',
  'COMPLAINT',
  'PROVIDER_PERMANENT',
  'CONFIGURATION',
  'UNKNOWN'
);

ALTER TABLE "EmailCampaign"
  ADD COLUMN "queuedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sendingCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "acceptedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deferredCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "bouncedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "droppedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "suppressedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "complainedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cancelledCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "unresolvedCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "EmailCampaignRecipient"
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'resend',
  ADD COLUMN "providerReason" TEXT,
  ADD COLUMN "normalizedErrorCategory" "EmailDeliveryErrorCategory" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "acceptedAt" TIMESTAMP(3),
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "retryAt" TIMESTAMP(3),
  ADD COLUMN "terminalAt" TIMESTAMP(3),
  ADD COLUMN "sendOperationKey" TEXT,
  ADD COLUMN "providerOperationKey" TEXT,
  ADD COLUMN "providerOperationStartedAt" TIMESTAMP(3),
  ADD COLUMN "sendLeaseToken" TEXT,
  ADD COLUMN "sendLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "reconcileAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reconcileAt" TIMESTAMP(3);

-- Provider IDs emitted by the local log adapter are distinguishable from Resend IDs.
UPDATE "EmailCampaignRecipient"
SET "provider" = CASE
  WHEN "providerMessageId" LIKE 'log_%' THEN 'log'
  ELSE 'resend'
END,
"sendOperationKey" = 'email-campaign:' || "campaignId" || ':recipient:' || "id",
"acceptedAt" = COALESCE("sentAt", "acceptedAt"),
"providerReason" = COALESCE("errorMessage", "providerReason");

-- Deterministic precedence prevents a legacy SENT row with a later bounce/complaint
-- from being incorrectly backfilled to ACCEPTED.
UPDATE "EmailCampaignRecipient"
SET "status" = (
  CASE
    WHEN "complainedAt" IS NOT NULL OR lower(COALESCE("providerStatus", '')) IN ('complained', 'email.complained')
      THEN 'COMPLAINED'
    WHEN lower(COALESCE("providerStatus", '')) IN ('suppressed', 'email.suppressed')
      THEN 'SUPPRESSED'
    WHEN "bouncedAt" IS NOT NULL OR lower(COALESCE("providerStatus", '')) IN ('bounced', 'email.bounced')
      THEN 'BOUNCED'
    WHEN "deliveredAt" IS NOT NULL OR lower(COALESCE("providerStatus", '')) IN ('delivered', 'opened', 'clicked', 'email.delivered', 'email.opened', 'email.clicked')
      THEN 'DELIVERED'
    WHEN lower(COALESCE("providerStatus", '')) IN ('delivery_delayed', 'deferred', 'email.delivery_delayed', 'email.deferred')
      THEN 'DEFERRED'
    WHEN "status"::text = 'PENDING' THEN 'QUEUED'
    WHEN "status"::text = 'SKIPPED' AND lower(COALESCE("errorMessage", '')) LIKE '%unsubscrib%'
      THEN 'SUPPRESSED'
    WHEN "status"::text IN ('FAILED', 'SKIPPED') OR lower(COALESCE("providerStatus", '')) IN ('failed', 'email.failed')
      THEN 'FAILED'
    WHEN "sentAt" IS NOT NULL OR "status"::text = 'SENT' THEN 'ACCEPTED'
    ELSE 'FAILED'
  END
)::"EmailCampaignRecipientStatus";

UPDATE "EmailCampaignRecipient"
SET
  "acceptedAt" = CASE
    WHEN "status"::text IN ('ACCEPTED', 'DEFERRED', 'DELIVERED', 'BOUNCED', 'DROPPED', 'SUPPRESSED', 'COMPLAINED')
      THEN COALESCE("acceptedAt", "sentAt", "updatedAt")
    ELSE "acceptedAt"
  END,
  "failedAt" = CASE
    WHEN "status"::text IN ('BOUNCED', 'DROPPED', 'SUPPRESSED', 'COMPLAINED', 'FAILED')
      THEN COALESCE("failedAt", "bouncedAt", "complainedAt", "updatedAt")
    ELSE "failedAt"
  END,
  "terminalAt" = CASE
    WHEN "status"::text IN ('DELIVERED', 'BOUNCED', 'DROPPED', 'SUPPRESSED', 'COMPLAINED', 'FAILED', 'CANCELLED')
      THEN COALESCE("terminalAt", "deliveredAt", "bouncedAt", "complainedAt", "updatedAt")
    ELSE NULL
  END,
  "normalizedErrorCategory" = (
    CASE
      WHEN "status"::text = 'COMPLAINED' THEN 'COMPLAINT'
      WHEN "status"::text = 'SUPPRESSED' AND lower(COALESCE("errorMessage", '')) LIKE '%unsubscrib%' THEN 'UNSUBSCRIBED'
      WHEN "status"::text = 'SUPPRESSED' THEN 'SUPPRESSED'
      WHEN "status"::text = 'BOUNCED' AND lower(COALESCE("providerReason", '')) ~ '(invalid|does not exist|unknown user|mailbox not found)' THEN 'INVALID_ADDRESS'
      WHEN "status"::text = 'BOUNCED' THEN 'HARD_BOUNCE'
      WHEN "status"::text IN ('FAILED', 'DROPPED') THEN 'UNKNOWN'
      ELSE 'NONE'
    END
  )::"EmailDeliveryErrorCategory";

ALTER TABLE "EmailCampaignRecipient"
  ALTER COLUMN "sendOperationKey" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'QUEUED';

-- A provider message must identify exactly one recipient. Preserve the oldest
-- mapping and turn any pre-existing duplicate mapping into an explicit failure.
WITH duplicate_provider_ids AS (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "provider", "providerMessageId"
        ORDER BY "createdAt" ASC, "id" ASC
      ) AS duplicate_rank
    FROM "EmailCampaignRecipient"
    WHERE "providerMessageId" IS NOT NULL
  ) ranked
  WHERE duplicate_rank > 1
)
UPDATE "EmailCampaignRecipient" recipient
SET
  "providerMessageId" = NULL,
  "providerReason" = 'duplicateLegacyProviderMessageId',
  "errorMessage" = 'duplicateLegacyProviderMessageId',
  "normalizedErrorCategory" = 'UNKNOWN',
  "status" = 'FAILED',
  "failedAt" = COALESCE(recipient."failedAt", recipient."updatedAt"),
  "terminalAt" = COALESCE(recipient."terminalAt", recipient."updatedAt")
FROM duplicate_provider_ids duplicate
WHERE recipient."id" = duplicate."id";

DROP INDEX IF EXISTS "EmailCampaignRecipient_providerMessageId_idx";

CREATE UNIQUE INDEX "EmailCampaignRecipient_provider_providerMessageId_key"
  ON "EmailCampaignRecipient"("provider", "providerMessageId");
CREATE UNIQUE INDEX "EmailCampaignRecipient_sendOperationKey_key"
  ON "EmailCampaignRecipient"("sendOperationKey");
CREATE INDEX "EmailCampaignRecipient_campaignId_status_retryAt_idx"
  ON "EmailCampaignRecipient"("campaignId", "status", "retryAt");
CREATE INDEX "EmailCampaignRecipient_campaignId_providerOperationKey_idx"
  ON "EmailCampaignRecipient"("campaignId", "providerOperationKey");
CREATE INDEX "EmailCampaignRecipient_status_sendLeaseExpiresAt_idx"
  ON "EmailCampaignRecipient"("status", "sendLeaseExpiresAt");

CREATE TABLE "EmailCampaignRecipientEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "eventIdentity" TEXT NOT NULL,
  "providerEventId" TEXT,
  "providerMessageId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "statusBefore" "EmailCampaignRecipientStatus" NOT NULL,
  "statusAfter" "EmailCampaignRecipientStatus" NOT NULL,
  "applied" BOOLEAN NOT NULL DEFAULT false,
  "ignoredReason" TEXT,
  "providerReason" TEXT,
  "payloadJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailCampaignRecipientEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailCampaignRecipientEvent_provider_eventIdentity_key"
  ON "EmailCampaignRecipientEvent"("provider", "eventIdentity");
CREATE INDEX "EmailCampaignRecipientEvent_organizationId_campaignId_eventAt_idx"
  ON "EmailCampaignRecipientEvent"("organizationId", "campaignId", "eventAt");
CREATE INDEX "EmailCampaignRecipientEvent_provider_providerMessageId_eventAt_idx"
  ON "EmailCampaignRecipientEvent"("provider", "providerMessageId", "eventAt");
CREATE INDEX "EmailCampaignRecipientEvent_recipientId_eventAt_idx"
  ON "EmailCampaignRecipientEvent"("recipientId", "eventAt");

ALTER TABLE "EmailCampaignRecipientEvent"
  ADD CONSTRAINT "EmailCampaignRecipientEvent_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EmailCampaignRecipientEvent_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "EmailCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EmailCampaignRecipientEvent_recipientId_fkey"
    FOREIGN KEY ("recipientId") REFERENCES "EmailCampaignRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EmailMarketingSuppression" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "reason" TEXT,
  "originProviderEventId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "suppressedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clearedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailMarketingSuppression_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailMarketingSuppression_organizationId_storeId_email_key"
  ON "EmailMarketingSuppression"("organizationId", "storeId", "email");
CREATE INDEX "EmailMarketingSuppression_organizationId_email_active_idx"
  ON "EmailMarketingSuppression"("organizationId", "email", "active");
CREATE INDEX "EmailMarketingSuppression_storeId_active_suppressedAt_idx"
  ON "EmailMarketingSuppression"("storeId", "active", "suppressedAt");

ALTER TABLE "EmailMarketingSuppression"
  ADD CONSTRAINT "EmailMarketingSuppression_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EmailMarketingSuppression_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Campaign counters are an exclusive partition of recipient rows. Keep sentCount as
-- the backwards-compatible cumulative accepted counter.
WITH lifecycle_counts AS (
  SELECT
    c."id" AS "campaignId",
    COUNT(r."id")::INTEGER AS audience,
    COUNT(*) FILTER (WHERE r."status"::text = 'QUEUED')::INTEGER AS queued,
    COUNT(*) FILTER (WHERE r."status"::text = 'SENDING')::INTEGER AS sending,
    COUNT(*) FILTER (WHERE r."status"::text = 'ACCEPTED')::INTEGER AS accepted,
    COUNT(*) FILTER (WHERE r."status"::text = 'DEFERRED')::INTEGER AS deferred,
    COUNT(*) FILTER (WHERE r."status"::text = 'DELIVERED')::INTEGER AS delivered,
    COUNT(*) FILTER (WHERE r."status"::text = 'BOUNCED')::INTEGER AS bounced,
    COUNT(*) FILTER (WHERE r."status"::text = 'DROPPED')::INTEGER AS dropped,
    COUNT(*) FILTER (WHERE r."status"::text = 'SUPPRESSED')::INTEGER AS suppressed,
    COUNT(*) FILTER (WHERE r."status"::text = 'COMPLAINED')::INTEGER AS complained,
    COUNT(*) FILTER (WHERE r."status"::text = 'FAILED')::INTEGER AS failed,
    COUNT(*) FILTER (WHERE r."status"::text = 'CANCELLED')::INTEGER AS cancelled,
    COUNT(*) FILTER (WHERE r."acceptedAt" IS NOT NULL)::INTEGER AS cumulative_accepted
  FROM "EmailCampaign" c
  LEFT JOIN "EmailCampaignRecipient" r ON r."campaignId" = c."id"
  GROUP BY c."id"
)
UPDATE "EmailCampaign" c
SET
  "recipientCount" = lc.audience,
  "queuedCount" = lc.queued,
  "sendingCount" = lc.sending,
  "acceptedCount" = lc.accepted,
  "deferredCount" = lc.deferred,
  "deliveredCount" = lc.delivered,
  "bouncedCount" = lc.bounced,
  "droppedCount" = lc.dropped,
  "suppressedCount" = lc.suppressed,
  "complainedCount" = lc.complained,
  "failedCount" = lc.failed,
  "cancelledCount" = lc.cancelled,
  "unresolvedCount" = lc.queued + lc.sending + lc.accepted + lc.deferred,
  "sentCount" = lc.cumulative_accepted,
  "status" = (
    CASE
      WHEN c."status"::text = 'DRAFT' THEN 'DRAFT'
      WHEN lc.audience > 0 AND lc.cancelled = lc.audience THEN 'CANCELLED'
      WHEN lc.sending > 0 OR (lc.queued > 0 AND lc.queued < lc.audience) THEN 'SENDING'
      WHEN lc.queued > 0 THEN 'QUEUED'
      WHEN lc.accepted + lc.deferred > 0 THEN 'AWAITING_EVENTS'
      WHEN lc.audience > 0 AND lc.delivered = lc.audience THEN 'COMPLETED'
      WHEN lc.delivered > 0 THEN 'COMPLETED_WITH_ERRORS'
      ELSE 'FAILED'
    END
  )::"EmailCampaignStatus"
FROM lifecycle_counts lc
WHERE c."id" = lc."campaignId";

ALTER TABLE "EmailCampaign"
  ADD CONSTRAINT "EmailCampaign_delivery_counter_invariant"
  CHECK (
    "recipientCount" =
      "queuedCount" + "sendingCount" + "acceptedCount" + "deferredCount" +
      "deliveredCount" + "bouncedCount" + "droppedCount" + "suppressedCount" +
      "complainedCount" + "failedCount" + "cancelledCount"
  );
