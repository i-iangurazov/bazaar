CREATE INDEX IF NOT EXISTS "User_organizationId_isActive_idx"
  ON "User"("organizationId", "isActive");

CREATE INDEX IF NOT EXISTS "Store_organizationId_name_idx"
  ON "Store"("organizationId", "name");

CREATE INDEX IF NOT EXISTS "PlanUpgradeRequest_organizationId_createdAt_idx"
  ON "PlanUpgradeRequest"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "InventorySnapshot_storeId_onHand_idx"
  ON "InventorySnapshot"("storeId", "onHand");

CREATE INDEX IF NOT EXISTS "StockMovement_storeId_createdAt_idx"
  ON "StockMovement"("storeId", "createdAt");

CREATE INDEX IF NOT EXISTS "PurchaseOrder_organizationId_storeId_status_createdAt_idx"
  ON "PurchaseOrder"("organizationId", "storeId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "CustomerOrder_organizationId_storeId_isDebt_debtSettledAt_idx"
  ON "CustomerOrder"("organizationId", "storeId", "isDebt", "debtSettledAt");

CREATE INDEX IF NOT EXISTS "CustomerOrder_organizationId_storeId_status_completedAt_idx"
  ON "CustomerOrder"("organizationId", "storeId", "status", "completedAt");

CREATE INDEX IF NOT EXISTS "ReorderPolicy_storeId_minStock_idx"
  ON "ReorderPolicy"("storeId", "minStock");

CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_createdAt_idx"
  ON "AuditLog"("organizationId", "createdAt");
