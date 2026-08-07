-- Permanent exact identity for externally supplied Bazaar API order IDs.
-- The staged dual-read/write rollout and collision-safe backfill must complete
-- before this migration is deployed.
CREATE UNIQUE INDEX "CustomerOrder_external_identity_uq"
ON "CustomerOrder"("organizationId", "storeId", "source", "externalOrderId")
WHERE "externalOrderId" IS NOT NULL;
