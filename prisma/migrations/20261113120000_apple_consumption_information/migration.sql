BEGIN;

CREATE TABLE "AppleConsumptionConsent" (
  "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL, "appleTransactionId" TEXT NOT NULL,
  "purchaserId" TEXT NOT NULL, "policyVersion" TEXT NOT NULL, "consented" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1, "deliveryStatus" TEXT, "sampleContentProvided" BOOLEAN,
  "evidenceSource" TEXT NOT NULL DEFAULT 'BUYER_REPORTED', "grantedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppleConsumptionConsent_values_check" CHECK (
    "revision" > 0 AND length("policyVersion") BETWEEN 1 AND 100 AND "evidenceSource" = 'BUYER_REPORTED'
    AND ("deliveryStatus" IS NULL OR "deliveryStatus" IN ('DELIVERED','UNDELIVERED_QUALITY_ISSUE','UNDELIVERED_WRONG_ITEM','UNDELIVERED_SERVER_OUTAGE','UNDELIVERED_OTHER'))
    AND (("consented" AND "grantedAt" IS NOT NULL AND "revokedAt" IS NULL) OR (NOT "consented" AND "revokedAt" IS NOT NULL))),
  CONSTRAINT "AppleConsumptionConsent_transaction_org_fkey" FOREIGN KEY ("appleTransactionId","organizationId") REFERENCES "AppleTransaction"("id","organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "AppleConsumptionConsent_appleTransactionId_key" ON "AppleConsumptionConsent"("appleTransactionId");
CREATE UNIQUE INDEX "AppleConsumptionConsent_id_organizationId_key" ON "AppleConsumptionConsent"("id","organizationId");
CREATE UNIQUE INDEX "AppleConsumptionConsent_appleTransactionId_organizationId_key" ON "AppleConsumptionConsent"("appleTransactionId","organizationId");
CREATE INDEX "AppleConsumptionConsent_purchaserId_consented_idx" ON "AppleConsumptionConsent"("purchaserId","consented");

CREATE TABLE "AppleConsumptionConsentEvent" (
  "id" TEXT NOT NULL PRIMARY KEY, "consentId" TEXT NOT NULL, "organizationId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL, "revision" INTEGER NOT NULL, "policyVersion" TEXT NOT NULL, "consented" BOOLEAN NOT NULL,
  "deliveryStatus" TEXT, "sampleContentProvided" BOOLEAN, "evidenceSource" TEXT NOT NULL DEFAULT 'BUYER_REPORTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppleConsumptionConsentEvent_consent_org_fkey" FOREIGN KEY ("consentId","organizationId") REFERENCES "AppleConsumptionConsent"("id","organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "AppleConsumptionConsentEvent_consentId_revision_key" ON "AppleConsumptionConsentEvent"("consentId","revision");

CREATE TABLE "AppleConsumptionRequest" (
  "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT, "appleTransactionId" TEXT,
  "environment" TEXT NOT NULL, "transactionId" TEXT NOT NULL, "originalTransactionId" TEXT NOT NULL,
  "productId" TEXT NOT NULL, "appAccountToken" UUID NOT NULL, "signedTransactionInfo" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL, "deadlineAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'WAITING_BINDING', "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attemptCount" INTEGER NOT NULL DEFAULT 0, "lastAttemptAt" TIMESTAMP(3), "processingToken" TEXT, "processingUntil" TIMESTAMP(3),
  "payload" JSONB, "payloadDigest" VARCHAR(64), "consentRevision" INTEGER, "sentAt" TIMESTAMP(3), "lastIssue" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppleConsumptionRequest_notification_fkey" FOREIGN KEY ("id") REFERENCES "AppleServerNotification"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AppleConsumptionRequest_transaction_org_fkey" FOREIGN KEY ("appleTransactionId","organizationId") REFERENCES "AppleTransaction"("id","organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AppleConsumptionRequest_values_check" CHECK (
    "environment" IN ('Production','Sandbox') AND "transactionId" ~ '^[0-9]{1,40}$' AND "originalTransactionId" ~ '^[0-9]{1,40}$'
    AND "status" IN ('WAITING_BINDING','WAITING_CONSENT','WAITING_EVIDENCE','PENDING','SENDING','SENT','EXPIRED','FAILED','SUPPRESSED')
    AND "attemptCount" >= 0 AND ("attemptCount" = 0 OR "lastAttemptAt" IS NOT NULL)
    AND (("organizationId" IS NULL AND "appleTransactionId" IS NULL) OR ("organizationId" IS NOT NULL AND "appleTransactionId" IS NOT NULL))
    AND (("processingToken" IS NULL) = ("processingUntil" IS NULL))
    AND (("status" = 'SENT' AND "sentAt" IS NOT NULL) OR ("status" <> 'SENT' AND "sentAt" IS NULL))
    AND (("payload" IS NULL AND "payloadDigest" IS NULL AND "consentRevision" IS NULL) OR
      ("payload" IS NOT NULL AND "payloadDigest" IS NOT NULL AND "consentRevision" IS NOT NULL AND "payloadDigest" ~ '^[0-9a-f]{64}$' AND "consentRevision" > 0 AND "appleTransactionId" IS NOT NULL)))
);
CREATE INDEX "AppleConsumptionRequest_recovery_idx" ON "AppleConsumptionRequest"("status","nextAttemptAt","processingUntil");
CREATE INDEX "AppleConsumptionRequest_environment_transactionId_idx" ON "AppleConsumptionRequest"("environment","transactionId");

CREATE FUNCTION "protectAppleConsumptionConsent"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_buyer TEXT; active_admin BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Apple consumption consent history is retained' USING ERRCODE='23514'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."id",NEW."organizationId",NEW."appleTransactionId",NEW."purchaserId",NEW."createdAt",NEW."evidenceSource") IS DISTINCT FROM
    (OLD."id",OLD."organizationId",OLD."appleTransactionId",OLD."purchaserId",OLD."createdAt",OLD."evidenceSource") THEN
    RAISE EXCEPTION 'Apple consumption consent identity is immutable' USING ERRCODE='23514'; END IF;
  IF (TG_OP='INSERT' AND NEW."revision"<>1) OR (TG_OP='UPDATE' AND NEW."revision"<>OLD."revision"+1) THEN
    RAISE EXCEPTION 'Apple consumption consent requires sequential audit revision' USING ERRCODE='23514'; END IF;
  SELECT i."createdById" INTO original_buyer FROM "AppleTransaction" t JOIN "ApplePurchaseIntent" i ON i."id"=t."intentId" AND i."organizationId"=t."organizationId"
    WHERE t."id"=NEW."appleTransactionId" AND t."organizationId"=NEW."organizationId";
  IF original_buyer IS NULL OR original_buyer<>NEW."purchaserId" THEN
    RAISE EXCEPTION 'Apple consumption consent must belong to original purchaser' USING ERRCODE='23514'; END IF;
  IF NEW."consented" THEN
    SELECT (u."isActive" AND u."deletedAt" IS NULL AND u."role"='ADMIN' AND u."organizationId"=NEW."organizationId") INTO active_admin FROM "User" u WHERE u."id"=original_buyer;
    IF active_admin IS DISTINCT FROM true THEN RAISE EXCEPTION 'Apple consumption grant requires active original buyer' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AppleConsumptionConsent_protect" BEFORE INSERT OR UPDATE OR DELETE ON "AppleConsumptionConsent" FOR EACH ROW EXECUTE FUNCTION "protectAppleConsumptionConsent"();

CREATE FUNCTION "protectAppleConsumptionConsentEvent"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "AppleConsumptionConsent"%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Apple consumption consent events are append-only' USING ERRCODE='23514'; END IF;
  SELECT * INTO c FROM "AppleConsumptionConsent" WHERE "id"=NEW."consentId";
  IF c."id" IS NULL OR (NEW."organizationId",NEW."actorId",NEW."revision",NEW."policyVersion",NEW."consented",NEW."deliveryStatus",NEW."sampleContentProvided",NEW."evidenceSource") IS DISTINCT FROM
    (c."organizationId",c."purchaserId",c."revision",c."policyVersion",c."consented",c."deliveryStatus",c."sampleContentProvided",c."evidenceSource") THEN
    RAISE EXCEPTION 'Apple consumption event must match current buyer revision' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AppleConsumptionConsentEvent_protect" BEFORE INSERT OR UPDATE OR DELETE ON "AppleConsumptionConsentEvent" FOR EACH ROW EXECUTE FUNCTION "protectAppleConsumptionConsentEvent"();
CREATE FUNCTION "requireAppleConsumptionConsentAudit"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "AppleConsumptionConsentEvent" e WHERE e."consentId"=NEW."id" AND e."revision"=NEW."revision"
    AND (e."organizationId",e."actorId",e."policyVersion",e."consented",e."deliveryStatus",e."sampleContentProvided",e."evidenceSource") IS NOT DISTINCT FROM
      (NEW."organizationId",NEW."purchaserId",NEW."policyVersion",NEW."consented",NEW."deliveryStatus",NEW."sampleContentProvided",NEW."evidenceSource")) THEN
    RAISE EXCEPTION 'Apple consumption consent change requires matching audit event' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "AppleConsumptionConsent_require_audit" AFTER INSERT OR UPDATE ON "AppleConsumptionConsent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "requireAppleConsumptionConsentAudit"();

CREATE FUNCTION "appleConsumptionPayloadDigest"(p JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT encode(sha256(convert_to('{"customerConsented":true,"deliveryStatus":' || (p->'deliveryStatus')::text || ',"sampleContentProvided":' || (p->'sampleContentProvided')::text ||
    CASE WHEN p ? 'consumptionPercentage' THEN ',"consumptionPercentage":' || (p->'consumptionPercentage')::text ELSE '' END || '}', 'UTF8')), 'hex');
$$;

CREATE FUNCTION "protectAppleConsumptionRequest"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n "AppleServerNotification"%ROWTYPE; t "AppleTransaction"%ROWTYPE; c "AppleConsumptionConsent"%ROWTYPE; active_buyer BOOLEAN;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Apple consumption obligations are retained' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW."id",NEW."environment",NEW."transactionId",NEW."originalTransactionId",NEW."productId",NEW."appAccountToken",NEW."signedTransactionInfo",NEW."receivedAt",NEW."deadlineAt",NEW."createdAt") IS DISTINCT FROM
      (OLD."id",OLD."environment",OLD."transactionId",OLD."originalTransactionId",OLD."productId",OLD."appAccountToken",OLD."signedTransactionInfo",OLD."receivedAt",OLD."deadlineAt",OLD."createdAt") THEN
      RAISE EXCEPTION 'Apple consumption request origin is immutable' USING ERRCODE='23514'; END IF;
    IF OLD."appleTransactionId" IS NOT NULL AND (NEW."organizationId",NEW."appleTransactionId") IS DISTINCT FROM (OLD."organizationId",OLD."appleTransactionId") THEN
      RAISE EXCEPTION 'Apple consumption request tenant binding is immutable' USING ERRCODE='23514'; END IF;
    IF OLD."payload" IS NOT NULL AND (NEW."payload",NEW."payloadDigest",NEW."consentRevision") IS DISTINCT FROM (OLD."payload",OLD."payloadDigest",OLD."consentRevision") THEN
      RAISE EXCEPTION 'Apple consumption response body is frozen for retries' USING ERRCODE='23514'; END IF;
    IF OLD."status"='SENT' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Apple consumption accepted response is final' USING ERRCODE='23514'; END IF;
    IF NEW."attemptCount"<OLD."attemptCount" THEN RAISE EXCEPTION 'Apple consumption attempt counter cannot decrease' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT * INTO n FROM "AppleServerNotification" WHERE "id"=NEW."id";
  IF n."id" IS NULL OR n."notificationType"<>'CONSUMPTION_REQUEST' OR n."environment"<>NEW."environment" OR NEW."receivedAt"<>n."createdAt" OR NEW."deadlineAt"<>NEW."receivedAt"+interval '12 hours' THEN
    RAISE EXCEPTION 'Apple consumption obligation requires original notification/deadline' USING ERRCODE='23514'; END IF;
  IF NEW."appleTransactionId" IS NOT NULL THEN
    SELECT * INTO t FROM "AppleTransaction" WHERE "id"=NEW."appleTransactionId";
    IF t."id" IS NULL OR (NEW."organizationId",NEW."environment",NEW."transactionId",NEW."originalTransactionId",NEW."productId",NEW."appAccountToken") IS DISTINCT FROM
      (t."organizationId",t."environment",t."transactionId",t."originalTransactionId",t."productId",t."appAccountToken") THEN
      RAISE EXCEPTION 'Apple consumption request must match verified tenant transaction' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW."payload" IS NOT NULL THEN
    IF jsonb_typeof(NEW."payload")<>'object' OR NOT (NEW."payload" ?& ARRAY['customerConsented','deliveryStatus','sampleContentProvided'])
      OR NEW."payload"->'customerConsented'<>'true'::jsonb OR jsonb_typeof(NEW."payload"->'sampleContentProvided')<>'boolean'
      OR jsonb_typeof(NEW."payload"->'deliveryStatus') IS DISTINCT FROM 'string'
      OR NEW."payload"->>'deliveryStatus' NOT IN ('DELIVERED','UNDELIVERED_QUALITY_ISSUE','UNDELIVERED_WRONG_ITEM','UNDELIVERED_SERVER_OUTAGE','UNDELIVERED_OTHER')
      OR NEW."payload" - ARRAY['customerConsented','deliveryStatus','sampleContentProvided','consumptionPercentage'] <> '{}'::jsonb
      OR (NEW."payload"->>'deliveryStatus'='DELIVERED' AND NEW."payload" ? 'consumptionPercentage')
      OR (NEW."payload"->>'deliveryStatus'<>'DELIVERED' AND NEW."payload"->'consumptionPercentage' IS DISTINCT FROM '0'::jsonb)
      OR NEW."payloadDigest" IS DISTINCT FROM "appleConsumptionPayloadDigest"(NEW."payload") THEN
      RAISE EXCEPTION 'Apple consumption response requires exact minimal consented V2 data' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW."status" IN ('SENDING','SENT') AND (NEW."payload" IS NULL OR NEW."attemptCount"<1 OR NEW."lastAttemptAt" IS NULL OR NEW."lastAttemptAt">=NEW."deadlineAt") THEN
    RAISE EXCEPTION 'Apple consumption dispatch requires frozen timely attempt' USING ERRCODE='23514'; END IF;
  IF NEW."payload" IS NOT NULL AND (TG_OP='INSERT' OR OLD."payload" IS NULL OR NEW."status" IN ('SENDING','SENT')) THEN
    SELECT * INTO c FROM "AppleConsumptionConsent" WHERE "appleTransactionId"=NEW."appleTransactionId" AND "organizationId"=NEW."organizationId";
    SELECT (u."isActive" AND u."deletedAt" IS NULL AND u."role"='ADMIN' AND u."organizationId"=NEW."organizationId") INTO active_buyer FROM "User" u WHERE u."id"=c."purchaserId";
    IF c."id" IS NULL OR NOT c."consented" OR active_buyer IS DISTINCT FROM true OR c."revision" IS DISTINCT FROM NEW."consentRevision"
      OR (NEW."payload"->>'deliveryStatus') IS DISTINCT FROM c."deliveryStatus"
      OR (NEW."payload"->'sampleContentProvided') IS DISTINCT FROM to_jsonb(c."sampleContentProvided") THEN
      RAISE EXCEPTION 'Apple consumption dispatch requires current original buyer consent/evidence' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AppleConsumptionRequest_protect" BEFORE INSERT OR UPDATE OR DELETE ON "AppleConsumptionRequest" FOR EACH ROW EXECUTE FUNCTION "protectAppleConsumptionRequest"();

COMMIT;
