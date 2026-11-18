-- Read-only audit for the exact named Apple migrations and merged-main prerequisite.
-- No customer identifiers, financial values, signed payloads, URLs or secrets are emitted.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '25s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '30s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL search_path = pg_catalog, public;
DO $audit$
DECLARE
  checks JSONB := '[]'::jsonb; spec JSONB; requirement JSONB; parts TEXT[];
  missing BOOLEAN; affected BIGINT; state TEXT; stage TEXT; report JSONB;
  base_missing INTEGER := 0; privacy_present INTEGER := 0; lifecycle_present INTEGER := 0; attempt_present INTEGER := 0; temporary_present INTEGER := 0; deferred_present INTEGER := 0;
  privacy_expected INTEGER := 14; lifecycle_expected INTEGER := 3;
  privacy_applied BIGINT := 0; lifecycle_applied BIGINT := 0; attempt_applied BIGINT := 0; temporary_applied BIGINT := 0; deferred_applied BIGINT := 0; utc_applied BIGINT := 0; consumption_applied BIGINT := 0; consumption_present INTEGER := 0; prerequisite_applied BIGINT := 0;
  minimum_applied BIGINT := 0; minimum_present INTEGER := 0;
  upward_applied BIGINT := 0; upward_present INTEGER := 0;
  unfinished BIGINT := 0; bad_checksum BIGINT := 0;
  structural_issues INTEGER := 0; relation_name TEXT; column_name TEXT;
BEGIN
  IF current_setting('transaction_read_only') <> 'on' THEN RAISE EXCEPTION 'Read-only transaction is required'; END IF;
  FOREACH relation_name IN ARRAY ARRAY['Organization','User','SubscriptionContract','SubscriptionInvoice','SubscriptionPeriod','WhatsAppInvoice','WhatsAppCreditLot','ManualSubscriptionRefund'] LOOP
    IF to_regclass(format('public.%I',relation_name)) IS NULL THEN base_missing := base_missing + 1; END IF;
  END LOOP;
  FOREACH relation_name IN ARRAY ARRAY['AppleBillingAccount','ApplePurchaseIntent','AppleSubscriptionChain','AppleTransaction','AppleTransactionObservation','AppleServerNotification','AccountErasureAsset'] LOOP
    IF to_regclass(format('public.%I',relation_name)) IS NOT NULL THEN privacy_present := privacy_present + 1; END IF;
  END LOOP;
  FOR spec IN SELECT value FROM jsonb_array_elements('[{"table":"User","columns":["deletedAt","aiConsentVersion","aiConsentGrantedAt","aiConsentRevokedAt"]},{"table":"SubscriptionPeriod","columns":["appleTransactionId","revokedAt"]},{"table":"WhatsAppCreditLot","columns":["appleTransactionId"]}]'::jsonb) LOOP
    FOR column_name IN SELECT jsonb_array_elements_text(spec->'columns') LOOP
      IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass(format('public.%I',spec->>'table')) AND attname=column_name AND NOT attisdropped) THEN privacy_present := privacy_present + 1; END IF;
    END LOOP;
  END LOOP;
  FOR spec IN SELECT value FROM jsonb_array_elements('[{"table":"AppleTransaction","columns":["supersededAt"]},{"table":"AppleSubscriptionChain","columns":["pendingProductId","pendingChangeOffer"]}]'::jsonb) LOOP
    FOR column_name IN SELECT jsonb_array_elements_text(spec->'columns') LOOP
      IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass(format('public.%I',spec->>'table')) AND attname=column_name AND NOT attisdropped) THEN lifecycle_present := lifecycle_present + 1; END IF;
    END LOOP;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public."ApplePurchaseIntent"') AND attname='nativeAttemptId' AND NOT attisdropped) THEN attempt_present := 1; END IF;
  FOR spec IN SELECT value FROM jsonb_array_elements('[{"table":"ApplePurchaseIntent","columns":["purchaseAppAccountToken"]},{"table":"AppleTransaction","columns":["storefrontId"]},{"table":"SubscriptionPeriod","columns":["parentPeriodId","dependencyRevokedAt"]}]'::jsonb) LOOP
    FOR column_name IN SELECT jsonb_array_elements_text(spec->'columns') LOOP
      IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass(format('public.%I',spec->>'table')) AND attname=column_name AND NOT attisdropped) THEN temporary_present := temporary_present + 1; END IF;
    END LOOP;
  END LOOP;
  FOREACH relation_name IN ARRAY ARRAY['AppleNativeCompletion','AppleNativeDeferredOutcome'] LOOP
    IF to_regclass(format('public.%I',relation_name)) IS NOT NULL THEN deferred_present := deferred_present + 1; END IF;
  END LOOP;
  FOREACH column_name IN ARRAY ARRAY['completionPublicKey','completionKeyFingerprint','completionOrigin'] LOOP
    IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public."ApplePurchaseIntent"') AND attname=column_name AND NOT attisdropped) THEN deferred_present := deferred_present + 1; END IF;
  END LOOP;
  FOREACH relation_name IN ARRAY ARRAY['AppleConsumptionConsent','AppleConsumptionConsentEvent','AppleConsumptionRequest'] LOOP
    IF to_regclass(format('public.%I',relation_name)) IS NOT NULL THEN consumption_present := consumption_present + 1; END IF;
  END LOOP;
  IF to_regprocedure('public."appleTemporaryMinimumChargeValid"(jsonb)') IS NOT NULL THEN minimum_present := minimum_present+1; END IF;
  IF to_regprocedure('public."validateAppleTemporaryMinimumCharge"()') IS NOT NULL THEN minimum_present := minimum_present+1; END IF;
  IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='ApplePurchaseIntent_temporary_minimum_guard' AND tgrelid=to_regclass('public."ApplePurchaseIntent"') AND NOT tgisinternal) THEN minimum_present := minimum_present+1; END IF;
  IF to_regprocedure('public."appleTemporaryUpwardRoundingValid"(jsonb)') IS NOT NULL THEN upward_present := upward_present+1; END IF;
  IF to_regprocedure('public."validateAppleTemporaryUpwardRounding"()') IS NOT NULL THEN upward_present := upward_present+1; END IF;
  IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='ApplePurchaseIntent_temporary_upward_guard' AND tgrelid=to_regclass('public."ApplePurchaseIntent"') AND NOT tgisinternal) THEN upward_present := upward_present+1; END IF;
  stage := CASE WHEN base_missing>0 THEN 'UNBASELINED'
    WHEN privacy_present=0 AND lifecycle_present=0 AND attempt_present=0 AND temporary_present=0 AND deferred_present=0 THEN 'PRE_APPLE'
    WHEN privacy_present=privacy_expected AND lifecycle_present=0 AND attempt_present=0 AND temporary_present=0 AND deferred_present=0 THEN 'POST_PRIVACY'
    WHEN privacy_present=privacy_expected AND lifecycle_present=lifecycle_expected AND attempt_present=0 AND temporary_present=0 AND deferred_present=0 THEN 'POST_LIFECYCLE'
    WHEN privacy_present=privacy_expected AND lifecycle_present=lifecycle_expected AND attempt_present=1 AND temporary_present=0 AND deferred_present=0 THEN 'POST_NATIVE_ATTEMPT'
    WHEN privacy_present=privacy_expected AND lifecycle_present=lifecycle_expected AND attempt_present=1 AND temporary_present=4 AND deferred_present=0 THEN 'POST_TEMPORARY_UPGRADES'
    WHEN privacy_present=privacy_expected AND lifecycle_present=lifecycle_expected AND attempt_present=1 AND temporary_present=4 AND deferred_present=5 THEN 'POST_DEFERRED_OUTCOMES'
    ELSE 'PARTIAL' END;
  checks := checks || jsonb_build_array(jsonb_build_object('name','baseline_required_tables_missing','severity','blocker','count',base_missing,'skipped',false));
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE $history$SELECT count(*) FILTER(WHERE migration_name='20261111120000_ios_apple_billing_privacy' AND finished_at IS NOT NULL),
      count(*) FILTER(WHERE migration_name='20261111130000_apple_lifecycle_recovery' AND finished_at IS NOT NULL),
      count(*) FILTER(WHERE migration_name='20261111140000_apple_native_attempt_recovery' AND finished_at IS NOT NULL),
      count(*) FILTER(WHERE migration_name='20261111150000_apple_temporary_upgrades' AND finished_at IS NOT NULL),
      count(*) FILTER(WHERE migration_name='20261111160000_apple_deferred_outcomes' AND finished_at IS NOT NULL),
      count(*) FILTER(WHERE migration_name='20261111170000_apple_completion_utc_clock' AND finished_at IS NOT NULL),
      count(*) FILTER(WHERE migration_name='20261113120000_apple_consumption_information' AND finished_at IS NOT NULL),
      count(*) FILTER(WHERE migration_name='20261113130000_apple_temporary_minimum_charge' AND finished_at IS NOT NULL),
      count(*) FILTER(WHERE migration_name='20261113140000_apple_temporary_upward_rounding' AND finished_at IS NOT NULL),
      count(*) FILTER(WHERE migration_name='20261111020000_manual_subscription_refunds' AND finished_at IS NOT NULL),
      count(*) FILTER(WHERE finished_at IS NULL),
      count(*) FILTER(WHERE finished_at IS NOT NULL AND (
        (migration_name='20261111120000_ios_apple_billing_privacy' AND checksum<>'734e62c89a76aaedb153eb0b8029021f7713074b4526ca5501dac9abd41e2f38') OR
        (migration_name='20261111130000_apple_lifecycle_recovery' AND checksum<>'4d43cb3a27d30016fde92eb2465ff9f6ec8f148faf8d41495be89063fde2dc10') OR
        (migration_name='20261111140000_apple_native_attempt_recovery' AND checksum<>'1b3d22538c669d7f940e45dc14127842c25fe14accbe753c8a2b7e3efed32d0b') OR
        (migration_name='20261111150000_apple_temporary_upgrades' AND checksum<>'a13faf83ce11ad2c39480fbce1791299b82fd4fa58971bf3548f905c629a714f') OR
        (migration_name='20261111160000_apple_deferred_outcomes' AND checksum<>'66437a9da6224b1cfcc3a3c7d4ddc3be695119c7a00547a1256fa76f7c14201e') OR
        (migration_name='20261111170000_apple_completion_utc_clock' AND checksum<>'5b2bdce206b878ba9c616fbaf661c2c585acf81384de54ce2da334fd6f41016e') OR
        (migration_name='20261113120000_apple_consumption_information' AND checksum<>'adc1b13b7c9b3c673662a25577ee8b13e6f9fd33f3e115ad2b3d0ed0a8e4c34a') OR
        (migration_name='20261113130000_apple_temporary_minimum_charge' AND checksum<>'c928c60955d3f34b0a4c919bd40ffa59cc9fec60e3c685e6434ac8585c18b323') OR
        (migration_name='20261113140000_apple_temporary_upward_rounding' AND checksum<>'7d637cab8fdc8d519a32f1f52ed790cb755dfc381d79adfe982aecf4d0c7f808') OR
        (migration_name='20261111020000_manual_subscription_refunds' AND checksum<>'800cd487fb2d4b0ecd5501e5edc7182c4a06b851f68b0b02c18e40d795370b87')))
      FROM public._prisma_migrations WHERE rolled_back_at IS NULL$history$ INTO privacy_applied,lifecycle_applied,attempt_applied,temporary_applied,deferred_applied,utc_applied,consumption_applied,minimum_applied,upward_applied,prerequisite_applied,unfinished,bad_checksum;
  ELSE structural_issues := structural_issues + 1;
  END IF;
  IF utc_applied>0 AND stage='POST_DEFERRED_OUTCOMES' THEN stage := 'POST_COMPLETION_UTC'; END IF;
  IF consumption_applied=1 AND consumption_present=3 AND stage='POST_COMPLETION_UTC' THEN stage := 'POST_CONSUMPTION'; END IF;
  IF minimum_applied=1 AND minimum_present=3 AND stage='POST_CONSUMPTION' THEN stage := 'POST_TEMPORARY_MINIMUM'; END IF;
  IF upward_applied=1 AND upward_present=3 AND stage='POST_TEMPORARY_MINIMUM' THEN stage := 'POST_TEMPORARY_UPWARD_ROUNDING'; END IF;
  IF upward_applied>1 OR (upward_applied>0 AND minimum_applied<>1) OR (upward_applied=0 AND upward_present>0) OR
    (upward_applied>0 AND upward_present<>3) THEN structural_issues := structural_issues+1; END IF;
  IF minimum_applied>1 OR (minimum_applied>0 AND consumption_applied<>1) OR (minimum_applied=0 AND minimum_present>0) OR
    (minimum_applied>0 AND minimum_present<>3) THEN structural_issues := structural_issues+1; END IF;
  IF consumption_applied>1 OR (consumption_applied>0 AND utc_applied=0) OR
    (consumption_applied=0 AND consumption_present>0) OR (consumption_applied>0 AND consumption_present<>3) THEN structural_issues := structural_issues+1; END IF;
  IF privacy_applied>1 OR lifecycle_applied>1 OR attempt_applied>1 OR temporary_applied>1 OR deferred_applied>1 OR utc_applied>1 OR (lifecycle_applied>0 AND privacy_applied=0) OR (attempt_applied>0 AND lifecycle_applied=0) OR (temporary_applied>0 AND attempt_applied=0) OR (deferred_applied>0 AND temporary_applied=0) OR (utc_applied>0 AND deferred_applied=0) THEN structural_issues := structural_issues + 1; END IF;
  IF (privacy_applied=0 AND privacy_present>0) OR (privacy_applied>0 AND privacy_present<>privacy_expected) OR
     (lifecycle_applied=0 AND lifecycle_present>0) OR (lifecycle_applied>0 AND lifecycle_present<>lifecycle_expected) OR
     (attempt_applied=0 AND attempt_present>0) OR (attempt_applied>0 AND attempt_present<>1) OR
     (temporary_applied=0 AND temporary_present>0) OR (temporary_applied>0 AND temporary_present<>4) OR
     (deferred_applied=0 AND deferred_present>0) OR (deferred_applied>0 AND deferred_present<>5) OR
     (utc_applied>0 AND deferred_present<>5) OR stage='PARTIAL' THEN structural_issues := structural_issues + 1; END IF;
  checks := checks || jsonb_build_array(
    jsonb_build_object('name','apple_migrations_applied','severity','info','count',privacy_applied+lifecycle_applied+attempt_applied+temporary_applied+deferred_applied+utc_applied+consumption_applied+minimum_applied+upward_applied,'skipped',false),
    jsonb_build_object('name','manual_refund_prerequisite_missing','severity','blocker','count',CASE WHEN prerequisite_applied=1 THEN 0 ELSE 1 END,'skipped',false),
    jsonb_build_object('name','unfinished_migrations','severity','blocker','count',unfinished,'skipped',false),
    jsonb_build_object('name','reviewed_migration_checksum_mismatches','severity','blocker','count',bad_checksum,'skipped',false),
    jsonb_build_object('name','apple_schema_history_inconsistent','severity','blocker','count',structural_issues,'skipped',false));
  FOR spec IN SELECT value FROM jsonb_array_elements($checks$
[
  {
    "name": "organizations_total",
    "severity": "info",
    "requires": [
      "Organization"
    ],
    "sql": "SELECT count(*) FROM public.\"Organization\""
  },
  {
    "name": "users_total",
    "severity": "info",
    "requires": [
      "User"
    ],
    "sql": "SELECT count(*) FROM public.\"User\""
  },
  {
    "name": "legacy_contracts_total",
    "severity": "info",
    "requires": [
      "SubscriptionContract"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionContract\" WHERE \"catalogVersion\" = '2026-10' "
  },
  {
    "name": "current_contracts_total",
    "severity": "info",
    "requires": [
      "SubscriptionContract"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionContract\" WHERE \"catalogVersion\" = '2026-11' "
  },
  {
    "name": "manual_organizations_preserved",
    "severity": "info",
    "requires": [
      "Organization"
    ],
    "sql": "SELECT count(*) FROM public.\"Organization\" WHERE \"subscriptionBillingMode\"='MANUAL'"
  },
  {
    "name": "lifetime_contracts_preserved",
    "severity": "info",
    "requires": [
      "SubscriptionContract"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionContract\" WHERE \"lifetimeAccess\""
  },
  {
    "name": "future_web_periods_preserved",
    "severity": "info",
    "requires": [
      "SubscriptionPeriod"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionPeriod\" WHERE \"invoiceId\" IS NOT NULL AND \"startsAt\">CURRENT_TIMESTAMP"
  },
  {
    "name": "required_privacy_constraints_missing_or_unvalidated",
    "severity": "blocker",
    "requires": [
      "AppleTransaction"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('SubscriptionPeriod','SubscriptionPeriod_appleTransactionId_organizationId_fkey'),('WhatsAppCreditLot','WhatsAppCreditLot_appleTransactionId_organizationId_fkey'),('AppleBillingAccount','AppleBillingAccount_organizationId_fkey'),('ApplePurchaseIntent','ApplePurchaseIntent_organizationId_fkey'),('AppleSubscriptionChain','AppleSubscriptionChain_organizationId_fkey'),('AppleSubscriptionChain','AppleSubscriptionChain_initialIntentId_organizationId_fkey'),('AppleTransaction','AppleTransaction_organizationId_fkey'),('AppleTransaction','AppleTransaction_intentId_organizationId_fkey'),('AppleTransactionObservation','AppleTransactionObservation_transactionId_fkey'),('ApplePurchaseIntent','ApplePurchaseIntent_values_check'),('AppleSubscriptionChain','AppleSubscriptionChain_environment_check'),('AppleTransaction','AppleTransaction_values_check'),('SubscriptionPeriod','SubscriptionPeriod_source_check'),('WhatsAppCreditLot','WhatsAppCreditLot_source_check')) AS expected(table_name,constraint_name) WHERE NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname=expected.table_name AND c.conname=expected.constraint_name AND c.convalidated)"
  },
  {
    "name": "required_lifecycle_constraints_missing_or_unvalidated",
    "severity": "blocker",
    "requires": [
      "AppleTransaction.supersededAt",
      "AppleSubscriptionChain.pendingChangeOffer"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('AppleTransaction','AppleTransaction_superseded_check'),('AppleSubscriptionChain','AppleSubscriptionChain_pending_offer_check')) AS expected(table_name,constraint_name) WHERE NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname=expected.table_name AND c.conname=expected.constraint_name AND c.convalidated)"
  },
  {
    "name": "required_apple_unique_indexes_missing_or_invalid",
    "severity": "blocker",
    "requires": [
      "AppleTransaction"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('AppleBillingAccount','AppleBillingAccount_appAccountToken_key'),('ApplePurchaseIntent','ApplePurchaseIntent_pendingSlot_key'),('ApplePurchaseIntent','ApplePurchaseIntent_organizationId_idempotencyKey_key'),('ApplePurchaseIntent','ApplePurchaseIntent_id_organizationId_key'),('AppleSubscriptionChain','AppleSubscriptionChain_environment_originalTransactionId_key'),('AppleSubscriptionChain','AppleSubscriptionChain_id_organizationId_key'),('AppleTransaction','AppleTransaction_environment_transactionId_key'),('AppleTransaction','AppleTransaction_id_organizationId_key'),('AccountErasureAsset','AccountErasureAsset_url_key')) AS expected(table_name,index_name) WHERE NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class r ON r.oid=i.indrelid JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname=expected.table_name AND x.relname=expected.index_name AND i.indisunique AND i.indisvalid AND i.indisready)"
  },
  {
    "name": "legacy_invoices_without_purchase_snapshot",
    "severity": "info",
    "requires": [
      "SubscriptionInvoice.purchaseSnapshot"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionInvoice\" WHERE \"purchaseSnapshot\" IS NULL"
  },
  {
    "name": "web_invoice_money_invalid",
    "severity": "blocker",
    "requires": [
      "SubscriptionInvoice"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionInvoice\" WHERE \"amountMinor\" <= 0 OR currency <> 'KGS' "
  },
  {
    "name": "current_contract_historical_invoices_without_snapshot",
    "severity": "warning",
    "requires": [
      "SubscriptionInvoice.purchaseSnapshot",
      "SubscriptionContract"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionInvoice\" i JOIN public.\"SubscriptionContract\" c ON c.\"organizationId\"=i.\"organizationId\" WHERE c.\"catalogVersion\"='2026-11' AND i.\"purchaseSnapshot\" IS NULL"
  },
  {
    "name": "invoice_snapshot_binding_invalid",
    "severity": "blocker",
    "requires": [
      "SubscriptionInvoice.purchaseSnapshot"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionInvoice\" i WHERE i.\"purchaseSnapshot\" IS NOT NULL AND (jsonb_typeof(i.\"purchaseSnapshot\") IS DISTINCT FROM 'object' OR i.\"purchaseSnapshot\"->>'organizationId' IS DISTINCT FROM i.\"organizationId\" OR i.\"purchaseSnapshot\"->>'plan' IS DISTINCT FROM i.plan::text OR (i.\"purchaseSnapshot\"->>'amountMinor')::bigint IS DISTINCT FROM i.\"amountMinor\")"
  },
  {
    "name": "subscription_period_dates_invalid",
    "severity": "blocker",
    "requires": [
      "SubscriptionPeriod"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionPeriod\" WHERE \"endsAt\" <= \"startsAt\""
  },
  {
    "name": "subscription_invoice_tenant_binding_invalid",
    "severity": "blocker",
    "requires": [
      "SubscriptionPeriod",
      "SubscriptionInvoice"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionPeriod\" p LEFT JOIN public.\"SubscriptionInvoice\" i ON i.id=p.\"invoiceId\" WHERE p.\"invoiceId\" IS NOT NULL AND (i.id IS NULL OR i.\"organizationId\" IS DISTINCT FROM p.\"organizationId\")"
  },
  {
    "name": "web_period_purchase_snapshot_differs",
    "severity": "blocker",
    "requires": [
      "SubscriptionPeriod.purchaseSnapshot",
      "SubscriptionInvoice.purchaseSnapshot"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionPeriod\" p JOIN public.\"SubscriptionInvoice\" i ON i.id=p.\"invoiceId\" WHERE i.\"purchaseSnapshot\" IS NOT NULL AND EXISTS(SELECT 1 FROM unnest(ARRAY['plan','months','extras','amountMinor','monthlyMinor','discountBps','fullAmountMinor','serviceValueMinor','creditMinor','catalogVersion','organizationId','entitlements']) AS f(key) WHERE p.\"purchaseSnapshot\"->f.key IS DISTINCT FROM i.\"purchaseSnapshot\"->f.key)"
  },
  {
    "name": "whatsapp_invoice_tenant_binding_invalid",
    "severity": "blocker",
    "requires": [
      "WhatsAppCreditLot",
      "WhatsAppInvoice"
    ],
    "sql": "SELECT count(*) FROM public.\"WhatsAppCreditLot\" l LEFT JOIN public.\"WhatsAppInvoice\" i ON i.id=l.\"invoiceId\" WHERE l.\"invoiceId\" IS NOT NULL AND (i.id IS NULL OR i.\"organizationId\" IS DISTINCT FROM l.\"organizationId\")"
  },
  {
    "name": "whatsapp_credit_nonnegative_invalid",
    "severity": "blocker",
    "requires": [
      "WhatsAppCreditLot"
    ],
    "sql": "SELECT count(*) FROM public.\"WhatsAppCreditLot\" WHERE total <= 0 OR used < 0 OR reserved < 0"
  },
  {
    "name": "whatsapp_credit_overdrawn",
    "severity": "warning",
    "requires": [
      "WhatsAppCreditLot"
    ],
    "sql": "SELECT count(*) FROM public.\"WhatsAppCreditLot\" WHERE used::bigint + reserved::bigint > total::bigint"
  },
  {
    "name": "web_whatsapp_credit_expiry_missing",
    "severity": "blocker",
    "requires": [
      "WhatsAppCreditLot"
    ],
    "sql": "SELECT count(*) FROM public.\"WhatsAppCreditLot\" WHERE \"invoiceId\" IS NOT NULL AND \"expiresAt\" IS NULL"
  },
  {
    "name": "period_source_xor_invalid",
    "severity": "blocker",
    "requires": [
      "SubscriptionPeriod.appleTransactionId",
      "SubscriptionPeriod.revokedAt"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionPeriod\" WHERE (\"invoiceId\" IS NOT NULL)::int + (\"appleTransactionId\" IS NOT NULL)::int <> 1 OR (\"revokedAt\" IS NOT NULL AND \"appleTransactionId\" IS NULL)"
  },
  {
    "name": "whatsapp_source_or_expiry_invalid",
    "severity": "blocker",
    "requires": [
      "WhatsAppCreditLot.appleTransactionId"
    ],
    "sql": "SELECT count(*) FROM public.\"WhatsAppCreditLot\" WHERE (\"invoiceId\" IS NOT NULL)::int + (\"appleTransactionId\" IS NOT NULL)::int <> 1 OR (\"appleTransactionId\" IS NOT NULL AND \"expiresAt\" IS NOT NULL) OR (\"invoiceId\" IS NOT NULL AND \"expiresAt\" IS NULL)"
  },
  {
    "name": "post_privacy_source_columns_still_not_null",
    "severity": "blocker",
    "requires": [
      "AppleTransaction",
      "SubscriptionPeriod.appleTransactionId"
    ],
    "sql": "SELECT count(*) FROM pg_attribute a WHERE a.attnotnull AND NOT a.attisdropped AND ((a.attrelid='public.\"SubscriptionPeriod\"'::regclass AND a.attname='invoiceId') OR (a.attrelid='public.\"WhatsAppCreditLot\"'::regclass AND a.attname IN ('invoiceId','expiresAt')))"
  },
  {
    "name": "deleted_account_identity_not_erased",
    "severity": "warning",
    "requires": [
      "User.deletedAt"
    ],
    "sql": "SELECT count(*) FROM public.\"User\" WHERE \"deletedAt\" IS NOT NULL AND (\"isActive\" OR \"isOrgOwner\" OR email !~ '^deleted[+][^@]+@deleted[.]invalid$' OR phone IS NOT NULL OR \"jobTitle\" IS NOT NULL OR \"signupAttribution\" IS NOT NULL OR \"emailVerifiedAt\" IS NOT NULL)"
  },
  {
    "name": "apple_account_tenant_missing",
    "severity": "blocker",
    "requires": [
      "AppleBillingAccount",
      "Organization"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleBillingAccount\" a LEFT JOIN public.\"Organization\" o ON o.id=a.\"organizationId\" WHERE o.id IS NULL"
  },
  {
    "name": "apple_intent_account_binding_invalid",
    "severity": "blocker",
    "requires": [
      "AppleBillingAccount",
      "ApplePurchaseIntent"
    ],
    "sql": "SELECT count(*) FROM public.\"ApplePurchaseIntent\" i LEFT JOIN public.\"AppleBillingAccount\" a ON a.\"organizationId\"=i.\"organizationId\" WHERE a.\"organizationId\" IS NULL OR i.\"appAccountToken\" IS DISTINCT FROM a.\"appAccountToken\" OR i.environment NOT IN ('Production','Sandbox') OR (i.\"scope\"='SUBSCRIPTION' AND (i.\"purchaseSnapshot\" IS NULL OR i.\"productType\"='CONSUMABLE')) OR (i.\"scope\"='WHATSAPP_PACK' AND i.\"productType\" <> 'CONSUMABLE')"
  },
  {
    "name": "apple_chain_intent_binding_invalid",
    "severity": "blocker",
    "requires": [
      "AppleSubscriptionChain",
      "ApplePurchaseIntent"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleSubscriptionChain\" c LEFT JOIN public.\"ApplePurchaseIntent\" i ON i.id=c.\"initialIntentId\" WHERE i.id IS NULL OR i.\"organizationId\" IS DISTINCT FROM c.\"organizationId\" OR i.\"appAccountToken\" IS DISTINCT FROM c.\"appAccountToken\" OR i.environment IS DISTINCT FROM c.environment OR i.\"productType\" <> 'AUTO_RENEWABLE' "
  },
  {
    "name": "apple_transaction_account_binding_invalid",
    "severity": "blocker",
    "requires": [
      "AppleTransaction",
      "AppleBillingAccount"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleTransaction\" t LEFT JOIN public.\"AppleBillingAccount\" a ON a.\"organizationId\"=t.\"organizationId\" WHERE a.\"organizationId\" IS NULL OR (t.\"appAccountToken\" IS DISTINCT FROM a.\"appAccountToken\" AND NOT EXISTS(SELECT 1 FROM public.\"ApplePurchaseIntent\" i WHERE i.\"organizationId\"=t.\"organizationId\" AND (to_jsonb(i)->>'purchaseAppAccountToken')::uuid=t.\"appAccountToken\" AND (i.id=t.\"intentId\" OR (t.\"intentId\" IS NULL AND t.status='REVIEW'))))"
  },
  {
    "name": "apple_transaction_intent_binding_invalid",
    "severity": "blocker",
    "requires": [
      "AppleTransaction",
      "ApplePurchaseIntent"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleTransaction\" t LEFT JOIN public.\"ApplePurchaseIntent\" i ON i.id=t.\"intentId\" WHERE t.\"intentId\" IS NOT NULL AND (i.id IS NULL OR i.\"organizationId\" IS DISTINCT FROM t.\"organizationId\" OR COALESCE((to_jsonb(i)->>'purchaseAppAccountToken')::uuid,i.\"appAccountToken\") IS DISTINCT FROM t.\"appAccountToken\" OR i.environment IS DISTINCT FROM t.environment OR i.\"productId\" IS DISTINCT FROM t.\"productId\" OR i.\"productType\" IS DISTINCT FROM t.\"productType\" OR i.\"offerSnapshot\" IS DISTINCT FROM t.\"offerSnapshot\")"
  },
  {
    "name": "apple_signed_price_pair_invalid",
    "severity": "blocker",
    "requires": [
      "AppleTransaction"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleTransaction\" WHERE (\"priceMillis\" IS NULL) <> (currency IS NULL) OR \"priceMillis\" < 0 OR (currency IS NOT NULL AND currency !~ '^[A-Z]{3}$')"
  },
  {
    "name": "apple_review_receipts_retained",
    "severity": "warning",
    "requires": [
      "AppleTransaction"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleTransaction\" WHERE status='REVIEW' "
  },
  {
    "name": "apple_unbound_receipts_retained",
    "severity": "warning",
    "requires": [
      "AppleTransaction"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleTransaction\" WHERE \"intentId\" IS NULL"
  },
  {
    "name": "apple_period_tenant_or_signed_dates_invalid",
    "severity": "blocker",
    "requires": [
      "AppleTransaction",
      "SubscriptionPeriod.appleTransactionId"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionPeriod\" p LEFT JOIN public.\"AppleTransaction\" t ON t.id=p.\"appleTransactionId\" WHERE p.\"appleTransactionId\" IS NOT NULL AND (t.id IS NULL OR t.\"organizationId\" IS DISTINCT FROM p.\"organizationId\" OR t.\"productType\" NOT IN ('AUTO_RENEWABLE','NON_RENEWING') OR (t.\"productType\"='AUTO_RENEWABLE' AND (p.\"startsAt\" IS DISTINCT FROM t.\"purchaseDate\" OR p.\"endsAt\" IS DISTINCT FROM t.\"expiresDate\")))"
  },
  {
    "name": "apple_period_frozen_purchase_differs",
    "severity": "blocker",
    "requires": [
      "AppleTransaction",
      "ApplePurchaseIntent",
      "SubscriptionPeriod.appleTransactionId"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionPeriod\" p JOIN public.\"AppleTransaction\" t ON t.id=p.\"appleTransactionId\" LEFT JOIN public.\"ApplePurchaseIntent\" i ON i.id=t.\"intentId\" WHERE i.id IS NULL OR i.\"authorizedAt\" IS NULL OR i.\"purchaseSnapshot\" IS NULL OR EXISTS(SELECT 1 FROM unnest(ARRAY['plan','months','extras','amountMinor','monthlyMinor','discountBps','fullAmountMinor','serviceValueMinor','creditMinor','catalogVersion','organizationId','entitlements','appleTemporaryUpgrade']) AS f(key) WHERE p.\"purchaseSnapshot\"->f.key IS DISTINCT FROM i.\"purchaseSnapshot\"->f.key)"
  },
  {
    "name": "apple_consumable_lot_binding_invalid",
    "severity": "blocker",
    "requires": [
      "AppleTransaction",
      "WhatsAppCreditLot.appleTransactionId"
    ],
    "sql": "SELECT count(*) FROM public.\"WhatsAppCreditLot\" l LEFT JOIN public.\"AppleTransaction\" t ON t.id=l.\"appleTransactionId\" WHERE l.\"appleTransactionId\" IS NOT NULL AND (t.id IS NULL OR t.\"organizationId\" IS DISTINCT FROM l.\"organizationId\" OR t.\"productType\" <> 'CONSUMABLE' OR t.\"offerSnapshot\"->>'kind' IS DISTINCT FROM 'WHATSAPP_PACK' OR l.total IS DISTINCT FROM (t.\"offerSnapshot\"->>'messages')::integer)"
  },
  {
    "name": "non_auto_intents_with_multiple_fulfillments",
    "severity": "blocker",
    "requires": [
      "AppleTransaction",
      "SubscriptionPeriod.appleTransactionId",
      "WhatsAppCreditLot.appleTransactionId"
    ],
    "sql": "SELECT count(*) FROM (SELECT t.\"intentId\" FROM public.\"AppleTransaction\" t LEFT JOIN public.\"SubscriptionPeriod\" p ON p.\"appleTransactionId\"=t.id LEFT JOIN public.\"WhatsAppCreditLot\" l ON l.\"appleTransactionId\"=t.id WHERE t.\"intentId\" IS NOT NULL AND t.\"productType\" <> 'AUTO_RENEWABLE' AND (p.id IS NOT NULL OR l.id IS NOT NULL) GROUP BY t.\"intentId\" HAVING count(*) > 1) duplicate_fulfillments"
  },
  {
    "name": "superseded_apple_transaction_invalid",
    "severity": "blocker",
    "requires": [
      "AppleTransaction.supersededAt"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleTransaction\" WHERE \"supersededAt\" IS NOT NULL AND (\"productType\" <> 'AUTO_RENEWABLE' OR status <> 'REVOKED')"
  },
  {
    "name": "superseded_apple_period_still_active",
    "severity": "blocker",
    "requires": [
      "AppleTransaction.supersededAt",
      "SubscriptionPeriod.appleTransactionId"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionPeriod\" p JOIN public.\"AppleTransaction\" t ON t.id=p.\"appleTransactionId\" WHERE t.\"supersededAt\" IS NOT NULL AND p.\"revokedAt\" IS NULL"
  },
  {
    "name": "pending_apple_change_shape_invalid",
    "severity": "blocker",
    "requires": [
      "AppleSubscriptionChain.pendingChangeOffer",
      "AppleSubscriptionChain.pendingProductId"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleSubscriptionChain\" WHERE \"pendingChangeOffer\" IS NOT NULL AND (\"pendingProductId\" IS NULL OR \"pendingChangeOffer\"->>'kind' IS DISTINCT FROM 'SUBSCRIPTION' OR jsonb_typeof(\"pendingChangeOffer\"->'entitlements') IS DISTINCT FROM 'object')"
  },
  {
    "name": "required_financial_privacy_triggers_missing_or_disabled",
    "severity": "blocker",
    "requires": [
      "AppleTransaction"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('AppleBillingAccount','AppleBillingAccount_binding_guard'),('ApplePurchaseIntent','ApplePurchaseIntent_snapshot_guard'),('AppleSubscriptionChain','AppleSubscriptionChain_binding_guard'),('AppleTransaction','AppleTransaction_snapshot_guard'),('AppleServerNotification','AppleServerNotification_evidence_guard'),('AppleTransactionObservation','AppleTransactionObservation_evidence_guard'),('SubscriptionPeriod','SubscriptionPeriod_source_guard'),('SubscriptionPeriod','SubscriptionPeriod_purchase_binding_guard'),('WhatsAppCreditLot','WhatsAppCreditLot_source_guard'),('User','User_deleted_identity_guard')) AS expected(table_name,trigger_name) WHERE NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=expected.table_name AND t.tgname=expected.trigger_name AND NOT t.tgisinternal AND t.tgenabled IN ('O','A'))"
  },
  {
    "name": "reviewed_guard_function_bodies_changed",
    "severity": "blocker",
    "requires": [
      "AppleTransaction"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('public.\"protectAppleBillingAccount\"()','4904d780da38a5efbff724bb0d32bc4e','4904d780da38a5efbff724bb0d32bc4e','4904d780da38a5efbff724bb0d32bc4e','4904d780da38a5efbff724bb0d32bc4e'),('public.\"protectAppleIntent\"()','a2b71c63f15c7be726f8d3d42090ed56','a2b71c63f15c7be726f8d3d42090ed56','9706a471dcd7db0a400272f56d139950','e5824764ed973923bfa00f5d43161736'),('public.\"protectAppleChain\"()','3634b6c5f2c0955fc580d2ad017d8d64','3634b6c5f2c0955fc580d2ad017d8d64','3634b6c5f2c0955fc580d2ad017d8d64','3634b6c5f2c0955fc580d2ad017d8d64'),('public.\"protectAppleTransaction\"()','8d2d58e95e8f7abdf41723580d3d6118','c0d1aa0c2d552bf7d0c6903d10c334df','c0d1aa0c2d552bf7d0c6903d10c334df','d5b8ad3944dd390d2bca199c1e5bf5fc'),('public.\"protectAppleEvidence\"()','d3d80c29afbef01e6bbebf0adac8fdce','d3d80c29afbef01e6bbebf0adac8fdce','d3d80c29afbef01e6bbebf0adac8fdce','d3d80c29afbef01e6bbebf0adac8fdce'),('public.\"validateSubscriptionPeriodPurchase\"()','4516cb685f2d33cd0b58ff1e9f4d6df8','4516cb685f2d33cd0b58ff1e9f4d6df8','4516cb685f2d33cd0b58ff1e9f4d6df8','bc99297825556f5315154b239f4e16e6'),('public.\"protectSubscriptionPeriodSource\"()','249ab5329614e549df495b8b578acbc7','0e25ad94de6eb2476d52c55b771153ce','0e25ad94de6eb2476d52c55b771153ce','5aaa87a5f4c5a789d5dbe6707e453ad5'),('public.\"protectWhatsAppCreditSource\"()','3bf9077d0608e9b09ed4043935a1a6fb','3bf9077d0608e9b09ed4043935a1a6fb','3bf9077d0608e9b09ed4043935a1a6fb','3bf9077d0608e9b09ed4043935a1a6fb'),('public.\"protectDeletedUserIdentity\"()','33f7de835b228f8414800d6633cf803f','33f7de835b228f8414800d6633cf803f','33f7de835b228f8414800d6633cf803f','33f7de835b228f8414800d6633cf803f'),('public.\"enforceSubscriptionCapacity\"()','045d31abb34abb69cd318592e35175c0','da4172d8d0001200163f24d4c34f6146','da4172d8d0001200163f24d4c34f6146','80d1a71135790e80a1dd9256771f9925'),('public.\"assertSubscriptionFeatureConfiguration\"(text,text)','46750b3c1edc7cd45a8be46629819179','161b96ade46fe7ee1d24f42a5a38c156','161b96ade46fe7ee1d24f42a5a38c156','35df4513651c16d7b3bc66a7f8873af0'),('public.\"enforceSubscriptionMarketplaceChannel\"()','f13db24fddd9405aacb634c58a8c7626','80e2425b0b5bf48838d6342e4b54421c','80e2425b0b5bf48838d6342e4b54421c','1abf4c09fd923d2bfecefe1e8cad9e18')) AS expected(signature,privacy_digest,lifecycle_digest,native_digest,temporary_digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature) WHERE NOT (expected.signature='public.\"protectAppleIntent\"()' AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.\"ApplePurchaseIntent\"'::regclass AND attname='completionPublicKey' AND NOT attisdropped)) AND (p.oid IS NULL OR md5(p.prosrc) IS DISTINCT FROM CASE WHEN EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.\"SubscriptionPeriod\"'::regclass AND attname='parentPeriodId' AND NOT attisdropped) THEN expected.temporary_digest WHEN EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.\"ApplePurchaseIntent\"'::regclass AND attname='nativeAttemptId' AND NOT attisdropped) THEN expected.native_digest WHEN EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.\"AppleTransaction\"'::regclass AND attname='supersededAt' AND NOT attisdropped) THEN expected.lifecycle_digest ELSE expected.privacy_digest END)"
  },
  {
    "name": "required_native_attempt_constraint_missing",
    "severity": "blocker",
    "requires": [
      "ApplePurchaseIntent.nativeAttemptId"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('ApplePurchaseIntent_native_attempt_check')) expected(name) WHERE NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.\"ApplePurchaseIntent\"'::regclass AND conname=expected.name AND convalidated)"
  },
  {
    "name": "required_native_attempt_unique_index_missing",
    "severity": "blocker",
    "requires": [
      "ApplePurchaseIntent.nativeAttemptId"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('ApplePurchaseIntent_nativeAttemptId_key')) expected(name) WHERE NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='public.\"ApplePurchaseIntent\"'::regclass AND c.relname=expected.name AND i.indisunique AND i.indisvalid AND i.indisready)"
  },
  {
    "name": "native_attempt_without_authorization",
    "severity": "blocker",
    "requires": [
      "ApplePurchaseIntent.nativeAttemptId"
    ],
    "sql": "SELECT count(*) FROM public.\"ApplePurchaseIntent\" WHERE \"nativeAttemptId\" IS NOT NULL AND \"authorizedAt\" IS NULL"
  },
  {
    "name": "legacy_authorized_intents_without_native_attempt",
    "severity": "warning",
    "requires": [
      "ApplePurchaseIntent.nativeAttemptId"
    ],
    "sql": "SELECT count(*) FROM public.\"ApplePurchaseIntent\" WHERE \"nativeAttemptId\" IS NULL AND \"authorizedAt\" IS NOT NULL AND status IN ('PENDING','REVIEW')"
  },
  {
    "name": "manual_refund_payment_binding_invalid",
    "severity": "blocker",
    "requires": [
      "ManualSubscriptionRefund",
      "SubscriptionInvoice"
    ],
    "sql": "SELECT count(*) FROM public.\"ManualSubscriptionRefund\" r LEFT JOIN public.\"SubscriptionInvoice\" i ON i.id=r.\"invoiceId\" WHERE i.id IS NULL OR i.\"organizationId\" IS DISTINCT FROM r.\"organizationId\" OR i.provider<>'GOPAY' OR i.currency<>'KGS' OR i.\"isTest\" OR i.status<>'PAID' OR r.\"amountMinor\"<=0"
  },
  {
    "name": "manual_refund_total_exceeds_invoice",
    "severity": "blocker",
    "requires": [
      "ManualSubscriptionRefund",
      "SubscriptionInvoice"
    ],
    "sql": "SELECT count(*) FROM (SELECT r.\"invoiceId\" FROM public.\"ManualSubscriptionRefund\" r JOIN public.\"SubscriptionInvoice\" i ON i.id=r.\"invoiceId\" GROUP BY r.\"invoiceId\",i.\"amountMinor\" HAVING sum(r.\"amountMinor\")>i.\"amountMinor\") invalid_totals"
  },
  {
    "name": "temporary_upgrade_constraints_missing_or_unvalidated",
    "severity": "blocker",
    "requires": [
      "SubscriptionPeriod.parentPeriodId",
      "SubscriptionPeriod.dependencyRevokedAt",
      "ApplePurchaseIntent.purchaseAppAccountToken",
      "AppleTransaction.storefrontId"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('SubscriptionPeriod_parentPeriodId_organizationId_fkey'),('SubscriptionPeriod_temporary_parent_check')) expected(name) WHERE NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.\"SubscriptionPeriod\"'::regclass AND conname=expected.name AND convalidated)"
  },
  {
    "name": "temporary_upgrade_indexes_missing_or_invalid",
    "severity": "blocker",
    "requires": [
      "SubscriptionPeriod.parentPeriodId",
      "SubscriptionPeriod.dependencyRevokedAt",
      "ApplePurchaseIntent.purchaseAppAccountToken",
      "AppleTransaction.storefrontId"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('ApplePurchaseIntent','ApplePurchaseIntent_purchaseAppAccountToken_key'),('SubscriptionPeriod','SubscriptionPeriod_id_organizationId_key')) expected(table_name,index_name) WHERE NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class r ON r.oid=i.indrelid JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname=expected.table_name AND x.relname=expected.index_name AND i.indisunique AND i.indisvalid AND i.indisready)"
  },
  {
    "name": "temporary_upgrade_triggers_missing_or_disabled",
    "severity": "blocker",
    "requires": [
      "SubscriptionPeriod.parentPeriodId",
      "SubscriptionPeriod.dependencyRevokedAt",
      "ApplePurchaseIntent.purchaseAppAccountToken",
      "AppleTransaction.storefrontId"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('AppleBillingAccount','AppleBillingAccount_token_namespace_guard'),('SubscriptionPeriod','SubscriptionPeriod_dependency_refresh')) expected(table_name,trigger_name) WHERE NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=expected.table_name AND t.tgname=expected.trigger_name AND NOT t.tgisinternal AND t.tgenabled IN ('O','A'))"
  },
  {
    "name": "temporary_upgrade_function_bodies_changed",
    "severity": "blocker",
    "requires": [
      "SubscriptionPeriod.parentPeriodId",
      "SubscriptionPeriod.dependencyRevokedAt",
      "ApplePurchaseIntent.purchaseAppAccountToken",
      "AppleTransaction.storefrontId"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('public.\"subscriptionPeriodDependencyInvalidAt\"(text,text)','8d845506ed3c40fd0bcb9b7a3c1d102d'),('public.\"validateAppleAccountTokenNamespace\"()','c19486b4dc1b894beb320004fe0ca287'),('public.\"refreshSubscriptionPeriodDependencies\"()','dc89994b27d1b5a2539e646fd7221fc1')) expected(signature,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature) WHERE p.oid IS NULL OR md5(p.prosrc) IS DISTINCT FROM expected.digest"
  },
  {
    "name": "temporary_upgrade_token_namespace_collisions",
    "severity": "blocker",
    "requires": [
      "SubscriptionPeriod.parentPeriodId",
      "SubscriptionPeriod.dependencyRevokedAt",
      "ApplePurchaseIntent.purchaseAppAccountToken",
      "AppleTransaction.storefrontId"
    ],
    "sql": "SELECT count(*) FROM public.\"ApplePurchaseIntent\" i JOIN public.\"AppleBillingAccount\" a ON a.\"appAccountToken\"=i.\"purchaseAppAccountToken\""
  },
  {
    "name": "temporary_upgrade_intent_shape_invalid",
    "severity": "blocker",
    "requires": [
      "SubscriptionPeriod.parentPeriodId",
      "SubscriptionPeriod.dependencyRevokedAt",
      "ApplePurchaseIntent.purchaseAppAccountToken",
      "AppleTransaction.storefrontId"
    ],
    "sql": "SELECT count(*) FROM public.\"ApplePurchaseIntent\" i WHERE ((i.\"purchaseAppAccountToken\" IS NOT NULL) <> COALESCE(jsonb_typeof(i.\"purchaseSnapshot\"->'appleTemporaryUpgrade')='object',false)) OR (i.\"purchaseAppAccountToken\" IS NOT NULL AND (i.scope<>'SUBSCRIPTION' OR i.action<>'CHANGE' OR i.\"productType\"<>'NON_RENEWING' OR i.\"purchaseSnapshot\"->>'kind' IS DISTINCT FROM 'UPGRADE' OR i.\"purchaseSnapshot\"->>'sourcePeriodId' IS NULL))"
  },
  {
    "name": "temporary_upgrade_period_binding_invalid",
    "severity": "blocker",
    "requires": [
      "SubscriptionPeriod.parentPeriodId",
      "SubscriptionPeriod.dependencyRevokedAt",
      "ApplePurchaseIntent.purchaseAppAccountToken",
      "AppleTransaction.storefrontId"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionPeriod\" p LEFT JOIN public.\"SubscriptionPeriod\" b ON b.id=p.\"parentPeriodId\" LEFT JOIN public.\"AppleTransaction\" t ON t.id=p.\"appleTransactionId\" LEFT JOIN public.\"ApplePurchaseIntent\" i ON i.id=t.\"intentId\" WHERE p.\"parentPeriodId\" IS NOT NULL AND (b.id IS NULL OR b.\"organizationId\" IS DISTINCT FROM p.\"organizationId\" OR p.id=b.id OR p.\"invoiceId\" IS NOT NULL OR t.\"productType\" IS DISTINCT FROM 'NON_RENEWING' OR i.\"purchaseAppAccountToken\" IS NULL OR t.\"appAccountToken\" IS DISTINCT FROM i.\"purchaseAppAccountToken\" OR p.\"purchaseSnapshot\"->>'kind' IS DISTINCT FROM 'UPGRADE' OR p.\"purchaseSnapshot\"->>'sourcePeriodId' IS DISTINCT FROM b.id OR p.\"startsAt\"<b.\"startsAt\" OR p.\"endsAt\" IS DISTINCT FROM b.\"endsAt\" OR p.\"startsAt\" IS DISTINCT FROM ((i.\"purchaseSnapshot\"->>'startsAt')::timestamptz AT TIME ZONE 'UTC') OR p.\"endsAt\" IS DISTINCT FROM ((i.\"purchaseSnapshot\"->>'endsAt')::timestamptz AT TIME ZONE 'UTC') OR EXISTS(SELECT 1 FROM unnest(ARRAY['sourcePeriodId','startsAt','endsAt','cycleStartsAt','cycleEndsAt','anchorDay','expectedPlan','expectedPeriodEnd','appleTemporaryUpgrade']) f(key) WHERE p.\"purchaseSnapshot\"->f.key IS DISTINCT FROM i.\"purchaseSnapshot\"->f.key) OR t.\"priceMillis\" IS DISTINCT FROM (i.\"purchaseSnapshot\"->'appleTemporaryUpgrade'->'price'->>'priceMillis')::bigint OR t.currency IS DISTINCT FROM i.\"purchaseSnapshot\"->'appleTemporaryUpgrade'->'price'->>'currency' OR t.\"storefrontId\" IS DISTINCT FROM i.\"purchaseSnapshot\"->'appleTemporaryUpgrade'->'price'->>'storefrontId')"
  },
  {
    "name": "temporary_upgrade_standalone_period_invalid",
    "severity": "blocker",
    "requires": [
      "SubscriptionPeriod.parentPeriodId",
      "SubscriptionPeriod.dependencyRevokedAt",
      "ApplePurchaseIntent.purchaseAppAccountToken",
      "AppleTransaction.storefrontId"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionPeriod\" p JOIN public.\"AppleTransaction\" t ON t.id=p.\"appleTransactionId\" JOIN public.\"ApplePurchaseIntent\" i ON i.id=t.\"intentId\" WHERE i.\"purchaseAppAccountToken\" IS NOT NULL AND p.\"parentPeriodId\" IS NULL"
  },
  {
    "name": "temporary_upgrade_dependency_state_invalid",
    "severity": "blocker",
    "requires": [
      "SubscriptionPeriod.parentPeriodId",
      "SubscriptionPeriod.dependencyRevokedAt",
      "ApplePurchaseIntent.purchaseAppAccountToken",
      "AppleTransaction.storefrontId"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionPeriod\" p WHERE p.\"parentPeriodId\" IS NOT NULL AND p.\"dependencyRevokedAt\" IS DISTINCT FROM public.\"subscriptionPeriodDependencyInvalidAt\"(p.\"parentPeriodId\",p.\"organizationId\")"
  },
  {
    "name": "temporary_upgrade_ancestry_invalid",
    "severity": "blocker",
    "requires": [
      "SubscriptionPeriod.parentPeriodId",
      "SubscriptionPeriod.dependencyRevokedAt",
      "ApplePurchaseIntent.purchaseAppAccountToken",
      "AppleTransaction.storefrontId"
    ],
    "sql": "WITH RECURSIVE paths AS (SELECT p.id AS root,p.id,p.\"parentPeriodId\",ARRAY[p.id] AS seen,0 AS depth,false AS cycle FROM public.\"SubscriptionPeriod\" p WHERE p.\"parentPeriodId\" IS NOT NULL UNION ALL SELECT w.root,p.id,p.\"parentPeriodId\",w.seen||p.id,w.depth+1,p.id=ANY(w.seen) FROM paths w JOIN public.\"SubscriptionPeriod\" p ON p.id=w.\"parentPeriodId\" WHERE NOT w.cycle AND w.depth<64) SELECT count(DISTINCT root) FROM paths WHERE cycle OR depth>=64"
  },
  {
    "name": "temporary_upgrade_unserved_dependency_unreviewed",
    "severity": "blocker",
    "requires": [
      "SubscriptionPeriod.parentPeriodId",
      "SubscriptionPeriod.dependencyRevokedAt",
      "ApplePurchaseIntent.purchaseAppAccountToken",
      "AppleTransaction.storefrontId"
    ],
    "sql": "SELECT count(*) FROM public.\"SubscriptionPeriod\" p JOIN public.\"AppleTransaction\" t ON t.id=p.\"appleTransactionId\" WHERE p.\"parentPeriodId\" IS NOT NULL AND p.\"dependencyRevokedAt\" IS NOT NULL AND p.\"revokedAt\" IS NULL AND p.\"endsAt\">CURRENT_TIMESTAMP AND t.status='GRANTED' AND t.\"revocationDate\" IS NULL AND t.\"supersededAt\" IS NULL"
  },
  {
    "name": "native_outcome_columns_missing_or_invalid",
    "severity": "blocker",
    "afterDeferred": true,
    "requires": [
      "AppleNativeCompletion",
      "AppleNativeDeferredOutcome",
      "ApplePurchaseIntent.completionPublicKey",
      "ApplePurchaseIntent.completionKeyFingerprint",
      "ApplePurchaseIntent.completionOrigin"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('ApplePurchaseIntent','completionPublicKey','character varying(200)',false),('ApplePurchaseIntent','completionKeyFingerprint','character varying(64)',false),('ApplePurchaseIntent','completionOrigin','text',false),('AppleNativeCompletion','id','text',true),('AppleNativeCompletion','intentId','text',true),('AppleNativeCompletion','organizationId','text',true),('AppleNativeCompletion','nativeAttemptId','uuid',true),('AppleNativeCompletion','keyFingerprint','character varying(64)',true),('AppleNativeCompletion','origin','text',true),('AppleNativeCompletion','outcome','text',true),('AppleNativeCompletion','transactionDigest','character varying(64)',false),('AppleNativeCompletion','renewalDigest','character varying(64)',false),('AppleNativeCompletion','challengeDigest','character varying(64)',true),('AppleNativeCompletion','challenge','text',true),('AppleNativeCompletion','signature','character varying(100)',true),('AppleNativeCompletion','issuedAt','timestamp(3) without time zone',true),('AppleNativeCompletion','expiresAt','timestamp(3) without time zone',true),('AppleNativeCompletion','createdAt','timestamp(3) without time zone',true),('AppleNativeDeferredOutcome','id','text',true),('AppleNativeDeferredOutcome','intentId','text',true),('AppleNativeDeferredOutcome','organizationId','text',true),('AppleNativeDeferredOutcome','nativeAttemptId','uuid',true),('AppleNativeDeferredOutcome','actorId','text',true),('AppleNativeDeferredOutcome','chainId','text',true),('AppleNativeDeferredOutcome','previousTransactionId','text',true),('AppleNativeDeferredOutcome','environment','text',true),('AppleNativeDeferredOutcome','originalTransactionId','text',true),('AppleNativeDeferredOutcome','appAccountToken','uuid',true),('AppleNativeDeferredOutcome','currentProductId','text',true),('AppleNativeDeferredOutcome','productId','text',true),('AppleNativeDeferredOutcome','effectiveAt','timestamp(3) without time zone',true),('AppleNativeDeferredOutcome','renewalSignedAt','timestamp(3) without time zone',true),('AppleNativeDeferredOutcome','transactionDigest','character varying(64)',true),('AppleNativeDeferredOutcome','renewalDigest','character varying(64)',true),('AppleNativeDeferredOutcome','signedTransactionInfo','text',true),('AppleNativeDeferredOutcome','signedRenewalInfo','text',true),('AppleNativeDeferredOutcome','createdAt','timestamp(3) without time zone',true)) expected(table_name,column_name,column_type,required) WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass(format('public.%I',expected.table_name)) AND a.attname=expected.column_name AND NOT a.attisdropped AND format_type(a.atttypid,a.atttypmod)=expected.column_type AND a.attnotnull=expected.required AND a.attidentity='' AND a.attgenerated='' AND COALESCE((SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attrdef d WHERE d.adrelid=a.attrelid AND d.adnum=a.attnum),'')=CASE WHEN expected.table_name IN ('AppleNativeCompletion','AppleNativeDeferredOutcome') AND expected.column_name='createdAt' THEN 'CURRENT_TIMESTAMP' ELSE '' END)"
  },
  {
    "name": "native_outcome_indexes_missing_or_invalid",
    "severity": "blocker",
    "afterDeferred": true,
    "requires": [
      "AppleNativeCompletion",
      "AppleNativeDeferredOutcome",
      "ApplePurchaseIntent.completionPublicKey",
      "ApplePurchaseIntent.completionKeyFingerprint",
      "ApplePurchaseIntent.completionOrigin"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('ApplePurchaseIntent','ApplePurchaseIntent_completionKeyFingerprint_key',true,false,ARRAY['completionKeyFingerprint']::text[]),('AppleNativeCompletion','AppleNativeCompletion_pkey',true,true,ARRAY['id']::text[]),('AppleNativeCompletion','AppleNativeCompletion_intentId_key',true,false,ARRAY['intentId']::text[]),('AppleNativeCompletion','AppleNativeCompletion_challengeDigest_key',true,false,ARRAY['challengeDigest']::text[]),('AppleNativeCompletion','AppleNativeCompletion_intentId_organizationId_key',true,false,ARRAY['intentId','organizationId']::text[]),('AppleNativeCompletion','AppleNativeCompletion_organizationId_createdAt_idx',false,false,ARRAY['organizationId','createdAt']::text[]),('AppleNativeDeferredOutcome','AppleNativeDeferredOutcome_pkey',true,true,ARRAY['id']::text[]),('AppleNativeDeferredOutcome','AppleNativeDeferredOutcome_intentId_key',true,false,ARRAY['intentId']::text[]),('AppleNativeDeferredOutcome','AppleNativeDeferredOutcome_intentId_organizationId_key',true,false,ARRAY['intentId','organizationId']::text[]),('AppleNativeDeferredOutcome','AppleNativeDeferredOutcome_organizationId_createdAt_idx',false,false,ARRAY['organizationId','createdAt']::text[])) expected(table_name,index_name,unique_key,primary_key,columns) WHERE NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_namespace n ON n.oid=x.relnamespace WHERE i.indrelid=to_regclass(format('public.%I',expected.table_name)) AND n.nspname='public' AND x.relname=expected.index_name AND i.indisvalid AND i.indisready AND i.indisunique=expected.unique_key AND i.indisprimary=expected.primary_key AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts=i.indnatts AND ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum,position) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.position)=expected.columns)"
  },
  {
    "name": "native_outcome_foreign_keys_missing_or_invalid",
    "severity": "blocker",
    "afterDeferred": true,
    "requires": [
      "AppleNativeCompletion",
      "AppleNativeDeferredOutcome",
      "ApplePurchaseIntent.completionPublicKey",
      "ApplePurchaseIntent.completionKeyFingerprint",
      "ApplePurchaseIntent.completionOrigin"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('AppleNativeCompletion','AppleNativeCompletion_intentId_organizationId_fkey',ARRAY['intentId','organizationId']::text[],'ApplePurchaseIntent',ARRAY['id','organizationId']::text[]),('AppleNativeDeferredOutcome','AppleNativeDeferredOutcome_intentId_organizationId_fkey',ARRAY['intentId','organizationId']::text[],'ApplePurchaseIntent',ARRAY['id','organizationId']::text[]),('AppleNativeDeferredOutcome','AppleNativeDeferredOutcome_chainId_organizationId_fkey',ARRAY['chainId','organizationId']::text[],'AppleSubscriptionChain',ARRAY['id','organizationId']::text[]),('AppleNativeDeferredOutcome','AppleNativeDeferredOutcome_previous_org_fkey',ARRAY['previousTransactionId','organizationId']::text[],'AppleTransaction',ARRAY['id','organizationId']::text[])) expected(table_name,constraint_name,columns,target_table,target_columns) WHERE NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass(format('public.%I',expected.table_name)) AND c.conname=expected.constraint_name AND c.contype='f' AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred AND c.confrelid=to_regclass(format('public.%I',expected.target_table)) AND c.confdeltype='r' AND c.confupdtype='r' AND c.confmatchtype='s' AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,position) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.position)=expected.columns AND ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,position) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.position)=expected.target_columns)"
  },
  {
    "name": "native_outcome_check_definitions_changed",
    "severity": "blocker",
    "afterDeferred": true,
    "requires": [
      "AppleNativeCompletion",
      "AppleNativeDeferredOutcome",
      "ApplePurchaseIntent.completionPublicKey",
      "ApplePurchaseIntent.completionKeyFingerprint",
      "ApplePurchaseIntent.completionOrigin"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('ApplePurchaseIntent','ApplePurchaseIntent_completion_key_shape','474bdf290d7bf62dbde70e4584344846'),('AppleNativeCompletion','AppleNativeCompletion_shape_check','15d16ff32144100b8ab1283d0bd9ddee'),('AppleNativeDeferredOutcome','AppleNativeDeferredOutcome_shape_check','079be7c5368389d1dc3d88ada13749dc')) expected(table_name,constraint_name,digest) WHERE NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass(format('public.%I',expected.table_name)) AND c.conname=expected.constraint_name AND c.contype='c' AND c.convalidated AND NOT c.connoinherit AND md5(pg_get_constraintdef(c.oid,true))=expected.digest)"
  },
  {
    "name": "native_outcome_triggers_missing_or_invalid",
    "severity": "blocker",
    "afterDeferred": true,
    "requires": [
      "AppleNativeCompletion",
      "AppleNativeDeferredOutcome",
      "ApplePurchaseIntent.completionPublicKey",
      "ApplePurchaseIntent.completionKeyFingerprint",
      "ApplePurchaseIntent.completionOrigin"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('ApplePurchaseIntent','ApplePurchaseIntent_snapshot_guard','public.\"protectAppleIntent\"()',31),('AppleNativeCompletion','AppleNativeCompletion_append_only','public.\"protectAppleNativeCompletion\"()',31),('AppleNativeDeferredOutcome','AppleNativeDeferredOutcome_append_only','public.\"protectAppleNativeDeferredOutcome\"()',31),('AppleTransaction','AppleTransaction_deferred_outcome_lock','public.\"lockAppleFinancialOutcomeOrganization\"()',7)) expected(table_name,trigger_name,signature,event_type) WHERE NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass(format('public.%I',expected.table_name)) AND t.tgname=expected.trigger_name AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND t.tgtype=expected.event_type AND t.tgfoid=to_regprocedure(expected.signature) AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text='')"
  },
  {
    "name": "native_outcome_function_definitions_changed",
    "severity": "blocker",
    "afterDeferred": true,
    "requires": [
      "AppleNativeCompletion",
      "AppleNativeDeferredOutcome",
      "ApplePurchaseIntent.completionPublicKey",
      "ApplePurchaseIntent.completionKeyFingerprint",
      "ApplePurchaseIntent.completionOrigin"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('public.\"protectAppleIntent\"()','95718ad9eca8fcc3b355b172de516364'),('public.\"protectAppleNativeCompletion\"()','a11a911fc46a1e70baca4ccd36592553'),('public.\"protectAppleNativeDeferredOutcome\"()','9eed5957fe77453c9b64cb09e8993651'),('public.\"lockAppleFinancialOutcomeOrganization\"()','c61c595c66069a7b8ba4f1d7460afb74')) expected(signature,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature) WHERE p.oid IS NULL OR p.prorettype<>'trigger'::regtype OR p.prosecdef OR p.proconfig IS NOT NULL OR p.prokind<>'f' OR p.provolatile<>'v' OR p.pronargs<>0 OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM CASE WHEN expected.signature='public.\"protectAppleNativeCompletion\"()' AND EXISTS(SELECT 1 FROM public._prisma_migrations WHERE migration_name='20261111170000_apple_completion_utc_clock' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN 'a1cfda9b9960dd2031aafeca4e51a581' ELSE expected.digest END"
  },
  {
    "name": "native_completion_enrollment_invalid",
    "severity": "blocker",
    "afterDeferred": true,
    "requires": [
      "AppleNativeCompletion",
      "AppleNativeDeferredOutcome",
      "ApplePurchaseIntent.completionPublicKey",
      "ApplePurchaseIntent.completionKeyFingerprint",
      "ApplePurchaseIntent.completionOrigin"
    ],
    "sql": "SELECT count(*) FROM public.\"ApplePurchaseIntent\" i WHERE NOT ((\"completionPublicKey\" IS NULL AND \"completionKeyFingerprint\" IS NULL AND \"completionOrigin\" IS NULL) OR (\"completionPublicKey\" IS NOT NULL AND \"completionKeyFingerprint\" IS NOT NULL AND \"completionOrigin\" IS NOT NULL AND \"nativeAttemptId\" IS NOT NULL AND \"authorizedAt\" IS NOT NULL AND \"completionKeyFingerprint\" ~ '^[a-f0-9]{64}$' AND \"completionOrigin\" ~ '^https://[^/?#[:space:]]+$' AND \"completionKeyFingerprint\"=encode(sha256(decode(\"completionPublicKey\",'base64')),'hex')))"
  },
  {
    "name": "legacy_authorized_intents_without_completion_key",
    "severity": "info",
    "afterDeferred": true,
    "requires": [
      "AppleNativeCompletion",
      "AppleNativeDeferredOutcome",
      "ApplePurchaseIntent.completionPublicKey",
      "ApplePurchaseIntent.completionKeyFingerprint",
      "ApplePurchaseIntent.completionOrigin"
    ],
    "sql": "SELECT count(*) FROM public.\"ApplePurchaseIntent\" WHERE \"authorizedAt\" IS NOT NULL AND \"completionPublicKey\" IS NULL"
  },
  {
    "name": "native_completion_immutable_binding_invalid",
    "severity": "blocker",
    "afterDeferred": true,
    "requires": [
      "AppleNativeCompletion",
      "AppleNativeDeferredOutcome",
      "ApplePurchaseIntent.completionPublicKey",
      "ApplePurchaseIntent.completionKeyFingerprint",
      "ApplePurchaseIntent.completionOrigin"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleNativeCompletion\" c LEFT JOIN public.\"ApplePurchaseIntent\" i ON i.id=c.\"intentId\" WHERE i.id IS NULL OR c.\"organizationId\" IS DISTINCT FROM i.\"organizationId\" OR c.\"nativeAttemptId\" IS DISTINCT FROM i.\"nativeAttemptId\" OR i.\"authorizedAt\" IS NULL OR i.\"completionPublicKey\" IS NULL OR c.\"keyFingerprint\" IS DISTINCT FROM i.\"completionKeyFingerprint\" OR c.origin IS DISTINCT FROM i.\"completionOrigin\" OR c.\"issuedAt\"<i.\"authorizedAt\""
  },
  {
    "name": "native_completion_proof_shape_invalid",
    "severity": "blocker",
    "afterDeferred": true,
    "requires": [
      "AppleNativeCompletion",
      "AppleNativeDeferredOutcome",
      "ApplePurchaseIntent.completionPublicKey",
      "ApplePurchaseIntent.completionKeyFingerprint",
      "ApplePurchaseIntent.completionOrigin"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleNativeCompletion\" c WHERE c.\"keyFingerprint\" !~ '^[a-f0-9]{64}$' OR c.\"challengeDigest\" IS DISTINCT FROM encode(sha256(convert_to(c.challenge,'UTF8')),'hex') OR length(c.challenge) NOT BETWEEN 30 AND 3000 OR octet_length(decode(c.signature,'base64'))<>64 OR c.\"expiresAt\"<>c.\"issuedAt\"+interval '5 minutes' OR NOT ((c.outcome IN ('CANCELED','NOT_STARTED') AND c.\"transactionDigest\" IS NULL AND c.\"renewalDigest\" IS NULL) OR (c.outcome='DEFERRED' AND c.\"transactionDigest\" IS NOT NULL AND c.\"renewalDigest\" IS NOT NULL AND c.\"transactionDigest\" ~ '^[a-f0-9]{64}$' AND c.\"renewalDigest\" ~ '^[a-f0-9]{64}$'))"
  },
  {
    "name": "native_deferred_immutable_source_binding_invalid",
    "severity": "blocker",
    "afterDeferred": true,
    "requires": [
      "AppleNativeCompletion",
      "AppleNativeDeferredOutcome",
      "ApplePurchaseIntent.completionPublicKey",
      "ApplePurchaseIntent.completionKeyFingerprint",
      "ApplePurchaseIntent.completionOrigin"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleNativeDeferredOutcome\" d LEFT JOIN public.\"ApplePurchaseIntent\" i ON i.id=d.\"intentId\" LEFT JOIN public.\"AppleSubscriptionChain\" c ON c.id=d.\"chainId\" LEFT JOIN public.\"AppleTransaction\" t ON t.id=d.\"previousTransactionId\" LEFT JOIN public.\"SubscriptionPeriod\" p ON p.\"appleTransactionId\"=t.id WHERE i.id IS NULL OR c.id IS NULL OR t.id IS NULL OR p.id IS NULL OR d.\"organizationId\" IS DISTINCT FROM i.\"organizationId\" OR d.\"organizationId\" IS DISTINCT FROM c.\"organizationId\" OR d.\"organizationId\" IS DISTINCT FROM t.\"organizationId\" OR d.\"organizationId\" IS DISTINCT FROM p.\"organizationId\" OR d.\"actorId\" IS DISTINCT FROM i.\"createdById\" OR d.\"nativeAttemptId\" IS DISTINCT FROM i.\"nativeAttemptId\" OR i.\"authorizedAt\" IS NULL OR i.scope<>'SUBSCRIPTION' OR i.action<>'CHANGE' OR i.\"productType\"<>'AUTO_RENEWABLE' OR i.\"purchaseAppAccountToken\" IS NOT NULL OR t.\"productType\"<>'AUTO_RENEWABLE' OR d.environment IS DISTINCT FROM i.environment OR d.environment IS DISTINCT FROM c.environment OR d.environment IS DISTINCT FROM t.environment OR d.\"appAccountToken\" IS DISTINCT FROM i.\"appAccountToken\" OR d.\"appAccountToken\" IS DISTINCT FROM c.\"appAccountToken\" OR d.\"appAccountToken\" IS DISTINCT FROM t.\"appAccountToken\" OR d.\"originalTransactionId\" IS DISTINCT FROM c.\"originalTransactionId\" OR d.\"originalTransactionId\" IS DISTINCT FROM t.\"originalTransactionId\" OR d.\"currentProductId\" IS DISTINCT FROM t.\"productId\" OR d.\"productId\" IS DISTINCT FROM i.\"productId\" OR d.\"currentProductId\"=d.\"productId\" OR d.\"effectiveAt\" IS DISTINCT FROM t.\"expiresDate\" OR d.\"effectiveAt\" IS DISTINCT FROM p.\"endsAt\" OR t.\"createdAt\">i.\"authorizedAt\" OR t.\"purchaseDate\">i.\"authorizedAt\" OR p.\"startsAt\">i.\"authorizedAt\" OR d.\"renewalSignedAt\"<i.\"authorizedAt\" OR d.\"renewalSignedAt\">=d.\"effectiveAt\""
  },
  {
    "name": "native_deferred_frozen_quote_binding_invalid",
    "severity": "blocker",
    "afterDeferred": true,
    "requires": [
      "AppleNativeCompletion",
      "AppleNativeDeferredOutcome",
      "ApplePurchaseIntent.completionPublicKey",
      "ApplePurchaseIntent.completionKeyFingerprint",
      "ApplePurchaseIntent.completionOrigin"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleNativeDeferredOutcome\" d JOIN public.\"ApplePurchaseIntent\" i ON i.id=d.\"intentId\" LEFT JOIN public.\"AppleTransaction\" t ON t.id=d.\"previousTransactionId\" WHERE jsonb_typeof(i.\"offerSnapshot\"->'appleChangeSource') IS DISTINCT FROM 'object' OR i.\"offerSnapshot\"->'appleChangeSource'->>'version' IS DISTINCT FROM '1' OR i.\"offerSnapshot\"->'appleChangeSource'->>'chainId' IS DISTINCT FROM d.\"chainId\" OR i.\"offerSnapshot\"->'appleChangeSource'->>'transactionRowId' IS DISTINCT FROM d.\"previousTransactionId\" OR i.\"offerSnapshot\"->'appleChangeSource'->>'transactionId' IS DISTINCT FROM t.\"transactionId\" OR i.\"offerSnapshot\"->'appleChangeSource'->>'originalTransactionId' IS DISTINCT FROM d.\"originalTransactionId\" OR i.\"offerSnapshot\"->'appleChangeSource'->>'productId' IS DISTINCT FROM d.\"currentProductId\" OR i.\"offerSnapshot\"->'appleChangeSource'->>'environment' IS DISTINCT FROM d.environment OR i.\"offerSnapshot\"->'appleChangeSource'->>'subscriptionGroupId' IS NULL OR i.\"offerSnapshot\"->'appleChangeSource'->>'subscriptionGroupId' IS DISTINCT FROM i.\"offerSnapshot\"->'appleProduct'->>'subscriptionGroupId' OR ((i.\"offerSnapshot\"->'appleChangeSource'->>'expiresAt')::timestamptz AT TIME ZONE 'UTC') IS DISTINCT FROM d.\"effectiveAt\""
  },
  {
    "name": "native_deferred_evidence_digests_invalid",
    "severity": "blocker",
    "afterDeferred": true,
    "requires": [
      "AppleNativeCompletion",
      "AppleNativeDeferredOutcome",
      "ApplePurchaseIntent.completionPublicKey",
      "ApplePurchaseIntent.completionKeyFingerprint",
      "ApplePurchaseIntent.completionOrigin"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleNativeDeferredOutcome\" d WHERE d.environment NOT IN ('Production','Sandbox') OR d.\"originalTransactionId\" !~ '^[0-9]{1,40}$' OR d.\"transactionDigest\" !~ '^[a-f0-9]{64}$' OR d.\"renewalDigest\" !~ '^[a-f0-9]{64}$' OR length(d.\"signedTransactionInfo\") NOT BETWEEN 30 AND 100000 OR length(d.\"signedRenewalInfo\") NOT BETWEEN 30 AND 100000 OR d.\"transactionDigest\" IS DISTINCT FROM encode(sha256(convert_to(d.\"signedTransactionInfo\",'UTF8')),'hex') OR d.\"renewalDigest\" IS DISTINCT FROM encode(sha256(convert_to(d.\"signedRenewalInfo\",'UTF8')),'hex')"
  },
  {
    "name": "native_deferred_completion_binding_invalid",
    "severity": "blocker",
    "afterDeferred": true,
    "requires": [
      "AppleNativeCompletion",
      "AppleNativeDeferredOutcome",
      "ApplePurchaseIntent.completionPublicKey",
      "ApplePurchaseIntent.completionKeyFingerprint",
      "ApplePurchaseIntent.completionOrigin"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleNativeDeferredOutcome\" d JOIN public.\"ApplePurchaseIntent\" i ON i.id=d.\"intentId\" LEFT JOIN public.\"AppleNativeCompletion\" c ON c.\"intentId\"=d.\"intentId\" WHERE i.\"completionPublicKey\" IS NOT NULL AND (c.id IS NULL OR c.outcome<>'DEFERRED' OR c.\"organizationId\" IS DISTINCT FROM d.\"organizationId\" OR c.\"nativeAttemptId\" IS DISTINCT FROM d.\"nativeAttemptId\" OR c.\"keyFingerprint\" IS DISTINCT FROM i.\"completionKeyFingerprint\" OR c.origin IS DISTINCT FROM i.\"completionOrigin\" OR c.\"transactionDigest\" IS DISTINCT FROM d.\"transactionDigest\" OR c.\"renewalDigest\" IS DISTINCT FROM d.\"renewalDigest\")"
  },
  {
    "name": "native_completion_deferred_outcome_missing",
    "severity": "blocker",
    "afterDeferred": true,
    "requires": [
      "AppleNativeCompletion",
      "AppleNativeDeferredOutcome",
      "ApplePurchaseIntent.completionPublicKey",
      "ApplePurchaseIntent.completionKeyFingerprint",
      "ApplePurchaseIntent.completionOrigin"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleNativeCompletion\" c WHERE c.outcome='DEFERRED' AND NOT EXISTS(SELECT 1 FROM public.\"AppleNativeDeferredOutcome\" d WHERE d.\"intentId\"=c.\"intentId\") AND NOT EXISTS(SELECT 1 FROM public.\"AppleTransaction\" t WHERE t.\"intentId\"=c.\"intentId\")"
  },
  {
    "name": "consumption_consent_rows_total",
    "severity": "info",
    "afterConsumption": true,
    "requires": [
      "AppleConsumptionConsent"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleConsumptionConsent\""
  },
  {
    "name": "consumption_request_rows_total",
    "severity": "info",
    "afterConsumption": true,
    "requires": [
      "AppleConsumptionRequest"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleConsumptionRequest\""
  },
  {
    "name": "consumption_guard_function_bodies_changed",
    "severity": "blocker",
    "afterConsumption": true,
    "requires": [],
    "sql": "SELECT count(*) FROM (VALUES ('public.\"appleConsumptionPayloadDigest\"(jsonb)','9da17d105fa33039eaca6e22245ec4a8'),('public.\"protectAppleConsumptionConsent\"()','47e86450aabed205e688cfa66f9e9ad4'),('public.\"protectAppleConsumptionRequest\"()','3956d9de44d907d6dcd24f3ccae62022'),('public.\"protectAppleConsumptionConsentEvent\"()','3bfc95bbf5a44222e54a9937d684e75b'),('public.\"requireAppleConsumptionConsentAudit\"()','fe5db6d6c0dc1b074490b3a5381399e3')) expected(signature,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature) WHERE p.oid IS NULL OR p.prosecdef OR p.proconfig IS NOT NULL OR p.prokind<>'f' OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM expected.digest"
  },
  {
    "name": "consumption_required_triggers_missing",
    "severity": "blocker",
    "afterConsumption": true,
    "requires": [],
    "sql": "SELECT count(*) FROM (VALUES ('AppleConsumptionConsent','AppleConsumptionConsent_protect','public.\"protectAppleConsumptionConsent\"()',31,false),('AppleConsumptionConsentEvent','AppleConsumptionConsentEvent_protect','public.\"protectAppleConsumptionConsentEvent\"()',31,false),('AppleConsumptionRequest','AppleConsumptionRequest_protect','public.\"protectAppleConsumptionRequest\"()',31,false),('AppleConsumptionConsent','AppleConsumptionConsent_require_audit','public.\"requireAppleConsumptionConsentAudit\"()',21,true)) expected(table_name,trigger_name,signature,event_type,deferred) WHERE NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass(format('public.%I',expected.table_name)) AND t.tgname=expected.trigger_name AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND t.tgtype=expected.event_type AND t.tgfoid=to_regprocedure(expected.signature) AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text='' AND t.tgdeferrable=expected.deferred AND t.tginitdeferred=expected.deferred)"
  },
  {
    "name": "consumption_constraints_missing_or_unvalidated",
    "severity": "blocker",
    "afterConsumption": true,
    "requires": [],
    "sql": "SELECT count(*) FROM (VALUES ('AppleConsumptionConsent','AppleConsumptionConsent_values_check','c'),('AppleConsumptionRequest','AppleConsumptionRequest_values_check','c'),('AppleConsumptionConsent','AppleConsumptionConsent_transaction_org_fkey','f'),('AppleConsumptionConsentEvent','AppleConsumptionConsentEvent_consent_org_fkey','f'),('AppleConsumptionRequest','AppleConsumptionRequest_notification_fkey','f'),('AppleConsumptionRequest','AppleConsumptionRequest_transaction_org_fkey','f')) expected(table_name,constraint_name,kind) WHERE NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass(format('public.%I',expected.table_name)) AND c.conname=expected.constraint_name AND c.contype::text=expected.kind AND c.convalidated AND (c.contype<>'f' OR (c.confupdtype='r' AND c.confdeltype='r')))"
  },
  {
    "name": "consumption_consent_original_buyer_binding_invalid",
    "severity": "blocker",
    "afterConsumption": true,
    "requires": [
      "AppleConsumptionConsent",
      "AppleConsumptionConsentEvent",
      "AppleConsumptionRequest",
      "AppleTransaction",
      "ApplePurchaseIntent",
      "AppleServerNotification"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleConsumptionConsent\" c LEFT JOIN public.\"AppleTransaction\" t ON t.id=c.\"appleTransactionId\" AND t.\"organizationId\"=c.\"organizationId\" LEFT JOIN public.\"ApplePurchaseIntent\" i ON i.id=t.\"intentId\" AND i.\"organizationId\"=t.\"organizationId\" WHERE t.id IS NULL OR i.id IS NULL OR c.\"purchaserId\" IS DISTINCT FROM i.\"createdById\" OR c.\"evidenceSource\"<>'BUYER_REPORTED'"
  },
  {
    "name": "consumption_consent_latest_audit_missing",
    "severity": "blocker",
    "afterConsumption": true,
    "requires": [
      "AppleConsumptionConsent",
      "AppleConsumptionConsentEvent",
      "AppleConsumptionRequest",
      "AppleTransaction",
      "ApplePurchaseIntent",
      "AppleServerNotification"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleConsumptionConsent\" c WHERE NOT EXISTS(SELECT 1 FROM public.\"AppleConsumptionConsentEvent\" e WHERE e.\"consentId\"=c.id AND e.revision=c.revision AND (e.\"organizationId\",e.\"actorId\",e.\"policyVersion\",e.consented,e.\"deliveryStatus\",e.\"sampleContentProvided\",e.\"evidenceSource\") IS NOT DISTINCT FROM (c.\"organizationId\",c.\"purchaserId\",c.\"policyVersion\",c.consented,c.\"deliveryStatus\",c.\"sampleContentProvided\",c.\"evidenceSource\"))"
  },
  {
    "name": "consumption_request_origin_deadline_invalid",
    "severity": "blocker",
    "afterConsumption": true,
    "requires": [
      "AppleConsumptionConsent",
      "AppleConsumptionConsentEvent",
      "AppleConsumptionRequest",
      "AppleTransaction",
      "ApplePurchaseIntent",
      "AppleServerNotification"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleConsumptionRequest\" r LEFT JOIN public.\"AppleServerNotification\" n ON n.id=r.id WHERE n.id IS NULL OR n.\"notificationType\"<>'CONSUMPTION_REQUEST' OR n.environment IS DISTINCT FROM r.environment OR r.\"receivedAt\" IS DISTINCT FROM n.\"createdAt\" OR r.\"deadlineAt\" IS DISTINCT FROM r.\"receivedAt\"+interval '12 hours'"
  },
  {
    "name": "consumption_request_tenant_binding_invalid",
    "severity": "blocker",
    "afterConsumption": true,
    "requires": [
      "AppleConsumptionConsent",
      "AppleConsumptionConsentEvent",
      "AppleConsumptionRequest",
      "AppleTransaction",
      "ApplePurchaseIntent",
      "AppleServerNotification"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleConsumptionRequest\" r LEFT JOIN public.\"AppleTransaction\" t ON t.id=r.\"appleTransactionId\" AND t.\"organizationId\"=r.\"organizationId\" WHERE ((r.\"appleTransactionId\" IS NULL)<>(r.\"organizationId\" IS NULL)) OR (r.\"appleTransactionId\" IS NOT NULL AND (t.id IS NULL OR (r.environment,r.\"transactionId\",r.\"originalTransactionId\",r.\"productId\",r.\"appAccountToken\") IS DISTINCT FROM (t.environment,t.\"transactionId\",t.\"originalTransactionId\",t.\"productId\",t.\"appAccountToken\")))"
  },
  {
    "name": "consumption_frozen_payload_audit_invalid",
    "severity": "blocker",
    "afterConsumption": true,
    "requires": [
      "AppleConsumptionConsent",
      "AppleConsumptionConsentEvent",
      "AppleConsumptionRequest",
      "AppleTransaction",
      "ApplePurchaseIntent",
      "AppleServerNotification"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleConsumptionRequest\" r WHERE r.payload IS NOT NULL AND (r.\"payloadDigest\" IS DISTINCT FROM public.\"appleConsumptionPayloadDigest\"(r.payload) OR NOT EXISTS(SELECT 1 FROM public.\"AppleConsumptionConsent\" c JOIN public.\"AppleConsumptionConsentEvent\" e ON e.\"consentId\"=c.id AND e.revision=r.\"consentRevision\" WHERE c.\"appleTransactionId\"=r.\"appleTransactionId\" AND c.\"organizationId\"=r.\"organizationId\" AND e.consented AND e.\"evidenceSource\"='BUYER_REPORTED' AND (r.payload->>'deliveryStatus') IS NOT DISTINCT FROM e.\"deliveryStatus\" AND r.payload->'sampleContentProvided' IS NOT DISTINCT FROM to_jsonb(e.\"sampleContentProvided\")))"
  },
  {
    "name": "consumption_sent_without_timely_frozen_attempt",
    "severity": "blocker",
    "afterConsumption": true,
    "requires": [
      "AppleConsumptionConsent",
      "AppleConsumptionConsentEvent",
      "AppleConsumptionRequest",
      "AppleTransaction",
      "ApplePurchaseIntent",
      "AppleServerNotification"
    ],
    "sql": "SELECT count(*) FROM public.\"AppleConsumptionRequest\" r WHERE (r.status='SENT' AND (r.\"sentAt\" IS NULL OR r.payload IS NULL OR r.\"attemptCount\"<1 OR r.\"lastAttemptAt\" IS NULL OR r.\"lastAttemptAt\">=r.\"deadlineAt\")) OR (r.status<>'SENT' AND r.\"sentAt\" IS NOT NULL)"
  },
  {
    "name": "consumption_indexes_missing_or_invalid",
    "severity": "blocker",
    "afterConsumption": true,
    "requires": [],
    "sql": "SELECT count(*) FROM (VALUES ('AppleConsumptionConsent_pkey','AppleConsumptionConsent',true,true,ARRAY['id']),('AppleConsumptionConsent_appleTransactionId_key','AppleConsumptionConsent',true,false,ARRAY['appleTransactionId']),('AppleConsumptionConsent_id_organizationId_key','AppleConsumptionConsent',true,false,ARRAY['id','organizationId']),('AppleConsumptionConsent_appleTransactionId_organizationId_key','AppleConsumptionConsent',true,false,ARRAY['appleTransactionId','organizationId']),('AppleConsumptionConsentEvent_pkey','AppleConsumptionConsentEvent',true,true,ARRAY['id']),('AppleConsumptionConsentEvent_consentId_revision_key','AppleConsumptionConsentEvent',true,false,ARRAY['consentId','revision']),('AppleConsumptionRequest_pkey','AppleConsumptionRequest',true,true,ARRAY['id']),('AppleConsumptionRequest_recovery_idx','AppleConsumptionRequest',false,false,ARRAY['status','nextAttemptAt','processingUntil']),('AppleConsumptionRequest_environment_transactionId_idx','AppleConsumptionRequest',false,false,ARRAY['environment','transactionId'])) expected(index_name,table_name,is_unique,is_primary,columns) LEFT JOIN pg_index i ON i.indexrelid=to_regclass(format('public.%I',expected.index_name)) WHERE i.indexrelid IS NULL OR i.indrelid<>to_regclass(format('public.%I',expected.table_name)) OR NOT i.indisvalid OR NOT i.indisready OR i.indisunique IS DISTINCT FROM expected.is_unique OR i.indisprimary IS DISTINCT FROM expected.is_primary OR i.indpred IS NOT NULL OR i.indexprs IS NOT NULL OR i.indnkeyatts<>cardinality(expected.columns) OR ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum,pos) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE k.pos<=i.indnkeyatts ORDER BY k.pos) IS DISTINCT FROM expected.columns"
  },
  {
    "name": "consumption_foreign_key_shapes_invalid",
    "severity": "blocker",
    "afterConsumption": true,
    "requires": [],
    "sql": "SELECT count(*) FROM (VALUES ('AppleConsumptionConsent','AppleConsumptionConsent_transaction_org_fkey','AppleTransaction',ARRAY['appleTransactionId','organizationId'],ARRAY['id','organizationId']),('AppleConsumptionConsentEvent','AppleConsumptionConsentEvent_consent_org_fkey','AppleConsumptionConsent',ARRAY['consentId','organizationId'],ARRAY['id','organizationId']),('AppleConsumptionRequest','AppleConsumptionRequest_notification_fkey','AppleServerNotification',ARRAY['id'],ARRAY['id']),('AppleConsumptionRequest','AppleConsumptionRequest_transaction_org_fkey','AppleTransaction',ARRAY['appleTransactionId','organizationId'],ARRAY['id','organizationId'])) expected(table_name,constraint_name,target_table,source_columns,target_columns) LEFT JOIN pg_constraint c ON c.conrelid=to_regclass(format('public.%I',expected.table_name)) AND c.conname=expected.constraint_name WHERE c.oid IS NULL OR c.contype<>'f' OR NOT c.convalidated OR c.confrelid<>to_regclass(format('public.%I',expected.target_table)) OR c.confupdtype<>'r' OR c.confdeltype<>'r' OR ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,pos) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.pos) IS DISTINCT FROM expected.source_columns OR ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,pos) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.pos) IS DISTINCT FROM expected.target_columns"
  },
  {
    "name": "consumption_constraint_definitions_changed",
    "severity": "blocker",
    "afterConsumption": true,
    "requires": [],
    "sql": "SELECT count(*) FROM (VALUES ('AppleConsumptionConsent_values_check','9fda043fe5ce01d43afe0bd9eb1c4ed7'),('AppleConsumptionRequest_values_check','59ac16f2cf21b7c32301597b0b115e05'),('AppleConsumptionRequest_notification_fkey','b994e850924dd8d5071b6d73e005824d'),('AppleConsumptionConsent_transaction_org_fkey','082847aed796d86e24916caeac7e9b25'),('AppleConsumptionRequest_transaction_org_fkey','082847aed796d86e24916caeac7e9b25'),('AppleConsumptionConsentEvent_consent_org_fkey','655de7c176cf9c65e8aafd27e6ace62b')) expected(name,digest) LEFT JOIN pg_constraint c ON c.conname=expected.name AND c.connamespace='public'::regnamespace WHERE c.oid IS NULL OR md5(pg_get_constraintdef(c.oid,true)) IS DISTINCT FROM expected.digest"
  },
  {
    "name": "consumption_trigger_definitions_changed",
    "severity": "blocker",
    "afterConsumption": true,
    "requires": [
      "AppleConsumptionConsent",
      "AppleConsumptionConsentEvent",
      "AppleConsumptionRequest",
      "AppleTransaction",
      "ApplePurchaseIntent",
      "AppleServerNotification"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('AppleConsumptionConsent_protect','4cf2218f4336cbad01118f5839dce06e'),('AppleConsumptionRequest_protect','edf58ccd1a7a6d342a34e81d8f09bc8c'),('AppleConsumptionConsentEvent_protect','cbe2b65974ece5836fdc43e227a33769'),('AppleConsumptionConsent_require_audit','54351ca0fc9817f5a0a196a27b2fee25')) expected(name,digest) LEFT JOIN pg_trigger t ON t.tgname=expected.name AND NOT t.tgisinternal AND t.tgrelid IN ('public.\"AppleConsumptionConsent\"'::regclass,'public.\"AppleConsumptionConsentEvent\"'::regclass,'public.\"AppleConsumptionRequest\"'::regclass) WHERE t.oid IS NULL OR md5(pg_get_triggerdef(t.oid,true)) IS DISTINCT FROM expected.digest"
  }
  ,{
    "name": "temporary_minimum_function_bodies_changed",
    "severity": "blocker",
    "afterMinimum": true,
    "requires": [],
    "sql": "SELECT count(*) FROM (VALUES ('public.\"appleTemporaryMinimumChargeValid\"(jsonb)','fc593a4b362f744113f28d4235439ab8','i'),('public.\"validateAppleTemporaryMinimumCharge\"()','f2ea8d4221bb86a573579f95b2035f00','v')) expected(signature,digest,volatility) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature) WHERE p.oid IS NULL OR md5(p.prosrc) IS DISTINCT FROM expected.digest OR p.provolatile::text IS DISTINCT FROM expected.volatility OR p.prosecdef"
  },
  {
    "name": "temporary_minimum_trigger_invalid",
    "severity": "blocker",
    "afterMinimum": true,
    "requires": ["ApplePurchaseIntent"],
    "sql": "SELECT count(*) FROM (VALUES ('ApplePurchaseIntent_temporary_minimum_guard')) expected(name) LEFT JOIN pg_trigger t ON t.tgname=expected.name AND t.tgrelid='public.\"ApplePurchaseIntent\"'::regclass AND NOT t.tgisinternal WHERE t.oid IS NULL OR t.tgfoid IS DISTINCT FROM to_regprocedure('public.\"validateAppleTemporaryMinimumCharge\"()') OR t.tgtype<>23 OR t.tgenabled<>'O' OR t.tgqual IS NOT NULL OR t.tgattr::text<>''"
  },
  {
    "name": "temporary_minimum_quote_invalid",
    "severity": "blocker",
    "afterMinimum": true,
    "requires": ["ApplePurchaseIntent.purchaseAppAccountToken"],
    "sql": "SELECT count(*) FROM public.\"ApplePurchaseIntent\" i WHERE NOT public.\"appleTemporaryMinimumChargeValid\"(i.\"purchaseSnapshot\") OR (i.\"purchaseSnapshot\"->'appleTemporaryUpgrade' ? 'minimumCharge') AND (i.scope<>'SUBSCRIPTION' OR i.action<>'CHANGE' OR i.\"productType\"<>'NON_RENEWING' OR i.\"purchaseAppAccountToken\" IS NULL)"
  },
  {
    "name": "temporary_upward_function_bodies_changed",
    "severity": "blocker",
    "afterUpward": true,
    "requires": [],
    "sql": "SELECT count(*) FROM (VALUES ('public.\"appleTemporaryUpwardRoundingValid\"(jsonb)','71eb6084e728435506840149cc05a6f8','i'),('public.\"validateAppleTemporaryUpwardRounding\"()','7661fab379de7a1f7391452c9491d3b5','v')) expected(signature,digest,volatility) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature) WHERE p.oid IS NULL OR md5(p.prosrc) IS DISTINCT FROM expected.digest OR p.provolatile::text IS DISTINCT FROM expected.volatility OR p.prosecdef"
  },
  {
    "name": "temporary_upward_trigger_invalid",
    "severity": "blocker",
    "afterUpward": true,
    "requires": [
      "ApplePurchaseIntent"
    ],
    "sql": "SELECT count(*) FROM (VALUES ('ApplePurchaseIntent_temporary_upward_guard')) expected(name) LEFT JOIN pg_trigger t ON t.tgname=expected.name AND t.tgrelid='public.\"ApplePurchaseIntent\"'::regclass AND NOT t.tgisinternal WHERE t.oid IS NULL OR t.tgfoid IS DISTINCT FROM to_regprocedure('public.\"validateAppleTemporaryUpwardRounding\"()') OR t.tgtype<>23 OR t.tgenabled<>'O' OR t.tgqual IS NOT NULL OR t.tgattr::text<>''"
  },
  {
    "name": "temporary_upward_quote_invalid",
    "severity": "blocker",
    "afterUpward": true,
    "requires": [
      "ApplePurchaseIntent.purchaseAppAccountToken"
    ],
    "sql": "SELECT count(*) FROM public.\"ApplePurchaseIntent\" i WHERE NOT public.\"appleTemporaryUpwardRoundingValid\"(i.\"purchaseSnapshot\") OR ((i.\"purchaseSnapshot\"->'appleTemporaryUpgrade' ? 'upwardRounding') OR (i.\"purchaseSnapshot\"->'appleTemporaryUpgrade' ? 'roundingMode')) AND (i.scope<>'SUBSCRIPTION' OR i.action<>'CHANGE' OR i.\"productType\"<>'NON_RENEWING' OR i.\"purchaseAppAccountToken\" IS NULL)"
  }
]
$checks$::jsonb)
  LOOP
    -- Older reviewed stages retain their existing report/check set. A partial
    -- 144 schema still executes these checks and blocks instead of hiding it.
    IF spec->>'afterUpward'='true' AND upward_present=0 AND upward_applied=0 THEN CONTINUE; END IF;
    IF spec->>'afterMinimum'='true' AND minimum_present=0 AND minimum_applied=0 THEN CONTINUE; END IF;
    IF spec->>'afterConsumption'='true' AND consumption_present=0 AND consumption_applied=0 THEN CONTINUE; END IF;
    IF spec->>'afterDeferred'='true' AND deferred_present=0 AND deferred_applied=0 THEN CONTINUE; END IF;
    missing := false;
    FOR requirement IN SELECT value FROM jsonb_array_elements(spec->'requires') LOOP
      parts := string_to_array(requirement#>>'{}','.');
      IF to_regclass(format('public.%I',parts[1])) IS NULL THEN missing := true;
      ELSIF array_length(parts,1)=2 AND NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass(format('public.%I',parts[1])) AND attname=parts[2] AND NOT attisdropped) THEN missing := true;
      END IF;
    END LOOP;
    IF missing THEN
      checks := checks || jsonb_build_array(jsonb_build_object('name',spec->>'name','severity',spec->>'severity','count',NULL,'skipped',true));
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE spec->>'sql' INTO affected;
      checks := checks || jsonb_build_array(jsonb_build_object('name',spec->>'name','severity',spec->>'severity','count',affected,'skipped',false));
    EXCEPTION WHEN OTHERS THEN
      -- Never emit SQLERRM: malformed historical values can contain personal data.
      GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE;
      checks := checks || jsonb_build_array(jsonb_build_object('name',spec->>'name','severity','blocker','count',NULL,'skipped',false,'errorCode',state));
    END;
  END LOOP;
  report := jsonb_build_object('reportVersion',1,'transactionReadOnly',true,'schemaStage',stage,'checks',checks);
  PERFORM set_config('bazaar.ios_apple_preflight',report::text,true);
END;
$audit$;
SELECT current_setting('bazaar.ios_apple_preflight')::jsonb;
COMMIT;
