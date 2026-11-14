-- Prisma stores these TIMESTAMP(3) fields as UTC-naive values. Compare the
-- actual clock in the same representation, regardless of session TimeZone.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION "protectAppleNativeCompletion"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE intent "ApplePurchaseIntent";
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Native completion evidence is append-only' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "Organization" WHERE id=NEW."organizationId" FOR NO KEY UPDATE;
 SELECT * INTO intent FROM "ApplePurchaseIntent" WHERE id=NEW."intentId" FOR UPDATE;
 IF intent.id IS NULL OR intent."organizationId" IS DISTINCT FROM NEW."organizationId" OR intent."authorizedAt" IS NULL OR
   intent."completionPublicKey" IS NULL OR intent."nativeAttemptId" IS DISTINCT FROM NEW."nativeAttemptId" OR
   intent."completionKeyFingerprint" IS DISTINCT FROM NEW."keyFingerprint" OR intent."completionOrigin" IS DISTINCT FROM NEW.origin OR
   NEW."issuedAt"<intent."authorizedAt" OR NEW."issuedAt">(clock_timestamp() AT TIME ZONE 'UTC')+interval '5 seconds' OR NEW."expiresAt"<=(clock_timestamp() AT TIME ZONE 'UTC') OR
   EXISTS(SELECT 1 FROM "AppleTransaction" WHERE "intentId"=intent.id) OR
   NOT (intent.status='PENDING' OR (intent.status='REVIEW' AND intent."lastIssue"='applePurchasePendingVerification') OR
      (intent.status='CANCELED' AND NEW.outcome IN ('CANCELED','NOT_STARTED')) OR
      (intent.status='COMPLETED' AND NEW.outcome='DEFERRED' AND EXISTS(SELECT 1 FROM "AppleNativeDeferredOutcome" WHERE "intentId"=intent.id))) THEN
   RAISE EXCEPTION 'Native completion must match its enrolled winning attempt' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
COMMIT;
