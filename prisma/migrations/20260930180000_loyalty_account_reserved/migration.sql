-- Loyalty reservation guard (Stage 5). Additive: availability is guarded by an
-- atomic conditional update so parallel checkouts cannot oversell one balance.

-- AlterTable
ALTER TABLE "LoyaltyAccount" ADD COLUMN "reservedPoints" INTEGER NOT NULL DEFAULT 0;
