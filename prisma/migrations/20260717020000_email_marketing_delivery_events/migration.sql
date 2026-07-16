ALTER TABLE "EmailCampaign"
  ADD COLUMN "deliveredCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "EmailCampaignRecipient"
  ADD COLUMN "providerStatus" TEXT,
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "bouncedAt" TIMESTAMP(3),
  ADD COLUMN "complainedAt" TIMESTAMP(3),
  ADD COLUMN "lastProviderEvent" TEXT,
  ADD COLUMN "lastProviderEventId" TEXT,
  ADD COLUMN "lastProviderEventAt" TIMESTAMP(3);

CREATE INDEX "EmailCampaignRecipient_campaignId_deliveredAt_idx"
  ON "EmailCampaignRecipient"("campaignId", "deliveredAt");

CREATE INDEX "EmailCampaignRecipient_lastProviderEventId_idx"
  ON "EmailCampaignRecipient"("lastProviderEventId");
