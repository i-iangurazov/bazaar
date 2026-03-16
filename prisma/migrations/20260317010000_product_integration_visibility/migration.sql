-- Product-level visibility controls for M-Market and Bazaar catalog

CREATE TABLE "MMarketIncludedProduct" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MMarketIncludedProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BazaarCatalogHiddenProduct" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BazaarCatalogHiddenProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MMarketIncludedProduct_orgId_productId_key" ON "MMarketIncludedProduct"("orgId", "productId");
CREATE INDEX "MMarketIncludedProduct_orgId_productId_idx" ON "MMarketIncludedProduct"("orgId", "productId");
CREATE INDEX "MMarketIncludedProduct_productId_idx" ON "MMarketIncludedProduct"("productId");

CREATE UNIQUE INDEX "BazaarCatalogHiddenProduct_storeId_productId_key" ON "BazaarCatalogHiddenProduct"("storeId", "productId");
CREATE INDEX "BazaarCatalogHiddenProduct_organizationId_storeId_productId_idx" ON "BazaarCatalogHiddenProduct"("organizationId", "storeId", "productId");
CREATE INDEX "BazaarCatalogHiddenProduct_productId_storeId_idx" ON "BazaarCatalogHiddenProduct"("productId", "storeId");

ALTER TABLE "MMarketIncludedProduct"
ADD CONSTRAINT "MMarketIncludedProduct_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MMarketIncludedProduct"
ADD CONSTRAINT "MMarketIncludedProduct_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BazaarCatalogHiddenProduct"
ADD CONSTRAINT "BazaarCatalogHiddenProduct_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BazaarCatalogHiddenProduct"
ADD CONSTRAINT "BazaarCatalogHiddenProduct_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BazaarCatalogHiddenProduct"
ADD CONSTRAINT "BazaarCatalogHiddenProduct_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
