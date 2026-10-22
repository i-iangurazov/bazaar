-- Preserve the rendering quality of existing jobs; new requests explicitly
-- choose balanced mode unless the merchant asks for maximum detail.
ALTER TABLE "ProductImageStudioJob" ADD COLUMN "highQuality" BOOLEAN NOT NULL DEFAULT true;
