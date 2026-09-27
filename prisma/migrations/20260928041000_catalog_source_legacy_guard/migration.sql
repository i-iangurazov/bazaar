-- Source catalogues may be subscribed to, but cannot become legacy groups.
-- Otherwise an old group writer could insert a recipient's products into a source.
CREATE FUNCTION protect_source_catalog_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."productCatalogId" IS NOT NULL AND EXISTS (
  SELECT 1 FROM "ProductCatalog" WHERE id=NEW."productCatalogId" AND "sourceKey" IS NOT NULL
 ) THEN
  RAISE EXCEPTION 'Source catalogues require a StoreCatalog subscription';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_source_catalog_membership BEFORE INSERT OR UPDATE OF "productCatalogId" ON "Store"
 FOR EACH ROW EXECUTE FUNCTION protect_source_catalog_membership();
