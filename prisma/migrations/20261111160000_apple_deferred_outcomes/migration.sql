-- A native invocation's earned deferred result is neither money nor an access grant.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE "ApplePurchaseIntent" ADD COLUMN "completionPublicKey" VARCHAR(200), ADD COLUMN "completionKeyFingerprint" VARCHAR(64), ADD COLUMN "completionOrigin" TEXT;
CREATE UNIQUE INDEX "ApplePurchaseIntent_completionKeyFingerprint_key" ON "ApplePurchaseIntent"("completionKeyFingerprint");
ALTER TABLE "ApplePurchaseIntent" ADD CONSTRAINT "ApplePurchaseIntent_completion_key_shape" CHECK (
 ("completionPublicKey" IS NULL AND "completionKeyFingerprint" IS NULL AND "completionOrigin" IS NULL) OR
 ("completionPublicKey" IS NOT NULL AND "completionKeyFingerprint" IS NOT NULL AND "completionOrigin" IS NOT NULL AND
  "completionKeyFingerprint" ~ '^[a-f0-9]{64}$' AND "completionOrigin" ~ '^https://[^/?#[:space:]]+$' AND
  "nativeAttemptId" IS NOT NULL AND "authorizedAt" IS NOT NULL AND
  "completionKeyFingerprint"=encode(sha256(decode("completionPublicKey",'base64')),'hex')));

CREATE OR REPLACE FUNCTION "protectAppleIntent"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account "AppleBillingAccount";
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Apple purchase intent is retained' USING ERRCODE='23514'; END IF;
 SELECT * INTO account FROM "AppleBillingAccount" WHERE "organizationId"=NEW."organizationId";
 IF account."appAccountToken" IS DISTINCT FROM NEW."appAccountToken" THEN
   RAISE EXCEPTION 'Apple intent requires immutable organization account token' USING ERRCODE='23514';
 END IF;
 IF NEW."purchaseAppAccountToken" IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(NEW."purchaseAppAccountToken"::text,517));
   IF NEW.scope<>'SUBSCRIPTION' OR NEW.action<>'CHANGE' OR NEW."productType"<>'NON_RENEWING' OR
      jsonb_typeof(NEW."purchaseSnapshot"->'appleTemporaryUpgrade') IS DISTINCT FROM 'object' OR NEW."purchaseSnapshot"->>'kind' IS DISTINCT FROM 'UPGRADE' OR
      EXISTS(SELECT 1 FROM "AppleBillingAccount" WHERE "appAccountToken"=NEW."purchaseAppAccountToken") THEN
     RAISE EXCEPTION 'Temporary upgrade requires its own immutable quote token' USING ERRCODE='23514';
   END IF;
 ELSIF NEW."purchaseSnapshot"->'appleTemporaryUpgrade' IS NOT NULL THEN
   RAISE EXCEPTION 'Temporary upgrade requires an exact purchase token' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND OLD."completionPublicKey" IS NULL AND NEW."completionPublicKey" IS NOT NULL THEN
   IF OLD."authorizedAt" IS NOT NULL OR OLD."nativeAttemptId" IS NOT NULL OR NEW."authorizedAt" IS NULL OR NEW."nativeAttemptId" IS NULL THEN
     RAISE EXCEPTION 'Native completion key must enroll with first authorization' USING ERRCODE='23514';
   END IF;
   OLD."completionPublicKey":=NEW."completionPublicKey";
   OLD."completionKeyFingerprint":=NEW."completionKeyFingerprint";
   OLD."completionOrigin":=NEW."completionOrigin";
 END IF;
 IF TG_OP='UPDATE' AND OLD."nativeAttemptId" IS NULL AND NEW."nativeAttemptId" IS NOT NULL THEN
   IF OLD."authorizedAt" IS NOT NULL OR NEW."authorizedAt" IS NULL THEN
     RAISE EXCEPTION 'Native Apple attempt must bind with its first authorization' USING ERRCODE='23514';
   END IF;
   OLD."nativeAttemptId":=NEW."nativeAttemptId";
 END IF;
 IF TG_OP='UPDATE' AND OLD."completionKeyFingerprint" IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('CANCELED','COMPLETED') AND
    NOT EXISTS(SELECT 1 FROM "AppleTransaction" WHERE "intentId"=OLD.id) AND NOT EXISTS(
      SELECT 1 FROM "AppleNativeCompletion" c WHERE c."intentId"=OLD.id AND c."organizationId"=OLD."organizationId" AND
       c."nativeAttemptId"=OLD."nativeAttemptId" AND c."keyFingerprint"=OLD."completionKeyFingerprint" AND
       ((NEW.status='CANCELED' AND c.outcome IN ('CANCELED','NOT_STARTED')) OR (NEW.status='COMPLETED' AND c.outcome='DEFERRED'))) THEN
   RAISE EXCEPTION 'Enrolled Apple intent requires signed outcome or recorded money' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['pendingSlot','status','authorizedAt','lastIssue','updatedAt']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['pendingSlot','status','authorizedAt','lastIssue','updatedAt']) OR
   (OLD."authorizedAt" IS NOT NULL AND NEW."authorizedAt" IS DISTINCT FROM OLD."authorizedAt")) THEN
   RAISE EXCEPTION 'Apple purchase intent snapshot is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;

CREATE TABLE "AppleNativeCompletion" (
 "id" TEXT NOT NULL, "intentId" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "nativeAttemptId" UUID NOT NULL,
 "keyFingerprint" VARCHAR(64) NOT NULL, "origin" TEXT NOT NULL, "outcome" TEXT NOT NULL,
 "transactionDigest" VARCHAR(64), "renewalDigest" VARCHAR(64), "challengeDigest" VARCHAR(64) NOT NULL,
 "challenge" TEXT NOT NULL, "signature" VARCHAR(100) NOT NULL, "issuedAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AppleNativeCompletion_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "AppleNativeCompletion_shape_check" CHECK (
   "keyFingerprint" ~ '^[a-f0-9]{64}$' AND "challengeDigest"=encode(sha256(convert_to("challenge",'UTF8')),'hex') AND
   length("challenge") BETWEEN 30 AND 3000 AND octet_length(decode("signature",'base64'))=64 AND
   "expiresAt"="issuedAt"+interval '5 minutes' AND
   (("outcome" IN ('CANCELED','NOT_STARTED') AND "transactionDigest" IS NULL AND "renewalDigest" IS NULL) OR
    ("outcome"='DEFERRED' AND "transactionDigest" IS NOT NULL AND "renewalDigest" IS NOT NULL AND
      "transactionDigest" ~ '^[a-f0-9]{64}$' AND "renewalDigest" ~ '^[a-f0-9]{64}$')))
);
CREATE UNIQUE INDEX "AppleNativeCompletion_intentId_key" ON "AppleNativeCompletion"("intentId");
CREATE UNIQUE INDEX "AppleNativeCompletion_challengeDigest_key" ON "AppleNativeCompletion"("challengeDigest");
CREATE UNIQUE INDEX "AppleNativeCompletion_intentId_organizationId_key" ON "AppleNativeCompletion"("intentId","organizationId");
CREATE INDEX "AppleNativeCompletion_organizationId_createdAt_idx" ON "AppleNativeCompletion"("organizationId","createdAt");
ALTER TABLE "AppleNativeCompletion" ADD CONSTRAINT "AppleNativeCompletion_intentId_organizationId_fkey"
 FOREIGN KEY ("intentId","organizationId") REFERENCES "ApplePurchaseIntent"("id","organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TABLE "AppleNativeDeferredOutcome" (
 "id" TEXT NOT NULL, "intentId" TEXT NOT NULL, "organizationId" TEXT NOT NULL,
 "nativeAttemptId" UUID NOT NULL, "actorId" TEXT NOT NULL, "chainId" TEXT NOT NULL,
 "previousTransactionId" TEXT NOT NULL, "environment" TEXT NOT NULL, "originalTransactionId" TEXT NOT NULL,
 "appAccountToken" UUID NOT NULL, "currentProductId" TEXT NOT NULL, "productId" TEXT NOT NULL,
 "effectiveAt" TIMESTAMP(3) NOT NULL, "renewalSignedAt" TIMESTAMP(3) NOT NULL,
 "transactionDigest" VARCHAR(64) NOT NULL, "renewalDigest" VARCHAR(64) NOT NULL,
 "signedTransactionInfo" TEXT NOT NULL, "signedRenewalInfo" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AppleNativeDeferredOutcome_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "AppleNativeDeferredOutcome_shape_check" CHECK (
   "environment" IN ('Production','Sandbox') AND "currentProductId"<>"productId" AND
   "originalTransactionId" ~ '^[0-9]{1,40}$' AND "transactionDigest" ~ '^[a-f0-9]{64}$' AND "renewalDigest" ~ '^[a-f0-9]{64}$' AND
   length("signedTransactionInfo") BETWEEN 30 AND 100000 AND length("signedRenewalInfo") BETWEEN 30 AND 100000 AND
   "renewalSignedAt"<"effectiveAt" AND
   "transactionDigest"=encode(sha256(convert_to("signedTransactionInfo",'UTF8')),'hex') AND
   "renewalDigest"=encode(sha256(convert_to("signedRenewalInfo",'UTF8')),'hex'))
);
CREATE UNIQUE INDEX "AppleNativeDeferredOutcome_intentId_key" ON "AppleNativeDeferredOutcome"("intentId");
CREATE UNIQUE INDEX "AppleNativeDeferredOutcome_intentId_organizationId_key" ON "AppleNativeDeferredOutcome"("intentId","organizationId");
CREATE INDEX "AppleNativeDeferredOutcome_organizationId_createdAt_idx" ON "AppleNativeDeferredOutcome"("organizationId","createdAt");
ALTER TABLE "AppleNativeDeferredOutcome" ADD CONSTRAINT "AppleNativeDeferredOutcome_intentId_organizationId_fkey"
 FOREIGN KEY ("intentId","organizationId") REFERENCES "ApplePurchaseIntent"("id","organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AppleNativeDeferredOutcome" ADD CONSTRAINT "AppleNativeDeferredOutcome_chainId_organizationId_fkey"
 FOREIGN KEY ("chainId","organizationId") REFERENCES "AppleSubscriptionChain"("id","organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AppleNativeDeferredOutcome" ADD CONSTRAINT "AppleNativeDeferredOutcome_previous_org_fkey"
 FOREIGN KEY ("previousTransactionId","organizationId") REFERENCES "AppleTransaction"("id","organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- This also serializes a direct financial INSERT against outcome acceptance;
-- application payment paths already hold the same organization row lock.
CREATE FUNCTION "lockAppleFinancialOutcomeOrganization"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM "Organization" WHERE id=NEW."organizationId" FOR NO KEY UPDATE;
 RETURN NEW;
END; $$;
CREATE TRIGGER "AppleTransaction_deferred_outcome_lock" BEFORE INSERT ON "AppleTransaction"
 FOR EACH ROW EXECUTE FUNCTION "lockAppleFinancialOutcomeOrganization"();

CREATE FUNCTION "protectAppleNativeDeferredOutcome"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE intent "ApplePurchaseIntent"; previous "AppleTransaction"; chain "AppleSubscriptionChain"; source JSONB;
BEGIN
 IF TG_OP<>'INSERT' THEN
   RAISE EXCEPTION 'Native deferred outcome evidence is append-only' USING ERRCODE='23514';
 END IF;
 PERFORM id FROM "Organization" WHERE id=NEW."organizationId" FOR NO KEY UPDATE;
 SELECT * INTO intent FROM "ApplePurchaseIntent" WHERE id=NEW."intentId" FOR UPDATE;
 SELECT * INTO previous FROM "AppleTransaction" WHERE id=NEW."previousTransactionId";
 SELECT * INTO chain FROM "AppleSubscriptionChain" WHERE id=NEW."chainId";
 source:=intent."offerSnapshot"->'appleChangeSource';
 IF intent.id IS NULL OR previous.id IS NULL OR chain.id IS NULL OR
   intent."organizationId" IS DISTINCT FROM NEW."organizationId" OR previous."organizationId" IS DISTINCT FROM NEW."organizationId" OR chain."organizationId" IS DISTINCT FROM NEW."organizationId" OR
   intent."createdById" IS DISTINCT FROM NEW."actorId" OR intent."nativeAttemptId" IS DISTINCT FROM NEW."nativeAttemptId" OR intent."authorizedAt" IS NULL OR
   intent.scope<>'SUBSCRIPTION' OR intent.action<>'CHANGE' OR intent."productType"<>'AUTO_RENEWABLE' OR intent."purchaseAppAccountToken" IS NOT NULL OR
   NOT (intent.status='PENDING' OR (intent.status='REVIEW' AND intent."lastIssue"='applePurchasePendingVerification')) OR
   EXISTS(SELECT 1 FROM "AppleTransaction" WHERE "intentId"=intent.id) OR
   ((intent."completionKeyFingerprint" IS NULL AND NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."actorId" AND "organizationId"=NEW."organizationId" AND "isActive" AND "deletedAt" IS NULL AND role='ADMIN')) OR
    (intent."completionKeyFingerprint" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "AppleNativeCompletion" c WHERE c."intentId"=intent.id AND c."organizationId"=NEW."organizationId" AND
      c."nativeAttemptId"=NEW."nativeAttemptId" AND c."keyFingerprint"=intent."completionKeyFingerprint" AND c.outcome='DEFERRED' AND
      c."transactionDigest"=NEW."transactionDigest" AND c."renewalDigest"=NEW."renewalDigest"))) OR
   jsonb_typeof(source) IS DISTINCT FROM 'object' OR source->>'version' IS DISTINCT FROM '1' OR
   source->>'chainId' IS DISTINCT FROM chain.id OR source->>'transactionRowId' IS DISTINCT FROM previous.id OR
   source->>'transactionId' IS DISTINCT FROM previous."transactionId" OR source->>'originalTransactionId' IS DISTINCT FROM NEW."originalTransactionId" OR
   source->>'productId' IS DISTINCT FROM NEW."currentProductId" OR source->>'environment' IS DISTINCT FROM NEW.environment OR
   source->>'subscriptionGroupId' IS DISTINCT FROM intent."offerSnapshot"->'appleProduct'->>'subscriptionGroupId' OR
   source->>'subscriptionGroupId' IS NULL OR ((source->>'expiresAt')::timestamptz AT TIME ZONE 'UTC') IS DISTINCT FROM NEW."effectiveAt" OR
   previous.status NOT IN ('GRANTED','REVOKED') OR previous."productType"<>'AUTO_RENEWABLE' OR
   previous."createdAt">intent."authorizedAt" OR previous."purchaseDate">intent."authorizedAt" OR previous."expiresDate" IS DISTINCT FROM NEW."effectiveAt" OR
   previous."productId" IS DISTINCT FROM NEW."currentProductId" OR intent."productId" IS DISTINCT FROM NEW."productId" OR
   previous.environment IS DISTINCT FROM NEW.environment OR intent.environment IS DISTINCT FROM NEW.environment OR chain.environment IS DISTINCT FROM NEW.environment OR
   previous."originalTransactionId" IS DISTINCT FROM NEW."originalTransactionId" OR chain."originalTransactionId" IS DISTINCT FROM NEW."originalTransactionId" OR
   previous."appAccountToken" IS DISTINCT FROM NEW."appAccountToken" OR intent."appAccountToken" IS DISTINCT FROM NEW."appAccountToken" OR chain."appAccountToken" IS DISTINCT FROM NEW."appAccountToken" OR
   NEW."renewalSignedAt"<intent."authorizedAt" OR
   NOT EXISTS(SELECT 1 FROM "SubscriptionPeriod" p WHERE p."appleTransactionId"=previous.id AND p."organizationId"=NEW."organizationId" AND
     p."startsAt"<=intent."authorizedAt" AND p."endsAt"=NEW."effectiveAt" AND
     (previous.status='GRANTED' OR COALESCE(previous."revocationDate",previous."supersededAt",p."revokedAt",p."dependencyRevokedAt") IS NOT NULL) AND
     NOT EXISTS(SELECT 1 FROM unnest(ARRAY[previous."revocationDate",previous."supersededAt",p."revokedAt",p."dependencyRevokedAt"]) AS v("invalidatedAt")
       WHERE v."invalidatedAt"<intent."authorizedAt" OR v."invalidatedAt"<NEW."renewalSignedAt")) THEN
   RAISE EXCEPTION 'Native deferred outcome must match its original winning attempt and verified source' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "AppleNativeDeferredOutcome_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "AppleNativeDeferredOutcome"
 FOR EACH ROW EXECUTE FUNCTION "protectAppleNativeDeferredOutcome"();

CREATE FUNCTION "protectAppleNativeCompletion"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE intent "ApplePurchaseIntent";
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Native completion evidence is append-only' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "Organization" WHERE id=NEW."organizationId" FOR NO KEY UPDATE;
 SELECT * INTO intent FROM "ApplePurchaseIntent" WHERE id=NEW."intentId" FOR UPDATE;
 IF intent.id IS NULL OR intent."organizationId" IS DISTINCT FROM NEW."organizationId" OR intent."authorizedAt" IS NULL OR
   intent."completionPublicKey" IS NULL OR intent."nativeAttemptId" IS DISTINCT FROM NEW."nativeAttemptId" OR
   intent."completionKeyFingerprint" IS DISTINCT FROM NEW."keyFingerprint" OR intent."completionOrigin" IS DISTINCT FROM NEW.origin OR
   NEW."issuedAt"<intent."authorizedAt" OR NEW."issuedAt">clock_timestamp()+interval '5 seconds' OR NEW."expiresAt"<=clock_timestamp() OR
   EXISTS(SELECT 1 FROM "AppleTransaction" WHERE "intentId"=intent.id) OR
   NOT (intent.status='PENDING' OR (intent.status='REVIEW' AND intent."lastIssue"='applePurchasePendingVerification') OR
      (intent.status='CANCELED' AND NEW.outcome IN ('CANCELED','NOT_STARTED')) OR
      (intent.status='COMPLETED' AND NEW.outcome='DEFERRED' AND EXISTS(SELECT 1 FROM "AppleNativeDeferredOutcome" WHERE "intentId"=intent.id))) THEN
   RAISE EXCEPTION 'Native completion must match its enrolled winning attempt' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "AppleNativeCompletion_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "AppleNativeCompletion"
 FOR EACH ROW EXECUTE FUNCTION "protectAppleNativeCompletion"();
COMMIT;
