-- Additive and inert until an explicit store visibility action. No stock or product backfill.
ALTER TABLE "StoreProduct" ADD COLUMN "isHidden" BOOLEAN NOT NULL DEFAULT false;

-- Keep local exclusions authoritative, including old inventory/price/worker upserts.
CREATE OR REPLACE FUNCTION enforce_catalog_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."isHidden" THEN
  NEW."isActive" := false;
 ELSIF NOT NEW."isDirect" AND EXISTS (SELECT 1 FROM "Store" WHERE id = NEW."storeId" AND "catalogSourcesConfigured") THEN
  NEW."isActive" := catalog_product_available(NEW."storeId", NEW."productId");
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION capture_catalog_products() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE legacy_catalog text; configured boolean;
BEGIN
 -- Local visibility never removes membership from a source shared with other stores.
 IF NEW."isHidden" THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD."isDirect"=NEW."isDirect" AND OLD."isActive"=NEW."isActive" THEN RETURN NEW; END IF;
 IF NEW."isDirect" AND NEW."isActive" THEN
  INSERT INTO "ProductCatalogProduct" ("catalogId","productId")
   SELECT id,NEW."productId" FROM "ProductCatalog"
   WHERE "sourceStoreId"=NEW."storeId" AND "organizationId"=NEW."organizationId" AND "includeFuture"
   ON CONFLICT DO NOTHING;
 ELSIF TG_OP='UPDATE' AND OLD."isDirect" AND OLD."isActive" THEN
  DELETE FROM "ProductCatalogProduct" cp USING "ProductCatalog" c
   WHERE cp."catalogId"=c.id AND c."sourceKey"='store:'||NEW."storeId" AND cp."productId"=NEW."productId";
 END IF;
 SELECT "productCatalogId", "directedAssortment" INTO legacy_catalog,configured FROM "Store" WHERE id=NEW."storeId";
 IF legacy_catalog IS NOT NULL AND NOT configured AND NEW."isActive" THEN
  INSERT INTO "ProductCatalogProduct" ("catalogId","productId") VALUES (legacy_catalog,NEW."productId") ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
