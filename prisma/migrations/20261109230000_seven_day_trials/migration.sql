BEGIN;
-- Additive, opt-in policy for new registrations only. No existing organization,
-- contract, end date, payment, inventory record or lifetime grant is rewritten.
ALTER TABLE "SubscriptionContract" ADD COLUMN "trialOffer" JSONB;
ALTER TABLE "SubscriptionContract" ADD CONSTRAINT "SubscriptionContract_trial_offer_check" CHECK (
  "trialOffer" IS NULL OR COALESCE((
    "catalogVersion" = '2026-11' AND NOT "lifetimeAccess" AND
    jsonb_typeof("trialOffer") = 'object' AND
    "trialOffer"->>'version' = '1' AND "trialOffer"->>'days' = '7' AND
    "trialOffer"->>'previewPlan' = 'ENTERPRISE' AND
    jsonb_typeof("trialOffer"->'entitlements') = 'object' AND
    "trialOffer"->'entitlements'->>'code' = 'ENTERPRISE' AND
    "trialOffer"->'entitlements'->'limits'->>'maxStores' = '1' AND
    "trialOffer"->'entitlements'->'limits'->>'maxProducts' = '1000' AND
    "trialOffer"->'entitlements'->'limits'->>'maxActiveUsers' = '2'
  ), false)
);
CREATE FUNCTION "protectTrialOffer"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."trialOffer" IS DISTINCT FROM OLD."trialOffer" THEN
    RAISE EXCEPTION 'Trial offer is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "SubscriptionContract_trial_offer_guard" BEFORE UPDATE ON "SubscriptionContract"
 FOR EACH ROW EXECUTE FUNCTION "protectTrialOffer"();

-- Database enforcement uses the same frozen preview as the application. A paid
-- period supersedes it; pending lower-tier purchases retain their safeguards.
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
    WHERE "organizationId" = org_id AND "startsAt" <= CURRENT_TIMESTAMP
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
      WHERE "organizationId" = org_id AND "startsAt" > CURRENT_TIMESTAMP
    UNION ALL
    SELECT "purchaseSnapshot"->'entitlements' AS candidate FROM "SubscriptionInvoice"
      WHERE "organizationId" = org_id AND "pendingSlot" = org_id AND status::text IN ('CREATING','PENDING','REVIEW')
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
    WHERE "organizationId" = org_id AND "startsAt" <= CURRENT_TIMESTAMP
    ORDER BY "startsAt" DESC, "createdAt" DESC, id DESC LIMIT 1;
  effective := COALESCE(effective, CASE WHEN org."subscriptionBillingMode" = 'SELF_SERVE' THEN contract."trialOffer"->'entitlements' END, contract."termsSnapshot"->'plans'->(CASE WHEN org.plan::text = 'PRO' THEN 'BUSINESS' ELSE org.plan::text END));
  IF NOT COALESCE((effective->'features'->>feature)::boolean, false) THEN
    RAISE EXCEPTION 'featureLockedPlan' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "SubscriptionPeriod" WHERE "organizationId" = org_id AND "startsAt" > CURRENT_TIMESTAMP
      AND NOT COALESCE(("purchaseSnapshot"->'entitlements'->'features'->>feature)::boolean, false)
  ) OR EXISTS (
    SELECT 1 FROM "SubscriptionInvoice" WHERE "organizationId" = org_id AND "pendingSlot" = org_id
      AND status::text IN ('CREATING','PENDING','REVIEW')
      AND NOT COALESCE(("purchaseSnapshot"->'entitlements'->'features'->>feature)::boolean, false)
  ) THEN
    RAISE EXCEPTION 'billingScheduledFeatureRestriction' USING ERRCODE = '23514';
  END IF;
END; $$;


COMMIT;
