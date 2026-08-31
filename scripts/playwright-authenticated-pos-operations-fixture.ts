import { CustomerSource, RegisterShiftStatus, type PrismaClient } from "@prisma/client";

import { authenticatedE2ESeedPrefix } from "../tests/e2e/authenticated/contract";
import { authenticatedPosOperationsFixture as fixture } from "../tests/e2e/authenticated/pos-operations-contract";

const assertOwnedDependencies = async (prisma: PrismaClient) => {
  const [organizations, stores, unit, users, compliance, printer] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: [fixture.organizationId, fixture.foreignOrganizationId] } },
      select: { id: true, name: true },
    }),
    prisma.store.findMany({
      where: { id: { in: [fixture.storeId, fixture.foreignStoreId] } },
      select: {
        id: true,
        organizationId: true,
        name: true,
        currencyCode: true,
        currencyRateKgsPerUnit: true,
      },
    }),
    prisma.unit.findUnique({
      where: { id: fixture.baseUnitId },
      select: { id: true, organizationId: true },
    }),
    prisma.user.findMany({
      where: { id: { in: [fixture.adminUserId, fixture.foreignAdminUserId] } },
      select: { id: true, organizationId: true, name: true },
    }),
    prisma.storeComplianceProfile.findUnique({
      where: { storeId: fixture.storeId },
      select: { enableKkm: true, kkmMode: true, enableMarking: true, markingMode: true },
    }),
    prisma.storePrinterSettings.findUnique({
      where: { storeId: fixture.storeId },
      select: { receiptPrintProvider: true, receiptAutoPrintEnabled: true },
    }),
  ]);

  const expectedOrganizations = new Map([
    [fixture.organizationId, fixture.organizationId],
    [fixture.foreignOrganizationId, fixture.foreignOrganizationId],
  ]);
  if (organizations.length !== expectedOrganizations.size) {
    throw new Error("POS operations fixtures require both owned QA organizations.");
  }
  for (const organization of organizations) {
    if (
      !expectedOrganizations.has(organization.id) ||
      !organization.name.startsWith(authenticatedE2ESeedPrefix)
    ) {
      throw new Error(`Refusing to use non-QA POS operations organization ${organization.id}.`);
    }
  }

  const expectedStoreOrganizations = new Map([
    [fixture.storeId, fixture.organizationId],
    [fixture.foreignStoreId, fixture.foreignOrganizationId],
  ]);
  if (stores.length !== expectedStoreOrganizations.size) {
    throw new Error("POS operations fixtures require both owned QA stores.");
  }
  for (const store of stores) {
    if (
      store.organizationId !== expectedStoreOrganizations.get(store.id) ||
      !store.name.startsWith(authenticatedE2ESeedPrefix) ||
      store.currencyCode !== "KGS" ||
      Number(store.currencyRateKgsPerUnit) !== 1
    ) {
      throw new Error(`Refusing to use non-QA POS operations store ${store.id}.`);
    }
  }

  if (!unit || unit.organizationId !== fixture.organizationId) {
    throw new Error("POS operations fixtures require the owned primary QA unit.");
  }
  const expectedUserOrganizations = new Map([
    [fixture.adminUserId, fixture.organizationId],
    [fixture.foreignAdminUserId, fixture.foreignOrganizationId],
  ]);
  if (users.length !== expectedUserOrganizations.size) {
    throw new Error("POS operations fixtures require both owned QA administrators.");
  }
  for (const user of users) {
    if (
      user.organizationId !== expectedUserOrganizations.get(user.id) ||
      !user.name.startsWith(authenticatedE2ESeedPrefix)
    ) {
      throw new Error(`Refusing to use non-QA POS operations user ${user.id}.`);
    }
  }

  if (
    !compliance ||
    compliance.enableKkm ||
    compliance.kkmMode !== "OFF" ||
    compliance.enableMarking ||
    compliance.markingMode !== "OFF"
  ) {
    throw new Error("POS operations acceptance requires fiscal and marking providers to be off.");
  }
  if (!printer || printer.receiptAutoPrintEnabled || printer.receiptPrintProvider !== "DISABLED") {
    throw new Error("POS operations acceptance requires receipt auto-printing to be disabled.");
  }
};

const assertFixtureIdentityOwnership = async (prisma: PrismaClient) => {
  const [registers, shifts, products, barcodes, assignments, snapshots, costs, customers] =
    await Promise.all([
      prisma.posRegister.findMany({
        where: {
          OR: [
            { id: fixture.register.id },
            { storeId: fixture.storeId, code: fixture.register.code },
            { id: fixture.foreignRegister.id },
            { storeId: fixture.foreignStoreId, code: fixture.foreignRegister.code },
          ],
        },
        select: { id: true, organizationId: true, storeId: true, name: true, code: true },
      }),
      prisma.registerShift.findMany({
        where: {
          OR: [
            { id: { in: [fixture.shift.id, fixture.foreignShift.id] } },
            { registerId: { in: [fixture.register.id, fixture.foreignRegister.id] } },
          ],
        },
        select: { id: true, organizationId: true, storeId: true, registerId: true },
      }),
      prisma.product.findMany({
        where: { OR: [{ id: fixture.product.id }, { sku: fixture.product.sku }] },
        select: { id: true, organizationId: true, name: true, sku: true },
      }),
      prisma.productBarcode.findMany({
        where: { OR: [{ id: fixture.product.barcodeId }, { value: fixture.product.barcode }] },
        select: { id: true, organizationId: true, productId: true, value: true },
      }),
      prisma.storeProduct.findMany({
        where: {
          OR: [
            { id: fixture.product.storeProductId },
            { storeId: fixture.storeId, productId: fixture.product.id },
          ],
        },
        select: { id: true, organizationId: true, storeId: true, productId: true },
      }),
      prisma.inventorySnapshot.findMany({
        where: {
          OR: [
            { id: fixture.product.snapshotId },
            {
              storeId: fixture.storeId,
              productId: fixture.product.id,
              variantKey: fixture.variantKey,
            },
          ],
        },
        select: { id: true, storeId: true, productId: true, variantKey: true },
      }),
      prisma.productCost.findMany({
        where: {
          OR: [
            { id: fixture.product.productCostId },
            {
              organizationId: fixture.organizationId,
              productId: fixture.product.id,
              variantKey: fixture.variantKey,
            },
          ],
        },
        select: { id: true, organizationId: true, productId: true, variantKey: true },
      }),
      prisma.customer.findMany({
        where: { id: fixture.customer.id },
        select: { id: true, organizationId: true, storeId: true, name: true },
      }),
    ]);

  const expectedRegisters = new Map([
    [
      fixture.register.id,
      {
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
        name: fixture.register.name,
        code: fixture.register.code,
      },
    ],
    [
      fixture.foreignRegister.id,
      {
        organizationId: fixture.foreignOrganizationId,
        storeId: fixture.foreignStoreId,
        name: fixture.foreignRegister.name,
        code: fixture.foreignRegister.code,
      },
    ],
  ]);
  for (const register of registers) {
    const expected = expectedRegisters.get(register.id);
    if (
      !expected ||
      register.organizationId !== expected.organizationId ||
      register.storeId !== expected.storeId ||
      register.name !== expected.name ||
      register.code !== expected.code
    ) {
      throw new Error(`Refusing to overwrite non-QA POS operations register ${register.id}.`);
    }
  }

  const expectedShifts = new Map([
    [
      fixture.shift.id,
      {
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
        registerId: fixture.register.id,
      },
    ],
    [
      fixture.foreignShift.id,
      {
        organizationId: fixture.foreignOrganizationId,
        storeId: fixture.foreignStoreId,
        registerId: fixture.foreignRegister.id,
      },
    ],
  ]);
  for (const shift of shifts) {
    const expected = expectedShifts.get(shift.id);
    if (
      !expected ||
      shift.organizationId !== expected.organizationId ||
      shift.storeId !== expected.storeId ||
      shift.registerId !== expected.registerId
    ) {
      throw new Error(`Refusing to overwrite non-QA POS operations shift ${shift.id}.`);
    }
  }

  for (const product of products) {
    if (
      product.id !== fixture.product.id ||
      product.organizationId !== fixture.organizationId ||
      product.name !== fixture.product.name ||
      product.sku !== fixture.product.sku
    ) {
      throw new Error(`Refusing to overwrite non-QA POS operations product ${product.id}.`);
    }
  }
  for (const barcode of barcodes) {
    if (
      barcode.id !== fixture.product.barcodeId ||
      barcode.organizationId !== fixture.organizationId ||
      barcode.productId !== fixture.product.id ||
      barcode.value !== fixture.product.barcode
    ) {
      throw new Error(`Refusing to overwrite non-QA POS operations barcode ${barcode.id}.`);
    }
  }
  for (const assignment of assignments) {
    if (
      assignment.id !== fixture.product.storeProductId ||
      assignment.organizationId !== fixture.organizationId ||
      assignment.storeId !== fixture.storeId ||
      assignment.productId !== fixture.product.id
    ) {
      throw new Error(`Refusing to overwrite non-QA POS assignment ${assignment.id}.`);
    }
  }
  for (const snapshot of snapshots) {
    if (
      snapshot.id !== fixture.product.snapshotId ||
      snapshot.storeId !== fixture.storeId ||
      snapshot.productId !== fixture.product.id ||
      snapshot.variantKey !== fixture.variantKey
    ) {
      throw new Error(`Refusing to overwrite non-QA POS snapshot ${snapshot.id}.`);
    }
  }
  for (const cost of costs) {
    if (
      cost.id !== fixture.product.productCostId ||
      cost.organizationId !== fixture.organizationId ||
      cost.productId !== fixture.product.id ||
      cost.variantKey !== fixture.variantKey
    ) {
      throw new Error(`Refusing to overwrite non-QA POS cost ${cost.id}.`);
    }
  }
  for (const customer of customers) {
    if (
      customer.organizationId !== fixture.organizationId ||
      customer.storeId !== fixture.storeId ||
      customer.name !== fixture.customer.name
    ) {
      throw new Error(`Refusing to overwrite non-QA POS customer ${customer.id}.`);
    }
  }
};

const loadAndAssertRuntimeRecords = async (prisma: PrismaClient) => {
  const [foreignSales, foreignReturns, foreignCashMovements] = await Promise.all([
    prisma.customerOrder.count({ where: { registerId: fixture.foreignRegister.id } }),
    prisma.saleReturn.count({ where: { registerId: fixture.foreignRegister.id } }),
    prisma.cashDrawerMovement.count({ where: { shiftId: fixture.foreignShift.id } }),
  ]);
  if (foreignSales || foreignReturns || foreignCashMovements) {
    throw new Error("Refusing to reset a foreign POS denial fixture that contains runtime data.");
  }

  const orders = await prisma.customerOrder.findMany({
    where: { registerId: fixture.register.id },
    include: {
      lines: { select: { id: true, productId: true } },
      payments: { select: { id: true, createdById: true, storeId: true, shiftId: true } },
      fiscalReceipts: { select: { id: true } },
      refundRequests: { select: { id: true } },
      emailLogs: { select: { id: true } },
      emailAutomationDeliveries: { select: { id: true } },
      markingCodeCaptures: { select: { id: true } },
    },
  });
  const orderIds = orders.map((order) => order.id);
  for (const order of orders) {
    if (
      order.organizationId !== fixture.organizationId ||
      order.storeId !== fixture.storeId ||
      order.shiftId !== fixture.shift.id ||
      !order.isPosSale ||
      order.createdById !== fixture.adminUserId ||
      order.lines.some((line) => line.productId !== fixture.product.id)
    ) {
      throw new Error(`Refusing to remove non-QA POS operations sale ${order.id}.`);
    }
    if (
      order.fiscalReceipts.length ||
      order.refundRequests.length ||
      order.emailLogs.length ||
      order.emailAutomationDeliveries.length ||
      order.markingCodeCaptures.length
    ) {
      throw new Error(`POS operations sale ${order.id} produced a forbidden external side effect.`);
    }
    for (const payment of order.payments) {
      if (
        payment.createdById !== fixture.adminUserId ||
        payment.storeId !== fixture.storeId ||
        payment.shiftId !== fixture.shift.id
      ) {
        throw new Error(`Refusing to remove non-QA POS operations payment ${payment.id}.`);
      }
    }
  }

  const returns = await prisma.saleReturn.findMany({
    where: { registerId: fixture.register.id },
    include: {
      lines: { select: { id: true, productId: true } },
      payments: { select: { id: true, createdById: true, storeId: true, shiftId: true } },
      refundRequests: { select: { id: true } },
    },
  });
  const returnIds = returns.map((saleReturn) => saleReturn.id);
  for (const saleReturn of returns) {
    if (
      saleReturn.organizationId !== fixture.organizationId ||
      saleReturn.storeId !== fixture.storeId ||
      saleReturn.shiftId !== fixture.shift.id ||
      !orderIds.includes(saleReturn.originalSaleId) ||
      saleReturn.createdById !== fixture.adminUserId ||
      saleReturn.lines.some((line) => line.productId !== fixture.product.id) ||
      saleReturn.refundRequests.length
    ) {
      throw new Error(`Refusing to remove unsafe POS operations return ${saleReturn.id}.`);
    }
    for (const payment of saleReturn.payments) {
      if (
        payment.createdById !== fixture.adminUserId ||
        payment.storeId !== fixture.storeId ||
        payment.shiftId !== fixture.shift.id
      ) {
        throw new Error(`Refusing to remove non-QA return payment ${payment.id}.`);
      }
    }
  }

  const cashMovements = await prisma.cashDrawerMovement.findMany({
    where: { shiftId: fixture.shift.id },
    select: {
      id: true,
      organizationId: true,
      storeId: true,
      createdById: true,
      reason: true,
    },
  });
  for (const movement of cashMovements) {
    if (
      movement.organizationId !== fixture.organizationId ||
      movement.storeId !== fixture.storeId ||
      movement.createdById !== fixture.adminUserId ||
      !movement.reason.includes(authenticatedE2ESeedPrefix)
    ) {
      throw new Error(`Refusing to remove non-QA cash movement ${movement.id}.`);
    }
  }

  const stockMovements = await prisma.stockMovement.findMany({
    where: { productId: fixture.product.id },
    select: {
      id: true,
      storeId: true,
      productId: true,
      referenceType: true,
      referenceId: true,
      createdById: true,
    },
  });
  const allowedReferences = new Set([...orderIds, ...returnIds]);
  for (const movement of stockMovements) {
    if (
      movement.storeId !== fixture.storeId ||
      movement.productId !== fixture.product.id ||
      movement.createdById !== fixture.adminUserId ||
      !movement.referenceId ||
      !allowedReferences.has(movement.referenceId) ||
      (movement.referenceType !== "CustomerOrder" && movement.referenceType !== "SaleReturn")
    ) {
      throw new Error(`Refusing to remove non-QA stock movement ${movement.id}.`);
    }
  }

  return {
    orderIds,
    returnIds,
    cashMovementIds: cashMovements.map((movement) => movement.id),
  };
};

export const seedAuthenticatedPosOperationsFixtures = async (prisma: PrismaClient) => {
  await assertOwnedDependencies(prisma);
  await assertFixtureIdentityOwnership(prisma);
  const runtime = await loadAndAssertRuntimeRecords(prisma);
  const runtimeEntityIds = [
    ...runtime.orderIds,
    ...runtime.returnIds,
    ...runtime.cashMovementIds,
    fixture.shift.id,
  ];

  await prisma.$transaction(
    async (tx) => {
      if (runtimeEntityIds.length) {
        await tx.auditLog.deleteMany({
          where: {
            organizationId: fixture.organizationId,
            actorId: fixture.adminUserId,
            entityId: { in: runtimeEntityIds },
          },
        });
      }
      await tx.idempotencyKey.deleteMany({
        where: {
          userId: fixture.adminUserId,
          key: { startsWith: fixture.idempotencyKeyPrefix },
        },
      });
      await tx.salePayment.deleteMany({ where: { shiftId: fixture.shift.id } });
      await tx.stockMovement.deleteMany({ where: { productId: fixture.product.id } });
      await tx.saleReturn.deleteMany({ where: { id: { in: runtime.returnIds } } });
      await tx.customerOrder.deleteMany({ where: { id: { in: runtime.orderIds } } });
      await tx.cashDrawerMovement.deleteMany({ where: { shiftId: fixture.shift.id } });
      await tx.registerShift.deleteMany({
        where: { id: { in: [fixture.shift.id, fixture.foreignShift.id] } },
      });

      await tx.product.upsert({
        where: { id: fixture.product.id },
        create: {
          id: fixture.product.id,
          organizationId: fixture.organizationId,
          sku: fixture.product.sku,
          name: fixture.product.name,
          unit: "pc",
          baseUnitId: fixture.baseUnitId,
          basePriceKgs: fixture.product.unitPriceKgs,
        },
        update: {
          organizationId: fixture.organizationId,
          sku: fixture.product.sku,
          name: fixture.product.name,
          unit: "pc",
          baseUnitId: fixture.baseUnitId,
          basePriceKgs: fixture.product.unitPriceKgs,
          isDeleted: false,
        },
      });
      await tx.productBarcode.upsert({
        where: { id: fixture.product.barcodeId },
        create: {
          id: fixture.product.barcodeId,
          organizationId: fixture.organizationId,
          productId: fixture.product.id,
          value: fixture.product.barcode,
        },
        update: {
          organizationId: fixture.organizationId,
          productId: fixture.product.id,
          value: fixture.product.barcode,
        },
      });
      await tx.storeProduct.upsert({
        where: {
          storeId_productId: { storeId: fixture.storeId, productId: fixture.product.id },
        },
        create: {
          id: fixture.product.storeProductId,
          organizationId: fixture.organizationId,
          storeId: fixture.storeId,
          productId: fixture.product.id,
          isActive: true,
          assignedById: fixture.adminUserId,
        },
        update: {
          organizationId: fixture.organizationId,
          isActive: true,
          assignedById: fixture.adminUserId,
        },
      });
      await tx.inventorySnapshot.upsert({
        where: {
          storeId_productId_variantKey: {
            storeId: fixture.storeId,
            productId: fixture.product.id,
            variantKey: fixture.variantKey,
          },
        },
        create: {
          id: fixture.product.snapshotId,
          storeId: fixture.storeId,
          productId: fixture.product.id,
          variantId: null,
          variantKey: fixture.variantKey,
          onHand: fixture.product.baselineOnHand,
          onOrder: 0,
          allowNegativeStock: false,
        },
        update: {
          variantId: null,
          onHand: fixture.product.baselineOnHand,
          onOrder: 0,
          allowNegativeStock: false,
        },
      });
      await tx.productCost.upsert({
        where: {
          organizationId_productId_variantKey: {
            organizationId: fixture.organizationId,
            productId: fixture.product.id,
            variantKey: fixture.variantKey,
          },
        },
        create: {
          id: fixture.product.productCostId,
          organizationId: fixture.organizationId,
          productId: fixture.product.id,
          variantId: null,
          variantKey: fixture.variantKey,
          avgCostKgs: fixture.product.unitCostKgs,
          costBasisQty: fixture.product.baselineOnHand,
          preciseAvgCostKgs: null,
          preciseCostBasisQty: null,
          costBasisValueKgs: null,
          valuationStatus: null,
          valuationUpdatedAt: null,
          valuationLegacyUpdatedAt: null,
        },
        update: {
          variantId: null,
          avgCostKgs: fixture.product.unitCostKgs,
          costBasisQty: fixture.product.baselineOnHand,
          preciseAvgCostKgs: null,
          preciseCostBasisQty: null,
          costBasisValueKgs: null,
          valuationStatus: null,
          valuationUpdatedAt: null,
          valuationLegacyUpdatedAt: null,
          lastReceiptAt: null,
        },
      });
      await tx.customer.upsert({
        where: { id: fixture.customer.id },
        create: {
          id: fixture.customer.id,
          organizationId: fixture.organizationId,
          storeId: fixture.storeId,
          name: fixture.customer.name,
          phone: fixture.customer.phone,
          source: CustomerSource.MANUAL,
          createdById: fixture.adminUserId,
        },
        update: {
          organizationId: fixture.organizationId,
          storeId: fixture.storeId,
          name: fixture.customer.name,
          email: null,
          phone: fixture.customer.phone,
          address: null,
          source: CustomerSource.MANUAL,
          lastOrderAt: null,
          orderCount: 0,
          deletedAt: null,
          emailMarketingUnsubscribedAt: null,
          createdById: fixture.adminUserId,
        },
      });

      await tx.posRegister.upsert({
        where: { id: fixture.register.id },
        create: {
          id: fixture.register.id,
          organizationId: fixture.organizationId,
          storeId: fixture.storeId,
          name: fixture.register.name,
          code: fixture.register.code,
          isActive: true,
        },
        update: {
          organizationId: fixture.organizationId,
          storeId: fixture.storeId,
          name: fixture.register.name,
          code: fixture.register.code,
          isActive: true,
        },
      });
      await tx.posRegister.upsert({
        where: { id: fixture.foreignRegister.id },
        create: {
          id: fixture.foreignRegister.id,
          organizationId: fixture.foreignOrganizationId,
          storeId: fixture.foreignStoreId,
          name: fixture.foreignRegister.name,
          code: fixture.foreignRegister.code,
          isActive: true,
        },
        update: {
          organizationId: fixture.foreignOrganizationId,
          storeId: fixture.foreignStoreId,
          name: fixture.foreignRegister.name,
          code: fixture.foreignRegister.code,
          isActive: true,
        },
      });
      const openedAt = new Date("2026-08-31T07:30:00.000Z");
      await tx.registerShift.create({
        data: {
          id: fixture.shift.id,
          organizationId: fixture.organizationId,
          storeId: fixture.storeId,
          registerId: fixture.register.id,
          status: RegisterShiftStatus.OPEN,
          openedAt,
          openedById: fixture.adminUserId,
          openingCashKgs: fixture.shift.openingCashKgs,
          currencyCode: "KGS",
          currencyRateKgsPerUnit: 1,
          notes: `${authenticatedE2ESeedPrefix} POS operations acceptance shift`,
        },
      });
      await tx.registerShift.create({
        data: {
          id: fixture.foreignShift.id,
          organizationId: fixture.foreignOrganizationId,
          storeId: fixture.foreignStoreId,
          registerId: fixture.foreignRegister.id,
          status: RegisterShiftStatus.OPEN,
          openedAt,
          openedById: fixture.foreignAdminUserId,
          openingCashKgs: 0,
          currencyCode: "KGS",
          currencyRateKgsPerUnit: 1,
          notes: `${authenticatedE2ESeedPrefix} foreign POS operations denial shift`,
        },
      });
    },
    { timeout: 30_000 },
  );
};
