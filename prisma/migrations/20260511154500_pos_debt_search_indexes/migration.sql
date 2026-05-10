CREATE INDEX IF NOT EXISTS "CustomerOrder_organizationId_storeId_isDebt_debtSettledAt_status_completedAt_idx"
  ON "CustomerOrder"("organizationId", "storeId", "isDebt", "debtSettledAt", "status", "completedAt");
