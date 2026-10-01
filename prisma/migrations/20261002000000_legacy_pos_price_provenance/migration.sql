-- Preserve quoted prices written by clients that predate price provenance.
-- New POS inserts explicitly provide their resolved source.
ALTER TABLE "CustomerOrderLine" ALTER COLUMN "priceSource" SET DEFAULT 'LEGACY';
UPDATE "CustomerOrderLine" l SET "manualPrice" = true, "priceSource" = 'LEGACY'
FROM "CustomerOrder" o WHERE o.id = l."customerOrderId" AND o.status = 'DRAFT'
AND l."priceSource" = 'STANDARD';

CREATE FUNCTION "preserveLegacyOrderLinePrice"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."priceSource" = 'LEGACY' THEN
      NEW."manualPrice" := true;
    END IF;
  ELSIF current_setting('bazaar.price_mode_write', true) IS DISTINCT FROM 'v1' THEN
    -- Legacy manual price edits write the base/discount columns even when the
    -- entered amount is unchanged. Quantity and loyalty edits do not write them.
    NEW."manualPrice" := true;
    NEW."priceSource" := 'MANUAL';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "preserveLegacyOrderLinePriceInsert"
BEFORE INSERT ON "CustomerOrderLine" FOR EACH ROW
EXECUTE FUNCTION "preserveLegacyOrderLinePrice"();
CREATE TRIGGER "preserveLegacyOrderLinePriceUpdate"
BEFORE UPDATE OF "baseUnitPriceKgs", "appliedDiscountType", "appliedDiscountPercentage", "appliedDiscountAmountKgs"
ON "CustomerOrderLine" FOR EACH ROW
EXECUTE FUNCTION "preserveLegacyOrderLinePrice"();
