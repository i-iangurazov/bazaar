-- Native push registrations are additive and scoped to the authenticated user and organization.
CREATE TYPE "MobilePlatform" AS ENUM ('IOS', 'ANDROID');

CREATE TABLE "MobileDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "installationId" VARCHAR(160) NOT NULL,
    "platform" "MobilePlatform" NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "appVersion" VARCHAR(40) NOT NULL,
    "buildNumber" VARCHAR(40) NOT NULL,
    "deviceName" VARCHAR(120),
    "osVersion" VARCHAR(80),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobileDevice_userId_installationId_key"
    ON "MobileDevice"("userId", "installationId");
CREATE INDEX "MobileDevice_organizationId_userId_enabled_idx"
    ON "MobileDevice"("organizationId", "userId", "enabled");
CREATE INDEX "MobileDevice_tokenHash_enabled_idx"
    ON "MobileDevice"("tokenHash", "enabled");
CREATE INDEX "MobileDevice_lastSeenAt_idx" ON "MobileDevice"("lastSeenAt");

ALTER TABLE "MobileDevice"
    ADD CONSTRAINT "MobileDevice_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MobileDevice"
    ADD CONSTRAINT "MobileDevice_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
