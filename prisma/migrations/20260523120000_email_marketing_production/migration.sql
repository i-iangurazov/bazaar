-- Production email marketing foundations: verified senders, campaign metadata, and automations.

CREATE TYPE "EmailCampaignType" AS ENUM ('MARKETING', 'AUTOMATION', 'TRANSACTIONAL');
CREATE TYPE "EmailSenderDomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');
CREATE TYPE "EmailSenderIdentityStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');
CREATE TYPE "EmailAutomationTrigger" AS ENUM ('ORDER_CREATED', 'ORDER_STATUS_CHANGED');
CREATE TYPE "EmailAutomationStatus" AS ENUM ('ACTIVE', 'PAUSED');
CREATE TYPE "EmailAutomationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "EmailSenderDomain" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "resendDomainId" TEXT,
  "status" "EmailSenderDomainStatus" NOT NULL DEFAULT 'PENDING',
  "resendStatus" TEXT,
  "recordsJson" JSONB,
  "errorMessage" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "lastCheckedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmailSenderDomain_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailSenderIdentity" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "domainId" TEXT,
  "displayName" TEXT NOT NULL,
  "fromEmail" TEXT NOT NULL,
  "replyToEmail" TEXT,
  "status" "EmailSenderIdentityStatus" NOT NULL DEFAULT 'PENDING',
  "lastUsedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmailSenderIdentity_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EmailCampaign"
  ADD COLUMN "contentVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "campaignType" "EmailCampaignType" NOT NULL DEFAULT 'MARKETING',
  ADD COLUMN "senderIdentityId" TEXT,
  ADD COLUMN "duplicatedFromId" TEXT,
  ADD COLUMN "audienceJson" JSONB,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "EmailCampaignRecipient"
  ADD COLUMN "providerMessageId" TEXT;

CREATE TABLE "EmailAutomation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "senderIdentityId" TEXT,
  "trigger" "EmailAutomationTrigger" NOT NULL,
  "status" "EmailAutomationStatus" NOT NULL DEFAULT 'PAUSED',
  "name" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "preheader" TEXT,
  "contentVersion" INTEGER NOT NULL DEFAULT 1,
  "blocksJson" JSONB,
  "lastTriggeredAt" TIMESTAMP(3),
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmailAutomation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailAutomationDelivery" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "customerOrderId" TEXT NOT NULL,
  "triggerKey" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "status" "EmailAutomationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "providerMessageId" TEXT,
  "errorMessage" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmailAutomationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailSenderDomain_organizationId_storeId_domain_key" ON "EmailSenderDomain"("organizationId", "storeId", "domain");
CREATE UNIQUE INDEX "EmailSenderDomain_resendDomainId_key" ON "EmailSenderDomain"("resendDomainId");
CREATE INDEX "EmailSenderDomain_organizationId_storeId_status_idx" ON "EmailSenderDomain"("organizationId", "storeId", "status");
CREATE INDEX "EmailSenderDomain_storeId_domain_idx" ON "EmailSenderDomain"("storeId", "domain");

CREATE UNIQUE INDEX "EmailSenderIdentity_storeId_fromEmail_key" ON "EmailSenderIdentity"("storeId", "fromEmail");
CREATE INDEX "EmailSenderIdentity_organizationId_storeId_status_idx" ON "EmailSenderIdentity"("organizationId", "storeId", "status");
CREATE INDEX "EmailSenderIdentity_domainId_idx" ON "EmailSenderIdentity"("domainId");
CREATE INDEX "EmailSenderIdentity_archivedAt_idx" ON "EmailSenderIdentity"("archivedAt");

CREATE INDEX "EmailCampaign_storeId_campaignType_status_createdAt_idx" ON "EmailCampaign"("storeId", "campaignType", "status", "createdAt");
CREATE INDEX "EmailCampaign_senderIdentityId_idx" ON "EmailCampaign"("senderIdentityId");
CREATE INDEX "EmailCampaign_duplicatedFromId_idx" ON "EmailCampaign"("duplicatedFromId");
CREATE INDEX "EmailCampaignRecipient_providerMessageId_idx" ON "EmailCampaignRecipient"("providerMessageId");

CREATE UNIQUE INDEX "EmailAutomation_storeId_trigger_key" ON "EmailAutomation"("storeId", "trigger");
CREATE INDEX "EmailAutomation_organizationId_storeId_status_idx" ON "EmailAutomation"("organizationId", "storeId", "status");
CREATE INDEX "EmailAutomation_senderIdentityId_idx" ON "EmailAutomation"("senderIdentityId");

CREATE UNIQUE INDEX "EmailAutomationDelivery_automationId_triggerKey_key" ON "EmailAutomationDelivery"("automationId", "triggerKey");
CREATE INDEX "EmailAutomationDelivery_organizationId_storeId_status_idx" ON "EmailAutomationDelivery"("organizationId", "storeId", "status");
CREATE INDEX "EmailAutomationDelivery_customerOrderId_idx" ON "EmailAutomationDelivery"("customerOrderId");
CREATE INDEX "EmailAutomationDelivery_providerMessageId_idx" ON "EmailAutomationDelivery"("providerMessageId");

ALTER TABLE "EmailSenderDomain"
  ADD CONSTRAINT "EmailSenderDomain_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EmailSenderDomain_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailSenderIdentity"
  ADD CONSTRAINT "EmailSenderIdentity_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EmailSenderIdentity_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EmailSenderIdentity_domainId_fkey"
  FOREIGN KEY ("domainId") REFERENCES "EmailSenderDomain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmailCampaign"
  ADD CONSTRAINT "EmailCampaign_senderIdentityId_fkey"
  FOREIGN KEY ("senderIdentityId") REFERENCES "EmailSenderIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "EmailCampaign_duplicatedFromId_fkey"
  FOREIGN KEY ("duplicatedFromId") REFERENCES "EmailCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmailAutomation"
  ADD CONSTRAINT "EmailAutomation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EmailAutomation_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EmailAutomation_senderIdentityId_fkey"
  FOREIGN KEY ("senderIdentityId") REFERENCES "EmailSenderIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmailAutomationDelivery"
  ADD CONSTRAINT "EmailAutomationDelivery_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EmailAutomationDelivery_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EmailAutomationDelivery_automationId_fkey"
  FOREIGN KEY ("automationId") REFERENCES "EmailAutomation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EmailAutomationDelivery_customerOrderId_fkey"
  FOREIGN KEY ("customerOrderId") REFERENCES "CustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
