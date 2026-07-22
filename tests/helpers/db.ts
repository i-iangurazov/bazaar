import { Role } from "@prisma/client";
import type { OrganizationPlan } from "@prisma/client";

import { prisma } from "@/server/db/prisma";

import {
  assertSafeTestDatabaseReset,
  isDatabaseTestExecutionEnabled,
} from "./testDatabaseSafety";

export const shouldRunDbTests = isDatabaseTestExecutionEnabled();

export const resetDatabase = async () => {
  assertSafeTestDatabaseReset();
  await prisma.$executeRawUnsafe(`
    DO $$
    DECLARE
      truncate_sql text;
    BEGIN
      SELECT
        'TRUNCATE TABLE ' ||
        string_agg(format('%I.%I', schemaname, tablename), ', ') ||
        ' RESTART IDENTITY CASCADE'
      INTO truncate_sql
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename <> '_prisma_migrations';

      IF truncate_sql IS NOT NULL THEN
        EXECUTE truncate_sql;
      END IF;
    END $$;
  `);
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
  await prisma.storeProduct.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      isActive: true,
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
  const cashierUser = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "cashier@test.local",
      name: "Cashier User",
      passwordHash: "hash",
      role: Role.CASHIER,
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.userStoreAccess.createMany({
    data: [managerUser, staffUser, cashierUser].map((user) => ({
      organizationId: org.id,
      userId: user.id,
      storeId: store.id,
    })),
    skipDuplicates: true,
  });

  return {
    org,
    store,
    supplier,
    product,
    adminUser,
    managerUser,
    staffUser,
    cashierUser,
    baseUnit,
  };
};
