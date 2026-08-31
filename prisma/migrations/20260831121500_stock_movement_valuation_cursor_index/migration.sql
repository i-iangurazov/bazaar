CREATE INDEX CONCURRENTLY "StockMovement_valuation_backfill_cursor_idx" ON "StockMovement" ("ledgerRecordedAt", "id");
