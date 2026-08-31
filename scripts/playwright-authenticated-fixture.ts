import bcrypt from "bcryptjs";
import {
  CustomerOrderStatus,
  LegalEntityType,
  OrganizationPlan,
  PrismaClient,
  PurchaseOrderStatus,
  RegisterShiftStatus,
  Role,
  StockCountStatus,
  StockMovementType,
} from "@prisma/client";

import {
  assertAuthenticatedE2EDatabaseUrl,
  authenticatedE2EAccounts,
  authenticatedE2EAccountKeys,
  authenticatedE2EIds,
  authenticatedE2EPassword,
  authenticatedE2ESeedPrefix,
} from "../tests/e2e/authenticated/contract";
import { seedAuthenticatedAccountingFixtures } from "./playwright-authenticated-accounting-fixture";
import { seedAuthenticatedAdvancedProductFixtures } from "./playwright-authenticated-advanced-product-fixture";
import { seedAuthenticatedAuthLifecycleFixtures } from "./playwright-authenticated-auth-lifecycle-fixture";
import { seedAuthenticatedCatalogPublicationFixtures } from "./playwright-authenticated-catalog-publication-fixture";
import { seedAuthenticatedInventoryMutationFixtures } from "./playwright-authenticated-inventory-mutations-fixture";
import { seedAuthenticatedMasterDataProcurementFixtures } from "./playwright-authenticated-master-data-procurement-fixture";
import { seedAuthenticatedPosMobileFixtures } from "./playwright-authenticated-pos-mobile-fixture";
import { seedAuthenticatedPosOperationsFixtures } from "./playwright-authenticated-pos-operations-fixture";
import { seedAuthenticatedSalesOrderFixtures } from "./playwright-authenticated-sales-order-fixture";

const seedAuthorizationVariable = "ALLOW_AUTHENTICATED_E2E_SEED";
const primaryOrganizationId = authenticatedE2EIds.primaryOrganization;
const secondOrganizationId = authenticatedE2EIds.secondOrganization;
const allowedOrganizationIds = new Set([primaryOrganizationId, secondOrganizationId]);
const allowedStoreIds = new Set([
  authenticatedE2EIds.primaryStore,
  authenticatedE2EIds.secondaryStore,
  authenticatedE2EIds.secondTenantStore,
  authenticatedE2EIds.secondTenantSecondaryStore,
]);

const userId = (key: (typeof authenticatedE2EAccountKeys)[number]) =>
  `qa_bazaar_auth_user_${key.replace(/[A-Z]/g, (value) => `_${value.toLowerCase()}`)}`;

const assertSeedAuthorization = () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Authenticated Playwright fixtures are forbidden in production.");
  }
  if (process.env[seedAuthorizationVariable] !== "1") {
    throw new Error(
      `${seedAuthorizationVariable}=1 is required before authenticated Playwright fixtures may write.`,
    );
  }
};

const assertSeedOwnership = async (prisma: PrismaClient) => {
  const [
    organizations,
    stores,
    units,
    suppliers,
    products,
    orders,
    purchaseOrders,
    stockCounts,
    users,
  ] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: [...allowedOrganizationIds] } },
      select: { id: true, name: true },
    }),
    prisma.store.findMany({
      where: { id: { in: [...allowedStoreIds] } },
      select: { id: true, organizationId: true, name: true },
    }),
    prisma.unit.findMany({
      where: {
        id: { in: [authenticatedE2EIds.primaryUnit, authenticatedE2EIds.secondTenantUnit] },
      },
      select: { id: true, organizationId: true },
    }),
    prisma.supplier.findMany({
      where: {
        id: {
          in: [authenticatedE2EIds.primarySupplier, authenticatedE2EIds.secondTenantSupplier],
        },
      },
      select: { id: true, organizationId: true, name: true },
    }),
    prisma.product.findMany({
      where: {
        id: { in: [authenticatedE2EIds.primaryProduct, authenticatedE2EIds.secondTenantProduct] },
      },
      select: { id: true, organizationId: true, name: true },
    }),
    prisma.customerOrder.findMany({
      where: {
        id: { in: [authenticatedE2EIds.primaryOrder, authenticatedE2EIds.secondTenantOrder] },
      },
      select: { id: true, organizationId: true },
    }),
    prisma.purchaseOrder.findMany({
      where: {
        id: {
          in: [
            authenticatedE2EIds.primaryPurchaseOrder,
            authenticatedE2EIds.secondTenantPurchaseOrder,
          ],
        },
      },
      select: { id: true, organizationId: true },
    }),
    prisma.stockCount.findMany({
      where: {
        id: {
          in: [authenticatedE2EIds.primaryStockCount, authenticatedE2EIds.secondTenantStockCount],
        },
      },
      select: { id: true, organizationId: true },
    }),
    prisma.user.findMany({
      where: {
        email: {
          in: authenticatedE2EAccountKeys.map((key) => authenticatedE2EAccounts[key].email),
        },
      },
      select: { id: true, organizationId: true, email: true, name: true },
    }),
  ]);

  for (const organization of organizations) {
    if (!organization.name.startsWith(authenticatedE2ESeedPrefix)) {
      throw new Error(`Refusing to overwrite non-QA organization id ${organization.id}.`);
    }
  }
  for (const record of [...stores, ...suppliers, ...products]) {
    if (!allowedOrganizationIds.has(record.organizationId)) {
      throw new Error(`Refusing to reuse ${record.id}; it belongs to a non-QA organization.`);
    }
    if (!("name" in record) || !record.name.startsWith(authenticatedE2ESeedPrefix)) {
      throw new Error(`Refusing to overwrite non-QA record id ${record.id}.`);
    }
  }
  for (const record of [...units, ...orders, ...purchaseOrders, ...stockCounts]) {
    if (!allowedOrganizationIds.has(record.organizationId)) {
      throw new Error(`Refusing to reuse ${record.id}; it belongs to a non-QA organization.`);
    }
  }
  for (const user of users) {
    if (
      !user.name.startsWith(authenticatedE2ESeedPrefix) ||
      !user.organizationId ||
      !allowedOrganizationIds.has(user.organizationId)
    ) {
      throw new Error(`Refusing to overwrite non-QA user ${user.email}.`);
    }
  }
};

const assertExtendedSeedOwnership = async (prisma: PrismaClient) => {
  const [
    customers,
    orderLines,
    purchaseOrderLines,
    stockCountLines,
    registers,
    shifts,
    complianceProfiles,
    printerSettings,
    movements,
    fixedIdUsers,
  ] = await Promise.all([
    prisma.customer.findMany({
      where: { id: authenticatedE2EIds.primaryCustomer },
      select: { id: true, organizationId: true, storeId: true, name: true },
    }),
    prisma.customerOrderLine.findMany({
      where: {
        id: {
          in: [authenticatedE2EIds.primaryOrderLine, authenticatedE2EIds.secondTenantOrderLine],
        },
      },
      select: { id: true, customerOrderId: true, productId: true },
    }),
    prisma.purchaseOrderLine.findMany({
      where: {
        id: {
          in: [
            authenticatedE2EIds.primaryPurchaseOrderLine,
            authenticatedE2EIds.secondTenantPurchaseOrderLine,
          ],
        },
      },
      select: { id: true, purchaseOrderId: true, productId: true },
    }),
    prisma.stockCountLine.findMany({
      where: {
        id: {
          in: [
            authenticatedE2EIds.primaryStockCountLine,
            authenticatedE2EIds.secondTenantStockCountLine,
          ],
        },
      },
      select: { id: true, stockCountId: true, storeId: true, productId: true },
    }),
    prisma.posRegister.findMany({
      where: {
        id: {
          in: [authenticatedE2EIds.primaryRegister, authenticatedE2EIds.secondaryRegister],
        },
      },
      select: { id: true, organizationId: true, storeId: true, name: true },
    }),
    prisma.registerShift.findMany({
      where: {
        OR: [
          { id: authenticatedE2EIds.primaryShift },
          { registerId: authenticatedE2EIds.secondaryRegister },
        ],
      },
      select: { id: true, organizationId: true, storeId: true, registerId: true },
    }),
    prisma.storeComplianceProfile.findMany({
      where: {
        storeId: {
          in: [authenticatedE2EIds.primaryStore, authenticatedE2EIds.secondaryStore],
        },
      },
      select: { id: true, organizationId: true, storeId: true },
    }),
    prisma.storePrinterSettings.findMany({
      where: {
        storeId: {
          in: [authenticatedE2EIds.primaryStore, authenticatedE2EIds.secondaryStore],
        },
      },
      select: { id: true, organizationId: true, storeId: true },
    }),
    prisma.stockMovement.findMany({
      where: {
        id: {
          in: [
            authenticatedE2EIds.receivingMovement,
            authenticatedE2EIds.transferOutMovement,
            authenticatedE2EIds.transferInMovement,
            authenticatedE2EIds.writeOffMovement,
            authenticatedE2EIds.foreignReceivingMovement,
            authenticatedE2EIds.foreignTransferOutMovement,
            authenticatedE2EIds.foreignTransferInMovement,
            authenticatedE2EIds.foreignWriteOffMovement,
          ],
        },
      },
      select: {
        id: true,
        storeId: true,
        productId: true,
        referenceType: true,
        referenceId: true,
      },
    }),
    prisma.user.findMany({
      where: { id: { in: authenticatedE2EAccountKeys.map((key) => userId(key)) } },
      select: { id: true, organizationId: true, email: true, name: true },
    }),
  ]);

  for (const customer of customers) {
    if (
      customer.organizationId !== primaryOrganizationId ||
      customer.storeId !== authenticatedE2EIds.primaryStore ||
      !customer.name.startsWith(authenticatedE2ESeedPrefix)
    ) {
      throw new Error(`Refusing to overwrite non-QA customer id ${customer.id}.`);
    }
  }

  const expectedOrderLineParent = new Map<string, readonly [string, string]>([
    [
      authenticatedE2EIds.primaryOrderLine,
      [authenticatedE2EIds.primaryOrder, authenticatedE2EIds.primaryProduct],
    ],
    [
      authenticatedE2EIds.secondTenantOrderLine,
      [authenticatedE2EIds.secondTenantOrder, authenticatedE2EIds.secondTenantProduct],
    ],
  ]);
  for (const line of orderLines) {
    const expected = expectedOrderLineParent.get(line.id);
    if (!expected || line.customerOrderId !== expected[0] || line.productId !== expected[1]) {
      throw new Error(`Refusing to overwrite non-QA sales order line id ${line.id}.`);
    }
  }

  const expectedPurchaseOrderLineParent = new Map<string, readonly [string, string]>([
    [
      authenticatedE2EIds.primaryPurchaseOrderLine,
      [authenticatedE2EIds.primaryPurchaseOrder, authenticatedE2EIds.primaryProduct],
    ],
    [
      authenticatedE2EIds.secondTenantPurchaseOrderLine,
      [authenticatedE2EIds.secondTenantPurchaseOrder, authenticatedE2EIds.secondTenantProduct],
    ],
  ]);
  for (const line of purchaseOrderLines) {
    const expected = expectedPurchaseOrderLineParent.get(line.id);
    if (!expected || line.purchaseOrderId !== expected[0] || line.productId !== expected[1]) {
      throw new Error(`Refusing to overwrite non-QA purchase order line id ${line.id}.`);
    }
  }

  const expectedStockCountLineParent = new Map<string, readonly [string, string, string]>([
    [
      authenticatedE2EIds.primaryStockCountLine,
      [
        authenticatedE2EIds.primaryStockCount,
        authenticatedE2EIds.primaryStore,
        authenticatedE2EIds.primaryProduct,
      ],
    ],
    [
      authenticatedE2EIds.secondTenantStockCountLine,
      [
        authenticatedE2EIds.secondTenantStockCount,
        authenticatedE2EIds.secondTenantStore,
        authenticatedE2EIds.secondTenantProduct,
      ],
    ],
  ]);
  for (const line of stockCountLines) {
    const expected = expectedStockCountLineParent.get(line.id);
    if (
      !expected ||
      line.stockCountId !== expected[0] ||
      line.storeId !== expected[1] ||
      line.productId !== expected[2]
    ) {
      throw new Error(`Refusing to overwrite non-QA stock count line id ${line.id}.`);
    }
  }

  const expectedRegisterStoreId = new Map([
    [authenticatedE2EIds.primaryRegister, authenticatedE2EIds.primaryStore],
    [authenticatedE2EIds.secondaryRegister, authenticatedE2EIds.secondaryStore],
  ]);
  for (const register of registers) {
    if (
      register.organizationId !== primaryOrganizationId ||
      register.storeId !== expectedRegisterStoreId.get(register.id) ||
      !register.name.startsWith(authenticatedE2ESeedPrefix)
    ) {
      throw new Error(`Refusing to overwrite non-QA register id ${register.id}.`);
    }
  }
  for (const shift of shifts) {
    if (
      shift.organizationId !== primaryOrganizationId ||
      shift.storeId !== authenticatedE2EIds.primaryStore ||
      shift.registerId !== authenticatedE2EIds.primaryRegister
    ) {
      throw new Error(`Refusing to overwrite non-QA shift id ${shift.id}.`);
    }
  }

  for (const settingsRecord of [...complianceProfiles, ...printerSettings]) {
    if (
      settingsRecord.organizationId !== primaryOrganizationId ||
      (settingsRecord.storeId !== authenticatedE2EIds.primaryStore &&
        settingsRecord.storeId !== authenticatedE2EIds.secondaryStore)
    ) {
      throw new Error(`Refusing to overwrite non-QA store settings id ${settingsRecord.id}.`);
    }
  }

  const expectedMovementParent = new Map<string, readonly [string, string, string, string]>([
    [
      authenticatedE2EIds.receivingMovement,
      [
        authenticatedE2EIds.primaryStore,
        authenticatedE2EIds.primaryProduct,
        "STOCK_RECEIVING",
        authenticatedE2EIds.receivingReference,
      ],
    ],
    [
      authenticatedE2EIds.transferOutMovement,
      [
        authenticatedE2EIds.primaryStore,
        authenticatedE2EIds.primaryProduct,
        "TRANSFER",
        authenticatedE2EIds.transferReference,
      ],
    ],
    [
      authenticatedE2EIds.transferInMovement,
      [
        authenticatedE2EIds.secondaryStore,
        authenticatedE2EIds.primaryProduct,
        "TRANSFER",
        authenticatedE2EIds.transferReference,
      ],
    ],
    [
      authenticatedE2EIds.writeOffMovement,
      [
        authenticatedE2EIds.primaryStore,
        authenticatedE2EIds.primaryProduct,
        "WRITE_OFF",
        authenticatedE2EIds.writeOffReference,
      ],
    ],
    [
      authenticatedE2EIds.foreignReceivingMovement,
      [
        authenticatedE2EIds.secondTenantStore,
        authenticatedE2EIds.secondTenantProduct,
        "STOCK_RECEIVING",
        authenticatedE2EIds.foreignReceivingReference,
      ],
    ],
    [
      authenticatedE2EIds.foreignTransferOutMovement,
      [
        authenticatedE2EIds.secondTenantStore,
        authenticatedE2EIds.secondTenantProduct,
        "TRANSFER",
        authenticatedE2EIds.foreignTransferReference,
      ],
    ],
    [
      authenticatedE2EIds.foreignTransferInMovement,
      [
        authenticatedE2EIds.secondTenantSecondaryStore,
        authenticatedE2EIds.secondTenantProduct,
        "TRANSFER",
        authenticatedE2EIds.foreignTransferReference,
      ],
    ],
    [
      authenticatedE2EIds.foreignWriteOffMovement,
      [
        authenticatedE2EIds.secondTenantStore,
        authenticatedE2EIds.secondTenantProduct,
        "WRITE_OFF",
        authenticatedE2EIds.foreignWriteOffReference,
      ],
    ],
  ]);
  for (const movement of movements) {
    const expected = expectedMovementParent.get(movement.id);
    if (
      !expected ||
      movement.storeId !== expected[0] ||
      movement.productId !== expected[1] ||
      movement.referenceType !== expected[2] ||
      movement.referenceId !== expected[3]
    ) {
      throw new Error(`Refusing to overwrite non-QA movement id ${movement.id}.`);
    }
  }

  const accountKeyById = new Map(
    authenticatedE2EAccountKeys.map((key) => [userId(key), key] as const),
  );
  for (const user of fixedIdUsers) {
    const key = accountKeyById.get(user.id);
    const account = key ? authenticatedE2EAccounts[key] : null;
    const expectedOrganizationId =
      account && account.secondTenant ? secondOrganizationId : primaryOrganizationId;
    if (
      !key ||
      !account ||
      user.email !== account.email ||
      user.organizationId !== expectedOrganizationId ||
      !user.name.startsWith(authenticatedE2ESeedPrefix)
    ) {
      throw new Error(`Refusing to overwrite non-QA fixed user id ${user.id}.`);
    }
  }
};

const seedFixtures = async (prisma: PrismaClient) => {
  const passwordHash = await bcrypt.hash(authenticatedE2EPassword, 12);
  const verifiedAt = new Date("2026-01-01T00:00:00.000Z");

  await prisma.$transaction(
    async (tx) => {
      await tx.organization.upsert({
        where: { id: primaryOrganizationId },
        create: {
          id: primaryOrganizationId,
          name: "QA-BAZAAR Authenticated Primary Tenant",
          plan: OrganizationPlan.ENTERPRISE,
        },
        update: {
          name: "QA-BAZAAR Authenticated Primary Tenant",
          plan: OrganizationPlan.ENTERPRISE,
        },
      });
      await tx.organization.upsert({
        where: { id: secondOrganizationId },
        create: {
          id: secondOrganizationId,
          name: "QA-BAZAAR Authenticated Isolation Tenant",
          plan: OrganizationPlan.ENTERPRISE,
        },
        update: {
          name: "QA-BAZAAR Authenticated Isolation Tenant",
          plan: OrganizationPlan.ENTERPRISE,
        },
      });

      const stores = [
        {
          id: authenticatedE2EIds.primaryStore,
          organizationId: primaryOrganizationId,
          name: "QA-BAZAAR Primary Store",
          code: "QA-AUTH-PRIMARY",
          legalEntityType: LegalEntityType.IP,
          legalName: "QA-BAZAAR Primary Store Legal Entity",
        },
        {
          id: authenticatedE2EIds.secondaryStore,
          organizationId: primaryOrganizationId,
          name: "QA-BAZAAR Secondary Store",
          code: "QA-AUTH-SECONDARY",
          legalEntityType: LegalEntityType.IP,
          legalName: "QA-BAZAAR Secondary Store Legal Entity",
        },
        {
          id: authenticatedE2EIds.secondTenantStore,
          organizationId: secondOrganizationId,
          name: "QA-BAZAAR Foreign Store",
          code: "QA-AUTH-FOREIGN",
          legalEntityType: LegalEntityType.IP,
          legalName: "QA-BAZAAR Foreign Store Legal Entity",
        },
        {
          id: authenticatedE2EIds.secondTenantSecondaryStore,
          organizationId: secondOrganizationId,
          name: "QA-BAZAAR Foreign Secondary Store",
          code: "QA-AUTH-FOREIGN-2",
          legalEntityType: LegalEntityType.IP,
          legalName: "QA-BAZAAR Foreign Secondary Store Legal Entity",
        },
      ];
      for (const store of stores) {
        await tx.store.upsert({
          where: { id: store.id },
          create: { ...store, address: "QA-BAZAAR Local Test Address", phone: "+996000000000" },
          update: {
            organizationId: store.organizationId,
            name: store.name,
            code: store.code,
            legalEntityType: store.legalEntityType,
            legalName: store.legalName,
            address: "QA-BAZAAR Local Test Address",
            phone: "+996000000000",
          },
        });
      }

      await tx.unit.upsert({
        where: { id: authenticatedE2EIds.primaryUnit },
        create: {
          id: authenticatedE2EIds.primaryUnit,
          organizationId: primaryOrganizationId,
          code: "QA-AUTH-PC",
          labelRu: "QA-BAZAAR штука",
          labelKg: "QA-BAZAAR даана",
        },
        update: { code: "QA-AUTH-PC", labelRu: "QA-BAZAAR штука", labelKg: "QA-BAZAAR даана" },
      });
      await tx.unit.upsert({
        where: { id: authenticatedE2EIds.secondTenantUnit },
        create: {
          id: authenticatedE2EIds.secondTenantUnit,
          organizationId: secondOrganizationId,
          code: "QA-AUTH-PC",
          labelRu: "QA-BAZAAR штука",
          labelKg: "QA-BAZAAR даана",
        },
        update: { code: "QA-AUTH-PC", labelRu: "QA-BAZAAR штука", labelKg: "QA-BAZAAR даана" },
      });

      const suppliers = [
        {
          id: authenticatedE2EIds.primarySupplier,
          organizationId: primaryOrganizationId,
          name: "QA-BAZAAR Primary Supplier",
        },
        {
          id: authenticatedE2EIds.secondTenantSupplier,
          organizationId: secondOrganizationId,
          name: "QA-BAZAAR Foreign Supplier",
        },
      ];
      for (const supplier of suppliers) {
        await tx.supplier.upsert({
          where: { id: supplier.id },
          create: { ...supplier, email: "qa-bazaar-supplier@auth-e2e.test" },
          update: { organizationId: supplier.organizationId, name: supplier.name },
        });
      }

      const products = [
        {
          id: authenticatedE2EIds.primaryProduct,
          organizationId: primaryOrganizationId,
          supplierId: authenticatedE2EIds.primarySupplier,
          baseUnitId: authenticatedE2EIds.primaryUnit,
          sku: "QA-BAZAAR-AUTH-PRIMARY",
          name: "QA-BAZAAR Authenticated Product",
        },
        {
          id: authenticatedE2EIds.secondTenantProduct,
          organizationId: secondOrganizationId,
          supplierId: authenticatedE2EIds.secondTenantSupplier,
          baseUnitId: authenticatedE2EIds.secondTenantUnit,
          sku: "QA-BAZAAR-AUTH-FOREIGN",
          name: "QA-BAZAAR Foreign Product",
        },
      ];
      for (const product of products) {
        await tx.product.upsert({
          where: { id: product.id },
          create: { ...product, unit: "pc", basePriceKgs: 125 },
          update: {
            organizationId: product.organizationId,
            supplierId: product.supplierId,
            baseUnitId: product.baseUnitId,
            sku: product.sku,
            name: product.name,
            unit: "pc",
            basePriceKgs: 125,
            isDeleted: false,
          },
        });
      }

      const seededUsers = new Map<string, string>();
      for (const key of authenticatedE2EAccountKeys) {
        const account = authenticatedE2EAccounts[key];
        const organizationId = account.secondTenant ? secondOrganizationId : primaryOrganizationId;
        const user = await tx.user.upsert({
          where: { email: account.email },
          create: {
            id: userId(key),
            organizationId,
            email: account.email,
            name: account.name,
            passwordHash,
            role: Role[account.role],
            isOrgOwner: account.isOrgOwner ?? false,
            preferredLocale: "en",
            isActive: true,
            emailVerifiedAt: verifiedAt,
          },
          update: {
            organizationId,
            name: account.name,
            passwordHash,
            role: Role[account.role],
            isOrgOwner: account.isOrgOwner ?? false,
            preferredLocale: "en",
            isActive: true,
            emailVerifiedAt: verifiedAt,
          },
          select: { id: true },
        });
        seededUsers.set(key, user.id);
      }
      const adminId = seededUsers.get("admin");
      const cashierId = seededUsers.get("cashier");
      if (!adminId || !cashierId) {
        throw new Error("Authenticated fixture user creation did not return required local users.");
      }

      for (const key of ["manager", "staff", "cashier"] as const) {
        const seededUserId = seededUsers.get(key);
        if (!seededUserId) throw new Error(`Missing ${key} fixture user.`);
        for (const storeId of [
          authenticatedE2EIds.primaryStore,
          authenticatedE2EIds.secondaryStore,
        ]) {
          await tx.userStoreAccess.upsert({
            where: { userId_storeId: { userId: seededUserId, storeId } },
            create: { organizationId: primaryOrganizationId, userId: seededUserId, storeId },
            update: { organizationId: primaryOrganizationId },
          });
        }
      }

      const storeProducts = [
        [
          authenticatedE2EIds.primaryStore,
          authenticatedE2EIds.primaryProduct,
          primaryOrganizationId,
        ],
        [
          authenticatedE2EIds.secondaryStore,
          authenticatedE2EIds.primaryProduct,
          primaryOrganizationId,
        ],
        [
          authenticatedE2EIds.secondTenantStore,
          authenticatedE2EIds.secondTenantProduct,
          secondOrganizationId,
        ],
        [
          authenticatedE2EIds.secondTenantSecondaryStore,
          authenticatedE2EIds.secondTenantProduct,
          secondOrganizationId,
        ],
      ] as const;
      for (const [storeId, productId, organizationId] of storeProducts) {
        await tx.storeProduct.upsert({
          where: { storeId_productId: { storeId, productId } },
          create: { organizationId, storeId, productId, isActive: true },
          update: { organizationId, isActive: true },
        });
        await tx.inventorySnapshot.upsert({
          where: { storeId_productId_variantKey: { storeId, productId, variantKey: "BASE" } },
          create: { storeId, productId, variantKey: "BASE", onHand: 100 },
          update: { onHand: 100 },
        });
      }

      await tx.customer.upsert({
        where: { id: authenticatedE2EIds.primaryCustomer },
        create: {
          id: authenticatedE2EIds.primaryCustomer,
          organizationId: primaryOrganizationId,
          storeId: authenticatedE2EIds.primaryStore,
          name: "QA-BAZAAR Authenticated Customer",
          email: "qa-bazaar-customer@auth-e2e.test",
          createdById: adminId,
        },
        update: {
          organizationId: primaryOrganizationId,
          storeId: authenticatedE2EIds.primaryStore,
          name: "QA-BAZAAR Authenticated Customer",
          deletedAt: null,
        },
      });

      const orders = [
        {
          id: authenticatedE2EIds.primaryOrder,
          lineId: authenticatedE2EIds.primaryOrderLine,
          organizationId: primaryOrganizationId,
          storeId: authenticatedE2EIds.primaryStore,
          productId: authenticatedE2EIds.primaryProduct,
          number: "QA-BAZAAR-AUTH-ORDER-1",
          createdById: adminId,
        },
        {
          id: authenticatedE2EIds.secondTenantOrder,
          lineId: authenticatedE2EIds.secondTenantOrderLine,
          organizationId: secondOrganizationId,
          storeId: authenticatedE2EIds.secondTenantStore,
          productId: authenticatedE2EIds.secondTenantProduct,
          number: "QA-BAZAAR-AUTH-FOREIGN-ORDER-1",
          createdById: seededUsers.get("secondTenantAdmin")!,
        },
      ];
      for (const order of orders) {
        await tx.customerOrder.upsert({
          where: { id: order.id },
          create: {
            id: order.id,
            organizationId: order.organizationId,
            storeId: order.storeId,
            number: order.number,
            status: CustomerOrderStatus.CONFIRMED,
            customerName: "QA-BAZAAR Customer",
            subtotalKgs: 250,
            totalKgs: 250,
            createdById: order.createdById,
            updatedById: order.createdById,
          },
          update: {
            organizationId: order.organizationId,
            storeId: order.storeId,
            number: order.number,
            status: CustomerOrderStatus.CONFIRMED,
            subtotalKgs: 250,
            totalKgs: 250,
          },
        });
        await tx.customerOrderLine.upsert({
          where: {
            customerOrderId_productId_variantKey: {
              customerOrderId: order.id,
              productId: order.productId,
              variantKey: "BASE",
            },
          },
          create: {
            id: order.lineId,
            customerOrderId: order.id,
            productId: order.productId,
            variantKey: "BASE",
            qty: 2,
            unitPriceKgs: 125,
            lineTotalKgs: 250,
          },
          update: { qty: 2, unitPriceKgs: 125, lineTotalKgs: 250 },
        });
      }

      const purchaseOrders = [
        {
          id: authenticatedE2EIds.primaryPurchaseOrder,
          lineId: authenticatedE2EIds.primaryPurchaseOrderLine,
          organizationId: primaryOrganizationId,
          storeId: authenticatedE2EIds.primaryStore,
          supplierId: authenticatedE2EIds.primarySupplier,
          productId: authenticatedE2EIds.primaryProduct,
          createdById: adminId,
        },
        {
          id: authenticatedE2EIds.secondTenantPurchaseOrder,
          lineId: authenticatedE2EIds.secondTenantPurchaseOrderLine,
          organizationId: secondOrganizationId,
          storeId: authenticatedE2EIds.secondTenantStore,
          supplierId: authenticatedE2EIds.secondTenantSupplier,
          productId: authenticatedE2EIds.secondTenantProduct,
          createdById: seededUsers.get("secondTenantAdmin")!,
        },
      ];
      for (const purchaseOrder of purchaseOrders) {
        await tx.purchaseOrder.upsert({
          where: { id: purchaseOrder.id },
          create: {
            id: purchaseOrder.id,
            organizationId: purchaseOrder.organizationId,
            storeId: purchaseOrder.storeId,
            supplierId: purchaseOrder.supplierId,
            status: PurchaseOrderStatus.APPROVED,
            createdById: purchaseOrder.createdById,
            updatedById: purchaseOrder.createdById,
          },
          update: {
            organizationId: purchaseOrder.organizationId,
            storeId: purchaseOrder.storeId,
            supplierId: purchaseOrder.supplierId,
            status: PurchaseOrderStatus.APPROVED,
          },
        });
        await tx.purchaseOrderLine.upsert({
          where: {
            purchaseOrderId_productId_variantKey: {
              purchaseOrderId: purchaseOrder.id,
              productId: purchaseOrder.productId,
              variantKey: "BASE",
            },
          },
          create: {
            id: purchaseOrder.lineId,
            purchaseOrderId: purchaseOrder.id,
            productId: purchaseOrder.productId,
            variantKey: "BASE",
            qtyOrdered: 12,
            unitCost: 80,
          },
          update: { qtyOrdered: 12, unitCost: 80 },
        });
      }

      const stockCounts = [
        {
          id: authenticatedE2EIds.primaryStockCount,
          lineId: authenticatedE2EIds.primaryStockCountLine,
          organizationId: primaryOrganizationId,
          storeId: authenticatedE2EIds.primaryStore,
          productId: authenticatedE2EIds.primaryProduct,
          code: "QA-BAZAAR-AUTH-COUNT-1",
          createdById: adminId,
        },
        {
          id: authenticatedE2EIds.secondTenantStockCount,
          lineId: authenticatedE2EIds.secondTenantStockCountLine,
          organizationId: secondOrganizationId,
          storeId: authenticatedE2EIds.secondTenantStore,
          productId: authenticatedE2EIds.secondTenantProduct,
          code: "QA-BAZAAR-AUTH-FOREIGN-COUNT-1",
          createdById: seededUsers.get("secondTenantAdmin")!,
        },
      ];
      for (const stockCount of stockCounts) {
        await tx.stockCount.upsert({
          where: { id: stockCount.id },
          create: {
            id: stockCount.id,
            organizationId: stockCount.organizationId,
            storeId: stockCount.storeId,
            code: stockCount.code,
            status: StockCountStatus.IN_PROGRESS,
            notes: "QA-BAZAAR deterministic authenticated route fixture",
            createdById: stockCount.createdById,
          },
          update: {
            organizationId: stockCount.organizationId,
            storeId: stockCount.storeId,
            code: stockCount.code,
            status: StockCountStatus.IN_PROGRESS,
          },
        });
        await tx.stockCountLine.upsert({
          where: {
            stockCountId_productId_variantKey: {
              stockCountId: stockCount.id,
              productId: stockCount.productId,
              variantKey: "BASE",
            },
          },
          create: {
            id: stockCount.lineId,
            stockCountId: stockCount.id,
            storeId: stockCount.storeId,
            productId: stockCount.productId,
            variantKey: "BASE",
            expectedOnHand: 100,
            countedQty: 100,
          },
          update: { expectedOnHand: 100, countedQty: 100, deltaQty: 0 },
        });
      }

      await tx.posRegister.upsert({
        where: { id: authenticatedE2EIds.primaryRegister },
        create: {
          id: authenticatedE2EIds.primaryRegister,
          organizationId: primaryOrganizationId,
          storeId: authenticatedE2EIds.primaryStore,
          name: "QA-BAZAAR Register",
          code: "QA-AUTH-REGISTER",
        },
        update: { name: "QA-BAZAAR Register", isActive: true },
      });
      await tx.posRegister.upsert({
        where: { id: authenticatedE2EIds.secondaryRegister },
        create: {
          id: authenticatedE2EIds.secondaryRegister,
          organizationId: primaryOrganizationId,
          storeId: authenticatedE2EIds.secondaryStore,
          name: "QA-BAZAAR Secondary Register",
          code: "QA-AUTH-SECONDARY",
        },
        update: {
          name: "QA-BAZAAR Secondary Register",
          code: "QA-AUTH-SECONDARY",
          isActive: true,
        },
      });
      await tx.registerShift.upsert({
        where: { id: authenticatedE2EIds.primaryShift },
        create: {
          id: authenticatedE2EIds.primaryShift,
          organizationId: primaryOrganizationId,
          storeId: authenticatedE2EIds.primaryStore,
          registerId: authenticatedE2EIds.primaryRegister,
          status: RegisterShiftStatus.OPEN,
          openedById: cashierId,
          openingCashKgs: 1000,
        },
        update: {
          status: RegisterShiftStatus.OPEN,
          closedAt: null,
          closedById: null,
          openedById: cashierId,
        },
      });

      for (const storeId of [
        authenticatedE2EIds.primaryStore,
        authenticatedE2EIds.secondaryStore,
      ]) {
        await tx.storeComplianceProfile.upsert({
          where: { storeId },
          create: {
            organizationId: primaryOrganizationId,
            storeId,
            defaultLocale: "en",
            updatedById: adminId,
          },
          update: { defaultLocale: "en", updatedById: adminId },
        });
        await tx.storePrinterSettings.upsert({
          where: { storeId },
          create: { organizationId: primaryOrganizationId, storeId, updatedById: adminId },
          update: {
            receiptPrintProvider: "DISABLED",
            labelPrintProvider: "DISABLED",
            receiptAutoPrintEnabled: false,
            updatedById: adminId,
          },
        });
      }

      const movements = [
        {
          id: authenticatedE2EIds.receivingMovement,
          storeId: authenticatedE2EIds.primaryStore,
          productId: authenticatedE2EIds.primaryProduct,
          type: StockMovementType.RECEIVE,
          qtyDelta: 10,
          referenceType: "STOCK_RECEIVING",
          referenceId: authenticatedE2EIds.receivingReference,
          note: "QA-BAZAAR receiving fixture",
          createdById: adminId,
        },
        {
          id: authenticatedE2EIds.transferOutMovement,
          storeId: authenticatedE2EIds.primaryStore,
          productId: authenticatedE2EIds.primaryProduct,
          type: StockMovementType.TRANSFER_OUT,
          qtyDelta: -4,
          referenceType: "TRANSFER",
          referenceId: authenticatedE2EIds.transferReference,
          note: "QA-BAZAAR transfer fixture",
          createdById: adminId,
        },
        {
          id: authenticatedE2EIds.transferInMovement,
          storeId: authenticatedE2EIds.secondaryStore,
          productId: authenticatedE2EIds.primaryProduct,
          type: StockMovementType.TRANSFER_IN,
          qtyDelta: 4,
          referenceType: "TRANSFER",
          referenceId: authenticatedE2EIds.transferReference,
          note: "QA-BAZAAR transfer fixture",
          createdById: adminId,
        },
        {
          id: authenticatedE2EIds.writeOffMovement,
          storeId: authenticatedE2EIds.primaryStore,
          productId: authenticatedE2EIds.primaryProduct,
          type: StockMovementType.WRITE_OFF,
          qtyDelta: -2,
          referenceType: "WRITE_OFF",
          referenceId: authenticatedE2EIds.writeOffReference,
          note: "QA-BAZAAR write-off fixture",
          createdById: adminId,
        },
        {
          id: authenticatedE2EIds.foreignReceivingMovement,
          storeId: authenticatedE2EIds.secondTenantStore,
          productId: authenticatedE2EIds.secondTenantProduct,
          type: StockMovementType.RECEIVE,
          qtyDelta: 10,
          referenceType: "STOCK_RECEIVING",
          referenceId: authenticatedE2EIds.foreignReceivingReference,
          note: "QA-BAZAAR foreign receiving fixture",
          createdById: seededUsers.get("secondTenantAdmin")!,
        },
        {
          id: authenticatedE2EIds.foreignTransferOutMovement,
          storeId: authenticatedE2EIds.secondTenantStore,
          productId: authenticatedE2EIds.secondTenantProduct,
          type: StockMovementType.TRANSFER_OUT,
          qtyDelta: -4,
          referenceType: "TRANSFER",
          referenceId: authenticatedE2EIds.foreignTransferReference,
          note: "QA-BAZAAR foreign transfer fixture",
          createdById: seededUsers.get("secondTenantAdmin")!,
        },
        {
          id: authenticatedE2EIds.foreignTransferInMovement,
          storeId: authenticatedE2EIds.secondTenantSecondaryStore,
          productId: authenticatedE2EIds.secondTenantProduct,
          type: StockMovementType.TRANSFER_IN,
          qtyDelta: 4,
          referenceType: "TRANSFER",
          referenceId: authenticatedE2EIds.foreignTransferReference,
          note: "QA-BAZAAR foreign transfer fixture",
          createdById: seededUsers.get("secondTenantAdmin")!,
        },
        {
          id: authenticatedE2EIds.foreignWriteOffMovement,
          storeId: authenticatedE2EIds.secondTenantStore,
          productId: authenticatedE2EIds.secondTenantProduct,
          type: StockMovementType.WRITE_OFF,
          qtyDelta: -2,
          referenceType: "WRITE_OFF",
          referenceId: authenticatedE2EIds.foreignWriteOffReference,
          note: "QA-BAZAAR foreign write-off fixture",
          createdById: seededUsers.get("secondTenantAdmin")!,
        },
      ];
      for (const movement of movements) {
        const unitCostKgs = 80;
        const inventoryValueDeltaKgs = movement.qtyDelta * unitCostKgs;
        const lineTotalKgs = Math.abs(inventoryValueDeltaKgs);
        const createdAt = new Date("2026-08-31T06:00:00.000Z");
        await tx.stockMovement.upsert({
          where: { id: movement.id },
          create: {
            ...movement,
            variantId: null,
            linePosition: 1,
            unitCostKgs,
            lineTotalKgs,
            inventoryValueDeltaKgs,
            createdAt,
          },
          update: {
            storeId: movement.storeId,
            productId: movement.productId,
            variantId: null,
            type: movement.type,
            qtyDelta: movement.qtyDelta,
            linePosition: 1,
            unitCostKgs,
            lineTotalKgs,
            inventoryValueDeltaKgs,
            referenceType: movement.referenceType,
            referenceId: movement.referenceId,
            note: movement.note,
            createdAt,
            createdById: movement.createdById,
          },
        });
      }
    },
    { timeout: 30_000 },
  );
};

const main = async () => {
  assertSeedAuthorization();
  const datasourceUrl = assertAuthenticatedE2EDatabaseUrl(process.env.E2E_AUTH_DATABASE_URL);
  const prisma = new PrismaClient({ datasourceUrl });
  try {
    const [identity] = await prisma.$queryRaw<
      Array<{ databaseName: string; serverAddress: string | null; databaseUser: string }>
    >`SELECT current_database() AS "databaseName", host(inet_server_addr()) AS "serverAddress", current_user AS "databaseUser"`;
    if (!identity || identity.databaseName !== "bazaar_hardening_agent4_platform") {
      throw new Error(
        "Connected database identity does not match the authenticated E2E allowlist.",
      );
    }
    if (
      identity.serverAddress !== null &&
      identity.serverAddress !== "127.0.0.1" &&
      identity.serverAddress !== "::1"
    ) {
      throw new Error("Authenticated E2E fixture writes require a loopback PostgreSQL server.");
    }
    await assertSeedOwnership(prisma);
    await assertExtendedSeedOwnership(prisma);
    await seedFixtures(prisma);
    await seedAuthenticatedInventoryMutationFixtures(prisma);
    await seedAuthenticatedAccountingFixtures(prisma);
    await seedAuthenticatedMasterDataProcurementFixtures(prisma);
    await seedAuthenticatedSalesOrderFixtures(prisma);
    await seedAuthenticatedPosMobileFixtures(prisma);
    await seedAuthenticatedPosOperationsFixtures(prisma);
    await seedAuthenticatedAuthLifecycleFixtures(prisma);
    await seedAuthenticatedAdvancedProductFixtures(prisma);
    await seedAuthenticatedCatalogPublicationFixtures(prisma);
    console.info(
      JSON.stringify({
        fixture: authenticatedE2ESeedPrefix,
        database: identity.databaseName,
        databaseUser: identity.databaseUser,
        accounts: authenticatedE2EAccountKeys.length,
        status: "ready",
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Authenticated fixture setup failed.");
  process.exitCode = 1;
});
