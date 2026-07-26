-- Store/variant-scoped percentage discounts and immutable order-line pricing snapshots.
BEGIN;

CREATE TYPE "CatalogDiscountType" AS ENUM ('PERCENTAGE');

ALTER TABLE "StorePrice"
  ADD COLUMN "discountType" "CatalogDiscountType",
  ADD COLUMN "discountPercentage" DECIMAL(5,2),
  ADD COLUMN "discountStartsAt" TIMESTAMP(3),
  ADD COLUMN "discountEndsAt" TIMESTAMP(3),
  ADD COLUMN "discountCreatedById" TEXT,
  ADD COLUMN "discountUpdatedAt" TIMESTAMP(3);

ALTER TABLE "StorePrice"
  ADD CONSTRAINT "StorePrice_discountCreatedById_fkey"
    FOREIGN KEY ("discountCreatedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "StorePrice_discount_pair_check"
    CHECK (("discountType" IS NULL) = ("discountPercentage" IS NULL)),
  ADD CONSTRAINT "StorePrice_discount_percentage_check"
    CHECK ("discountPercentage" IS NULL OR ("discountPercentage" > 0 AND "discountPercentage" < 100)),
  ADD CONSTRAINT "StorePrice_discount_schedule_check"
    CHECK ("discountStartsAt" IS NULL OR "discountEndsAt" IS NULL OR "discountEndsAt" > "discountStartsAt");

CREATE INDEX "StorePrice_organizationId_storeId_discountType_discountStartsAt_discountEndsAt_idx"
  ON "StorePrice"("organizationId", "storeId", "discountType", "discountStartsAt", "discountEndsAt");

ALTER TABLE "CustomerOrderLine"
  ADD COLUMN "baseUnitPriceKgs" DECIMAL(12,2),
  ADD COLUMN "appliedDiscountType" "CatalogDiscountType",
  ADD COLUMN "appliedDiscountPercentage" DECIMAL(5,2),
  ADD COLUMN "appliedDiscountAmountKgs" DECIMAL(12,2);

-- Existing order lines already contain their immutable final sale price. Seed the
-- new base snapshot with that value; no historical totals are recalculated.
UPDATE "CustomerOrderLine"
SET "baseUnitPriceKgs" = "unitPriceKgs"
WHERE "baseUnitPriceKgs" IS NULL;

ALTER TABLE "CustomerOrderLine"
  ADD CONSTRAINT "CustomerOrderLine_discount_snapshot_check"
    CHECK (
      ("appliedDiscountType" IS NULL AND "appliedDiscountPercentage" IS NULL AND "appliedDiscountAmountKgs" IS NULL)
      OR
      ("appliedDiscountType" IS NOT NULL AND "appliedDiscountPercentage" IS NOT NULL AND "appliedDiscountAmountKgs" IS NOT NULL)
    ),
  ADD CONSTRAINT "CustomerOrderLine_discount_percentage_check"
    CHECK ("appliedDiscountPercentage" IS NULL OR ("appliedDiscountPercentage" > 0 AND "appliedDiscountPercentage" < 100)),
  ADD CONSTRAINT "CustomerOrderLine_discount_amount_check"
    CHECK ("appliedDiscountAmountKgs" IS NULL OR "appliedDiscountAmountKgs" >= 0);

COMMIT;
