-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "catalogSourcesConfigured" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProductCatalog" ADD COLUMN     "includeFuture" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourceKey" TEXT,
ADD COLUMN     "sourceStoreId" TEXT;

-- CreateTable
CREATE TABLE "ProductCatalogProduct" (
    "catalogId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "ProductCatalogProduct_pkey" PRIMARY KEY ("catalogId","productId")
);

-- CreateTable
CREATE TABLE "StoreCatalog" (
    "storeId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "scope" TEXT NOT NULL DEFAULT 'ALL',
    "selectedProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCatalog_pkey" PRIMARY KEY ("storeId","catalogId")
);

-- CreateIndex
CREATE INDEX "ProductCatalogProduct_productId_idx" ON "ProductCatalogProduct"("productId");

-- CreateIndex
CREATE INDEX "StoreCatalog_catalogId_enabled_idx" ON "StoreCatalog"("catalogId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCatalog_sourceKey_key" ON "ProductCatalog"("sourceKey");

-- AddForeignKey
ALTER TABLE "ProductCatalog" ADD CONSTRAINT "ProductCatalog_sourceStoreId_fkey" FOREIGN KEY ("sourceStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCatalogProduct" ADD CONSTRAINT "ProductCatalogProduct_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "ProductCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCatalogProduct" ADD CONSTRAINT "ProductCatalogProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCatalog" ADD CONSTRAINT "StoreCatalog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCatalog" ADD CONSTRAINT "StoreCatalog_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "ProductCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- No data/topology backfill: existing stores keep their policy until an explicit save.
ALTER TABLE "StoreCatalog" ADD CONSTRAINT "StoreCatalog_scope_check" CHECK (scope IN ('ALL', 'SELECTED'));
ALTER TABLE "Store" ADD CONSTRAINT "Store_catalog_sources_policy_check"
 CHECK (NOT "catalogSourcesConfigured" OR ("directedAssortment" AND "productCatalogId" IS NULL));

CREATE FUNCTION catalog_product_available(target_store text, target_product text) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM "StoreCatalog" sc
  JOIN "ProductCatalogProduct" cp ON cp."catalogId" = sc."catalogId" AND cp."productId" = target_product
  JOIN "ProductCatalog" c ON c.id = sc."catalogId"
  JOIN "Store" s ON s.id = sc."storeId" AND s."organizationId" = c."organizationId"
  JOIN "Product" p ON p.id = cp."productId" AND p."organizationId" = s."organizationId"
  WHERE sc."storeId" = target_store AND sc.enabled
   AND (sc.scope = 'ALL' OR target_product = ANY(sc."selectedProductIds"))
 )
$$;

-- Old inventory/group/worker upserts cannot reactivate a disconnected product.
CREATE FUNCTION enforce_catalog_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT NEW."isDirect" AND EXISTS (SELECT 1 FROM "Store" WHERE id = NEW."storeId" AND "catalogSourcesConfigured") THEN
  NEW."isActive" := catalog_product_available(NEW."storeId", NEW."productId");
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enforce_catalog_access BEFORE INSERT OR UPDATE ON "StoreProduct"
 FOR EACH ROW EXECUTE FUNCTION enforce_catalog_access();

CREATE FUNCTION sync_catalog_product(target_store text, target_product text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE org text;
BEGIN
 SELECT "organizationId" INTO org FROM "Store" WHERE id = target_store AND "catalogSourcesConfigured";
 IF org IS NULL THEN RETURN; END IF;
 IF catalog_product_available(target_store, target_product) THEN
  INSERT INTO "StoreProduct" (id,"organizationId","storeId","productId","isActive","isDirect","isHistorical","updatedAt")
  VALUES (gen_random_uuid()::text,org,target_store,target_product,true,false,false,now())
  ON CONFLICT ("storeId","productId") DO UPDATE SET "isActive"=true, "updatedAt"=now()
   WHERE NOT "StoreProduct"."isActive";
 ELSE
  UPDATE "StoreProduct" SET "isActive"=false,"updatedAt"=now()
   WHERE "storeId"=target_store AND "productId"=target_product AND NOT "isDirect" AND "isActive";
 END IF;
END $$;
CREATE FUNCTION catalog_membership_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid text; pid text; target text;
BEGIN
 IF TG_OP='DELETE' THEN cid:=OLD."catalogId"; pid:=OLD."productId"; ELSE cid:=NEW."catalogId"; pid:=NEW."productId"; END IF;
 FOR target IN SELECT "storeId" FROM "StoreCatalog" WHERE "catalogId"=cid AND enabled LOOP
  PERFORM sync_catalog_product(target,pid);
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER catalog_membership_changed AFTER INSERT OR DELETE ON "ProductCatalogProduct"
 FOR EACH ROW EXECUTE FUNCTION catalog_membership_changed();

-- Only confirmed local assignments feed a store source. Receiving a product never cascades.
CREATE FUNCTION capture_catalog_products() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE legacy_catalog text; configured boolean;
BEGIN
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
CREATE TRIGGER capture_catalog_products AFTER INSERT OR UPDATE OF "isDirect","isActive" ON "StoreProduct"
 FOR EACH ROW EXECUTE FUNCTION capture_catalog_products();
