-- Temporary current-term Apple upgrades. Existing grants are not reinterpreted.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE "SubscriptionPeriod" ADD COLUMN "parentPeriodId" TEXT, ADD COLUMN "dependencyRevokedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "SubscriptionPeriod_id_organizationId_key" ON "SubscriptionPeriod"(id,"organizationId");
CREATE INDEX "SubscriptionPeriod_parentPeriodId_organizationId_idx" ON "SubscriptionPeriod"("parentPeriodId","organizationId");
ALTER TABLE "SubscriptionPeriod" ADD CONSTRAINT "SubscriptionPeriod_parentPeriodId_organizationId_fkey"
 FOREIGN KEY ("parentPeriodId","organizationId") REFERENCES "SubscriptionPeriod"(id,"organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "SubscriptionPeriod" ADD CONSTRAINT "SubscriptionPeriod_temporary_parent_check"
 CHECK (("parentPeriodId" IS NULL AND "dependencyRevokedAt" IS NULL) OR ("parentPeriodId" IS NOT NULL AND "appleTransactionId" IS NOT NULL AND "invoiceId" IS NULL AND "parentPeriodId"<>id));
ALTER TABLE "ApplePurchaseIntent" ADD COLUMN "purchaseAppAccountToken" UUID;
CREATE UNIQUE INDEX "ApplePurchaseIntent_purchaseAppAccountToken_key" ON "ApplePurchaseIntent"("purchaseAppAccountToken");
ALTER TABLE "AppleTransaction" ADD COLUMN "storefrontId" TEXT;

CREATE FUNCTION "subscriptionPeriodDependencyInvalidAt"(parent_id TEXT, org_id TEXT) RETURNS TIMESTAMP(3) LANGUAGE sql STABLE AS $$
 WITH RECURSIVE ancestors AS (
  SELECT id,"parentPeriodId","revokedAt",1 AS depth FROM "SubscriptionPeriod" WHERE id=parent_id AND "organizationId"=org_id
  UNION ALL SELECT p.id,p."parentPeriodId",p."revokedAt",a.depth+1 FROM "SubscriptionPeriod" p JOIN ancestors a ON p.id=a."parentPeriodId"
    WHERE p."organizationId"=org_id AND a.depth<64
 ) SELECT max("revokedAt") FROM ancestors;
$$;
CREATE FUNCTION "validateAppleAccountTokenNamespace"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW."appAccountToken"::text,517));
 IF EXISTS(SELECT 1 FROM "ApplePurchaseIntent" WHERE "purchaseAppAccountToken"=NEW."appAccountToken") THEN
   RAISE EXCEPTION 'Apple token is already bound to a purchase quote' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "AppleBillingAccount_token_namespace_guard" BEFORE INSERT ON "AppleBillingAccount" FOR EACH ROW EXECUTE FUNCTION "validateAppleAccountTokenNamespace"();
CREATE OR REPLACE FUNCTION "protectAppleIntent"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account "AppleBillingAccount";
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Apple purchase intent is retained' USING ERRCODE = '23514'; END IF;
  SELECT * INTO account FROM "AppleBillingAccount" WHERE "organizationId" = NEW."organizationId";
  IF account."appAccountToken" IS DISTINCT FROM NEW."appAccountToken" THEN
    RAISE EXCEPTION 'Apple intent requires immutable organization account token' USING ERRCODE = '23514';
  END IF;
  IF NEW."purchaseAppAccountToken" IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW."purchaseAppAccountToken"::text,517));
    IF NEW.scope<>'SUBSCRIPTION' OR NEW.action<>'CHANGE' OR NEW."productType"<>'NON_RENEWING' OR
       jsonb_typeof(NEW."purchaseSnapshot"->'appleTemporaryUpgrade') IS DISTINCT FROM 'object' OR
       NEW."purchaseSnapshot"->>'kind' IS DISTINCT FROM 'UPGRADE' OR
       EXISTS(SELECT 1 FROM "AppleBillingAccount" WHERE "appAccountToken"=NEW."purchaseAppAccountToken") THEN
      RAISE EXCEPTION 'Temporary upgrade requires its own immutable quote token' USING ERRCODE='23514';
    END IF;
  ELSIF NEW."purchaseSnapshot"->'appleTemporaryUpgrade' IS NOT NULL THEN
    RAISE EXCEPTION 'Temporary upgrade requires an exact purchase token' USING ERRCODE='23514';
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

CREATE OR REPLACE FUNCTION "protectAppleTransaction"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account "AppleBillingAccount"; intent "ApplePurchaseIntent";
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Apple financial transaction is retained' USING ERRCODE = '23514'; END IF;
  SELECT * INTO account FROM "AppleBillingAccount" WHERE "organizationId" = NEW."organizationId";
  IF account."appAccountToken" IS DISTINCT FROM NEW."appAccountToken" AND NOT EXISTS (SELECT 1 FROM "ApplePurchaseIntent" WHERE "organizationId"=NEW."organizationId" AND "purchaseAppAccountToken"=NEW."appAccountToken") THEN
    RAISE EXCEPTION 'Apple transaction requires its immutable organization token' USING ERRCODE = '23514';
  END IF;
  IF NEW."intentId" IS NOT NULL THEN
    SELECT * INTO intent FROM "ApplePurchaseIntent" WHERE id = NEW."intentId";
    IF intent."organizationId" IS DISTINCT FROM NEW."organizationId" OR COALESCE(intent."purchaseAppAccountToken",intent."appAccountToken") IS DISTINCT FROM NEW."appAccountToken" OR
      intent.environment IS DISTINCT FROM NEW.environment OR intent."productId" IS DISTINCT FROM NEW."productId" OR
      intent."productType" IS DISTINCT FROM NEW."productType" OR intent."offerSnapshot" IS DISTINCT FROM NEW."offerSnapshot" THEN
      RAISE EXCEPTION 'Apple transaction differs from authorized purchase intent' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."supersededAt" IS NOT NULL AND NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt" THEN
    RAISE EXCEPTION 'Superseded Apple coverage cannot be resurrected' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."intentId" IS NULL AND OLD.status = 'REVIEW' AND NEW."intentId" IS NOT NULL THEN
    -- A delayed approved SKU mapping can bind a retained unknown receipt once;
    -- financial identity, token, currency, and original transaction stay frozen.
    OLD."intentId" := NEW."intentId";
    OLD."offerSnapshot" := NEW."offerSnapshot";
  END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - ARRAY['lastSignedAt','revocationDate','supersededAt','status','lastIssue','nextCheckAt','processingToken','processingUntil','updatedAt']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['lastSignedAt','revocationDate','supersededAt','status','lastIssue','nextCheckAt','processingToken','processingUntil','updatedAt']) THEN
    RAISE EXCEPTION 'Apple transaction financial snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;

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
  IF NEW."parentPeriodId" IS NOT NULL THEN
    IF NEW."appleTransactionId" IS NULL OR transaction."productType"<>'NON_RENEWING' OR intent."purchaseAppAccountToken" IS NULL OR
       intent.action<>'CHANGE' OR purchase->>'kind' IS DISTINCT FROM 'UPGRADE' OR purchase->>'sourcePeriodId' IS DISTINCT FROM NEW."parentPeriodId" OR
       jsonb_typeof(purchase->'appleTemporaryUpgrade') IS DISTINCT FROM 'object' OR
       transaction."appAccountToken" IS DISTINCT FROM intent."purchaseAppAccountToken" OR transaction.quantity<>1 OR
       transaction."priceMillis" IS DISTINCT FROM (purchase->'appleTemporaryUpgrade'->'price'->>'priceMillis')::bigint OR
       transaction.currency IS DISTINCT FROM purchase->'appleTemporaryUpgrade'->'price'->>'currency' OR
       transaction."storefrontId" IS DISTINCT FROM purchase->'appleTemporaryUpgrade'->'price'->>'storefrontId' OR
       NEW."startsAt" IS DISTINCT FROM ((purchase->>'startsAt')::timestamptz AT TIME ZONE 'UTC') OR
       NEW."endsAt" IS DISTINCT FROM ((purchase->>'endsAt')::timestamptz AT TIME ZONE 'UTC') OR
       NOT EXISTS(SELECT 1 FROM "SubscriptionPeriod" p WHERE p.id=NEW."parentPeriodId" AND p."organizationId"=NEW."organizationId"
         AND p."revokedAt" IS NULL AND p."dependencyRevokedAt" IS NULL AND p."startsAt"<=NEW."startsAt" AND p."endsAt"=NEW."endsAt" AND NEW."startsAt"<p."endsAt") THEN
       RAISE EXCEPTION 'Temporary upgrade requires its verified parent and frozen price' USING ERRCODE='23514';
    END IF;
    FOREACH field IN ARRAY ARRAY['sourcePeriodId','startsAt','endsAt','cycleStartsAt','cycleEndsAt','anchorDay','expectedPlan','expectedPeriodEnd','appleTemporaryUpgrade'] LOOP
      IF NEW."purchaseSnapshot"->field IS DISTINCT FROM purchase->field THEN
        RAISE EXCEPTION 'Temporary upgrade interval and usage anchor are frozen by its authorization' USING ERRCODE='23514';
      END IF;
    END LOOP;
    IF EXISTS(WITH RECURSIVE ancestors AS (
      SELECT p.*,1 AS depth FROM "SubscriptionPeriod" p WHERE p.id=NEW."parentPeriodId"
      UNION ALL SELECT p.*,a.depth+1 FROM "SubscriptionPeriod" p JOIN ancestors a ON p.id=a."parentPeriodId" WHERE a.depth<64
    ) SELECT 1 FROM ancestors a LEFT JOIN "AppleTransaction" t ON t.id=a."appleTransactionId" LEFT JOIN "SubscriptionInvoice" i ON i.id=a."invoiceId"
      WHERE a.depth>=64 OR a."organizationId"<>NEW."organizationId" OR a."revokedAt" IS NOT NULL OR a."dependencyRevokedAt" IS NOT NULL OR
      (a."parentPeriodId" IS NULL AND ((a."appleTransactionId" IS NOT NULL AND t."productType"<>'NON_RENEWING') OR (a."invoiceId" IS NOT NULL AND (i.provider<>'GOPAY' OR i.status<>'PAID'))))) THEN
      RAISE EXCEPTION 'Temporary upgrade funding chain is invalid' USING ERRCODE='23514';
    END IF;
  ELSIF intent."purchaseAppAccountToken" IS NOT NULL OR purchase->'appleTemporaryUpgrade' IS NOT NULL THEN
    RAISE EXCEPTION 'Temporary upgrade cannot become standalone coverage' USING ERRCODE='23514';
  END IF;
  IF purchase IS NULL THEN RETURN NEW; END IF;
  FOREACH field IN ARRAY ARRAY['plan','months','extras','amountMinor','monthlyMinor','discountBps','fullAmountMinor',
    'serviceValueMinor','creditMinor','catalogVersion','organizationId','entitlements','appleTemporaryUpgrade'] LOOP
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

CREATE OR REPLACE FUNCTION "protectSubscriptionPeriodSource"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - ARRAY['revokedAt','dependencyRevokedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['revokedAt','dependencyRevokedAt']) THEN
    RAISE EXCEPTION 'Subscription period source and financial grant are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."revokedAt" IS NULL AND NEW."appleTransactionId" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "AppleTransaction" WHERE id = NEW."appleTransactionId" AND "supersededAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Superseded Apple period cannot be restored' USING ERRCODE = '23514';
  END IF;
  IF NEW."dependencyRevokedAt" IS DISTINCT FROM "subscriptionPeriodDependencyInvalidAt"(NEW."parentPeriodId",NEW."organizationId") THEN
    RAISE EXCEPTION 'Temporary funding state follows its immutable parent' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;


CREATE FUNCTION "refreshSubscriptionPeriodDependencies"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF pg_trigger_depth()>1 THEN RETURN NEW; END IF;
 UPDATE "SubscriptionPeriod" p SET "dependencyRevokedAt"="subscriptionPeriodDependencyInvalidAt"(p."parentPeriodId",p."organizationId")
  WHERE p."organizationId"=NEW."organizationId" AND p."parentPeriodId" IS NOT NULL AND p."dependencyRevokedAt" IS DISTINCT FROM "subscriptionPeriodDependencyInvalidAt"(p."parentPeriodId",p."organizationId");
 -- Only unserved dependent value becomes review. Served expired history remains history.
 UPDATE "AppleTransaction" t SET status='REVIEW',"lastIssue"='appleTemporaryUpgradeDependencyRevoked',"nextCheckAt"=CURRENT_TIMESTAMP
  FROM "SubscriptionPeriod" p WHERE p."appleTransactionId"=t.id AND p."organizationId"=NEW."organizationId" AND p."parentPeriodId" IS NOT NULL
    AND p."dependencyRevokedAt" IS NOT NULL AND p."revokedAt" IS NULL AND p."endsAt">CURRENT_TIMESTAMP
    AND t.status='GRANTED' AND t."revocationDate" IS NULL AND t."supersededAt" IS NULL;
 UPDATE "AppleTransaction" t SET status='GRANTED',"lastIssue"=NULL FROM "SubscriptionPeriod" p
  WHERE p."appleTransactionId"=t.id AND p."organizationId"=NEW."organizationId" AND p."parentPeriodId" IS NOT NULL
    AND p."dependencyRevokedAt" IS NULL AND p."revokedAt" IS NULL AND p."endsAt">CURRENT_TIMESTAMP
    AND t.status='REVIEW' AND t."lastIssue"='appleTemporaryUpgradeDependencyRevoked' AND t."revocationDate" IS NULL AND t."supersededAt" IS NULL;
 UPDATE "ApplePurchaseIntent" i SET status=CASE WHEN EXISTS(SELECT 1 FROM "AppleTransaction" t WHERE t."intentId"=i.id AND t.status='REVIEW') THEN 'REVIEW' ELSE 'COMPLETED' END,
   "pendingSlot"=NULL,"lastIssue"=(SELECT t."lastIssue" FROM "AppleTransaction" t WHERE t."intentId"=i.id AND t.status='REVIEW' ORDER BY t."createdAt" LIMIT 1)
  WHERE i.id IN (SELECT t."intentId" FROM "AppleTransaction" t JOIN "SubscriptionPeriod" p ON p."appleTransactionId"=t.id
    WHERE p."organizationId"=NEW."organizationId" AND p."parentPeriodId" IS NOT NULL);
 RETURN NEW;
END; $$;
CREATE TRIGGER "SubscriptionPeriod_dependency_refresh" AFTER INSERT OR UPDATE OF "revokedAt","dependencyRevokedAt" ON "SubscriptionPeriod"
 FOR EACH ROW EXECUTE FUNCTION "refreshSubscriptionPeriodDependencies"();


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
    WHERE "revokedAt" IS NULL AND "dependencyRevokedAt" IS NULL AND ("parentPeriodId" IS NULL OR "endsAt">CURRENT_TIMESTAMP) AND "organizationId" = org_id AND "startsAt" <= CURRENT_TIMESTAMP
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
      WHERE "revokedAt" IS NULL AND "dependencyRevokedAt" IS NULL AND ("parentPeriodId" IS NULL OR "endsAt">CURRENT_TIMESTAMP) AND "organizationId" = org_id AND "startsAt" > CURRENT_TIMESTAMP
    UNION ALL
    SELECT "purchaseSnapshot"->'entitlements' AS candidate FROM "SubscriptionInvoice"
      WHERE "organizationId" = org_id AND "pendingSlot" = org_id AND status::text IN ('CREATING','PENDING','REVIEW')
    UNION ALL
    SELECT "purchaseSnapshot"->'entitlements' AS candidate FROM "ApplePurchaseIntent"
      WHERE "organizationId" = org_id AND scope = 'SUBSCRIPTION' AND status IN ('PENDING','REVIEW')
    UNION ALL
    SELECT "pendingChangeOffer"->'entitlements' AS candidate FROM "AppleSubscriptionChain"
      WHERE "organizationId" = org_id AND "pendingChangeOffer" IS NOT NULL AND "autoRenewEnabled" IS TRUE
  ) choices;
  capacity := LEAST(capacity, COALESCE(future_capacity, capacity));
  IF used >= capacity THEN
    RAISE EXCEPTION 'subscriptionCapacityExceeded:%', resource USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "assertSubscriptionFeatureConfiguration"(org_id TEXT, feature TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE contract "SubscriptionContract"; org "Organization"; effective JSONB;
BEGIN
  SELECT * INTO contract FROM "SubscriptionContract" WHERE "organizationId" = org_id;
  IF contract."catalogVersion" IS DISTINCT FROM '2026-11' OR contract."lifetimeAccess" THEN RETURN; END IF;
  SELECT * INTO org FROM "Organization" WHERE id = org_id FOR UPDATE;
  SELECT "purchaseSnapshot"->'entitlements' INTO effective FROM "SubscriptionPeriod"
    WHERE "revokedAt" IS NULL AND "dependencyRevokedAt" IS NULL AND ("parentPeriodId" IS NULL OR "endsAt">CURRENT_TIMESTAMP) AND "organizationId" = org_id AND "startsAt" <= CURRENT_TIMESTAMP
    ORDER BY "startsAt" DESC, "createdAt" DESC, id DESC LIMIT 1;
  effective := COALESCE(effective, CASE WHEN org."subscriptionBillingMode" = 'SELF_SERVE' THEN contract."trialOffer"->'entitlements' END, contract."termsSnapshot"->'plans'->(CASE WHEN org.plan::text = 'PRO' THEN 'BUSINESS' ELSE org.plan::text END));
  IF NOT COALESCE((effective->'features'->>feature)::boolean, false) THEN
    RAISE EXCEPTION 'featureLockedPlan' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "SubscriptionPeriod" WHERE "revokedAt" IS NULL AND "dependencyRevokedAt" IS NULL AND ("parentPeriodId" IS NULL OR "endsAt">CURRENT_TIMESTAMP) AND "organizationId" = org_id AND "startsAt" > CURRENT_TIMESTAMP
      AND NOT COALESCE(("purchaseSnapshot"->'entitlements'->'features'->>feature)::boolean, false)
  ) OR EXISTS (
    SELECT 1 FROM "SubscriptionInvoice" WHERE "organizationId" = org_id AND "pendingSlot" = org_id
      AND status::text IN ('CREATING','PENDING','REVIEW')
      AND NOT COALESCE(("purchaseSnapshot"->'entitlements'->'features'->>feature)::boolean, false)
  ) OR EXISTS (
    SELECT 1 FROM "ApplePurchaseIntent" WHERE "organizationId" = org_id AND scope = 'SUBSCRIPTION' AND status IN ('PENDING','REVIEW')
      AND NOT COALESCE(("purchaseSnapshot"->'entitlements'->'features'->>feature)::boolean, false)
  ) OR EXISTS (
    SELECT 1 FROM "AppleSubscriptionChain" WHERE "organizationId" = org_id AND "pendingChangeOffer" IS NOT NULL AND "autoRenewEnabled" IS TRUE
      AND NOT COALESCE(("pendingChangeOffer"->'entitlements'->'features'->>feature)::boolean, false)
  ) THEN
    RAISE EXCEPTION 'billingScheduledFeatureRestriction' USING ERRCODE = '23514';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION "enforceSubscriptionMarketplaceChannel"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contract "SubscriptionContract"; org "Organization"; channel TEXT; other TEXT; effective JSONB;
BEGIN
  IF NEW."apiTokenEncrypted" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO org FROM "Organization" WHERE id = NEW."orgId" FOR UPDATE;
  SELECT * INTO contract FROM "SubscriptionContract" WHERE "organizationId" = NEW."orgId";
  IF contract."catalogVersion" IS DISTINCT FROM '2026-11' OR contract."lifetimeAccess" THEN RETURN NEW; END IF;
  channel := CASE TG_TABLE_NAME WHEN 'MMarketIntegration' THEN 'MMARKET' WHEN 'BakaiStoreIntegration' THEN 'BAKAI' ELSE 'OMARKET' END;
  SELECT "purchaseSnapshot"->'entitlements' INTO effective FROM "SubscriptionPeriod"
    WHERE "revokedAt" IS NULL AND "dependencyRevokedAt" IS NULL AND ("parentPeriodId" IS NULL OR "endsAt">CURRENT_TIMESTAMP) AND "organizationId" = NEW."orgId" AND "startsAt" <= CURRENT_TIMESTAMP
    ORDER BY "startsAt" DESC, "createdAt" DESC, id DESC LIMIT 1;
  effective := COALESCE(effective, contract."termsSnapshot"->'plans'->(CASE WHEN org.plan::text = 'PRO' THEN 'BUSINESS' ELSE org.plan::text END));
  IF COALESCE((effective->'features'->>'marketplaces')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'featureLockedPlan' USING ERRCODE = '23514';
  END IF;
  IF (TG_OP = 'INSERT' OR OLD."apiTokenEncrypted" IS NULL) AND (
    EXISTS (SELECT 1 FROM "SubscriptionPeriod" WHERE "revokedAt" IS NULL AND "dependencyRevokedAt" IS NULL AND ("parentPeriodId" IS NULL OR "endsAt">CURRENT_TIMESTAMP) AND "organizationId" = NEW."orgId" AND "startsAt" > CURRENT_TIMESTAMP
      AND COALESCE(("purchaseSnapshot"->'entitlements'->'features'->>'marketplaces')::BOOLEAN, false) IS NOT TRUE)
    OR EXISTS (SELECT 1 FROM "SubscriptionInvoice" WHERE "organizationId" = NEW."orgId"
      AND status IN ('CREATING','PENDING','REVIEW') AND "purchaseSnapshot" IS NOT NULL
      AND COALESCE(("purchaseSnapshot"->'entitlements'->'features'->>'marketplaces')::BOOLEAN, false) IS NOT TRUE)
    OR EXISTS (SELECT 1 FROM "ApplePurchaseIntent" WHERE "organizationId" = NEW."orgId" AND scope = 'SUBSCRIPTION' AND status IN ('PENDING','REVIEW')
      AND NOT COALESCE(("purchaseSnapshot"->'entitlements'->'features'->>'marketplaces')::boolean, false))
    OR EXISTS (SELECT 1 FROM "AppleSubscriptionChain" WHERE "organizationId" = NEW."orgId" AND "pendingChangeOffer" IS NOT NULL AND "autoRenewEnabled" IS TRUE
      AND NOT COALESCE(("pendingChangeOffer"->'entitlements'->'features'->>'marketplaces')::boolean, false))
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
