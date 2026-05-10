-- Store-scoped email marketing logo gallery.

ALTER TABLE "EmailCampaign" ADD COLUMN "logoImageId" TEXT;

CREATE TABLE "EmailMarketingLogo" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailMarketingLogo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailMarketingLogo_storeId_key" ON "EmailMarketingLogo"("storeId");
CREATE UNIQUE INDEX "EmailMarketingLogo_organizationId_storeId_key" ON "EmailMarketingLogo"("organizationId", "storeId");
CREATE INDEX "EmailMarketingLogo_organizationId_updatedAt_idx" ON "EmailMarketingLogo"("organizationId", "updatedAt");
CREATE INDEX "EmailMarketingLogo_imageId_idx" ON "EmailMarketingLogo"("imageId");
CREATE INDEX "EmailMarketingLogo_updatedById_idx" ON "EmailMarketingLogo"("updatedById");
CREATE INDEX "EmailCampaign_logoImageId_idx" ON "EmailCampaign"("logoImageId");

ALTER TABLE "EmailCampaign"
  ADD CONSTRAINT "EmailCampaign_logoImageId_fkey"
  FOREIGN KEY ("logoImageId") REFERENCES "BazaarCatalogImage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmailMarketingLogo"
  ADD CONSTRAINT "EmailMarketingLogo_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailMarketingLogo"
  ADD CONSTRAINT "EmailMarketingLogo_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailMarketingLogo"
  ADD CONSTRAINT "EmailMarketingLogo_imageId_fkey"
  FOREIGN KEY ("imageId") REFERENCES "BazaarCatalogImage"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailMarketingLogo"
  ADD CONSTRAINT "EmailMarketingLogo_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
