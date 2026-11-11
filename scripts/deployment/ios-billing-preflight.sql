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
  base_missing INTEGER := 0; privacy_present INTEGER := 0; lifecycle_present INTEGER := 0; attempt_present INTEGER := 0; temporary_present INTEGER := 0;
  privacy_expected INTEGER := 14; lifecycle_expected INTEGER := 3;
  privacy_applied BIGINT := 0; lifecycle_applied BIGINT := 0; attempt_applied BIGINT := 0; temporary_applied BIGINT := 0; prerequisite_applied BIGINT := 0;
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
  stage := CASE WHEN base_missing>0 THEN 'UNBASELINED'
    WHEN privacy_present=0 AND lifecycle_present=0 AND attempt_present=0 AND temporary_present=0 THEN 'PRE_APPLE'
    WHEN privacy_present=privacy_expected AND lifecycle_present=0 AND attempt_present=0 AND temporary_present=0 THEN 'POST_PRIVACY'
    WHEN privacy_present=privacy_expected AND lifecycle_present=lifecycle_expected AND attempt_present=0 AND temporary_present=0 THEN 'POST_LIFECYCLE'
    WHEN privacy_present=privacy_expected AND lifecycle_present=lifecycle_expected AND attempt_present=1 AND temporary_present=0 THEN 'POST_NATIVE_ATTEMPT'
    WHEN privacy_present=privacy_expected AND lifecycle_present=lifecycle_expected AND attempt_present=1 AND temporary_present=4 THEN 'POST_TEMPORARY_UPGRADES'
    ELSE 'PARTIAL' END;
  checks := checks || jsonb_build_array(jsonb_build_object('name','baseline_required_tables_missing','severity','blocker','count',base_missing,'skipped',false));
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE $history$SELECT count(*) FILTER(WHERE migration_name='20261111120000_ios_apple_billing_privacy' AND finished_at IS NOT NULL),
      count(*) FILTER(WHERE migration_name='20261111130000_apple_lifecycle_recovery' AND finished_at IS NOT NULL),
      count(*) FILTER(WHERE migration_name='20261111140000_apple_native_attempt_recovery' AND finished_at IS NOT NULL),
      count(*) FILTER(WHERE migration_name='20261111150000_apple_temporary_upgrades' AND finished_at IS NOT NULL),
      count(*) FILTER(WHERE migration_name='20261111020000_manual_subscription_refunds' AND finished_at IS NOT NULL),
      count(*) FILTER(WHERE finished_at IS NULL),
      count(*) FILTER(WHERE finished_at IS NOT NULL AND (
        (migration_name='20261111120000_ios_apple_billing_privacy' AND checksum<>'734e62c89a76aaedb153eb0b8029021f7713074b4526ca5501dac9abd41e2f38') OR
        (migration_name='20261111130000_apple_lifecycle_recovery' AND checksum<>'4d43cb3a27d30016fde92eb2465ff9f6ec8f148faf8d41495be89063fde2dc10') OR
        (migration_name='20261111140000_apple_native_attempt_recovery' AND checksum<>'1b3d22538c669d7f940e45dc14127842c25fe14accbe753c8a2b7e3efed32d0b') OR
        (migration_name='20261111150000_apple_temporary_upgrades' AND checksum<>'a13faf83ce11ad2c39480fbce1791299b82fd4fa58971bf3548f905c629a714f') OR
        (migration_name='20261111020000_manual_subscription_refunds' AND checksum<>'800cd487fb2d4b0ecd5501e5edc7182c4a06b851f68b0b02c18e40d795370b87')))
      FROM public._prisma_migrations WHERE rolled_back_at IS NULL$history$ INTO privacy_applied,lifecycle_applied,attempt_applied,temporary_applied,prerequisite_applied,unfinished,bad_checksum;
  ELSE structural_issues := structural_issues + 1;
  END IF;
  IF privacy_applied>1 OR lifecycle_applied>1 OR attempt_applied>1 OR temporary_applied>1 OR (lifecycle_applied>0 AND privacy_applied=0) OR (attempt_applied>0 AND lifecycle_applied=0) OR (temporary_applied>0 AND attempt_applied=0) THEN structural_issues := structural_issues + 1; END IF;
  IF (privacy_applied=0 AND privacy_present>0) OR (privacy_applied>0 AND privacy_present<>privacy_expected) OR
     (lifecycle_applied=0 AND lifecycle_present>0) OR (lifecycle_applied>0 AND lifecycle_present<>lifecycle_expected) OR
     (attempt_applied=0 AND attempt_present>0) OR (attempt_applied>0 AND attempt_present<>1) OR
     (temporary_applied=0 AND temporary_present>0) OR (temporary_applied>0 AND temporary_present<>4) OR stage='PARTIAL' THEN structural_issues := structural_issues + 1; END IF;
  checks := checks || jsonb_build_array(
    jsonb_build_object('name','apple_migrations_applied','severity','info','count',privacy_applied+lifecycle_applied+attempt_applied+temporary_applied,'skipped',false),
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
    "sql": "SELECT count(*) FROM (VALUES ('public.\"protectAppleBillingAccount\"()','4904d780da38a5efbff724bb0d32bc4e','4904d780da38a5efbff724bb0d32bc4e','4904d780da38a5efbff724bb0d32bc4e','4904d780da38a5efbff724bb0d32bc4e'),('public.\"protectAppleIntent\"()','a2b71c63f15c7be726f8d3d42090ed56','a2b71c63f15c7be726f8d3d42090ed56','9706a471dcd7db0a400272f56d139950','e5824764ed973923bfa00f5d43161736'),('public.\"protectAppleChain\"()','3634b6c5f2c0955fc580d2ad017d8d64','3634b6c5f2c0955fc580d2ad017d8d64','3634b6c5f2c0955fc580d2ad017d8d64','3634b6c5f2c0955fc580d2ad017d8d64'),('public.\"protectAppleTransaction\"()','8d2d58e95e8f7abdf41723580d3d6118','c0d1aa0c2d552bf7d0c6903d10c334df','c0d1aa0c2d552bf7d0c6903d10c334df','d5b8ad3944dd390d2bca199c1e5bf5fc'),('public.\"protectAppleEvidence\"()','d3d80c29afbef01e6bbebf0adac8fdce','d3d80c29afbef01e6bbebf0adac8fdce','d3d80c29afbef01e6bbebf0adac8fdce','d3d80c29afbef01e6bbebf0adac8fdce'),('public.\"validateSubscriptionPeriodPurchase\"()','4516cb685f2d33cd0b58ff1e9f4d6df8','4516cb685f2d33cd0b58ff1e9f4d6df8','4516cb685f2d33cd0b58ff1e9f4d6df8','bc99297825556f5315154b239f4e16e6'),('public.\"protectSubscriptionPeriodSource\"()','249ab5329614e549df495b8b578acbc7','0e25ad94de6eb2476d52c55b771153ce','0e25ad94de6eb2476d52c55b771153ce','5aaa87a5f4c5a789d5dbe6707e453ad5'),('public.\"protectWhatsAppCreditSource\"()','3bf9077d0608e9b09ed4043935a1a6fb','3bf9077d0608e9b09ed4043935a1a6fb','3bf9077d0608e9b09ed4043935a1a6fb','3bf9077d0608e9b09ed4043935a1a6fb'),('public.\"protectDeletedUserIdentity\"()','33f7de835b228f8414800d6633cf803f','33f7de835b228f8414800d6633cf803f','33f7de835b228f8414800d6633cf803f','33f7de835b228f8414800d6633cf803f'),('public.\"enforceSubscriptionCapacity\"()','045d31abb34abb69cd318592e35175c0','da4172d8d0001200163f24d4c34f6146','da4172d8d0001200163f24d4c34f6146','f3ec3ba91a1136ab203b6640574a5c3b'),('public.\"assertSubscriptionFeatureConfiguration\"(text,text)','46750b3c1edc7cd45a8be46629819179','161b96ade46fe7ee1d24f42a5a38c156','161b96ade46fe7ee1d24f42a5a38c156','f8c3a43fc0e4bc603c127918a1dd3848'),('public.\"enforceSubscriptionMarketplaceChannel\"()','f13db24fddd9405aacb634c58a8c7626','80e2425b0b5bf48838d6342e4b54421c','80e2425b0b5bf48838d6342e4b54421c','1abf4c09fd923d2bfecefe1e8cad9e18')) AS expected(signature,privacy_digest,lifecycle_digest,native_digest,temporary_digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature) WHERE p.oid IS NULL OR md5(p.prosrc) IS DISTINCT FROM CASE WHEN EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.\"SubscriptionPeriod\"'::regclass AND attname='parentPeriodId' AND NOT attisdropped) THEN expected.temporary_digest WHEN EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.\"ApplePurchaseIntent\"'::regclass AND attname='nativeAttemptId' AND NOT attisdropped) THEN expected.native_digest WHEN EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.\"AppleTransaction\"'::regclass AND attname='supersededAt' AND NOT attisdropped) THEN expected.lifecycle_digest ELSE expected.privacy_digest END"
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
  }
]
$checks$::jsonb)
  LOOP
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
