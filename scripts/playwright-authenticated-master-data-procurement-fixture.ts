import type { PrismaClient } from "@prisma/client";

import { authenticatedE2ESeedPrefix } from "../tests/e2e/authenticated/contract";
import {
  authenticatedMasterDataProcurementFixture,
  authenticatedMasterDataProcurementProducts,
} from "../tests/e2e/authenticated/master-data-procurement-contract";

const assertMasterDataProcurementSeedOwnership = async (prisma: PrismaClient) => {
  const fixture = authenticatedMasterDataProcurementFixture;
  const productIds = authenticatedMasterDataProcurementProducts.map((product) => product.id);
  const productSkus = authenticatedMasterDataProcurementProducts.map((product) => product.sku);
  const [
    organization,
    store,
    unit,
    admin,
    supplier,
    categories,
    products,
    preferences,
    attributeDefinitions,
    attributeVariant,
    attributeValues,
  ] = await Promise.all([
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
    prisma.supplier.findUnique({
      where: { id: fixture.supplier.id },
      select: { id: true, organizationId: true, name: true },
    }),
    prisma.productCategory.findMany({
      where: {
        OR: [
          { id: fixture.category.id },
          { organizationId: fixture.organizationId, name: fixture.category.name },
        ],
      },
      select: { id: true, organizationId: true, name: true },
    }),
    prisma.product.findMany({
      where: { OR: [{ id: { in: productIds } }, { sku: { in: productSkus } }] },
      select: { id: true, organizationId: true, name: true, sku: true },
    }),
    prisma.storeCategoryPreference.findMany({
      where: {
        storeId: fixture.storeId,
        normalizedName: fixture.category.normalizedName,
      },
      select: { id: true, organizationId: true, storeId: true, name: true },
    }),
    prisma.attributeDefinition.findMany({
      where: {
        OR: [
          { id: fixture.attribute.id },
          {
            organizationId: fixture.organizationId,
            key: fixture.attribute.key,
          },
        ],
      },
      select: { id: true, organizationId: true, key: true, labelRu: true, labelKg: true },
    }),
    prisma.productVariant.findUnique({
      where: { id: fixture.attribute.variantId },
      select: { id: true, productId: true, attributes: true },
    }),
    prisma.variantAttributeValue.findMany({
      where: {
        OR: [
          { id: fixture.attribute.valueId },
          {
            variantId: fixture.attribute.variantId,
            key: fixture.attribute.key,
          },
        ],
      },
      select: {
        id: true,
        organizationId: true,
        productId: true,
        variantId: true,
        key: true,
        value: true,
      },
    }),
  ]);

  if (!organization || !organization.name.startsWith(authenticatedE2ESeedPrefix)) {
    throw new Error("Master-data fixtures require the primary QA organization.");
  }
  if (
    !store ||
    store.organizationId !== fixture.organizationId ||
    !store.name.startsWith(authenticatedE2ESeedPrefix)
  ) {
    throw new Error("Master-data fixtures require the primary QA store.");
  }
  if (!unit || unit.organizationId !== fixture.organizationId) {
    throw new Error("Master-data fixtures require the primary QA unit.");
  }
  if (
    !admin ||
    admin.organizationId !== fixture.organizationId ||
    !admin.name.startsWith(authenticatedE2ESeedPrefix)
  ) {
    throw new Error("Master-data fixtures require the primary QA admin.");
  }
  if (
    supplier &&
    (supplier.organizationId !== fixture.organizationId ||
      !supplier.name.startsWith(authenticatedE2ESeedPrefix))
  ) {
    throw new Error(`Refusing to overwrite non-QA supplier ${supplier.id}.`);
  }
  if (
    categories.some(
      (category) =>
        category.id !== fixture.category.id ||
        category.name !== fixture.category.name ||
        category.organizationId !== fixture.organizationId,
    )
  ) {
    throw new Error("Refusing to overwrite a non-QA product category or reuse its name.");
  }
  for (const product of products) {
    const expected = authenticatedMasterDataProcurementProducts.find(
      (candidate) => candidate.id === product.id || candidate.sku === product.sku,
    );
    if (
      !expected ||
      product.id !== expected.id ||
      product.sku !== expected.sku ||
      product.organizationId !== fixture.organizationId ||
      !product.name.startsWith(authenticatedE2ESeedPrefix)
    ) {
      throw new Error(`Refusing to overwrite non-QA master-data product ${product.id}.`);
    }
  }
  if (
    preferences.some(
      (preference) =>
        preference.organizationId !== fixture.organizationId ||
        preference.storeId !== fixture.storeId ||
        !preference.name.startsWith(authenticatedE2ESeedPrefix),
    )
  ) {
    throw new Error("Refusing to overwrite a non-QA store category preference.");
  }
  if (
    attributeDefinitions.some(
      (definition) =>
        definition.id !== fixture.attribute.id ||
        definition.organizationId !== fixture.organizationId ||
        definition.key !== fixture.attribute.key ||
        !definition.labelRu.startsWith(authenticatedE2ESeedPrefix) ||
        !definition.labelKg.startsWith(authenticatedE2ESeedPrefix),
    )
  ) {
    throw new Error("Refusing to overwrite a non-QA attribute definition or reuse its key.");
  }
  if (attributeVariant) {
    const attributes = attributeVariant.attributes;
    if (
      attributeVariant.productId !== fixture.attribute.productId ||
      !attributes ||
      Array.isArray(attributes) ||
      typeof attributes !== "object" ||
      attributes[fixture.attribute.key] !== fixture.attribute.value
    ) {
      throw new Error(`Refusing to overwrite non-QA product variant ${attributeVariant.id}.`);
    }
  }
  if (
    attributeValues.some(
      (value) =>
        value.id !== fixture.attribute.valueId ||
        value.organizationId !== fixture.organizationId ||
        value.productId !== fixture.attribute.productId ||
        value.variantId !== fixture.attribute.variantId ||
        value.key !== fixture.attribute.key ||
        value.value !== fixture.attribute.value,
    )
  ) {
    throw new Error("Refusing to overwrite a non-QA normalized attribute value.");
  }

  const [assignments, snapshots, costs] = await Promise.all([
    prisma.storeProduct.findMany({
      where: { storeId: fixture.storeId, productId: { in: productIds } },
      select: { id: true, organizationId: true, storeId: true, productId: true },
    }),
    prisma.inventorySnapshot.findMany({
      where: {
        storeId: fixture.storeId,
        productId: { in: [fixture.cancelProduct.id, fixture.receiveProduct.id] },
        variantKey: fixture.variantKey,
      },
      select: { id: true, storeId: true, productId: true, variantKey: true },
    }),
    prisma.productCost.findMany({
      where: {
        organizationId: fixture.organizationId,
        productId: { in: [fixture.cancelProduct.id, fixture.receiveProduct.id] },
        variantKey: fixture.variantKey,
      },
      select: { id: true, organizationId: true, productId: true, variantKey: true },
    }),
  ]);
  for (const assignment of assignments) {
    if (
      assignment.organizationId !== fixture.organizationId ||
      assignment.storeId !== fixture.storeId ||
      !productIds.includes(assignment.productId)
    ) {
      throw new Error(`Refusing to reuse non-QA store assignment ${assignment.id}.`);
    }
  }
  for (const snapshot of snapshots) {
    if (
      snapshot.storeId !== fixture.storeId ||
      snapshot.variantKey !== fixture.variantKey ||
      (snapshot.productId !== fixture.cancelProduct.id &&
        snapshot.productId !== fixture.receiveProduct.id)
    ) {
      throw new Error(`Refusing to reuse non-QA inventory snapshot ${snapshot.id}.`);
    }
  }
  for (const cost of costs) {
    if (
      cost.organizationId !== fixture.organizationId ||
      cost.variantKey !== fixture.variantKey ||
      (cost.productId !== fixture.cancelProduct.id && cost.productId !== fixture.receiveProduct.id)
    ) {
      throw new Error(`Refusing to reuse non-QA product cost ${cost.id}.`);
    }
  }
};

export const seedAuthenticatedMasterDataProcurementFixtures = async (prisma: PrismaClient) => {
  await assertMasterDataProcurementSeedOwnership(prisma);
  const fixture = authenticatedMasterDataProcurementFixture;
  const valuationTimestamp = new Date("2026-08-31T06:00:00.000Z");

  await prisma.$transaction(
    async (tx) => {
      await tx.supplier.upsert({
        where: { id: fixture.supplier.id },
        create: {
          id: fixture.supplier.id,
          organizationId: fixture.organizationId,
          name: fixture.supplier.name,
          email: fixture.supplier.email,
          phone: fixture.supplier.phone,
          notes: `${authenticatedE2ESeedPrefix} procurement acceptance fixture`,
        },
        update: {
          organizationId: fixture.organizationId,
          name: fixture.supplier.name,
          email: fixture.supplier.email,
          phone: fixture.supplier.phone,
          notes: `${authenticatedE2ESeedPrefix} procurement acceptance fixture`,
        },
      });
      await tx.productCategory.upsert({
        where: { id: fixture.category.id },
        create: {
          id: fixture.category.id,
          organizationId: fixture.organizationId,
          name: fixture.category.name,
        },
        update: {
          organizationId: fixture.organizationId,
          name: fixture.category.name,
        },
      });
      await tx.storeCategoryPreference.upsert({
        where: {
          storeId_normalizedName: {
            storeId: fixture.storeId,
            normalizedName: fixture.category.normalizedName,
          },
        },
        create: {
          organizationId: fixture.organizationId,
          storeId: fixture.storeId,
          name: fixture.category.name,
          normalizedName: fixture.category.normalizedName,
          isVisibleInForms: true,
          isArchived: false,
        },
        update: {
          organizationId: fixture.organizationId,
          name: fixture.category.name,
          isVisibleInForms: true,
          isArchived: false,
        },
      });

      for (const product of authenticatedMasterDataProcurementProducts) {
        await tx.product.upsert({
          where: { id: product.id },
          create: {
            id: product.id,
            organizationId: fixture.organizationId,
            supplierId: fixture.supplier.id,
            sku: product.sku,
            name: product.name,
            category: fixture.category.name,
            categories: [fixture.category.name],
            unit: "pc",
            baseUnitId: fixture.baseUnitId,
            basePriceKgs: product.basePriceKgs,
          },
          update: {
            organizationId: fixture.organizationId,
            supplierId: fixture.supplier.id,
            sku: product.sku,
            name: product.name,
            category: fixture.category.name,
            categories: [fixture.category.name],
            unit: "pc",
            baseUnitId: fixture.baseUnitId,
            basePriceKgs: product.basePriceKgs,
            isDeleted: false,
          },
        });
        await tx.storeProduct.upsert({
          where: { storeId_productId: { storeId: fixture.storeId, productId: product.id } },
          create: {
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

      await tx.attributeDefinition.upsert({
        where: { id: fixture.attribute.id },
        create: {
          id: fixture.attribute.id,
          organizationId: fixture.organizationId,
          key: fixture.attribute.key,
          labelRu: fixture.attribute.labelRu,
          labelKg: fixture.attribute.labelKg,
          type: "TEXT",
          optionsRu: [],
          optionsKg: [],
          required: false,
          isActive: true,
        },
        update: {
          organizationId: fixture.organizationId,
          key: fixture.attribute.key,
          labelRu: fixture.attribute.labelRu,
          labelKg: fixture.attribute.labelKg,
          type: "TEXT",
          optionsRu: [],
          optionsKg: [],
          required: false,
          isActive: true,
        },
      });
      await tx.productVariant.upsert({
        where: { id: fixture.attribute.variantId },
        create: {
          id: fixture.attribute.variantId,
          productId: fixture.attribute.productId,
          name: `${authenticatedE2ESeedPrefix} attribute fixture variant`,
          attributes: { [fixture.attribute.key]: fixture.attribute.value },
          isActive: true,
        },
        update: {
          productId: fixture.attribute.productId,
          name: `${authenticatedE2ESeedPrefix} attribute fixture variant`,
          attributes: { [fixture.attribute.key]: fixture.attribute.value },
          isActive: true,
        },
      });
      await tx.variantAttributeValue.upsert({
        where: { id: fixture.attribute.valueId },
        create: {
          id: fixture.attribute.valueId,
          organizationId: fixture.organizationId,
          productId: fixture.attribute.productId,
          variantId: fixture.attribute.variantId,
          key: fixture.attribute.key,
          value: fixture.attribute.value,
        },
        update: {
          organizationId: fixture.organizationId,
          productId: fixture.attribute.productId,
          variantId: fixture.attribute.variantId,
          key: fixture.attribute.key,
          value: fixture.attribute.value,
        },
      });

      for (const product of [fixture.cancelProduct, fixture.receiveProduct]) {
        await tx.inventorySnapshot.upsert({
          where: {
            storeId_productId_variantKey: {
              storeId: fixture.storeId,
              productId: product.id,
              variantKey: fixture.variantKey,
            },
          },
          create: {
            storeId: fixture.storeId,
            productId: product.id,
            variantId: null,
            variantKey: fixture.variantKey,
            onHand: product.baselineOnHand,
            onOrder: 0,
            allowNegativeStock: false,
          },
          update: {
            variantId: null,
            onHand: product.baselineOnHand,
            onOrder: 0,
            allowNegativeStock: false,
          },
        });
        await tx.productCost.upsert({
          where: {
            organizationId_productId_variantKey: {
              organizationId: fixture.organizationId,
              productId: product.id,
              variantKey: fixture.variantKey,
            },
          },
          create: {
            organizationId: fixture.organizationId,
            productId: product.id,
            variantId: null,
            variantKey: fixture.variantKey,
            avgCostKgs: product.unitCostKgs,
            costBasisQty: product.baselineOnHand,
            preciseAvgCostKgs: product.unitCostKgs,
            preciseCostBasisQty: product.baselineOnHand,
            costBasisValueKgs: product.baselineOnHand * product.unitCostKgs,
            valuationStatus: "PRECISE",
            valuationUpdatedAt: valuationTimestamp,
            valuationLegacyUpdatedAt: valuationTimestamp,
            updatedAt: valuationTimestamp,
          },
          update: {
            variantId: null,
            avgCostKgs: product.unitCostKgs,
            costBasisQty: product.baselineOnHand,
            preciseAvgCostKgs: product.unitCostKgs,
            preciseCostBasisQty: product.baselineOnHand,
            costBasisValueKgs: product.baselineOnHand * product.unitCostKgs,
            valuationStatus: "PRECISE",
            valuationUpdatedAt: valuationTimestamp,
            valuationLegacyUpdatedAt: valuationTimestamp,
            updatedAt: valuationTimestamp,
            lastReceiptAt: null,
          },
        });
      }
    },
    { timeout: 30_000 },
  );
};
