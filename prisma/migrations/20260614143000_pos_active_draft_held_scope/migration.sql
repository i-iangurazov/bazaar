-- Held POS receipts remain DRAFT documents, but they must not block the
-- cashier/register from creating the next active sale draft.
DROP INDEX IF EXISTS "CustomerOrder_pos_active_draft_unique";

CREATE UNIQUE INDEX "CustomerOrder_pos_active_draft_unique"
  ON "CustomerOrder" ("registerId", "createdById")
  WHERE "isPosSale" = true
    AND "status" = 'DRAFT'
    AND "isHeld" = false
    AND "registerId" IS NOT NULL;
