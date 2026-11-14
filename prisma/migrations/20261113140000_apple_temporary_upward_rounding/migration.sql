-- Explicit UP cohort only. Historical DOWN, minimum charges and every existing
-- immutable source/price/period/usage check retain their original semantics.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE FUNCTION "appleTemporaryUpwardRoundingValid"(purchase JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE context JSONB; marker JSONB; price JSONB; value JSONB;
        due NUMERIC; charged NUMERIC; adjustment NUMERIC; millis NUMERIC; numerator NUMERIC; denominator NUMERIC;
BEGIN
  context := purchase->'appleTemporaryUpgrade';
  IF context IS NULL OR NOT (context ? 'upwardRounding' OR context ? 'roundingMode') THEN RETURN true; END IF;
  marker := context->'upwardRounding'; price := context->'price';
  IF jsonb_typeof(context) IS DISTINCT FROM 'object' OR jsonb_typeof(marker) IS DISTINCT FROM 'object' OR
     jsonb_typeof(price) IS DISTINCT FROM 'object' OR context->>'roundingMode' IS DISTINCT FROM 'UP_TO_COVER_QUOTE' OR
     context ? 'minimumCharge' OR purchase->>'kind' IS DISTINCT FROM 'UPGRADE' OR
     NULLIF(purchase->>'sourcePeriodId','') IS NULL OR jsonb_typeof(context->'version') IS DISTINCT FROM 'number' OR
     context->>'version' IS DISTINCT FROM '1' THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(marker))<>2 OR NOT (marker ? 'serviceAdjustmentMinor') OR
     jsonb_typeof(marker->'minimumPriceApplied') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
  FOREACH value IN ARRAY ARRAY[purchase->'amountMinor',context->'chargedServiceMinor',
    price->'priceMillis',price->'serviceMinorPerUnitNumerator',price->'serviceMinorPerUnitDenominator'] LOOP
    IF jsonb_typeof(value) IS DISTINCT FROM 'number' OR value::text !~ '^[1-9][0-9]{0,15}$' THEN RETURN false; END IF;
  END LOOP;
  IF jsonb_typeof(marker->'serviceAdjustmentMinor') IS DISTINCT FROM 'number' OR
     (marker->'serviceAdjustmentMinor')::text !~ '^(0|[1-9][0-9]{0,15})$' OR
     jsonb_typeof(context->'ownerDiscountMinor') IS DISTINCT FROM 'number' OR context->>'ownerDiscountMinor' IS DISTINCT FROM '0' THEN RETURN false; END IF;
  due := (purchase->>'amountMinor')::numeric; charged := (context->>'chargedServiceMinor')::numeric;
  adjustment := (marker->>'serviceAdjustmentMinor')::numeric; millis := (price->>'priceMillis')::numeric;
  numerator := (price->>'serviceMinorPerUnitNumerator')::numeric; denominator := (price->>'serviceMinorPerUnitDenominator')::numeric;
  RETURN due<=2147483647 AND charged<=9007199254740991 AND adjustment<=9007199254740991 AND millis<=9007199254740991 AND
    numerator<=1000000000 AND denominator<=1000000000 AND charged>=due AND charged=due+adjustment AND
    charged=ceil(millis*numerator/(1000*denominator)) AND millis*numerator>=due*1000*denominator AND
    (marker->>'minimumPriceApplied'='false' OR charged>due);
END;
$$;

CREATE FUNCTION "validateAppleTemporaryUpwardRounding"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT "appleTemporaryUpwardRoundingValid"(NEW."purchaseSnapshot") OR
    ((NEW."purchaseSnapshot"->'appleTemporaryUpgrade' ? 'upwardRounding') OR
     (NEW."purchaseSnapshot"->'appleTemporaryUpgrade' ? 'roundingMode')) AND
    (NEW.scope<>'SUBSCRIPTION' OR NEW.action<>'CHANGE' OR NEW."productType"<>'NON_RENEWING' OR NEW."purchaseAppAccountToken" IS NULL) THEN
    RAISE EXCEPTION 'Temporary upward rounding requires its exact covering price and immutable funded change' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ApplePurchaseIntent_temporary_upward_guard" BEFORE INSERT OR UPDATE ON "ApplePurchaseIntent"
  FOR EACH ROW EXECUTE FUNCTION "validateAppleTemporaryUpwardRounding"();
COMMIT;
