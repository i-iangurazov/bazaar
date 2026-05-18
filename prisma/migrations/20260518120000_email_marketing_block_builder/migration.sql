ALTER TYPE "EmailCampaignStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';

ALTER TABLE "EmailCampaign"
  ADD COLUMN "templateKey" TEXT NOT NULL DEFAULT 'blank',
  ADD COLUMN "name" TEXT NOT NULL DEFAULT 'Кампания',
  ADD COLUMN "blocksJson" JSONB,
  ADD COLUMN "audienceSummaryJson" JSONB,
  ADD COLUMN "sentCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failedCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "EmailCampaign"
SET "name" = COALESCE(NULLIF("subject", ''), 'Кампания')
WHERE "name" = 'Кампания';
