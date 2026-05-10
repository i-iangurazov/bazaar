CREATE TYPE "CustomerSource" AS ENUM ('MANUAL', 'IMPORT', 'ORDER', 'INTEGRATION');

CREATE TYPE "EmailCampaignStatus" AS ENUM ('DRAFT', 'SENDING', 'SENT', 'FAILED');

CREATE TYPE "EmailCampaignTemplate" AS ENUM ('ANNOUNCEMENT', 'PROMOTION', 'NEW_ARRIVALS', 'SALE', 'CUSTOM');

CREATE TYPE "EmailCampaignFontFamily" AS ENUM ('JOST', 'INTER', 'SYSTEM');

CREATE TYPE "EmailCampaignRecipientStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "Customer" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "address" TEXT,
  "source" "CustomerSource" NOT NULL DEFAULT 'MANUAL',
  "metadata" JSONB,
  "lastOrderAt" TIMESTAMP(3),
  "orderCount" INTEGER NOT NULL DEFAULT 0,
  "deletedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailCampaign" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "createdById" TEXT,
  "status" "EmailCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "template" "EmailCampaignTemplate" NOT NULL DEFAULT 'CUSTOM',
  "subject" TEXT NOT NULL,
  "preheader" TEXT,
  "heading" TEXT,
  "body" TEXT NOT NULL,
  "ctaLabel" TEXT,
  "ctaUrl" TEXT,
  "footerText" TEXT,
  "senderDisplayName" TEXT,
  "replyToEmail" TEXT,
  "brandColor" TEXT,
  "buttonColor" TEXT,
  "fontFamily" "EmailCampaignFontFamily" NOT NULL DEFAULT 'INTER',
  "bannerImageUrl" TEXT,
  "recipientCount" INTEGER NOT NULL DEFAULT 0,
  "sentAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmailCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailCampaignRecipient" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "status" "EmailCampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
  "errorMessage" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmailCampaignRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Customer_organizationId_storeId_idx" ON "Customer"("organizationId", "storeId");
CREATE INDEX "Customer_storeId_email_idx" ON "Customer"("storeId", "email");
CREATE INDEX "Customer_storeId_phone_idx" ON "Customer"("storeId", "phone");
CREATE INDEX "Customer_createdAt_idx" ON "Customer"("createdAt");

CREATE INDEX "EmailCampaign_organizationId_storeId_createdAt_idx" ON "EmailCampaign"("organizationId", "storeId", "createdAt");
CREATE INDEX "EmailCampaign_storeId_status_createdAt_idx" ON "EmailCampaign"("storeId", "status", "createdAt");
CREATE INDEX "EmailCampaign_createdAt_idx" ON "EmailCampaign"("createdAt");

CREATE UNIQUE INDEX "EmailCampaignRecipient_campaignId_customerId_key" ON "EmailCampaignRecipient"("campaignId", "customerId");
CREATE INDEX "EmailCampaignRecipient_organizationId_campaignId_idx" ON "EmailCampaignRecipient"("organizationId", "campaignId");
CREATE INDEX "EmailCampaignRecipient_customerId_idx" ON "EmailCampaignRecipient"("customerId");
CREATE INDEX "EmailCampaignRecipient_email_idx" ON "EmailCampaignRecipient"("email");

ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmailCampaign"
  ADD CONSTRAINT "EmailCampaign_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailCampaign"
  ADD CONSTRAINT "EmailCampaign_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailCampaign"
  ADD CONSTRAINT "EmailCampaign_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmailCampaignRecipient"
  ADD CONSTRAINT "EmailCampaignRecipient_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailCampaignRecipient"
  ADD CONSTRAINT "EmailCampaignRecipient_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "EmailCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailCampaignRecipient"
  ADD CONSTRAINT "EmailCampaignRecipient_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
