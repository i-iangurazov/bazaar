-- Link sellable product variants to one of the product gallery images.
ALTER TABLE "ProductVariant" ADD COLUMN "imageId" TEXT;

CREATE INDEX "ProductVariant_imageId_idx" ON "ProductVariant"("imageId");

ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_imageId_fkey"
  FOREIGN KEY ("imageId") REFERENCES "ProductImage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
