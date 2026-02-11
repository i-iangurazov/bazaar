import { Role } from "@prisma/client";
import type { OrganizationPlan } from "@prisma/client";

import { prisma } from "@/server/db/prisma";

export const shouldRunDbTests =
  process.env.CI === "true" || process.env.CI === "1" || process.env.RUN_DB_TESTS === "1";

export const resetDatabase = async () => {
  await prisma.customerOrderLine.deleteMany();
  await prisma.customerOrder.deleteMany();
  await prisma.organizationCounter.deleteMany();
  await prisma.purchaseOrderLine.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.importedEntity.deleteMany();
  await prisma.importRollbackReport.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.stockCountLine.deleteMany();
  await prisma.stockCount.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.periodClose.deleteMany();
  await prisma.exportJob.deleteMany();
  await prisma.storeComplianceProfile.deleteMany();
  await prisma.productComplianceFlags.deleteMany();
  await prisma.deadLetterJob.deleteMany();
  await prisma.stockLot.deleteMany();
  await prisma.inventorySnapshot.deleteMany();
  await prisma.reorderPolicy.deleteMany();
  await prisma.forecastSnapshot.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.diagnosticsReport.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.authToken.deleteMany();
  await prisma.productEvent.deleteMany();
  await prisma.storeFeatureFlag.deleteMany();
  await prisma.impersonationSession.deleteMany();
  await prisma.inviteToken.deleteMany();
  await prisma.accessRequest.deleteMany();
  await prisma.storePrice.deleteMany();
  await prisma.productCost.deleteMany();
  await prisma.variantAttributeValue.deleteMany();
  await prisma.categoryAttributeTemplate.deleteMany();
  await prisma.attributeDefinition.deleteMany();
  await prisma.productBarcode.deleteMany();
  await prisma.productImage.deleteMany();
  await prisma.productPack.deleteMany();
  await prisma.productBundleComponent.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.store.deleteMany();
  await prisma.onboardingProgress.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
};

export const seedBase = async (options?: {
  allowNegativeStock?: boolean;
  plan?: OrganizationPlan;
}) => {
  const org = await prisma.organization.create({
    data: {
      name: "Test Org",
      plan: options?.plan ?? "STARTER",
    },
  });
  const baseUnit = await prisma.unit.create({
    data: {
      organizationId: org.id,
      code: "each",
      labelRu: "each",
      labelKg: "each",
    },
  });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: "Test Store",
      code: "TST",
      allowNegativeStock: options?.allowNegativeStock ?? false,
    },
  });
  const supplier = await prisma.supplier.create({
    data: { organizationId: org.id, name: "Test Supplier" },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      supplierId: supplier.id,
      sku: "TEST-1",
      name: "Test Product",
      unit: baseUnit.code,
      baseUnitId: baseUnit.id,
    },
  });
  const adminUser = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "admin@test.local",
      name: "Admin User",
      passwordHash: "hash",
      role: Role.ADMIN,
      isOrgOwner: true,
      emailVerifiedAt: new Date(),
    },
  });
  const managerUser = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "manager@test.local",
      name: "Manager User",
      passwordHash: "hash",
      role: Role.MANAGER,
      emailVerifiedAt: new Date(),
    },
  });
  const staffUser = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "staff@test.local",
      name: "Staff User",
      passwordHash: "hash",
      role: Role.STAFF,
      emailVerifiedAt: new Date(),
    },
  });

  return { org, store, supplier, product, adminUser, managerUser, staffUser, baseUnit };
};
