import type { PrismaClient } from "@prisma/client";

import {
  authenticatedAdvancedProductFixture,
  authenticatedAdvancedSeededProducts,
} from "../tests/e2e/authenticated/advanced-product-contract";
import { authenticatedE2ESeedPrefix } from "../tests/e2e/authenticated/contract";

const assertAdvancedProductSeedOwnership = async (prisma: PrismaClient) => {
  const fixture = authenticatedAdvancedProductFixture;
  const seededIds = authenticatedAdvancedSeededProducts.map((product) => product.id);
  const seededSkus = authenticatedAdvancedSeededProducts.map((product) => product.sku);
  const [organization, store, unit, admin, products, browserBundles] = await Promise.all([
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
    prisma.product.findMany({
      where: { OR: [{ id: { in: seededIds } }, { sku: { in: seededSkus } }] },
      select: { id: true, organizationId: true, name: true, sku: true },
    }),
    prisma.product.findMany({
      where: { sku: fixture.browserBundle.sku },
      select: { id: true, organizationId: true, name: true, sku: true, isBundle: true },
    }),
  ]);

  if (!organization || !organization.name.startsWith(authenticatedE2ESeedPrefix)) {
    throw new Error("Advanced-product fixtures require the primary QA organization.");
  }
  if (
    !store ||
    store.organizationId !== fixture.organizationId ||
    !store.name.startsWith(authenticatedE2ESeedPrefix)
  ) {
    throw new Error("Advanced-product fixtures require the primary QA store.");
  }
  if (!unit || unit.organizationId !== fixture.organizationId) {
    throw new Error("Advanced-product fixtures require the primary QA unit.");
  }
  if (
    !admin ||
    admin.organizationId !== fixture.organizationId ||
    !admin.name.startsWith(authenticatedE2ESeedPrefix)
  ) {
    throw new Error("Advanced-product fixtures require the primary QA admin.");
  }

  for (const product of products) {
    const expected = authenticatedAdvancedSeededProducts.find(
      (candidate) => candidate.id === product.id || candidate.sku === product.sku,
    );
    const allowedNames =
      expected?.id === fixture.staleEdit.id
        ? new Set([
            fixture.staleEdit.name,
            fixture.staleEdit.winnerName,
            fixture.staleEdit.loserName,
          ])
        : new Set(expected ? [expected.name] : []);
    if (
      !expected ||
      product.id !== expected.id ||
      product.sku !== expected.sku ||
      !allowedNames.has(product.name) ||
      product.organizationId !== fixture.organizationId
    ) {
      throw new Error(`Refusing to overwrite non-QA advanced product ${product.id}.`);
    }
  }
  for (const product of browserBundles) {
    if (
      product.organizationId !== fixture.organizationId ||
      product.name !== fixture.browserBundle.name ||
      product.sku !== fixture.browserBundle.sku ||
      !product.isBundle
    ) {
      throw new Error(`Refusing to clean non-QA browser bundle ${product.id}.`);
    }
  }

  const [storeProducts, snapshots, costs] = await Promise.all([
    prisma.storeProduct.findMany({
      where: {
        OR: authenticatedAdvancedSeededProducts.map((product) => ({
          id: product.storeProductId,
        })),
      },
      select: { id: true, organizationId: true, storeId: true, productId: true },
    }),
    prisma.inventorySnapshot.findMany({
      where: { id: fixture.component.snapshotId },
      select: { id: true, storeId: true, productId: true, variantKey: true },
    }),
    prisma.productCost.findMany({
      where: { id: fixture.component.productCostId },
      select: { id: true, organizationId: true, productId: true, variantKey: true },
    }),
  ]);
  for (const assignment of storeProducts) {
    const expected = authenticatedAdvancedSeededProducts.find(
      (candidate) => candidate.storeProductId === assignment.id,
    );
    if (
      !expected ||
      assignment.organizationId !== fixture.organizationId ||
      assignment.storeId !== fixture.storeId ||
      assignment.productId !== expected.id
    ) {
      throw new Error(`Refusing to reuse non-QA store assignment ${assignment.id}.`);
    }
  }
  for (const snapshot of snapshots) {
    if (
      snapshot.storeId !== fixture.storeId ||
      snapshot.productId !== fixture.component.id ||
      snapshot.variantKey !== fixture.variantKey
    ) {
      throw new Error(`Refusing to reuse non-QA inventory snapshot ${snapshot.id}.`);
    }
  }
  for (const cost of costs) {
    if (
      cost.organizationId !== fixture.organizationId ||
      cost.productId !== fixture.component.id ||
      cost.variantKey !== fixture.variantKey
    ) {
      throw new Error(`Refusing to reuse non-QA product cost ${cost.id}.`);
    }
  }

  return browserBundles;
};

export const seedAuthenticatedAdvancedProductFixtures = async (prisma: PrismaClient) => {
  const browserBundles = await assertAdvancedProductSeedOwnership(prisma);
  const fixture = authenticatedAdvancedProductFixture;

  await prisma.$transaction(async (tx) => {
    for (const bundle of browserBundles) {
      const assemblyReferences = (
        await tx.stockMovement.findMany({
          where: {
            productId: bundle.id,
            referenceType: "BUNDLE_ASSEMBLY",
            referenceId: { not: null },
          },
          select: { referenceId: true },
        })
      ).flatMap((movement) => (movement.referenceId ? [movement.referenceId] : []));
      if (assemblyReferences.length) {
        await tx.stockMovement.deleteMany({
          where: { referenceType: "BUNDLE_ASSEMBLY", referenceId: { in: assemblyReferences } },
        });
      }
      await tx.productBundleComponent.deleteMany({
        where: { OR: [{ bundleProductId: bundle.id }, { componentProductId: bundle.id }] },
      });
      await tx.inventorySnapshot.deleteMany({ where: { productId: bundle.id } });
      await tx.productCost.deleteMany({ where: { productId: bundle.id } });
      await tx.storePrice.deleteMany({ where: { productId: bundle.id } });
      await tx.reorderPolicy.deleteMany({ where: { productId: bundle.id } });
      await tx.productImage.deleteMany({ where: { productId: bundle.id } });
      await tx.productBarcode.deleteMany({ where: { productId: bundle.id } });
      await tx.productPack.deleteMany({ where: { productId: bundle.id } });
      await tx.storeProduct.deleteMany({ where: { productId: bundle.id } });
      await tx.product.delete({ where: { id: bundle.id } });
    }

    await tx.stockMovement.deleteMany({
      where: {
        productId: fixture.component.id,
        referenceType: "BUNDLE_ASSEMBLY",
        note: `bundleAssemble:${fixture.browserBundle.sku}`,
      },
    });

    for (const product of authenticatedAdvancedSeededProducts) {
      await tx.product.upsert({
        where: { id: product.id },
        create: {
          id: product.id,
          organizationId: fixture.organizationId,
          sku: product.sku,
          name: product.name,
          unit: "pc",
          baseUnitId: fixture.baseUnitId,
          basePriceKgs: 100,
        },
        update: {
          organizationId: fixture.organizationId,
          sku: product.sku,
          name: product.name,
          unit: "pc",
          baseUnitId: fixture.baseUnitId,
          basePriceKgs: 100,
          description: null,
          photoUrl: null,
          isDeleted: false,
          isBundle: false,
        },
      });
      await tx.storeProduct.upsert({
        where: { storeId_productId: { storeId: fixture.storeId, productId: product.id } },
        create: {
          id: product.storeProductId,
          organizationId: fixture.organizationId,
          storeId: fixture.storeId,
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
    }

    await tx.productImage.deleteMany({ where: { productId: fixture.image.id } });
    await tx.productBundleComponent.deleteMany({
      where: {
        OR: [
          {
            bundleProductId: {
              in: authenticatedAdvancedSeededProducts.map((product) => product.id),
            },
          },
          { componentProductId: fixture.staleEdit.id },
          { componentProductId: fixture.image.id },
        ],
      },
    });
    await tx.inventorySnapshot.upsert({
      where: {
        storeId_productId_variantKey: {
          storeId: fixture.storeId,
          productId: fixture.component.id,
          variantKey: fixture.variantKey,
        },
      },
      create: {
        id: fixture.component.snapshotId,
        storeId: fixture.storeId,
        productId: fixture.component.id,
        variantKey: fixture.variantKey,
        onHand: fixture.component.onHand,
        onOrder: 0,
        allowNegativeStock: false,
      },
      update: {
        variantId: null,
        onHand: fixture.component.onHand,
        onOrder: 0,
        allowNegativeStock: false,
      },
    });
    await tx.productCost.upsert({
      where: {
        organizationId_productId_variantKey: {
          organizationId: fixture.organizationId,
          productId: fixture.component.id,
          variantKey: fixture.variantKey,
        },
      },
      create: {
        id: fixture.component.productCostId,
        organizationId: fixture.organizationId,
        productId: fixture.component.id,
        variantKey: fixture.variantKey,
        avgCostKgs: fixture.component.unitCostKgs,
        costBasisQty: fixture.component.onHand,
        costBasisValueKgs: fixture.component.onHand * fixture.component.unitCostKgs,
      },
      update: {
        variantId: null,
        avgCostKgs: fixture.component.unitCostKgs,
        costBasisQty: fixture.component.onHand,
        costBasisValueKgs: fixture.component.onHand * fixture.component.unitCostKgs,
        lastReceiptAt: null,
      },
    });
  });
};
