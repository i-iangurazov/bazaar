-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "directedAssortment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StoreProduct" ADD COLUMN     "isDirect" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isHistorical" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AssortmentRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceStoreId" TEXT NOT NULL,
    "targetStoreId" TEXT NOT NULL,
    "label" TEXT,
    "scope" TEXT NOT NULL,
    "includeFuture" BOOLEAN NOT NULL DEFAULT true,
    "selectedProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssortmentRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssortmentGrant" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssortmentGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssortmentRule_organizationId_active_idx" ON "AssortmentRule"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AssortmentRule_sourceStoreId_targetStoreId_key" ON "AssortmentRule"("sourceStoreId", "targetStoreId");

-- CreateIndex
CREATE INDEX "AssortmentGrant_productId_idx" ON "AssortmentGrant"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "AssortmentGrant_ruleId_productId_key" ON "AssortmentGrant"("ruleId", "productId");

-- AddForeignKey
ALTER TABLE "AssortmentRule" ADD CONSTRAINT "AssortmentRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssortmentRule" ADD CONSTRAINT "AssortmentRule_sourceStoreId_fkey" FOREIGN KEY ("sourceStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssortmentRule" ADD CONSTRAINT "AssortmentRule_targetStoreId_fkey" FOREIGN KEY ("targetStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssortmentGrant" ADD CONSTRAINT "AssortmentGrant_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AssortmentRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssortmentGrant" ADD CONSTRAINT "AssortmentGrant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- No topology or ownership backfill. Existing assignments remain unresolved history.
ALTER TABLE "AssortmentRule" ADD CONSTRAINT "AssortmentRule_scope_check"
  CHECK ("sourceStoreId" <> "targetStoreId" AND scope IN ('ALL', 'SELECTED')
    AND (scope <> 'SELECTED' OR NOT "includeFuture"));

-- An older group editor cannot put a converted store back into automatic sharing.
CREATE FUNCTION protect_directed_assortment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD."directedAssortment" AND NOT NEW."directedAssortment") OR
     (NEW."directedAssortment" AND NEW."productCatalogId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Directed assortment cannot rejoin a legacy group';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_directed_assortment BEFORE UPDATE ON "Store"
  FOR EACH ROW EXECUTE FUNCTION protect_directed_assortment();

-- Future eligible assignments are propagated in the writer's own transaction.
-- A received assignment has isDirect=false and cannot cascade to another rule.
CREATE FUNCTION grant_future_assortment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE edge "AssortmentRule"%ROWTYPE;
BEGIN
  IF NOT NEW."isDirect" OR NOT NEW."isActive" THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD."isDirect" AND OLD."isActive" THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('assortment:' || NEW."organizationId", 0));
  FOR edge IN SELECT * FROM "AssortmentRule"
    WHERE "organizationId" = NEW."organizationId" AND "sourceStoreId" = NEW."storeId"
      AND active AND scope = 'ALL' AND "includeFuture"
  LOOP
    INSERT INTO "StoreProduct" (id, "organizationId", "storeId", "productId", "isActive", "isDirect", "isHistorical", "updatedAt")
    VALUES (gen_random_uuid()::text, NEW."organizationId", edge."targetStoreId", NEW."productId", true, false, false, now())
    ON CONFLICT ("storeId", "productId") DO UPDATE SET "isActive" = true;
    INSERT INTO "AssortmentGrant" (id, "ruleId", "productId")
    VALUES (gen_random_uuid()::text, edge.id, NEW."productId") ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER grant_future_assortment AFTER INSERT OR UPDATE OF "isDirect", "isActive" ON "StoreProduct"
  FOR EACH ROW EXECUTE FUNCTION grant_future_assortment();
