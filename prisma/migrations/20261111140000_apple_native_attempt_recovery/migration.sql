-- Bind the one-use native sheet authorization to its durable local attempt.
-- Existing authorized intents remain valid financial/recovery evidence; a
-- missing historical attempt is never retroactively claimed by another device.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "ApplePurchaseIntent" ADD COLUMN "nativeAttemptId" UUID;
CREATE UNIQUE INDEX "ApplePurchaseIntent_nativeAttemptId_key" ON "ApplePurchaseIntent"("nativeAttemptId");
ALTER TABLE "ApplePurchaseIntent" ADD CONSTRAINT "ApplePurchaseIntent_native_attempt_check"
  CHECK ("nativeAttemptId" IS NULL OR "authorizedAt" IS NOT NULL);

CREATE OR REPLACE FUNCTION "protectAppleIntent"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account "AppleBillingAccount";
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Apple purchase intent is retained' USING ERRCODE = '23514'; END IF;
  SELECT * INTO account FROM "AppleBillingAccount" WHERE "organizationId" = NEW."organizationId";
  IF account."appAccountToken" IS DISTINCT FROM NEW."appAccountToken" THEN
    RAISE EXCEPTION 'Apple intent requires immutable organization account token' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."nativeAttemptId" IS NULL AND NEW."nativeAttemptId" IS NOT NULL THEN
    IF OLD."authorizedAt" IS NOT NULL OR NEW."authorizedAt" IS NULL THEN
      RAISE EXCEPTION 'Native Apple attempt must bind with its first authorization' USING ERRCODE = '23514';
    END IF;
    -- Permit only the first atomic binding. The remaining comparison freezes
    -- the attempt forever along with the existing financial/tenant snapshot.
    OLD."nativeAttemptId" := NEW."nativeAttemptId";
  END IF;
  IF TG_OP = 'UPDATE' AND (
    (to_jsonb(NEW) - ARRAY['pendingSlot','status','authorizedAt','lastIssue','updatedAt']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['pendingSlot','status','authorizedAt','lastIssue','updatedAt']) OR
    (OLD."authorizedAt" IS NOT NULL AND NEW."authorizedAt" IS DISTINCT FROM OLD."authorizedAt")) THEN
    RAISE EXCEPTION 'Apple purchase intent snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
COMMIT;
