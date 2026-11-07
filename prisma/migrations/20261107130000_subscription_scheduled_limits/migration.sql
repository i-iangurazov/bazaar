BEGIN;
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
  terms := COALESCE(effective, contract."termsSnapshot"->'plans'->(CASE WHEN org.plan::text = 'PRO' THEN 'BUSINESS' ELSE org.plan::text END));
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

-- A requested downgrade cannot be made incompatible after the quotation or
-- while a bank payment is in flight. The same organization row lock serializes
-- checkout, capacity and configuration writes.
CREATE FUNCTION "assertSubscriptionFeatureConfiguration"(org_id TEXT, feature TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE contract "SubscriptionContract"; org "Organization"; effective JSONB;
BEGIN
  SELECT * INTO contract FROM "SubscriptionContract" WHERE "organizationId" = org_id;
  IF contract."catalogVersion" IS DISTINCT FROM '2026-11' OR contract."lifetimeAccess" THEN RETURN; END IF;
  SELECT * INTO org FROM "Organization" WHERE id = org_id FOR UPDATE;
  SELECT "purchaseSnapshot"->'entitlements' INTO effective FROM "SubscriptionPeriod"
    WHERE "organizationId" = org_id AND "startsAt" <= CURRENT_TIMESTAMP
    ORDER BY "startsAt" DESC, "createdAt" DESC, id DESC LIMIT 1;
  effective := COALESCE(effective, contract."termsSnapshot"->'plans'->(CASE WHEN org.plan::text = 'PRO' THEN 'BUSINESS' ELSE org.plan::text END));
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

CREATE FUNCTION "enforceSubscriptionFeatureConfiguration"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE feature TEXT;
BEGIN
  IF TG_TABLE_NAME = 'Store' THEN
    IF NOT NEW."trackExpiryLots" OR (TG_OP = 'UPDATE' AND OLD."trackExpiryLots") THEN RETURN NEW; END IF;
    feature := 'expiryLots';
  ELSIF TG_TABLE_NAME = 'LoyaltyProgram' THEN
    IF NOT NEW.enabled OR (TG_OP = 'UPDATE' AND OLD.enabled) THEN RETURN NEW; END IF;
    feature := 'loyalty';
  ELSIF TG_TABLE_NAME = 'Product' THEN
    IF NOT NEW."isBundle" OR NEW."isDeleted" OR
      (TG_OP = 'UPDATE' AND OLD."isBundle" AND NOT OLD."isDeleted") THEN RETURN NEW; END IF;
    feature := 'bundles';
  ELSIF TG_TABLE_NAME = 'ProductBundleComponent' THEN
    feature := 'bundles';
  ELSIF TG_TABLE_NAME = 'EmailAutomation' THEN
    IF NEW.status::text <> 'ACTIVE' OR (TG_OP = 'UPDATE' AND OLD.status::text = 'ACTIVE') THEN RETURN NEW; END IF;
    feature := 'marketingAutomation';
  ELSE
    IF NEW."archivedAt" IS NOT NULL OR (TG_OP = 'UPDATE' AND OLD."archivedAt" IS NULL) THEN RETURN NEW; END IF;
    feature := 'ownSender';
  END IF;
  PERFORM "assertSubscriptionFeatureConfiguration"(NEW."organizationId", feature);
  RETURN NEW;
END; $$;
CREATE TRIGGER "Store_subscription_feature" BEFORE INSERT OR UPDATE OF "trackExpiryLots" ON "Store"
 FOR EACH ROW EXECUTE FUNCTION "enforceSubscriptionFeatureConfiguration"();
CREATE TRIGGER "LoyaltyProgram_subscription_feature" BEFORE INSERT OR UPDATE OF enabled ON "LoyaltyProgram"
 FOR EACH ROW EXECUTE FUNCTION "enforceSubscriptionFeatureConfiguration"();
CREATE TRIGGER "Product_bundle_subscription_feature" BEFORE INSERT OR UPDATE OF "isBundle", "isDeleted" ON "Product"
 FOR EACH ROW EXECUTE FUNCTION "enforceSubscriptionFeatureConfiguration"();
CREATE TRIGGER "BundleComponent_subscription_feature" BEFORE INSERT ON "ProductBundleComponent"
 FOR EACH ROW EXECUTE FUNCTION "enforceSubscriptionFeatureConfiguration"();
CREATE TRIGGER "EmailAutomation_subscription_feature" BEFORE INSERT OR UPDATE OF status ON "EmailAutomation"
 FOR EACH ROW EXECUTE FUNCTION "enforceSubscriptionFeatureConfiguration"();
CREATE TRIGGER "EmailSender_subscription_feature" BEFORE INSERT OR UPDATE OF "archivedAt" ON "EmailSenderIdentity"
 FOR EACH ROW EXECUTE FUNCTION "enforceSubscriptionFeatureConfiguration"();

CREATE OR REPLACE FUNCTION "validateSubscriptionPeriodPurchase"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE purchase JSONB; field TEXT;
BEGIN
  SELECT "purchaseSnapshot" INTO purchase FROM "SubscriptionInvoice" WHERE id = NEW."invoiceId";
  IF purchase IS NULL THEN RETURN NEW; END IF;
  FOREACH field IN ARRAY ARRAY['plan','months','extras','amountMinor','monthlyMinor','discountBps','fullAmountMinor',
    'serviceValueMinor','creditMinor','catalogVersion','organizationId','entitlements'] LOOP
    IF NEW."purchaseSnapshot" IS NULL OR NEW."purchaseSnapshot"->field IS DISTINCT FROM purchase->field THEN
      RAISE EXCEPTION 'Subscription paid period requires its purchase snapshot' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END; $$;

COMMIT;
