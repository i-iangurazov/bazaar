-- Signed sessions are invalidated when this monotonically increasing value changes.
-- Existing rows start at zero; legacy JWTs without a version require a fresh login.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
