-- Sticky same-chain replacement and durable signed future preferences.
-- Additive follow-up: do not change the checksum of the already applied iOS migration.
BEGIN;
ALTER TABLE "AppleTransaction" ADD COLUMN "supersededAt" TIMESTAMP(3);
ALTER TABLE "AppleSubscriptionChain" ADD COLUMN "pendingProductId" TEXT, ADD COLUMN "pendingChangeOffer" JSONB;
ALTER TABLE "AppleTransaction" ADD CONSTRAINT "AppleTransaction_superseded_check"
  CHECK ("supersededAt" IS NULL OR ("productType" = 'AUTO_RENEWABLE' AND status = 'REVOKED'));
ALTER TABLE "AppleSubscriptionChain" ADD CONSTRAINT "AppleSubscriptionChain_pending_offer_check"
  CHECK ("pendingChangeOffer" IS NULL OR COALESCE(("pendingProductId" IS NOT NULL AND
    "pendingChangeOffer"->>'kind' = 'SUBSCRIPTION' AND jsonb_typeof("pendingChangeOffer"->'entitlements') = 'object'), false));

CREATE OR REPLACE FUNCTION "protectAppleTransaction"() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE OR REPLACE FUNCTION "protectSubscriptionPeriodSource"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'revokedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'revokedAt') THEN
    RAISE EXCEPTION 'Subscription period source and financial grant are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."revokedAt" IS NULL AND NEW."appleTransactionId" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "AppleTransaction" WHERE id = NEW."appleTransactionId" AND "supersededAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Superseded Apple period cannot be restored' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;

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
