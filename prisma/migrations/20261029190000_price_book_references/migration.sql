-- AddForeignKey
ALTER TABLE "PriceBookEntry" ADD CONSTRAINT "PriceBookEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBookEntry" ADD CONSTRAINT "PriceBookEntry_baseUnitId_fkey" FOREIGN KEY ("baseUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBookStore" ADD CONSTRAINT "PriceBookStore_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBookStoreItem" ADD CONSTRAINT "PriceBookStoreItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBookStoreItem" ADD CONSTRAINT "PriceBookStoreItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBookChange" ADD CONSTRAINT "PriceBookChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
