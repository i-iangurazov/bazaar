-- Positive current-term upgrades may explicitly use their configured Apple minimum.
-- Historical quotes and every existing funding/date/usage guard remain unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE FUNCTION "appleTemporaryMinimumChargeValid"(purchase JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE context JSONB; marker JSONB; price JSONB; value JSONB;
        due NUMERIC; charged NUMERIC; adjustment NUMERIC; millis NUMERIC; numerator NUMERIC; denominator NUMERIC;
BEGIN
  context := purchase->'appleTemporaryUpgrade';
  IF context IS NULL OR NOT (context ? 'minimumCharge') THEN RETURN true; END IF;
  marker := context->'minimumCharge'; price := context->'price';
  IF jsonb_typeof(context) IS DISTINCT FROM 'object' OR jsonb_typeof(marker) IS DISTINCT FROM 'object' OR
     jsonb_typeof(price) IS DISTINCT FROM 'object' OR purchase->>'kind' IS DISTINCT FROM 'UPGRADE' OR
     NULLIF(purchase->>'sourcePeriodId','') IS NULL OR jsonb_typeof(context->'version') IS DISTINCT FROM 'number' OR
     context->>'version' IS DISTINCT FROM '1' THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(marker))<>1 OR NOT (marker ? 'serviceAdjustmentMinor') THEN RETURN false; END IF;
  FOREACH value IN ARRAY ARRAY[purchase->'amountMinor',context->'chargedServiceMinor',marker->'serviceAdjustmentMinor',
    price->'priceMillis',price->'serviceMinorPerUnitNumerator',price->'serviceMinorPerUnitDenominator'] LOOP
    IF jsonb_typeof(value) IS DISTINCT FROM 'number' OR value::text !~ '^[1-9][0-9]{0,15}$' THEN RETURN false; END IF;
  END LOOP;
  IF jsonb_typeof(context->'ownerDiscountMinor') IS DISTINCT FROM 'number' OR context->>'ownerDiscountMinor' IS DISTINCT FROM '0' THEN RETURN false; END IF;
  due := (purchase->>'amountMinor')::numeric; charged := (context->>'chargedServiceMinor')::numeric;
  adjustment := (marker->>'serviceAdjustmentMinor')::numeric; millis := (price->>'priceMillis')::numeric;
  numerator := (price->>'serviceMinorPerUnitNumerator')::numeric; denominator := (price->>'serviceMinorPerUnitDenominator')::numeric;
  RETURN due<=2147483647 AND charged<=9007199254740991 AND adjustment<=9007199254740991 AND millis<=9007199254740991 AND
    numerator<=1000000000 AND denominator<=1000000000 AND charged>due AND charged=due+adjustment AND
    charged=ceil(millis*numerator/(1000*denominator));
END;
$$;

CREATE FUNCTION "validateAppleTemporaryMinimumCharge"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT "appleTemporaryMinimumChargeValid"(NEW."purchaseSnapshot") OR
    (NEW."purchaseSnapshot"->'appleTemporaryUpgrade' ? 'minimumCharge') AND
    (NEW.scope<>'SUBSCRIPTION' OR NEW.action<>'CHANGE' OR NEW."productType"<>'NON_RENEWING' OR NEW."purchaseAppAccountToken" IS NULL) THEN
    RAISE EXCEPTION 'Temporary minimum charge requires its exact positive quote and funded change' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ApplePurchaseIntent_temporary_minimum_guard" BEFORE INSERT OR UPDATE ON "ApplePurchaseIntent"
  FOR EACH ROW EXECUTE FUNCTION "validateAppleTemporaryMinimumCharge"();
COMMIT;
