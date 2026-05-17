-- Store-level category visibility preferences for future product forms.
-- Existing Product.category/Product.categories values remain unchanged.
CREATE TABLE "StoreCategoryPreference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "isVisibleInForms" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCategoryPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoreCategoryPreference_storeId_normalizedName_key" ON "StoreCategoryPreference"("storeId", "normalizedName");
CREATE INDEX "StoreCategoryPreference_organizationId_storeId_isVisibleInForms_isArchived_idx" ON "StoreCategoryPreference"("organizationId", "storeId", "isVisibleInForms", "isArchived");
CREATE INDEX "StoreCategoryPreference_organizationId_normalizedName_idx" ON "StoreCategoryPreference"("organizationId", "normalizedName");

ALTER TABLE "StoreCategoryPreference"
    ADD CONSTRAINT "StoreCategoryPreference_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StoreCategoryPreference"
    ADD CONSTRAINT "StoreCategoryPreference_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
