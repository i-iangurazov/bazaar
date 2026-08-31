import { StockCountStatus, type PrismaClient } from "@prisma/client";

import {
  authenticatedInventoryMutationFixture,
  authenticatedInventoryMutationProducts,
} from "../tests/e2e/authenticated/inventory-mutations-contract";
import { authenticatedE2ESeedPrefix } from "../tests/e2e/authenticated/contract";

const assertMutationSeedOwnership = async (prisma: PrismaClient) => {
  const fixture = authenticatedInventoryMutationFixture;
  const productIds = authenticatedInventoryMutationProducts.map((item) => item.id);
  const productSkus = authenticatedInventoryMutationProducts.map((item) => item.sku);
  const ownedRecordIds = new Set(
    authenticatedInventoryMutationProducts.flatMap((item) => [
      item.storeProductId,
      item.secondaryStoreProductId,
      item.primarySnapshotId,
      item.secondarySnapshotId,
      item.productCostId,
    ]),
  );

  const [organization, stores, unit, supplier, admin, products, stockCount, stockCountLine] =
    await Promise.all([
      prisma.organization.findUnique({
        where: { id: fixture.organizationId },
        select: { id: true, name: true },
      }),
      prisma.store.findMany({
        where: { id: { in: [fixture.primaryStoreId, fixture.secondaryStoreId] } },
        select: { id: true, organizationId: true, name: true },
      }),
      prisma.unit.findUnique({
        where: { id: fixture.baseUnitId },
        select: { id: true, organizationId: true },
      }),
      prisma.supplier.findUnique({
        where: { id: fixture.supplierId },
        select: { id: true, organizationId: true, name: true },
      }),
      prisma.user.findUnique({
        where: { id: fixture.adminUserId },
        select: { id: true, organizationId: true, name: true },
      }),
      prisma.product.findMany({
        where: { OR: [{ id: { in: productIds } }, { sku: { in: productSkus } }] },
        select: { id: true, organizationId: true, name: true, sku: true },
      }),
      prisma.stockCount.findFirst({
        where: {
          OR: [{ id: fixture.stockCount.countId }, { code: fixture.stockCount.code }],
        },
        select: { id: true, organizationId: true, storeId: true, code: true },
      }),
      prisma.stockCountLine.findUnique({
        where: { id: fixture.stockCount.countLineId },
        select: { id: true, stockCountId: true, storeId: true, productId: true },
      }),
    ]);

  if (!organization || !organization.name.startsWith(authenticatedE2ESeedPrefix)) {
    throw new Error("Inventory mutation fixtures require the primary QA organization.");
  }
  if (
    stores.length !== 2 ||
    stores.some(
      (store) =>
        store.organizationId !== fixture.organizationId ||
        !store.name.startsWith(authenticatedE2ESeedPrefix),
    )
  ) {
    throw new Error("Inventory mutation fixtures require both primary QA stores.");
  }
  for (const record of [unit, supplier, admin]) {
    if (!record || record.organizationId !== fixture.organizationId) {
      throw new Error("Inventory mutation fixture dependencies must belong to the primary QA org.");
    }
  }
  if (
    !supplier?.name.startsWith(authenticatedE2ESeedPrefix) ||
    !admin?.name.startsWith(authenticatedE2ESeedPrefix)
  ) {
    throw new Error("Inventory mutation fixture dependencies must retain QA ownership names.");
  }

  for (const existing of products) {
    const expected = authenticatedInventoryMutationProducts.find(
      (item) => item.id === existing.id || item.sku === existing.sku,
    );
    if (
      !expected ||
      existing.id !== expected.id ||
      existing.sku !== expected.sku ||
      existing.organizationId !== fixture.organizationId ||
      !existing.name.startsWith(authenticatedE2ESeedPrefix)
    ) {
      throw new Error(`Refusing to overwrite non-QA inventory mutation product ${existing.id}.`);
    }
  }
  if (
    stockCount &&
    (stockCount.id !== fixture.stockCount.countId ||
      stockCount.code !== fixture.stockCount.code ||
      stockCount.organizationId !== fixture.organizationId ||
      stockCount.storeId !== fixture.primaryStoreId)
  ) {
    throw new Error("Refusing to overwrite a non-QA inventory mutation stock count.");
  }
  if (
    stockCountLine &&
    (stockCountLine.stockCountId !== fixture.stockCount.countId ||
      stockCountLine.storeId !== fixture.primaryStoreId ||
      stockCountLine.productId !== fixture.stockCount.id)
  ) {
    throw new Error("Refusing to overwrite a non-QA inventory mutation stock-count line.");
  }

  const occupiedRecords = await Promise.all([
    prisma.storeProduct.findMany({
      where: { id: { in: [...ownedRecordIds] } },
      select: { id: true, organizationId: true },
    }),
    prisma.inventorySnapshot.findMany({
      where: { id: { in: [...ownedRecordIds] } },
      select: { id: true, storeId: true, productId: true },
    }),
    prisma.productCost.findMany({
      where: { id: { in: [...ownedRecordIds] } },
      select: { id: true, organizationId: true, productId: true },
    }),
  ]);
  for (const record of occupiedRecords.flat()) {
    if (!ownedRecordIds.has(record.id)) {
      throw new Error(`Refusing to reuse non-QA fixture record ${record.id}.`);
    }
    if ("organizationId" in record && record.organizationId !== fixture.organizationId) {
      throw new Error(`Refusing to reuse cross-tenant fixture record ${record.id}.`);
    }
    if ("productId" in record && !productIds.includes(record.productId as never)) {
      throw new Error(`Refusing to reuse fixture record ${record.id} for another product.`);
    }
  }
};

export const seedAuthenticatedInventoryMutationFixtures = async (prisma: PrismaClient) => {
  await assertMutationSeedOwnership(prisma);
  const fixture = authenticatedInventoryMutationFixture;
  const valuationTimestamp = new Date("2026-08-31T06:00:00.000Z");

  await prisma.$transaction(
    async (tx) => {
      const existingGuidanceState = await tx.userGuideState.findUnique({
        where: { userId: fixture.adminUserId },
        select: { dismissedTipsJson: true },
      });
      const dismissedGuidance = Array.isArray(existingGuidanceState?.dismissedTipsJson)
        ? existingGuidanceState.dismissedTipsJson.filter(
            (item): item is string => typeof item === "string" && item.trim().length > 0,
          )
        : [];
      await tx.userGuideState.upsert({
        where: { userId: fixture.adminUserId },
        create: {
          userId: fixture.adminUserId,
          completedToursJson: [],
          dismissedTipsJson: [fixture.guidanceToursDisabledMarker],
        },
        update: {
          dismissedTipsJson: Array.from(
            new Set([...dismissedGuidance, fixture.guidanceToursDisabledMarker]),
          ),
        },
      });

      for (const product of authenticatedInventoryMutationProducts) {
        await tx.product.upsert({
          where: { id: product.id },
          create: {
            id: product.id,
            organizationId: fixture.organizationId,
            supplierId: fixture.supplierId,
            sku: product.sku,
            name: product.name,
            unit: "pc",
            baseUnitId: fixture.baseUnitId,
            basePriceKgs: 125,
          },
          update: {
            organizationId: fixture.organizationId,
            supplierId: fixture.supplierId,
            sku: product.sku,
            name: product.name,
            unit: "pc",
            baseUnitId: fixture.baseUnitId,
            basePriceKgs: 125,
            isDeleted: false,
          },
        });

        const assignments = [
          {
            id: product.storeProductId,
            storeId: fixture.primaryStoreId,
            snapshotId: product.primarySnapshotId,
            onHand: product.primaryOnHand,
          },
          ...(product === fixture.transfer
            ? [
                {
                  id: product.secondaryStoreProductId,
                  storeId: fixture.secondaryStoreId,
                  snapshotId: product.secondarySnapshotId,
                  onHand: product.secondaryOnHand,
                },
              ]
            : []),
        ];
        for (const assignment of assignments) {
          await tx.storeProduct.upsert({
            where: { storeId_productId: { storeId: assignment.storeId, productId: product.id } },
            create: {
              id: assignment.id,
              organizationId: fixture.organizationId,
              storeId: assignment.storeId,
              productId: product.id,
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
                storeId: assignment.storeId,
                productId: product.id,
                variantKey: fixture.variantKey,
              },
            },
            create: {
              id: assignment.snapshotId,
              storeId: assignment.storeId,
              productId: product.id,
              variantId: null,
              variantKey: fixture.variantKey,
              onHand: assignment.onHand,
              onOrder: 0,
              allowNegativeStock: false,
            },
            update: {
              variantId: null,
              onHand: assignment.onHand,
              onOrder: 0,
              allowNegativeStock: false,
            },
          });
        }

        const totalOnHand = product.primaryOnHand + product.secondaryOnHand;
        await tx.productCost.upsert({
          where: {
            organizationId_productId_variantKey: {
              organizationId: fixture.organizationId,
              productId: product.id,
              variantKey: fixture.variantKey,
            },
          },
          create: {
            id: product.productCostId,
            organizationId: fixture.organizationId,
            productId: product.id,
            variantId: null,
            variantKey: fixture.variantKey,
            avgCostKgs: product.unitCostKgs,
            costBasisQty: totalOnHand,
            preciseAvgCostKgs: product.unitCostKgs,
            preciseCostBasisQty: totalOnHand,
            costBasisValueKgs: totalOnHand * product.unitCostKgs,
            valuationStatus: "PRECISE",
            valuationUpdatedAt: valuationTimestamp,
            valuationLegacyUpdatedAt: valuationTimestamp,
            updatedAt: valuationTimestamp,
          },
          update: {
            variantId: null,
            avgCostKgs: product.unitCostKgs,
            costBasisQty: totalOnHand,
            preciseAvgCostKgs: product.unitCostKgs,
            preciseCostBasisQty: totalOnHand,
            costBasisValueKgs: totalOnHand * product.unitCostKgs,
            valuationStatus: "PRECISE",
            valuationUpdatedAt: valuationTimestamp,
            valuationLegacyUpdatedAt: valuationTimestamp,
            updatedAt: valuationTimestamp,
            lastReceiptAt: null,
          },
        });
      }

      await tx.stockCount.upsert({
        where: { id: fixture.stockCount.countId },
        create: {
          id: fixture.stockCount.countId,
          organizationId: fixture.organizationId,
          storeId: fixture.primaryStoreId,
          code: fixture.stockCount.code,
          status: StockCountStatus.IN_PROGRESS,
          notes: `${authenticatedE2ESeedPrefix} inventory mutation acceptance fixture`,
          startedAt: new Date("2026-08-31T06:00:00.000Z"),
          createdById: fixture.adminUserId,
        },
        update: {
          organizationId: fixture.organizationId,
          storeId: fixture.primaryStoreId,
          code: fixture.stockCount.code,
          status: StockCountStatus.IN_PROGRESS,
          appliedAt: null,
          appliedById: null,
          notes: `${authenticatedE2ESeedPrefix} inventory mutation acceptance fixture`,
        },
      });
      await tx.stockCountLine.upsert({
        where: {
          stockCountId_productId_variantKey: {
            stockCountId: fixture.stockCount.countId,
            productId: fixture.stockCount.id,
            variantKey: fixture.variantKey,
          },
        },
        create: {
          id: fixture.stockCount.countLineId,
          stockCountId: fixture.stockCount.countId,
          storeId: fixture.primaryStoreId,
          productId: fixture.stockCount.id,
          variantId: null,
          variantKey: fixture.variantKey,
          expectedOnHand: fixture.stockCount.primaryOnHand,
          countedQty: fixture.stockCount.primaryOnHand,
          deltaQty: 0,
        },
        update: {
          storeId: fixture.primaryStoreId,
          variantId: null,
          expectedOnHand: fixture.stockCount.primaryOnHand,
          countedQty: fixture.stockCount.primaryOnHand,
          deltaQty: 0,
          lastScannedAt: null,
        },
      });
    },
    { timeout: 30_000 },
  );
};
