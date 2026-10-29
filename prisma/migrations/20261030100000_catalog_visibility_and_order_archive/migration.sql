-- Additive defaults preserve every existing catalog and order.
ALTER TABLE "BazaarCatalog"
  ADD COLUMN "hideOutOfStock" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hideWithoutPhoto" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerOrder" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "CustomerOrder_organizationId_isPosSale_archivedAt_createdAt_idx"
  ON "CustomerOrder"("organizationId", "isPosSale", "archivedAt", "createdAt");
