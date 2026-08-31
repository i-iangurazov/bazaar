import { KkmMode, MarkingMode, type PrismaClient } from "@prisma/client";

import { authenticatedE2ESeedPrefix } from "../tests/e2e/authenticated/contract";
import { authenticatedPosMobileFixture } from "../tests/e2e/authenticated/pos-mobile-contract";

const assertPosMobileSeedOwnership = async (prisma: PrismaClient) => {
  const fixture = authenticatedPosMobileFixture;
  const [organization, store, unit, admin, register, shift, products, barcodes] = await Promise.all(
    [
      prisma.organization.findUnique({
        where: { id: fixture.organizationId },
        select: { id: true, name: true },
      }),
      prisma.store.findUnique({
        where: { id: fixture.storeId },
        select: { id: true, organizationId: true, name: true },
      }),
      prisma.unit.findUnique({
        where: { id: fixture.baseUnitId },
        select: { id: true, organizationId: true },
      }),
      prisma.user.findUnique({
        where: { id: fixture.adminUserId },
        select: { id: true, organizationId: true, name: true },
      }),
      prisma.posRegister.findUnique({
        where: { id: fixture.registerId },
        select: { id: true, organizationId: true, storeId: true, name: true },
      }),
      prisma.registerShift.findUnique({
        where: { id: fixture.shiftId },
        select: { id: true, organizationId: true, storeId: true, registerId: true },
      }),
      prisma.product.findMany({
        where: {
          OR: [{ id: fixture.product.id }, { sku: fixture.product.sku }],
        },
        select: { id: true, organizationId: true, name: true, sku: true },
      }),
      prisma.productBarcode.findMany({
        where: {
          OR: [{ id: fixture.product.barcodeId }, { value: fixture.product.barcode }],
        },
        select: { id: true, organizationId: true, productId: true, value: true },
      }),
    ],
  );

  if (!organization || !organization.name.startsWith(authenticatedE2ESeedPrefix)) {
    throw new Error("POS mobile fixtures require the primary QA organization.");
  }
  if (
    !store ||
    store.organizationId !== fixture.organizationId ||
    !store.name.startsWith(authenticatedE2ESeedPrefix)
  ) {
    throw new Error("POS mobile fixtures require the primary QA store.");
  }
  if (!unit || unit.organizationId !== fixture.organizationId) {
    throw new Error("POS mobile fixtures require the primary QA unit.");
  }
  if (
    !admin ||
    admin.organizationId !== fixture.organizationId ||
    !admin.name.startsWith(authenticatedE2ESeedPrefix)
  ) {
    throw new Error("POS mobile fixtures require the primary QA admin.");
  }
  if (
    !register ||
    register.organizationId !== fixture.organizationId ||
    register.storeId !== fixture.storeId ||
    !register.name.startsWith(authenticatedE2ESeedPrefix)
  ) {
    throw new Error("POS mobile fixtures require the primary QA register.");
  }
  if (
    !shift ||
    shift.organizationId !== fixture.organizationId ||
    shift.storeId !== fixture.storeId ||
    shift.registerId !== fixture.registerId
  ) {
    throw new Error("POS mobile fixtures require the primary QA register shift.");
  }

  for (const product of products) {
    if (
      product.id !== fixture.product.id ||
      product.sku !== fixture.product.sku ||
      product.organizationId !== fixture.organizationId ||
      !product.name.startsWith(authenticatedE2ESeedPrefix)
    ) {
      throw new Error(`Refusing to overwrite non-QA POS product ${product.id}.`);
    }
  }
  for (const barcode of barcodes) {
    if (
      barcode.id !== fixture.product.barcodeId ||
      barcode.organizationId !== fixture.organizationId ||
      barcode.productId !== fixture.product.id ||
      barcode.value !== fixture.product.barcode
    ) {
      throw new Error(`Refusing to overwrite non-QA POS barcode ${barcode.id}.`);
    }
  }

  const [storeProducts, snapshots, costs, staleDrafts] = await Promise.all([
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
    prisma.customerOrder.findMany({
      where: {
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
        registerId: fixture.registerId,
        createdById: fixture.adminUserId,
        isPosSale: true,
        status: "DRAFT",
      },
      select: {
        id: true,
        organizationId: true,
        storeId: true,
        registerId: true,
        shiftId: true,
        isPosSale: true,
        payments: { select: { id: true } },
        fiscalReceipts: { select: { id: true } },
      },
    }),
  ]);

  for (const assignment of storeProducts) {
    if (
      assignment.id !== fixture.product.storeProductId ||
      assignment.organizationId !== fixture.organizationId ||
      assignment.storeId !== fixture.storeId ||
      assignment.productId !== fixture.product.id
    ) {
      throw new Error(`Refusing to reuse non-QA POS store product ${assignment.id}.`);
    }
  }
  for (const snapshot of snapshots) {
    if (
      snapshot.id !== fixture.product.snapshotId ||
      snapshot.storeId !== fixture.storeId ||
      snapshot.productId !== fixture.product.id ||
      snapshot.variantKey !== fixture.variantKey
    ) {
      throw new Error(`Refusing to reuse non-QA POS snapshot ${snapshot.id}.`);
    }
  }
  for (const cost of costs) {
    if (
      cost.id !== fixture.product.productCostId ||
      cost.organizationId !== fixture.organizationId ||
      cost.productId !== fixture.product.id ||
      cost.variantKey !== fixture.variantKey
    ) {
      throw new Error(`Refusing to reuse non-QA POS product cost ${cost.id}.`);
    }
  }
  for (const draft of staleDrafts) {
    if (
      draft.organizationId !== fixture.organizationId ||
      draft.storeId !== fixture.storeId ||
      draft.registerId !== fixture.registerId ||
      draft.shiftId !== fixture.shiftId ||
      !draft.isPosSale ||
      draft.payments.length > 0 ||
      draft.fiscalReceipts.length > 0
    ) {
      throw new Error(`Refusing to remove non-QA or posted POS draft ${draft.id}.`);
    }
  }

  return staleDrafts.map((draft) => draft.id);
};

export const seedAuthenticatedPosMobileFixtures = async (prisma: PrismaClient) => {
  const staleDraftIds = await assertPosMobileSeedOwnership(prisma);
  const fixture = authenticatedPosMobileFixture;

  await prisma.$transaction(
    async (tx) => {
      if (staleDraftIds.length) {
        await tx.customerOrder.deleteMany({ where: { id: { in: staleDraftIds } } });
      }

      await tx.product.upsert({
        where: { id: fixture.product.id },
        create: {
          id: fixture.product.id,
          organizationId: fixture.organizationId,
          sku: fixture.product.sku,
          name: fixture.product.name,
          unit: "pc",
          baseUnitId: fixture.baseUnitId,
          basePriceKgs: fixture.product.basePriceKgs,
        },
        update: {
          organizationId: fixture.organizationId,
          sku: fixture.product.sku,
          name: fixture.product.name,
          unit: "pc",
          baseUnitId: fixture.baseUnitId,
          basePriceKgs: fixture.product.basePriceKgs,
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
          costBasisValueKgs: fixture.product.baselineOnHand * fixture.product.unitCostKgs,
        },
        update: {
          variantId: null,
          avgCostKgs: fixture.product.unitCostKgs,
          costBasisQty: fixture.product.baselineOnHand,
          costBasisValueKgs: fixture.product.baselineOnHand * fixture.product.unitCostKgs,
          lastReceiptAt: null,
        },
      });
      await tx.storeComplianceProfile.update({
        where: { storeId: fixture.storeId },
        data: {
          enableKkm: false,
          kkmMode: KkmMode.OFF,
          kkmProviderKey: null,
          kkmSettings: undefined,
          enableMarking: false,
          markingMode: MarkingMode.OFF,
          updatedById: fixture.adminUserId,
        },
      });
      await tx.storePrinterSettings.update({
        where: { storeId: fixture.storeId },
        data: {
          receiptPrintProvider: "DISABLED",
          receiptAutoPrintEnabled: false,
          updatedById: fixture.adminUserId,
        },
      });
    },
    { timeout: 30_000 },
  );
};
