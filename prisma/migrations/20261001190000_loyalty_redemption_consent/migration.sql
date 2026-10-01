CREATE TABLE "LoyaltyRedemptionConsent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT,
  "memberId" TEXT NOT NULL REFERENCES "LoyaltyMember"("id") ON DELETE RESTRICT,
  "customerOrderId" TEXT NOT NULL REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT,
  "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "points" INTEGER NOT NULL CHECK ("points" > 0),
  "payableKgs" DECIMAL(18,2) NOT NULL CHECK ("payableKgs" >= 0),
  "cartFingerprint" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "LoyaltyRedemptionConsent_memberId_expiresAt_idx" ON "LoyaltyRedemptionConsent"("memberId", "expiresAt");
CREATE INDEX "LoyaltyRedemptionConsent_customerOrderId_idx" ON "LoyaltyRedemptionConsent"("customerOrderId");
