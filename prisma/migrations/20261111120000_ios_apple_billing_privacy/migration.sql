-- Separate signed App Store money/entitlements; preserve existing gateway records.
BEGIN;

-- AlterTable
ALTER TABLE "SubscriptionPeriod" ADD COLUMN     "appleTransactionId" TEXT,
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ALTER COLUMN "invoiceId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "aiConsentGrantedAt" TIMESTAMP(3),
ADD COLUMN     "aiConsentRevokedAt" TIMESTAMP(3),
ADD COLUMN     "aiConsentVersion" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WhatsAppCreditLot" ADD COLUMN     "appleTransactionId" TEXT,
ALTER COLUMN "invoiceId" DROP NOT NULL,
ALTER COLUMN "expiresAt" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AppleBillingAccount" (
    "organizationId" TEXT NOT NULL,
    "appAccountToken" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppleBillingAccount_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "ApplePurchaseIntent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "pendingSlot" TEXT,
    "scope" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'RENEW',
    "offerKey" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "appAccountToken" UUID NOT NULL,
    "offerSnapshot" JSONB NOT NULL,
    "purchaseSnapshot" JSONB,
    "storeId" TEXT,
    "termsVersion" TEXT NOT NULL,
    "termsUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "authorizedAt" TIMESTAMP(3),
    "lastIssue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplePurchaseIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppleSubscriptionChain" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "originalTransactionId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "appAccountToken" UUID NOT NULL,
    "initialIntentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "autoRenewEnabled" BOOLEAN,
    "expiresAt" TIMESTAMP(3),
    "graceExpiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastSignedAt" TIMESTAMP(3) NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingToken" TEXT,
    "processingUntil" TIMESTAMP(3),
    "lastIssue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppleSubscriptionChain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppleTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "intentId" TEXT,
    "transactionId" TEXT NOT NULL,
    "originalTransactionId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "appAccountToken" UUID NOT NULL,
    "productId" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "expiresDate" TIMESTAMP(3),
    "priceMillis" BIGINT,
    "currency" TEXT,
    "storefront" TEXT,
    "ownershipType" TEXT,
    "offerSnapshot" JSONB NOT NULL,
    "signedTransactionInfo" TEXT NOT NULL,
    "lastSignedAt" TIMESTAMP(3) NOT NULL,
    "revocationDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'REVIEW',
    "lastIssue" TEXT,
    "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingToken" TEXT,
    "processingUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppleTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppleTransactionObservation" (
    "digest" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "signedPayload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppleTransactionObservation_pkey" PRIMARY KEY ("digest")
);

-- CreateTable
CREATE TABLE "AppleServerNotification" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL,
    "subtype" TEXT,
    "signedPayload" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "processingToken" TEXT,
    "processingUntil" TIMESTAMP(3),
    "lastIssue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppleServerNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountErasureAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountErasureAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppleBillingAccount_appAccountToken_key" ON "AppleBillingAccount"("appAccountToken");

-- CreateIndex
CREATE UNIQUE INDEX "ApplePurchaseIntent_pendingSlot_key" ON "ApplePurchaseIntent"("pendingSlot");

-- CreateIndex
CREATE INDEX "ApplePurchaseIntent_status_expiresAt_idx" ON "ApplePurchaseIntent"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplePurchaseIntent_organizationId_idempotencyKey_key" ON "ApplePurchaseIntent"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ApplePurchaseIntent_id_organizationId_key" ON "ApplePurchaseIntent"("id", "organizationId");

-- CreateIndex
CREATE INDEX "AppleSubscriptionChain_nextCheckAt_processingUntil_idx" ON "AppleSubscriptionChain"("nextCheckAt", "processingUntil");

-- CreateIndex
CREATE INDEX "AppleSubscriptionChain_organizationId_expiresAt_idx" ON "AppleSubscriptionChain"("organizationId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppleSubscriptionChain_environment_originalTransactionId_key" ON "AppleSubscriptionChain"("environment", "originalTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "AppleSubscriptionChain_id_organizationId_key" ON "AppleSubscriptionChain"("id", "organizationId");

-- CreateIndex
CREATE INDEX "AppleTransaction_organizationId_purchaseDate_idx" ON "AppleTransaction"("organizationId", "purchaseDate");

-- CreateIndex
CREATE INDEX "AppleTransaction_status_nextCheckAt_idx" ON "AppleTransaction"("status", "nextCheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppleTransaction_environment_transactionId_key" ON "AppleTransaction"("environment", "transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "AppleTransaction_id_organizationId_key" ON "AppleTransaction"("id", "organizationId");

-- CreateIndex
CREATE INDEX "AppleServerNotification_status_nextAttemptAt_idx" ON "AppleServerNotification"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccountErasureAsset_url_key" ON "AccountErasureAsset"("url");

-- CreateIndex
CREATE INDEX "AccountErasureAsset_nextAttemptAt_idx" ON "AccountErasureAsset"("nextAttemptAt");

-- AddForeignKey
ALTER TABLE "SubscriptionPeriod" ADD CONSTRAINT "SubscriptionPeriod_appleTransactionId_organizationId_fkey" FOREIGN KEY ("appleTransactionId", "organizationId") REFERENCES "AppleTransaction"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCreditLot" ADD CONSTRAINT "WhatsAppCreditLot_appleTransactionId_organizationId_fkey" FOREIGN KEY ("appleTransactionId", "organizationId") REFERENCES "AppleTransaction"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppleBillingAccount" ADD CONSTRAINT "AppleBillingAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplePurchaseIntent" ADD CONSTRAINT "ApplePurchaseIntent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppleSubscriptionChain" ADD CONSTRAINT "AppleSubscriptionChain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppleSubscriptionChain" ADD CONSTRAINT "AppleSubscriptionChain_initialIntentId_organizationId_fkey" FOREIGN KEY ("initialIntentId", "organizationId") REFERENCES "ApplePurchaseIntent"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppleTransaction" ADD CONSTRAINT "AppleTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppleTransaction" ADD CONSTRAINT "AppleTransaction_intentId_organizationId_fkey" FOREIGN KEY ("intentId", "organizationId") REFERENCES "ApplePurchaseIntent"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppleTransactionObservation" ADD CONSTRAINT "AppleTransactionObservation_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "AppleTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "ApplePurchaseIntent" ADD CONSTRAINT "ApplePurchaseIntent_values_check" CHECK (
  "scope" IN ('SUBSCRIPTION','WHATSAPP_PACK') AND "action" IN ('RENEW','CHANGE') AND
  "environment" IN ('Production','Sandbox') AND "productType" IN ('AUTO_RENEWABLE','NON_RENEWING','CONSUMABLE') AND
  "status" IN ('PENDING','COMPLETED','CANCELED','EXPIRED','REVIEW') AND
  ("pendingSlot" IS NULL OR "pendingSlot" = "scope" || ':' || "organizationId") AND
  ("status" <> 'PENDING' OR "pendingSlot" IS NOT NULL) AND
  ("status" = 'PENDING' OR "pendingSlot" IS NULL) AND
  ("scope" = 'SUBSCRIPTION' OR ("productType" = 'CONSUMABLE' AND "action" = 'RENEW')) AND
  ("scope" <> 'SUBSCRIPTION' OR ("productType" <> 'CONSUMABLE' AND "purchaseSnapshot" IS NOT NULL)));
ALTER TABLE "AppleSubscriptionChain" ADD CONSTRAINT "AppleSubscriptionChain_environment_check" CHECK ("environment" IN ('Production','Sandbox'));
ALTER TABLE "AppleTransaction" ADD CONSTRAINT "AppleTransaction_values_check" CHECK (
  "environment" IN ('Production','Sandbox') AND "productType" IN ('AUTO_RENEWABLE','NON_RENEWING','CONSUMABLE') AND
  "status" IN ('REVIEW','GRANTED','REVOKED') AND quantity > 0 AND
  (("priceMillis" IS NULL) = (currency IS NULL)) AND ("priceMillis" IS NULL OR ("priceMillis" >= 0 AND currency ~ '^[A-Z]{3}$')) AND
  ("expiresDate" IS NULL OR "expiresDate" > "purchaseDate"));
ALTER TABLE "SubscriptionPeriod" ADD CONSTRAINT "SubscriptionPeriod_source_check" CHECK (
  ("invoiceId" IS NOT NULL)::integer + ("appleTransactionId" IS NOT NULL)::integer = 1 AND
  ("revokedAt" IS NULL OR "appleTransactionId" IS NOT NULL));
ALTER TABLE "WhatsAppCreditLot" ADD CONSTRAINT "WhatsAppCreditLot_source_check" CHECK (
  ("invoiceId" IS NOT NULL)::integer + ("appleTransactionId" IS NOT NULL)::integer = 1 AND
  (("appleTransactionId" IS NOT NULL AND "expiresAt" IS NULL) OR ("invoiceId" IS NOT NULL AND "expiresAt" IS NOT NULL)));

CREATE FUNCTION "protectAppleBillingAccount"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Apple organization account-token binding is immutable' USING ERRCODE = '23514';
END; $$;
CREATE TRIGGER "AppleBillingAccount_binding_guard" BEFORE UPDATE OR DELETE ON "AppleBillingAccount"
FOR EACH ROW EXECUTE FUNCTION "protectAppleBillingAccount"();

CREATE FUNCTION "protectAppleIntent"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account "AppleBillingAccount";
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Apple purchase intent is retained' USING ERRCODE = '23514'; END IF;
  SELECT * INTO account FROM "AppleBillingAccount" WHERE "organizationId" = NEW."organizationId";
  IF account."appAccountToken" IS DISTINCT FROM NEW."appAccountToken" THEN
    RAISE EXCEPTION 'Apple intent requires immutable organization account token' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    (to_jsonb(NEW) - ARRAY['pendingSlot','status','authorizedAt','lastIssue','updatedAt']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['pendingSlot','status','authorizedAt','lastIssue','updatedAt']) OR
    (OLD."authorizedAt" IS NOT NULL AND NEW."authorizedAt" IS DISTINCT FROM OLD."authorizedAt")) THEN
    RAISE EXCEPTION 'Apple purchase intent snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "ApplePurchaseIntent_snapshot_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ApplePurchaseIntent"
FOR EACH ROW EXECUTE FUNCTION "protectAppleIntent"();

CREATE FUNCTION "protectAppleChain"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE intent "ApplePurchaseIntent";
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Apple subscription binding is retained' USING ERRCODE = '23514'; END IF;
  SELECT * INTO intent FROM "ApplePurchaseIntent" WHERE id = NEW."initialIntentId";
  IF intent."organizationId" IS DISTINCT FROM NEW."organizationId" OR intent."appAccountToken" IS DISTINCT FROM NEW."appAccountToken" OR
    intent.environment IS DISTINCT FROM NEW.environment OR intent."productType" <> 'AUTO_RENEWABLE' THEN
    RAISE EXCEPTION 'Apple subscription requires its original organization intent' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND ROW(NEW.id, NEW."organizationId", NEW."originalTransactionId", NEW.environment, NEW."appAccountToken", NEW."initialIntentId", NEW."createdAt") IS DISTINCT FROM
    ROW(OLD.id, OLD."organizationId", OLD."originalTransactionId", OLD.environment, OLD."appAccountToken", OLD."initialIntentId", OLD."createdAt") THEN
    RAISE EXCEPTION 'Apple subscription original transaction binding is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "AppleSubscriptionChain_binding_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AppleSubscriptionChain"
FOR EACH ROW EXECUTE FUNCTION "protectAppleChain"();

CREATE FUNCTION "protectAppleTransaction"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account "AppleBillingAccount"; intent "ApplePurchaseIntent";
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Apple financial transaction is retained' USING ERRCODE = '23514'; END IF;
  SELECT * INTO account FROM "AppleBillingAccount" WHERE "organizationId" = NEW."organizationId";
  IF account."appAccountToken" IS DISTINCT FROM NEW."appAccountToken" THEN
    RAISE EXCEPTION 'Apple transaction requires its immutable organization token' USING ERRCODE = '23514';
  END IF;
  IF NEW."intentId" IS NOT NULL THEN
    SELECT * INTO intent FROM "ApplePurchaseIntent" WHERE id = NEW."intentId";
    IF intent."organizationId" IS DISTINCT FROM NEW."organizationId" OR intent."appAccountToken" IS DISTINCT FROM NEW."appAccountToken" OR
      intent.environment IS DISTINCT FROM NEW.environment OR intent."productId" IS DISTINCT FROM NEW."productId" OR
      intent."productType" IS DISTINCT FROM NEW."productType" OR intent."offerSnapshot" IS DISTINCT FROM NEW."offerSnapshot" THEN
      RAISE EXCEPTION 'Apple transaction differs from authorized purchase intent' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - ARRAY['lastSignedAt','revocationDate','status','lastIssue','nextCheckAt','processingToken','processingUntil','updatedAt']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['lastSignedAt','revocationDate','status','lastIssue','nextCheckAt','processingToken','processingUntil','updatedAt']) THEN
    RAISE EXCEPTION 'Apple transaction financial snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "AppleTransaction_snapshot_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AppleTransaction"
FOR EACH ROW EXECUTE FUNCTION "protectAppleTransaction"();

CREATE FUNCTION "protectAppleEvidence"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_TABLE_NAME = 'AppleTransactionObservation' THEN
    RAISE EXCEPTION 'Signed Apple evidence is retained and immutable' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','nextAttemptAt','attemptCount','processingToken','processingUntil','lastIssue','updatedAt']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','nextAttemptAt','attemptCount','processingToken','processingUntil','lastIssue','updatedAt']) THEN
    RAISE EXCEPTION 'Signed Apple notification snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "AppleServerNotification_evidence_guard" BEFORE UPDATE OR DELETE ON "AppleServerNotification"
FOR EACH ROW EXECUTE FUNCTION "protectAppleEvidence"();
CREATE TRIGGER "AppleTransactionObservation_evidence_guard" BEFORE UPDATE OR DELETE ON "AppleTransactionObservation"
FOR EACH ROW EXECUTE FUNCTION "protectAppleEvidence"();

CREATE OR REPLACE FUNCTION "validateSubscriptionPeriodPurchase"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE purchase JSONB; field TEXT; transaction "AppleTransaction"; intent "ApplePurchaseIntent";
BEGIN
  IF NEW."appleTransactionId" IS NOT NULL THEN
    SELECT * INTO transaction FROM "AppleTransaction" WHERE id = NEW."appleTransactionId";
    SELECT * INTO intent FROM "ApplePurchaseIntent" WHERE id = transaction."intentId";
    IF transaction."organizationId" IS DISTINCT FROM NEW."organizationId" OR transaction."productType" NOT IN ('AUTO_RENEWABLE','NON_RENEWING') OR
      intent."purchaseSnapshot" IS NULL OR intent."authorizedAt" IS NULL OR NEW."purchaseSnapshot" IS NULL OR transaction."revocationDate" IS NOT NULL THEN
      RAISE EXCEPTION 'Apple paid period requires its verified tenant-bound subscription transaction' USING ERRCODE = '23514';
    END IF;
    purchase := intent."purchaseSnapshot";
    IF transaction."productType" = 'AUTO_RENEWABLE' AND
      (NEW."startsAt" IS DISTINCT FROM transaction."purchaseDate" OR NEW."endsAt" IS DISTINCT FROM transaction."expiresDate") THEN
      RAISE EXCEPTION 'Auto-renewing Apple grant dates must match signed dates' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT "purchaseSnapshot" INTO purchase FROM "SubscriptionInvoice" WHERE id = NEW."invoiceId";
  END IF;
  IF purchase IS NULL THEN RETURN NEW; END IF;
  FOREACH field IN ARRAY ARRAY['plan','months','extras','amountMinor','monthlyMinor','discountBps','fullAmountMinor',
    'serviceValueMinor','creditMinor','catalogVersion','organizationId','entitlements'] LOOP
    IF NEW."purchaseSnapshot" IS NULL OR NEW."purchaseSnapshot"->field IS DISTINCT FROM purchase->field THEN
      RAISE EXCEPTION 'Subscription paid period requires its immutable source purchase snapshot' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF NEW."purchaseSnapshot"->>'plan' IS DISTINCT FROM NEW.plan::text OR
    NEW."purchaseSnapshot"->>'organizationId' IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'Subscription grant tenant/plan binding differs' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE FUNCTION "protectSubscriptionPeriodSource"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'revokedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'revokedAt') THEN
    RAISE EXCEPTION 'Subscription period source and financial grant are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "SubscriptionPeriod_source_guard" BEFORE UPDATE OR DELETE ON "SubscriptionPeriod"
FOR EACH ROW EXECUTE FUNCTION "protectSubscriptionPeriodSource"();

CREATE FUNCTION "protectWhatsAppCreditSource"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE transaction "AppleTransaction";
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Paid WhatsApp credit source is retained' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' AND ROW(NEW.id,NEW."organizationId",NEW."invoiceId",NEW."appleTransactionId",NEW.total,NEW."expiresAt",NEW."createdAt") IS DISTINCT FROM
    ROW(OLD.id,OLD."organizationId",OLD."invoiceId",OLD."appleTransactionId",OLD.total,OLD."expiresAt",OLD."createdAt") THEN
    RAISE EXCEPTION 'Paid WhatsApp credit source is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."appleTransactionId" IS NOT NULL THEN
    SELECT * INTO transaction FROM "AppleTransaction" WHERE id = NEW."appleTransactionId";
    IF transaction."organizationId" IS DISTINCT FROM NEW."organizationId" OR transaction."productType" <> 'CONSUMABLE' OR
      transaction."offerSnapshot"->>'kind' IS DISTINCT FROM 'WHATSAPP_PACK' OR NEW.total IS DISTINCT FROM (transaction."offerSnapshot"->>'messages')::integer THEN
      RAISE EXCEPTION 'Apple WhatsApp credits require their verified tenant-bound offer' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "WhatsAppCreditLot_source_guard" BEFORE INSERT OR UPDATE OR DELETE ON "WhatsAppCreditLot"
FOR EACH ROW EXECUTE FUNCTION "protectWhatsAppCreditSource"();

CREATE FUNCTION "protectDeletedUserIdentity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."deletedAt" IS NOT NULL AND (
    NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt" OR NEW."isActive" OR NEW."isOrgOwner" OR
    ROW(NEW.email,NEW.name,NEW."passwordHash",NEW.phone,NEW."jobTitle",NEW."organizationId",NEW.role,NEW."signupAttribution",NEW."emailVerifiedAt") IS DISTINCT FROM
    ROW(OLD.email,OLD.name,OLD."passwordHash",OLD.phone,OLD."jobTitle",OLD."organizationId",OLD.role,OLD."signupAttribution",OLD."emailVerifiedAt") OR
    NEW."aiConsentVersion" IS NOT NULL OR NEW."aiConsentGrantedAt" IS NOT NULL OR NEW."aiConsentRevokedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Deleted account identity cannot be restored' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "User_deleted_identity_guard" BEFORE UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION "protectDeletedUserIdentity"();

-- Refunded/superseded Apple grants never constrain independent paid access.
CREATE OR REPLACE FUNCTION "enforceSubscriptionCapacity"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org_id TEXT; contract "SubscriptionContract"; org "Organization";
        terms JSONB; effective JSONB; resource TEXT; capacity INTEGER; future_capacity INTEGER; used BIGINT;
BEGIN
  org_id := NEW."organizationId";
  IF org_id IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'Product' THEN
    IF NEW."isDeleted" OR (TG_OP = 'UPDATE' AND NOT OLD."isDeleted" AND OLD."organizationId" = org_id) THEN RETURN NEW; END IF;
    resource := 'maxProducts';
  ELSIF TG_TABLE_NAME = 'User' THEN
    IF NOT NEW."isActive" OR (TG_OP = 'UPDATE' AND OLD."isActive" AND OLD."organizationId" IS NOT DISTINCT FROM org_id) THEN RETURN NEW; END IF;
    resource := 'maxActiveUsers';
  ELSE
    IF TG_OP = 'UPDATE' AND OLD."organizationId" = org_id THEN RETURN NEW; END IF;
    resource := 'maxStores';
  END IF;
  SELECT * INTO contract FROM "SubscriptionContract" WHERE "organizationId" = org_id;
  IF contract."catalogVersion" IS DISTINCT FROM '2026-11' OR contract."lifetimeAccess" THEN RETURN NEW; END IF;
  SELECT * INTO org FROM "Organization" WHERE id = org_id FOR UPDATE;
  SELECT "purchaseSnapshot"->'entitlements' INTO effective FROM "SubscriptionPeriod"
    WHERE "revokedAt" IS NULL AND "organizationId" = org_id AND "startsAt" <= CURRENT_TIMESTAMP
    ORDER BY "startsAt" DESC, "createdAt" DESC, id DESC LIMIT 1;
  terms := COALESCE(effective, CASE WHEN org."subscriptionBillingMode" = 'SELF_SERVE' THEN contract."trialOffer"->'entitlements' END, contract."termsSnapshot"->'plans'->(CASE WHEN org.plan::text = 'PRO' THEN 'BUSINESS' ELSE org.plan::text END));
  capacity := (terms->'limits'->>resource)::INTEGER;
  IF capacity IS NULL OR capacity < 1 THEN
    RAISE EXCEPTION 'billingContractNeedsReview' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'Product' THEN
    SELECT COUNT(*) INTO used FROM "Product" WHERE "organizationId" = org_id AND NOT "isDeleted" AND id <> NEW.id;
  ELSIF TG_TABLE_NAME = 'User' THEN
    SELECT COUNT(*) INTO used FROM "User" WHERE "organizationId" = org_id AND "isActive" AND id <> NEW.id;
  ELSE
    SELECT COUNT(*) INTO used FROM "Store" WHERE "organizationId" = org_id AND id <> NEW.id;
  END IF;
  SELECT MIN((candidate->'limits'->>resource)::INTEGER) INTO future_capacity FROM (
    SELECT "purchaseSnapshot"->'entitlements' AS candidate FROM "SubscriptionPeriod"
      WHERE "revokedAt" IS NULL AND "organizationId" = org_id AND "startsAt" > CURRENT_TIMESTAMP
    UNION ALL
    SELECT "purchaseSnapshot"->'entitlements' AS candidate FROM "SubscriptionInvoice"
      WHERE "organizationId" = org_id AND "pendingSlot" = org_id AND status::text IN ('CREATING','PENDING','REVIEW')
    UNION ALL
    SELECT "purchaseSnapshot"->'entitlements' AS candidate FROM "ApplePurchaseIntent"
      WHERE "organizationId" = org_id AND scope = 'SUBSCRIPTION' AND status IN ('PENDING','REVIEW')
  ) choices;
  capacity := LEAST(capacity, COALESCE(future_capacity, capacity));
  IF used >= capacity THEN
    RAISE EXCEPTION 'subscriptionCapacityExceeded:%', resource USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;

-- Refunded/superseded Apple grants never constrain independent paid access.
CREATE OR REPLACE FUNCTION "assertSubscriptionFeatureConfiguration"(org_id TEXT, feature TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE contract "SubscriptionContract"; org "Organization"; effective JSONB;
BEGIN
  SELECT * INTO contract FROM "SubscriptionContract" WHERE "organizationId" = org_id;
  IF contract."catalogVersion" IS DISTINCT FROM '2026-11' OR contract."lifetimeAccess" THEN RETURN; END IF;
  SELECT * INTO org FROM "Organization" WHERE id = org_id FOR UPDATE;
  SELECT "purchaseSnapshot"->'entitlements' INTO effective FROM "SubscriptionPeriod"
    WHERE "revokedAt" IS NULL AND "organizationId" = org_id AND "startsAt" <= CURRENT_TIMESTAMP
    ORDER BY "startsAt" DESC, "createdAt" DESC, id DESC LIMIT 1;
  effective := COALESCE(effective, CASE WHEN org."subscriptionBillingMode" = 'SELF_SERVE' THEN contract."trialOffer"->'entitlements' END, contract."termsSnapshot"->'plans'->(CASE WHEN org.plan::text = 'PRO' THEN 'BUSINESS' ELSE org.plan::text END));
  IF NOT COALESCE((effective->'features'->>feature)::boolean, false) THEN
    RAISE EXCEPTION 'featureLockedPlan' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "SubscriptionPeriod" WHERE "revokedAt" IS NULL AND "organizationId" = org_id AND "startsAt" > CURRENT_TIMESTAMP
      AND NOT COALESCE(("purchaseSnapshot"->'entitlements'->'features'->>feature)::boolean, false)
  ) OR EXISTS (
    SELECT 1 FROM "SubscriptionInvoice" WHERE "organizationId" = org_id AND "pendingSlot" = org_id
      AND status::text IN ('CREATING','PENDING','REVIEW')
      AND NOT COALESCE(("purchaseSnapshot"->'entitlements'->'features'->>feature)::boolean, false)
  ) OR EXISTS (
    SELECT 1 FROM "ApplePurchaseIntent" WHERE "organizationId" = org_id AND scope = 'SUBSCRIPTION' AND status IN ('PENDING','REVIEW')
      AND NOT COALESCE(("purchaseSnapshot"->'entitlements'->'features'->>feature)::boolean, false)
  ) THEN
    RAISE EXCEPTION 'billingScheduledFeatureRestriction' USING ERRCODE = '23514';
  END IF;
END; $$;

-- Refunded/superseded Apple grants never constrain independent paid access.
CREATE OR REPLACE FUNCTION "enforceSubscriptionMarketplaceChannel"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contract "SubscriptionContract"; org "Organization"; channel TEXT; other TEXT; effective JSONB;
BEGIN
  IF NEW."apiTokenEncrypted" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO org FROM "Organization" WHERE id = NEW."orgId" FOR UPDATE;
  SELECT * INTO contract FROM "SubscriptionContract" WHERE "organizationId" = NEW."orgId";
  IF contract."catalogVersion" IS DISTINCT FROM '2026-11' OR contract."lifetimeAccess" THEN RETURN NEW; END IF;
  channel := CASE TG_TABLE_NAME WHEN 'MMarketIntegration' THEN 'MMARKET' WHEN 'BakaiStoreIntegration' THEN 'BAKAI' ELSE 'OMARKET' END;
  SELECT "purchaseSnapshot"->'entitlements' INTO effective FROM "SubscriptionPeriod"
    WHERE "revokedAt" IS NULL AND "organizationId" = NEW."orgId" AND "startsAt" <= CURRENT_TIMESTAMP
    ORDER BY "startsAt" DESC, "createdAt" DESC, id DESC LIMIT 1;
  effective := COALESCE(effective, contract."termsSnapshot"->'plans'->(CASE WHEN org.plan::text = 'PRO' THEN 'BUSINESS' ELSE org.plan::text END));
  IF COALESCE((effective->'features'->>'marketplaces')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'featureLockedPlan' USING ERRCODE = '23514';
  END IF;
  IF (TG_OP = 'INSERT' OR OLD."apiTokenEncrypted" IS NULL) AND (
    EXISTS (SELECT 1 FROM "SubscriptionPeriod" WHERE "revokedAt" IS NULL AND "organizationId" = NEW."orgId" AND "startsAt" > CURRENT_TIMESTAMP
      AND COALESCE(("purchaseSnapshot"->'entitlements'->'features'->>'marketplaces')::BOOLEAN, false) IS NOT TRUE)
    OR EXISTS (SELECT 1 FROM "SubscriptionInvoice" WHERE "organizationId" = NEW."orgId"
      AND status IN ('CREATING','PENDING','REVIEW') AND "purchaseSnapshot" IS NOT NULL
      AND COALESCE(("purchaseSnapshot"->'entitlements'->'features'->>'marketplaces')::BOOLEAN, false) IS NOT TRUE)
    OR EXISTS (SELECT 1 FROM "ApplePurchaseIntent" WHERE "organizationId" = NEW."orgId" AND scope = 'SUBSCRIPTION' AND status IN ('PENDING','REVIEW')
      AND NOT COALESCE(("purchaseSnapshot"->'entitlements'->'features'->>'marketplaces')::boolean, false))
  ) THEN
    RAISE EXCEPTION 'billingScheduledFeatureConflict' USING ERRCODE = '23514';
  END IF;
  FOREACH other IN ARRAY ARRAY['MMARKET','BAKAI','OMARKET'] LOOP
    IF other <> channel AND "subscriptionMarketplaceChannelBusy"(NEW."orgId", other) THEN
      RAISE EXCEPTION 'billingMarketplaceChannelInUse' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF contract."selectedMarketplaceChannel" IS NOT NULL AND contract."selectedMarketplaceChannel" <> channel
    AND "subscriptionMarketplaceChannelBusy"(NEW."orgId", contract."selectedMarketplaceChannel") THEN
    RAISE EXCEPTION 'billingMarketplaceChannelInUse' USING ERRCODE = '23514';
  END IF;
  UPDATE "SubscriptionContract" SET "selectedMarketplaceChannel" = channel WHERE "organizationId" = NEW."orgId";
  RETURN NEW;
END; $$;

COMMIT;
