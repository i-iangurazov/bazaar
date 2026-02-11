CREATE INDEX IF NOT EXISTS "Product_organizationId_isDeleted_name_idx"
  ON "Product"("organizationId", "isDeleted", "name");

CREATE INDEX IF NOT EXISTS "Product_organizationId_category_isDeleted_idx"
  ON "Product"("organizationId", "category", "isDeleted");

CREATE INDEX IF NOT EXISTS "InventorySnapshot_storeId_updatedAt_idx"
  ON "InventorySnapshot"("storeId", "updatedAt");

CREATE INDEX IF NOT EXISTS "PurchaseOrder_organizationId_createdAt_idx"
  ON "PurchaseOrder"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "PurchaseOrder_organizationId_status_createdAt_idx"
  ON "PurchaseOrder"("organizationId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "PurchaseOrderLine_purchaseOrderId_idx"
  ON "PurchaseOrderLine"("purchaseOrderId");

CREATE INDEX IF NOT EXISTS "PurchaseOrderLine_productId_variantId_idx"
  ON "PurchaseOrderLine"("productId", "variantId");
