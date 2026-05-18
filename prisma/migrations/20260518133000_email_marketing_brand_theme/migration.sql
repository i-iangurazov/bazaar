ALTER TYPE "EmailCampaignFontFamily" ADD VALUE IF NOT EXISTS 'NOTO_SANS';
ALTER TYPE "EmailCampaignFontFamily" ADD VALUE IF NOT EXISTS 'ROBOTO';
ALTER TYPE "EmailCampaignFontFamily" ADD VALUE IF NOT EXISTS 'OPEN_SANS';
ALTER TYPE "EmailCampaignFontFamily" ADD VALUE IF NOT EXISTS 'MONTSERRAT';
ALTER TYPE "EmailCampaignFontFamily" ADD VALUE IF NOT EXISTS 'LATO';
ALTER TYPE "EmailCampaignFontFamily" ADD VALUE IF NOT EXISTS 'PT_SANS';
ALTER TYPE "EmailCampaignFontFamily" ADD VALUE IF NOT EXISTS 'SOURCE_SANS_3';
ALTER TYPE "EmailCampaignFontFamily" ADD VALUE IF NOT EXISTS 'MANROPE';

ALTER TABLE "EmailCampaign"
  ADD COLUMN "buttonTextColor" TEXT,
  ADD COLUMN "backgroundColor" TEXT,
  ADD COLUMN "contentBackgroundColor" TEXT,
  ADD COLUMN "textColor" TEXT,
  ADD COLUMN "mutedTextColor" TEXT,
  ADD COLUMN "borderColor" TEXT;
