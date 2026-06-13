ALTER TABLE "CustomerOrder"
  ADD COLUMN "isHeld" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "heldAt" TIMESTAMP(3),
  ADD COLUMN "heldById" TEXT;

CREATE INDEX "CustomerOrder_organizationId_isPosSale_isHeld_status_createdAt_idx"
  ON "CustomerOrder"("organizationId", "isPosSale", "isHeld", "status", "createdAt");

CREATE INDEX "CustomerOrder_registerId_isHeld_status_createdAt_idx"
  ON "CustomerOrder"("registerId", "isHeld", "status", "createdAt");
