-- CreateTable
CREATE TABLE "PriceBook" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'KGS',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceBook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceBookEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL DEFAULT 'BASE',
    "baseUnitId" TEXT NOT NULL,
    "retailPriceKgs" DECIMAL(12,2) NOT NULL,
    "wholesalePriceKgs" DECIMAL(12,2),

    CONSTRAINT "PriceBookEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceBookStore" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "preserveLocal" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PriceBookStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceBookStoreItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL DEFAULT 'BASE',
    "retailShared" BOOLEAN NOT NULL,
    "wholesaleShared" BOOLEAN NOT NULL,

    CONSTRAINT "PriceBookStoreItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceBookChange" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "scope" JSONB NOT NULL,
    "before" JSONB NOT NULL,
    "afterHash" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceBookChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceBook_organizationId_name_key" ON "PriceBook"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBook_id_organizationId_key" ON "PriceBook"("id", "organizationId");

-- CreateIndex
CREATE INDEX "PriceBookEntry_organizationId_productId_idx" ON "PriceBookEntry"("organizationId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBookEntry_bookId_productId_variantKey_key" ON "PriceBookEntry"("bookId", "productId", "variantKey");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBookStore_storeId_key" ON "PriceBookStore"("storeId");

-- CreateIndex
CREATE INDEX "PriceBookStore_organizationId_bookId_idx" ON "PriceBookStore"("organizationId", "bookId");

-- CreateIndex
CREATE INDEX "PriceBookStoreItem_organizationId_bookId_idx" ON "PriceBookStoreItem"("organizationId", "bookId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBookStoreItem_storeId_productId_variantKey_key" ON "PriceBookStoreItem"("storeId", "productId", "variantKey");

-- CreateIndex
CREATE INDEX "PriceBookChange_organizationId_bookId_createdAt_idx" ON "PriceBookChange"("organizationId", "bookId", "createdAt");

-- AddForeignKey
ALTER TABLE "PriceBook" ADD CONSTRAINT "PriceBook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBookEntry" ADD CONSTRAINT "PriceBookEntry_bookId_organizationId_fkey" FOREIGN KEY ("bookId", "organizationId") REFERENCES "PriceBook"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBookStore" ADD CONSTRAINT "PriceBookStore_bookId_organizationId_fkey" FOREIGN KEY ("bookId", "organizationId") REFERENCES "PriceBook"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBookStoreItem" ADD CONSTRAINT "PriceBookStoreItem_bookId_organizationId_fkey" FOREIGN KEY ("bookId", "organizationId") REFERENCES "PriceBook"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBookChange" ADD CONSTRAINT "PriceBookChange_bookId_organizationId_fkey" FOREIGN KEY ("bookId", "organizationId") REFERENCES "PriceBook"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- No existing price, assortment or stock is changed by this migration.
ALTER TABLE "PriceBook" ADD CONSTRAINT "PriceBook_currency_check" CHECK ("currencyCode" = 'KGS');
ALTER TABLE "PriceBookEntry" ADD CONSTRAINT "PriceBookEntry_prices_check" CHECK ("retailPriceKgs" >= 0 AND ("wholesalePriceKgs" IS NULL OR "wholesalePriceKgs" >= 0));
CREATE FUNCTION bazaar_price_book_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME IN ('PriceBookStore', 'PriceBookStoreItem') THEN
  IF NOT EXISTS (
    SELECT 1 FROM "Store" WHERE id=NEW."storeId" AND "organizationId"=NEW."organizationId"
  ) THEN RAISE EXCEPTION 'priceBookScopeMismatch'; END IF;
  END IF;
  IF TG_TABLE_NAME IN ('PriceBookEntry', 'PriceBookStoreItem') THEN
    IF NOT EXISTS (SELECT 1 FROM "Product" WHERE id=NEW."productId" AND "organizationId"=NEW."organizationId")
      OR (NEW."variantKey" <> 'BASE' AND NOT EXISTS (SELECT 1 FROM "ProductVariant" WHERE id=NEW."variantKey" AND "productId"=NEW."productId"))
    THEN RAISE EXCEPTION 'priceBookScopeMismatch'; END IF;
  END IF;
  IF TG_TABLE_NAME='PriceBookEntry' THEN
  IF NOT EXISTS (
    SELECT 1 FROM "Product" WHERE id=NEW."productId" AND "baseUnitId"=NEW."baseUnitId"
  ) THEN RAISE EXCEPTION 'priceBookUnitConflict'; END IF;
  END IF;
  IF TG_TABLE_NAME='PriceBookChange' THEN
  IF NOT EXISTS (
    SELECT 1 FROM "User" WHERE id=NEW."actorId" AND "organizationId"=NEW."organizationId"
  ) THEN RAISE EXCEPTION 'priceBookScopeMismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER price_book_entry_scope BEFORE INSERT OR UPDATE ON "PriceBookEntry" FOR EACH ROW EXECUTE FUNCTION bazaar_price_book_scope();
CREATE TRIGGER price_book_store_scope BEFORE INSERT OR UPDATE ON "PriceBookStore" FOR EACH ROW EXECUTE FUNCTION bazaar_price_book_scope();
CREATE TRIGGER price_book_item_scope BEFORE INSERT OR UPDATE ON "PriceBookStoreItem" FOR EACH ROW EXECUTE FUNCTION bazaar_price_book_scope();
CREATE TRIGGER price_book_change_scope BEFORE INSERT OR UPDATE ON "PriceBookChange" FOR EACH ROW EXECUTE FUNCTION bazaar_price_book_scope();

-- Legacy editors/imports keep working. A changed individual price leaves inheritance
-- for that kind only. Discount-only/name-only updates and equal price writes do not.
CREATE FUNCTION bazaar_price_book_local_edit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r boolean := false; w boolean := false; affected_book text;
BEGIN
  IF current_setting('bazaar.price_book_write', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP='DELETE' THEN
    r := true; w := TG_TABLE_NAME='StorePriceTypes';
  ELSIF TG_OP='UPDATE' THEN
    IF TG_TABLE_NAME='StorePrice' THEN r := NEW."priceKgs" IS DISTINCT FROM OLD."priceKgs";
    ELSE
      r := NEW."retailPriceKgs" IS DISTINCT FROM OLD."retailPriceKgs";
      w := NEW."wholesalePriceKgs" IS DISTINCT FROM OLD."wholesalePriceKgs";
    END IF;
  ELSE
    IF TG_TABLE_NAME='StorePrice' THEN r := true;
    ELSE r := NEW."retailPriceKgs" IS NOT NULL; w := NEW."wholesalePriceKgs" IS NOT NULL; END IF;
  END IF;
  IF r OR w THEN
    UPDATE "PriceBookStoreItem" i SET
      "retailShared"=CASE WHEN r THEN false ELSE i."retailShared" END,
      "wholesaleShared"=CASE WHEN w THEN false ELSE i."wholesaleShared" END
    WHERE i."organizationId"=COALESCE(NEW."organizationId", OLD."organizationId")
      AND i."storeId"=COALESCE(NEW."storeId", OLD."storeId")
      AND i."productId"=COALESCE(NEW."productId", OLD."productId")
      AND i."variantKey"=COALESCE(NEW."variantKey", OLD."variantKey")
      AND ((r AND i."retailShared") OR (w AND i."wholesaleShared"))
    RETURNING i."bookId" INTO affected_book;
    IF affected_book IS NOT NULL THEN
      UPDATE "PriceBook" SET version=version+1, "updatedAt"=CURRENT_TIMESTAMP WHERE id=affected_book;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER price_book_local_standard AFTER INSERT OR UPDATE OR DELETE ON "StorePrice" FOR EACH ROW EXECUTE FUNCTION bazaar_price_book_local_edit();
CREATE TRIGGER price_book_local_typed AFTER INSERT OR UPDATE OR DELETE ON "StorePriceTypes" FOR EACH ROW EXECUTE FUNCTION bazaar_price_book_local_edit();
CREATE FUNCTION bazaar_price_book_unit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."baseUnitId" IS DISTINCT FROM OLD."baseUnitId" AND EXISTS (
    SELECT 1 FROM "PriceBookEntry" e WHERE e."productId"=OLD.id
  ) THEN RAISE EXCEPTION 'priceBookUnitConflict'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER price_book_unit_guard BEFORE UPDATE OF "baseUnitId" ON "Product" FOR EACH ROW EXECUTE FUNCTION bazaar_price_book_unit_guard();
