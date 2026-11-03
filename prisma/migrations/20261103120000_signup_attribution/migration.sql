-- Nullable and additive; existing users and access requests retain their data.
ALTER TABLE "User" ADD COLUMN "signupAttribution" JSONB;
ALTER TABLE "AccessRequest" ADD COLUMN "signupAttribution" JSONB;
