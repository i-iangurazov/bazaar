-- Loyalty foundation (Stage 2/3). Additive only; the programme ships disabled by
-- default, so existing organizations and sales are unaffected.

-- CreateEnum
CREATE TYPE "LoyaltyMemberStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "LoyaltyLedgerType" AS ENUM ('EARN', 'REDEEM', 'REVERSAL_REDEEM', 'REVERSAL_EARN', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LoyaltyReservationStatus" AS ENUM ('ACTIVE', 'CONFIRMED', 'RELEASED', 'EXPIRED');

-- CreateTable
CREATE TABLE "LoyaltyProgram" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "currencyCode" TEXT NOT NULL DEFAULT 'KGS',
    "memberDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "earnPercent" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "maxSpendPercent" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "pointValueKgs" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "minRedeemPoints" INTEGER NOT NULL DEFAULT 0,
    "reservationTtlMinutes" INTEGER NOT NULL DEFAULT 30,
    "excludePromoItems" BOOLEAN NOT NULL DEFAULT true,
    "combinePromoDiscount" BOOLEAN NOT NULL DEFAULT false,
    "rulesText" TEXT,
    "rulesVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyProgramStore" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyProgramStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "customerId" TEXT,
    "phoneNormalized" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "status" "LoyaltyMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "balancePoints" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyLedgerEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "type" "LoyaltyLedgerType" NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT,
    "customerOrderId" TEXT,
    "saleReturnId" TEXT,
    "actorId" TEXT,
    "actorType" TEXT,
    "eventKey" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "customerOrderId" TEXT,
    "points" INTEGER NOT NULL,
    "status" "LoyaltyReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "eventKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "LoyaltyReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyOrderApplication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "customerOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "memberDiscountKgs" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pointsSpent" INTEGER NOT NULL DEFAULT 0,
    "pointsEarned" INTEGER NOT NULL DEFAULT 0,
    "eligibleKgs" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "rulesSnapshot" JSONB,
    "lineDistribution" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyOrderApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyProgram_organizationId_key" ON "LoyaltyProgram"("organizationId");

-- CreateIndex
CREATE INDEX "LoyaltyProgram_organizationId_idx" ON "LoyaltyProgram"("organizationId");

-- CreateIndex
CREATE INDEX "LoyaltyProgramStore_organizationId_storeId_idx" ON "LoyaltyProgramStore"("organizationId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyProgramStore_programId_storeId_key" ON "LoyaltyProgramStore"("programId", "storeId");

-- CreateIndex
CREATE INDEX "LoyaltyMember_organizationId_phoneNormalized_idx" ON "LoyaltyMember"("organizationId", "phoneNormalized");

-- CreateIndex
CREATE INDEX "LoyaltyMember_organizationId_customerId_idx" ON "LoyaltyMember"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyMember_programId_phoneNormalized_key" ON "LoyaltyMember"("programId", "phoneNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyAccount_memberId_key" ON "LoyaltyAccount"("memberId");

-- CreateIndex
CREATE INDEX "LoyaltyAccount_organizationId_idx" ON "LoyaltyAccount"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyLedgerEntry_eventKey_key" ON "LoyaltyLedgerEntry"("eventKey");

-- CreateIndex
CREATE INDEX "LoyaltyLedgerEntry_accountId_createdAt_idx" ON "LoyaltyLedgerEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyLedgerEntry_organizationId_customerOrderId_idx" ON "LoyaltyLedgerEntry"("organizationId", "customerOrderId");

-- CreateIndex
CREATE INDEX "LoyaltyLedgerEntry_organizationId_saleReturnId_idx" ON "LoyaltyLedgerEntry"("organizationId", "saleReturnId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyReservation_eventKey_key" ON "LoyaltyReservation"("eventKey");

-- CreateIndex
CREATE INDEX "LoyaltyReservation_accountId_status_idx" ON "LoyaltyReservation"("accountId", "status");

-- CreateIndex
CREATE INDEX "LoyaltyReservation_status_expiresAt_idx" ON "LoyaltyReservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "LoyaltyReservation_organizationId_customerOrderId_idx" ON "LoyaltyReservation"("organizationId", "customerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyOrderApplication_customerOrderId_key" ON "LoyaltyOrderApplication"("customerOrderId");

-- CreateIndex
CREATE INDEX "LoyaltyOrderApplication_organizationId_memberId_idx" ON "LoyaltyOrderApplication"("organizationId", "memberId");
