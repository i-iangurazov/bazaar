-- Add registration token type for verified-first business onboarding.
ALTER TYPE "AuthTokenType" ADD VALUE 'REGISTRATION';

-- Add explicit subscription status metadata for org billing enforcement.
CREATE TYPE "OrganizationSubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED');

ALTER TABLE "Organization"
  ADD COLUMN "subscriptionStatus" "OrganizationSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "currentPeriodEndsAt" TIMESTAMP(3);
