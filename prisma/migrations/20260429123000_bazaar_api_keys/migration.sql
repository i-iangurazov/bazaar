-- Add API source for retailer-created Bazaar API orders.
ALTER TYPE "CustomerOrderSource" ADD VALUE IF NOT EXISTS 'API';

-- Store-scoped Bazaar API keys. Only token hashes are persisted.
CREATE TABLE "BazaarApiKey" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BazaarApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BazaarApiKey_tokenHash_key" ON "BazaarApiKey"("tokenHash");
CREATE INDEX "BazaarApiKey_organizationId_storeId_revokedAt_idx" ON "BazaarApiKey"("organizationId", "storeId", "revokedAt");
CREATE INDEX "BazaarApiKey_tokenPrefix_idx" ON "BazaarApiKey"("tokenPrefix");

ALTER TABLE "BazaarApiKey"
  ADD CONSTRAINT "BazaarApiKey_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BazaarApiKey"
  ADD CONSTRAINT "BazaarApiKey_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BazaarApiKey"
  ADD CONSTRAINT "BazaarApiKey_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
