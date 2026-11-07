BEGIN;
ALTER TABLE "SubscriptionContract"
  ADD COLUMN "selectedMarketplaceChannel" TEXT,
  ADD COLUMN "selectedSenderDomain" TEXT;
ALTER TABLE "SubscriptionContract" ADD CONSTRAINT "SubscriptionContract_marketplace_channel_check"
  CHECK ("selectedMarketplaceChannel" IS NULL OR "selectedMarketplaceChannel" IN ('MMARKET', 'BAKAI', 'OMARKET'));

-- One live provider is an organization-wide entitlement, not one token per
-- store. Protect the bound even if an older application writes integration
-- records after an application rollback.
CREATE FUNCTION "subscriptionMarketplaceChannelBusy"(org_id TEXT, channel TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT CASE channel
    WHEN 'MMARKET' THEN
      EXISTS(SELECT 1 FROM "MMarketIntegration" WHERE "orgId" = org_id AND "apiTokenEncrypted" IS NOT NULL) OR
      EXISTS(SELECT 1 FROM "MMarketExportJob" WHERE "orgId" = org_id AND status IN ('QUEUED','RUNNING'))
    WHEN 'BAKAI' THEN
      EXISTS(SELECT 1 FROM "BakaiStoreIntegration" WHERE "orgId" = org_id AND "apiTokenEncrypted" IS NOT NULL) OR
      EXISTS(SELECT 1 FROM "BakaiStoreExportJob" WHERE "orgId" = org_id AND "jobType" = 'API_SYNC' AND status IN ('QUEUED','RUNNING'))
    WHEN 'OMARKET' THEN
      EXISTS(SELECT 1 FROM "OMarketIntegration" WHERE "orgId" = org_id AND "apiTokenEncrypted" IS NOT NULL) OR
      EXISTS(SELECT 1 FROM "OMarketExportJob" WHERE "orgId" = org_id AND status IN ('QUEUED','RUNNING'))
    ELSE false END;
$$;
CREATE FUNCTION "enforceSubscriptionMarketplaceChannel"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contract "SubscriptionContract"; org "Organization"; channel TEXT; other TEXT; effective JSONB;
BEGIN
  IF NEW."apiTokenEncrypted" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO org FROM "Organization" WHERE id = NEW."orgId" FOR UPDATE;
  SELECT * INTO contract FROM "SubscriptionContract" WHERE "organizationId" = NEW."orgId";
  IF contract."catalogVersion" IS DISTINCT FROM '2026-11' OR contract."lifetimeAccess" THEN RETURN NEW; END IF;
  channel := CASE TG_TABLE_NAME WHEN 'MMarketIntegration' THEN 'MMARKET' WHEN 'BakaiStoreIntegration' THEN 'BAKAI' ELSE 'OMARKET' END;
  SELECT "purchaseSnapshot"->'entitlements' INTO effective FROM "SubscriptionPeriod"
    WHERE "organizationId" = NEW."orgId" AND "startsAt" <= CURRENT_TIMESTAMP
    ORDER BY "startsAt" DESC, "createdAt" DESC, id DESC LIMIT 1;
  effective := COALESCE(effective, contract."termsSnapshot"->'plans'->(CASE WHEN org.plan::text = 'PRO' THEN 'BUSINESS' ELSE org.plan::text END));
  IF COALESCE((effective->'features'->>'marketplaces')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'featureLockedPlan' USING ERRCODE = '23514';
  END IF;
  IF (TG_OP = 'INSERT' OR OLD."apiTokenEncrypted" IS NULL) AND (
    EXISTS (SELECT 1 FROM "SubscriptionPeriod" WHERE "organizationId" = NEW."orgId" AND "startsAt" > CURRENT_TIMESTAMP
      AND COALESCE(("purchaseSnapshot"->'entitlements'->'features'->>'marketplaces')::BOOLEAN, false) IS NOT TRUE)
    OR EXISTS (SELECT 1 FROM "SubscriptionInvoice" WHERE "organizationId" = NEW."orgId"
      AND status IN ('CREATING','PENDING','REVIEW') AND "purchaseSnapshot" IS NOT NULL
      AND COALESCE(("purchaseSnapshot"->'entitlements'->'features'->>'marketplaces')::BOOLEAN, false) IS NOT TRUE)
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
CREATE TRIGGER "MMarketIntegration_subscription_channel" BEFORE INSERT OR UPDATE OF "apiTokenEncrypted" ON "MMarketIntegration"
FOR EACH ROW EXECUTE FUNCTION "enforceSubscriptionMarketplaceChannel"();
CREATE TRIGGER "BakaiStoreIntegration_subscription_channel" BEFORE INSERT OR UPDATE OF "apiTokenEncrypted" ON "BakaiStoreIntegration"
FOR EACH ROW EXECUTE FUNCTION "enforceSubscriptionMarketplaceChannel"();
CREATE TRIGGER "OMarketIntegration_subscription_channel" BEFORE INSERT OR UPDATE OF "apiTokenEncrypted" ON "OMarketIntegration"
FOR EACH ROW EXECUTE FUNCTION "enforceSubscriptionMarketplaceChannel"();
COMMIT;
