-- DropForeignKey
ALTER TABLE "CategoryAttributeTemplate" DROP CONSTRAINT "CategoryAttributeTemplate_definition_fkey";

-- DropForeignKey
ALTER TABLE "CategoryAttributeTemplate" DROP CONSTRAINT "CategoryAttributeTemplate_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "ImpersonationSession" DROP CONSTRAINT "ImpersonationSession_createdById_fkey";

-- DropForeignKey
ALTER TABLE "ImpersonationSession" DROP CONSTRAINT "ImpersonationSession_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "ImpersonationSession" DROP CONSTRAINT "ImpersonationSession_targetUserId_fkey";

-- DropForeignKey
ALTER TABLE "ImportBatch" DROP CONSTRAINT "ImportBatch_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "ImportRollbackReport" DROP CONSTRAINT "ImportRollbackReport_batchId_fkey";

-- DropForeignKey
ALTER TABLE "ImportedEntity" DROP CONSTRAINT "ImportedEntity_batchId_fkey";

-- DropForeignKey
ALTER TABLE "InviteToken" DROP CONSTRAINT "InviteToken_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "OnboardingProgress" DROP CONSTRAINT "OnboardingProgress_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "ProductEvent" DROP CONSTRAINT "ProductEvent_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "ProductPack" DROP CONSTRAINT "ProductPack_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "ProductPack" DROP CONSTRAINT "ProductPack_productId_fkey";

-- DropForeignKey
ALTER TABLE "PurchaseOrder" DROP CONSTRAINT "PurchaseOrder_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "StoreFeatureFlag" DROP CONSTRAINT "StoreFeatureFlag_storeId_fkey";

-- DropForeignKey
ALTER TABLE "Unit" DROP CONSTRAINT "Unit_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_organizationId_fkey";

-- AlterTable
ALTER TABLE "EsfReference" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "EttnReference" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FiscalReceipt" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "KkmConnectorDevice" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MarkingCodeCapture" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RefundRequest" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- RenameForeignKey
ALTER TABLE "VariantAttributeValue" RENAME CONSTRAINT "VariantAttributeValue_definition_fkey" TO "VariantAttributeValue_organizationId_key_fkey";

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPack" ADD CONSTRAINT "ProductPack_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPack" ADD CONSTRAINT "ProductPack_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryAttributeTemplate" ADD CONSTRAINT "CategoryAttributeTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryAttributeTemplate" ADD CONSTRAINT "CategoryAttributeTemplate_organizationId_attributeKey_fkey" FOREIGN KEY ("organizationId", "attributeKey") REFERENCES "AttributeDefinition"("organizationId", "key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportedEntity" ADD CONSTRAINT "ImportedEntity_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRollbackReport" ADD CONSTRAINT "ImportRollbackReport_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingProgress" ADD CONSTRAINT "OnboardingProgress_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreFeatureFlag" ADD CONSTRAINT "StoreFeatureFlag_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEvent" ADD CONSTRAINT "ProductEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteToken" ADD CONSTRAINT "InviteToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "CategoryAttributeTemplate_org_category_idx" RENAME TO "CategoryAttributeTemplate_organizationId_category_idx";

-- RenameIndex
ALTER INDEX "CategoryAttributeTemplate_org_category_key_key" RENAME TO "CategoryAttributeTemplate_organizationId_category_attribute_key";

-- RenameIndex
ALTER INDEX "EttnReference_organizationId_storeId_documentType_documentId_ke" RENAME TO "EttnReference_organizationId_storeId_documentType_documentI_key";

-- RenameIndex
ALTER INDEX "ImpersonationSession_org_createdAt_idx" RENAME TO "ImpersonationSession_organizationId_createdAt_idx";

-- RenameIndex
ALTER INDEX "ImportBatch_org_createdAt_idx" RENAME TO "ImportBatch_organizationId_createdAt_idx";

-- RenameIndex
ALTER INDEX "ImportedEntity_batch_entity_key" RENAME TO "ImportedEntity_batchId_entityType_entityId_key";

-- RenameIndex
ALTER INDEX "ImportedEntity_entity_idx" RENAME TO "ImportedEntity_entityType_entityId_idx";

-- RenameIndex
ALTER INDEX "ProductBundleComponent_bundleProductId_componentProductId_compo" RENAME TO "ProductBundleComponent_bundleProductId_componentProductId_c_key";

-- RenameIndex
ALTER INDEX "ProductEvent_org_type_createdAt_idx" RENAME TO "ProductEvent_organizationId_type_createdAt_idx";
