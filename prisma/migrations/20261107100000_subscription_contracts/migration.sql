BEGIN;
CREATE TABLE "SubscriptionContract" (
  "organizationId" TEXT PRIMARY KEY REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "catalogVersion" TEXT NOT NULL DEFAULT '2026-10' CHECK ("catalogVersion" IN ('2026-10', '2026-11')),
  "lifetimeAccess" BOOLEAN NOT NULL DEFAULT false,
  "termsSnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Freeze the complete contract, not merely its version label. The insert
-- guard also protects organizations created by a rolled-back application.
CREATE FUNCTION "initializeSubscriptionContractTerms"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."termsSnapshot" = '{}'::jsonb THEN
    NEW."termsSnapshot" := CASE NEW."catalogVersion"
      WHEN '2026-11' THEN '{"version":1,"catalogVersion":"2026-11","plans":{"STARTER":{"code":"STARTER","limits":{"maxStores":1,"maxProducts":1000,"maxActiveUsers":2},"features":{"pos":true,"customerOrders":true,"priceTags":true,"imports":false,"exports":false,"analytics":false,"stockCounts":true,"storePrices":true,"bundles":false,"expiryLots":false,"periodClose":false,"compliance":false,"supportToolkit":true,"kkm":false,"bulkProducts":false,"priceBooks":false,"assortments":false,"purchaseOrders":false,"replenishment":false,"loyalty":false,"emailMarketing":false,"marketingAutomation":false,"ownSender":false,"bazaarCatalog":false,"bazaarApi":false,"marketplaces":false,"bakaiExport":false,"bulkAiContent":false,"imageStudio":false,"initialImport":true,"rawDataExport":true},"usageLimits":{"ai":100,"images":0,"marketingEmails":0,"externalApi":0,"marketplaceChannels":0,"marketplaceRunsDaily":0,"marketplaceFullRunsDaily":0},"countArchivedProducts":false,"monthlyPriceKgs":2000},"BUSINESS":{"code":"BUSINESS","limits":{"maxStores":1,"maxProducts":5000,"maxActiveUsers":5},"features":{"pos":true,"customerOrders":true,"priceTags":true,"imports":true,"exports":true,"analytics":true,"stockCounts":true,"storePrices":true,"bundles":false,"expiryLots":false,"periodClose":false,"compliance":false,"supportToolkit":true,"kkm":false,"bulkProducts":true,"priceBooks":true,"assortments":true,"purchaseOrders":true,"replenishment":false,"loyalty":true,"emailMarketing":true,"marketingAutomation":false,"ownSender":false,"bazaarCatalog":true,"bazaarApi":false,"marketplaces":false,"bakaiExport":true,"bulkAiContent":true,"imageStudio":true,"initialImport":true,"rawDataExport":true},"usageLimits":{"ai":300,"images":5,"marketingEmails":500,"externalApi":0,"marketplaceChannels":0,"marketplaceRunsDaily":0,"marketplaceFullRunsDaily":0},"countArchivedProducts":false,"monthlyPriceKgs":3500},"ENTERPRISE":{"code":"ENTERPRISE","limits":{"maxStores":1,"maxProducts":15000,"maxActiveUsers":15},"features":{"pos":true,"customerOrders":true,"priceTags":true,"imports":true,"exports":true,"analytics":true,"stockCounts":true,"storePrices":true,"bundles":true,"expiryLots":true,"periodClose":true,"compliance":true,"supportToolkit":true,"kkm":false,"bulkProducts":true,"priceBooks":true,"assortments":true,"purchaseOrders":true,"replenishment":true,"loyalty":true,"emailMarketing":true,"marketingAutomation":true,"ownSender":true,"bazaarCatalog":true,"bazaarApi":true,"marketplaces":true,"bakaiExport":true,"bulkAiContent":true,"imageStudio":true,"initialImport":true,"rawDataExport":true},"usageLimits":{"ai":500,"images":10,"marketingEmails":1500,"externalApi":10000,"marketplaceChannels":1,"marketplaceRunsDaily":24,"marketplaceFullRunsDaily":1},"countArchivedProducts":false,"monthlyPriceKgs":5500}}}'::jsonb
      ELSE '{"version":1,"catalogVersion":"2026-10","plans":{"STARTER":{"code":"STARTER","limits":{"maxStores":1,"maxProducts":1000,"maxActiveUsers":5},"features":{"pos":true,"customerOrders":true,"priceTags":true,"imports":false,"exports":false,"analytics":false,"stockCounts":false,"storePrices":false,"bundles":false,"expiryLots":false,"periodClose":false,"compliance":false,"supportToolkit":false,"kkm":false,"bulkProducts":true,"priceBooks":false,"assortments":true,"purchaseOrders":true,"replenishment":true,"loyalty":true,"emailMarketing":true,"marketingAutomation":true,"ownSender":true,"bazaarCatalog":true,"bazaarApi":true,"marketplaces":true,"bakaiExport":true,"bulkAiContent":true,"imageStudio":true,"initialImport":true,"rawDataExport":true},"usageLimits":{"ai":null,"images":null,"marketingEmails":null,"externalApi":null,"marketplaceChannels":null,"marketplaceRunsDaily":null,"marketplaceFullRunsDaily":null},"countArchivedProducts":true,"monthlyPriceKgs":1750},"BUSINESS":{"code":"BUSINESS","limits":{"maxStores":5,"maxProducts":5000,"maxActiveUsers":10},"features":{"pos":true,"customerOrders":true,"priceTags":true,"imports":true,"exports":true,"analytics":true,"stockCounts":true,"storePrices":true,"bundles":true,"expiryLots":true,"periodClose":true,"compliance":false,"supportToolkit":false,"kkm":false,"bulkProducts":true,"priceBooks":true,"assortments":true,"purchaseOrders":true,"replenishment":true,"loyalty":true,"emailMarketing":true,"marketingAutomation":true,"ownSender":true,"bazaarCatalog":true,"bazaarApi":true,"marketplaces":true,"bakaiExport":true,"bulkAiContent":true,"imageStudio":true,"initialImport":true,"rawDataExport":true},"usageLimits":{"ai":null,"images":null,"marketingEmails":null,"externalApi":null,"marketplaceChannels":null,"marketplaceRunsDaily":null,"marketplaceFullRunsDaily":null},"countArchivedProducts":true,"monthlyPriceKgs":4375},"ENTERPRISE":{"code":"ENTERPRISE","limits":{"maxStores":15,"maxProducts":20000,"maxActiveUsers":20},"features":{"pos":true,"customerOrders":true,"priceTags":true,"imports":true,"exports":true,"analytics":true,"stockCounts":true,"storePrices":true,"bundles":true,"expiryLots":true,"periodClose":true,"compliance":true,"supportToolkit":true,"kkm":true,"bulkProducts":true,"priceBooks":true,"assortments":true,"purchaseOrders":true,"replenishment":true,"loyalty":true,"emailMarketing":true,"marketingAutomation":true,"ownSender":true,"bazaarCatalog":true,"bazaarApi":true,"marketplaces":true,"bakaiExport":true,"bulkAiContent":true,"imageStudio":true,"initialImport":true,"rawDataExport":true},"usageLimits":{"ai":null,"images":null,"marketingEmails":null,"externalApi":null,"marketplaceChannels":null,"marketplaceRunsDaily":null,"marketplaceFullRunsDaily":null},"countArchivedProducts":true,"monthlyPriceKgs":8750}}}'::jsonb END;
  END IF;
  IF NEW."termsSnapshot"->>'catalogVersion' IS DISTINCT FROM NEW."catalogVersion" OR
     NEW."termsSnapshot"->>'version' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Invalid subscription contract terms' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "SubscriptionContract_terms_init" BEFORE INSERT ON "SubscriptionContract"
FOR EACH ROW EXECUTE FUNCTION "initializeSubscriptionContractTerms"();

-- Freeze every existing organization's terms. Do not rewrite its plan, status,
-- dates, store data, users, financial records or manually approved access.
INSERT INTO "SubscriptionContract" ("organizationId", "catalogVersion", "lifetimeAccess")
SELECT "id", '2026-10', "id" IN (
 'cmldyo7dn0005btviqlnua4ii', 'cmohj800e0005blb2bybx77dy',
 'cmoiyjd650005inhb5bku5bsv', 'cmp5ntkgg0005njbftimmsg32',
 'cmqayktaq003eomscrqp2p8wr'
) FROM "Organization";

ALTER TABLE "SubscriptionInvoice" ADD COLUMN "purchaseSnapshot" JSONB;
ALTER TABLE "SubscriptionPeriod" ADD COLUMN "purchaseSnapshot" JSONB;
CREATE INDEX "SubscriptionPeriod_active_entitlement_idx" ON "SubscriptionPeriod" ("organizationId", "startsAt" DESC, "endsAt");

CREATE FUNCTION "protectSubscriptionContract"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."lifetimeAccess" THEN
      RAISE EXCEPTION 'Lifetime subscription grant cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."termsSnapshot" IS DISTINCT FROM NEW."termsSnapshot" OR
     OLD."catalogVersion" IS DISTINCT FROM NEW."catalogVersion" OR
     OLD."organizationId" IS DISTINCT FROM NEW."organizationId" OR
     (OLD."lifetimeAccess" AND NOT NEW."lifetimeAccess") THEN
    RAISE EXCEPTION 'Agreed subscription contract is protected' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "SubscriptionContract_guard" BEFORE UPDATE OR DELETE ON "SubscriptionContract"
FOR EACH ROW EXECUTE FUNCTION "protectSubscriptionContract"();

CREATE FUNCTION "protectLifetimeOrganizationBilling"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SubscriptionContract" WHERE "organizationId" = OLD.id AND "lifetimeAccess") AND
    ROW(NEW.plan, NEW."subscriptionStatus", NEW."subscriptionBillingMode", NEW."trialEndsAt", NEW."currentPeriodEndsAt")
    IS DISTINCT FROM
    ROW(OLD.plan, OLD."subscriptionStatus", OLD."subscriptionBillingMode", OLD."trialEndsAt", OLD."currentPeriodEndsAt") THEN
    RAISE EXCEPTION 'Lifetime subscription is protected' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "Organization_lifetime_billing_guard" BEFORE UPDATE ON "Organization"
FOR EACH ROW EXECUTE FUNCTION "protectLifetimeOrganizationBilling"();

CREATE FUNCTION "protectSubscriptionPurchaseSnapshot"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."purchaseSnapshot" IS DISTINCT FROM NEW."purchaseSnapshot" THEN
    RAISE EXCEPTION 'Subscription purchase snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "SubscriptionInvoice_purchase_snapshot_guard" BEFORE UPDATE ON "SubscriptionInvoice"
FOR EACH ROW EXECUTE FUNCTION "protectSubscriptionPurchaseSnapshot"();
CREATE TRIGGER "SubscriptionPeriod_purchase_snapshot_guard" BEFORE UPDATE ON "SubscriptionPeriod"
FOR EACH ROW EXECUTE FUNCTION "protectSubscriptionPurchaseSnapshot"();

-- Fail closed after an application rollback: old code must never turn a paid
-- six/twelve-month invoice into a one-month grant or charge a lifetime account.
CREATE FUNCTION "validateSubscriptionPurchase"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contract "SubscriptionContract";
BEGIN
  SELECT * INTO contract FROM "SubscriptionContract" WHERE "organizationId" = NEW."organizationId";
  IF contract."lifetimeAccess" OR (contract."catalogVersion" = '2026-11' AND NEW."purchaseSnapshot" IS NULL) THEN
    RAISE EXCEPTION 'Subscription invoice requires its agreed purchase snapshot' USING ERRCODE = '23514';
  END IF;
  IF NEW."purchaseSnapshot" IS NOT NULL AND (
    NEW."purchaseSnapshot"->>'plan' IS DISTINCT FROM NEW.plan::text OR
    (NEW."purchaseSnapshot"->>'amountMinor')::bigint IS DISTINCT FROM NEW."amountMinor" OR
    NEW."purchaseSnapshot"->>'organizationId' IS DISTINCT FROM NEW."organizationId" OR
    NEW."purchaseSnapshot"->>'catalogVersion' IS DISTINCT FROM COALESCE(contract."catalogVersion", '2026-10')) THEN
    RAISE EXCEPTION 'Subscription invoice purchase binding differs' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "SubscriptionInvoice_purchase_binding_guard" BEFORE INSERT ON "SubscriptionInvoice"
FOR EACH ROW EXECUTE FUNCTION "validateSubscriptionPurchase"();

CREATE FUNCTION "validateSubscriptionPeriodPurchase"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE purchase JSONB;
BEGIN
  SELECT "purchaseSnapshot" INTO purchase FROM "SubscriptionInvoice" WHERE id = NEW."invoiceId";
  IF purchase IS NOT NULL AND (NEW."purchaseSnapshot" IS NULL OR
      NEW."purchaseSnapshot"->>'plan' IS DISTINCT FROM purchase->>'plan' OR
      NEW."purchaseSnapshot"->>'months' IS DISTINCT FROM purchase->>'months' OR
      NEW."purchaseSnapshot"->'extras' IS DISTINCT FROM purchase->'extras' OR
      NEW."purchaseSnapshot"->>'amountMinor' IS DISTINCT FROM purchase->>'amountMinor') THEN
    RAISE EXCEPTION 'Subscription paid period requires its purchase snapshot' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "SubscriptionPeriod_purchase_binding_guard" BEFORE INSERT ON "SubscriptionPeriod"
FOR EACH ROW EXECUTE FUNCTION "validateSubscriptionPeriodPurchase"();

-- Capacity is serialized per organization, so two concurrent creators cannot
-- both consume the last available slot. Legacy terms and lifetime grants are
-- deliberately excluded from this new enforcement.
CREATE FUNCTION "enforceSubscriptionCapacity"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org_id TEXT; contract "SubscriptionContract"; org "Organization";
        terms JSONB; effective JSONB; resource TEXT; capacity INTEGER; used BIGINT;
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
  IF used >= capacity THEN
    RAISE EXCEPTION 'subscriptionCapacityExceeded:%', resource USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "Product_subscription_capacity" BEFORE INSERT OR UPDATE OF "organizationId", "isDeleted" ON "Product"
FOR EACH ROW EXECUTE FUNCTION "enforceSubscriptionCapacity"();
CREATE TRIGGER "User_subscription_capacity" BEFORE INSERT OR UPDATE OF "organizationId", "isActive" ON "User"
FOR EACH ROW EXECUTE FUNCTION "enforceSubscriptionCapacity"();
CREATE TRIGGER "Store_subscription_capacity" BEFORE INSERT OR UPDATE OF "organizationId" ON "Store"
FOR EACH ROW EXECUTE FUNCTION "enforceSubscriptionCapacity"();

COMMIT;
