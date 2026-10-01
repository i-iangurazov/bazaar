-- Preserve product/store deletion when the application is rolled back.
ALTER TABLE "StorePriceTypes" DROP CONSTRAINT "StorePriceTypes_organizationId_fkey";
ALTER TABLE "StorePriceTypes" ADD CONSTRAINT "StorePriceTypes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorePriceTypes" DROP CONSTRAINT "StorePriceTypes_storeId_fkey";
ALTER TABLE "StorePriceTypes" ADD CONSTRAINT "StorePriceTypes_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorePriceTypes" DROP CONSTRAINT "StorePriceTypes_productId_fkey";
ALTER TABLE "StorePriceTypes" ADD CONSTRAINT "StorePriceTypes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorePriceTypes" DROP CONSTRAINT "StorePriceTypes_variantId_fkey";
ALTER TABLE "StorePriceTypes" ADD CONSTRAINT "StorePriceTypes_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorePriceTypes" DROP CONSTRAINT "StorePriceTypes_updatedById_fkey";
ALTER TABLE "StorePriceTypes" ADD CONSTRAINT "StorePriceTypes_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
