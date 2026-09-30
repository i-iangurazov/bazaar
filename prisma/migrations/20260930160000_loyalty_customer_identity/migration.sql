-- Loyalty customer identity (Stage 4). Additive: the member key becomes a generic
-- normalized contact, and OTP/session/card-token tables are added. Customer
-- sessions are separate from staff authentication.

-- CreateEnum
CREATE TYPE "LoyaltyOtpPurpose" AS ENUM ('JOIN', 'SIGN_IN');

-- AlterTable: the existing phone identifier becomes the generic contact key.
ALTER TABLE "LoyaltyMember" RENAME COLUMN "phoneNormalized" TO "contactKey";
ALTER TABLE "LoyaltyMember" ADD COLUMN "phoneNormalized" TEXT;
UPDATE "LoyaltyMember" SET "contactKey" = 'phone:' || "contactKey" WHERE "contactKey" NOT LIKE '%:%';

-- DropIndex
DROP INDEX "LoyaltyMember_programId_phoneNormalized_key";

-- DropIndex
DROP INDEX "LoyaltyMember_organizationId_phoneNormalized_idx";

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyMember_programId_contactKey_key" ON "LoyaltyMember"("programId", "contactKey");

-- CreateIndex
CREATE INDEX "LoyaltyMember_organizationId_contactKey_idx" ON "LoyaltyMember"("organizationId", "contactKey");

-- CreateTable
CREATE TABLE "LoyaltyOtpChallenge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "contactKey" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" "LoyaltyOtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyOtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltySession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyCardToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyCardToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoyaltyOtpChallenge_contactKey_createdAt_idx" ON "LoyaltyOtpChallenge"("contactKey", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyOtpChallenge_expiresAt_idx" ON "LoyaltyOtpChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltySession_tokenHash_key" ON "LoyaltySession"("tokenHash");

-- CreateIndex
CREATE INDEX "LoyaltySession_memberId_expiresAt_idx" ON "LoyaltySession"("memberId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyCardToken_tokenHash_key" ON "LoyaltyCardToken"("tokenHash");

-- CreateIndex
CREATE INDEX "LoyaltyCardToken_memberId_expiresAt_idx" ON "LoyaltyCardToken"("memberId", "expiresAt");
