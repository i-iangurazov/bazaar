-- Repair environments where the original visibility migration was applied
-- with the old exclusion table name before the opt-in model was introduced.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'MMarketExcludedProduct'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'MMarketIncludedProduct'
  ) THEN
    CREATE TABLE "MMarketIncludedProduct" (
      "id" TEXT NOT NULL,
      "orgId" TEXT NOT NULL,
      "productId" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "MMarketIncludedProduct_pkey" PRIMARY KEY ("id")
    );

    ALTER TABLE "MMarketIncludedProduct"
    ADD CONSTRAINT "MMarketIncludedProduct_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

    ALTER TABLE "MMarketIncludedProduct"
    ADD CONSTRAINT "MMarketIncludedProduct_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

    CREATE UNIQUE INDEX "MMarketIncludedProduct_orgId_productId_key"
    ON "MMarketIncludedProduct"("orgId", "productId");

    CREATE INDEX "MMarketIncludedProduct_orgId_productId_idx"
    ON "MMarketIncludedProduct"("orgId", "productId");

    CREATE INDEX "MMarketIncludedProduct_productId_idx"
    ON "MMarketIncludedProduct"("productId");

    INSERT INTO "MMarketIncludedProduct" ("id", "orgId", "productId", "createdAt", "updatedAt")
    SELECT
      md5(random()::text || clock_timestamp()::text || p."id"),
      p."organizationId",
      p."id",
      NOW(),
      NOW()
    FROM "Product" p
    WHERE p."isDeleted" = false
      AND NOT EXISTS (
        SELECT 1
        FROM "MMarketExcludedProduct" e
        WHERE e."orgId" = p."organizationId"
          AND e."productId" = p."id"
      );

    DROP TABLE "MMarketExcludedProduct";
  END IF;
END $$;
