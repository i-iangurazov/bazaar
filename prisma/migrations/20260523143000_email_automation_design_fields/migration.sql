ALTER TABLE "EmailAutomation"
  ADD COLUMN "brandColor" TEXT,
  ADD COLUMN "buttonColor" TEXT,
  ADD COLUMN "buttonTextColor" TEXT,
  ADD COLUMN "backgroundColor" TEXT,
  ADD COLUMN "contentBackgroundColor" TEXT,
  ADD COLUMN "textColor" TEXT,
  ADD COLUMN "mutedTextColor" TEXT,
  ADD COLUMN "borderColor" TEXT,
  ADD COLUMN "fontFamily" "EmailCampaignFontFamily" NOT NULL DEFAULT 'INTER',
  ADD COLUMN "logoStoreId" TEXT;
