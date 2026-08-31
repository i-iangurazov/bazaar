import { BazaarCatalogStatus, type PrismaClient } from "@prisma/client";

import {
  authenticatedCatalogPublicationFixture,
  authenticatedCatalogPublicationRecords,
} from "../tests/e2e/authenticated/catalog-publication-contract";
import { authenticatedE2ESeedPrefix } from "../tests/e2e/authenticated/contract";

const assertCatalogPublicationSeedOwnership = async (prisma: PrismaClient) => {
  const fixture = authenticatedCatalogPublicationFixture;
  const records = authenticatedCatalogPublicationRecords;
  const [organizations, stores, units, actors, catalogs, products, assignments, hiddenProducts] =
    await Promise.all([
      prisma.organization.findMany({
        where: { id: { in: records.map((record) => record.organizationId) } },
        select: { id: true, name: true },
      }),
      prisma.store.findMany({
        where: { id: { in: records.map((record) => record.storeId) } },
        select: { id: true, organizationId: true, name: true },
      }),
      prisma.unit.findMany({
        where: { id: { in: [fixture.baseUnitId, fixture.foreignBaseUnitId] } },
        select: { id: true, organizationId: true },
      }),
      prisma.user.findMany({
        where: { id: { in: records.map((record) => record.updatedById) } },
        select: { id: true, organizationId: true, name: true },
      }),
      prisma.bazaarCatalog.findMany({
        where: {
          OR: records.flatMap((record) => [
            { id: record.id },
            { storeId: record.storeId },
            { slug: record.slug },
          ]),
        },
        select: {
          id: true,
          organizationId: true,
          storeId: true,
          slug: true,
          publicUrlPath: true,
          title: true,
          status: true,
          updatedById: true,
        },
      }),
      prisma.product.findMany({
        where: {
          OR: records.flatMap((record) => [
            { id: record.product.id },
            { organizationId: record.organizationId, sku: record.product.sku },
          ]),
        },
        select: { id: true, organizationId: true, sku: true, name: true },
      }),
      prisma.storeProduct.findMany({
        where: {
          OR: records.flatMap((record) => [
            { id: record.product.storeProductId },
            { storeId: record.storeId, productId: record.product.id },
          ]),
        },
        select: { id: true, organizationId: true, storeId: true, productId: true },
      }),
      prisma.bazaarCatalogHiddenProduct.findMany({
        where: {
          OR: records.map((record) => ({
            storeId: record.storeId,
            productId: record.product.id,
          })),
        },
        select: { id: true, organizationId: true, storeId: true, productId: true },
      }),
    ]);

  for (const record of records) {
    const organization = organizations.find((candidate) => candidate.id === record.organizationId);
    const store = stores.find((candidate) => candidate.id === record.storeId);
    const actor = actors.find((candidate) => candidate.id === record.updatedById);
    if (!organization || !organization.name.startsWith(authenticatedE2ESeedPrefix)) {
      throw new Error(`Catalog fixtures require QA organization ${record.organizationId}.`);
    }
    if (
      !store ||
      store.organizationId !== record.organizationId ||
      !store.name.startsWith(authenticatedE2ESeedPrefix)
    ) {
      throw new Error(`Catalog fixtures require QA store ${record.storeId}.`);
    }
    if (
      !actor ||
      actor.organizationId !== record.organizationId ||
      !actor.name.startsWith(authenticatedE2ESeedPrefix)
    ) {
      throw new Error(`Catalog fixtures require QA actor ${record.updatedById}.`);
    }
  }

  const expectedUnitOrganization = new Map([
    [fixture.baseUnitId, fixture.primary.organizationId],
    [fixture.foreignBaseUnitId, fixture.foreign.organizationId],
  ]);
  for (const [unitId, organizationId] of expectedUnitOrganization) {
    const unit = units.find((candidate) => candidate.id === unitId);
    if (!unit || unit.organizationId !== organizationId) {
      throw new Error(`Catalog fixtures require QA unit ${unitId}.`);
    }
  }

  for (const catalog of catalogs) {
    const expected = records.find(
      (record) =>
        record.id === catalog.id ||
        record.storeId === catalog.storeId ||
        record.slug === catalog.slug,
    );
    const allowedTitles = new Set(
      expected
        ? [
            expected.title,
            ...(expected === fixture.primary ? [fixture.primary.publishedTitle] : []),
          ]
        : [],
    );
    if (
      !expected ||
      catalog.id !== expected.id ||
      catalog.organizationId !== expected.organizationId ||
      catalog.storeId !== expected.storeId ||
      catalog.slug !== expected.slug ||
      catalog.publicUrlPath !== expected.publicUrlPath ||
      catalog.updatedById !== expected.updatedById ||
      !allowedTitles.has(catalog.title ?? "") ||
      (catalog.status !== BazaarCatalogStatus.DRAFT &&
        catalog.status !== BazaarCatalogStatus.PUBLISHED)
    ) {
      throw new Error(`Refusing catalog ownership collision ${catalog.id}.`);
    }
  }

  for (const product of products) {
    const expected = records.find(
      (record) => record.product.id === product.id || record.product.sku === product.sku,
    );
    if (
      !expected ||
      product.id !== expected.product.id ||
      product.organizationId !== expected.organizationId ||
      product.sku !== expected.product.sku ||
      product.name !== expected.product.name
    ) {
      throw new Error(`Refusing catalog-product ownership collision ${product.id}.`);
    }
  }

  for (const assignment of assignments) {
    const expected = records.find(
      (record) =>
        record.product.storeProductId === assignment.id ||
        (record.storeId === assignment.storeId && record.product.id === assignment.productId),
    );
    if (
      !expected ||
      assignment.id !== expected.product.storeProductId ||
      assignment.organizationId !== expected.organizationId ||
      assignment.storeId !== expected.storeId ||
      assignment.productId !== expected.product.id
    ) {
      throw new Error(`Refusing catalog-assignment ownership collision ${assignment.id}.`);
    }
  }

  for (const hiddenProduct of hiddenProducts) {
    const expected = records.find(
      (record) =>
        record.storeId === hiddenProduct.storeId && record.product.id === hiddenProduct.productId,
    );
    if (!expected || hiddenProduct.organizationId !== expected.organizationId) {
      throw new Error(`Refusing catalog-visibility ownership collision ${hiddenProduct.id}.`);
    }
  }
};

export const seedAuthenticatedCatalogPublicationFixtures = async (prisma: PrismaClient) => {
  await assertCatalogPublicationSeedOwnership(prisma);
  const fixture = authenticatedCatalogPublicationFixture;

  await prisma.$transaction(async (tx) => {
    for (const record of authenticatedCatalogPublicationRecords) {
      const baseUnitId =
        record === fixture.primary ? fixture.baseUnitId : fixture.foreignBaseUnitId;
      await tx.product.upsert({
        where: { id: record.product.id },
        create: {
          id: record.product.id,
          organizationId: record.organizationId,
          sku: record.product.sku,
          name: record.product.name,
          category: record.product.category,
          categories: [record.product.category],
          unit: "pc",
          baseUnitId,
          basePriceKgs: record.product.basePriceKgs,
        },
        update: {
          organizationId: record.organizationId,
          sku: record.product.sku,
          name: record.product.name,
          category: record.product.category,
          categories: [record.product.category],
          unit: "pc",
          baseUnitId,
          basePriceKgs: record.product.basePriceKgs,
          description: null,
          photoUrl: null,
          isDeleted: false,
          isBundle: false,
        },
      });
      await tx.storeProduct.upsert({
        where: { id: record.product.storeProductId },
        create: {
          id: record.product.storeProductId,
          organizationId: record.organizationId,
          storeId: record.storeId,
          productId: record.product.id,
          isActive: true,
          assignedById: record.updatedById,
        },
        update: {
          organizationId: record.organizationId,
          storeId: record.storeId,
          productId: record.product.id,
          isActive: true,
          assignedById: record.updatedById,
        },
      });
      await tx.bazaarCatalogHiddenProduct.deleteMany({
        where: { storeId: record.storeId, productId: record.product.id },
      });
      await tx.bazaarCatalog.upsert({
        where: { id: record.id },
        create: {
          id: record.id,
          organizationId: record.organizationId,
          storeId: record.storeId,
          slug: record.slug,
          publicUrlPath: record.publicUrlPath,
          title: record.title,
          status: BazaarCatalogStatus.DRAFT,
          accentColor: record.accentColor,
          fontFamily: record.fontFamily,
          headerStyle: record.headerStyle,
          publishedAt: null,
          logoImageId: null,
          updatedById: record.updatedById,
        },
        update: {
          organizationId: record.organizationId,
          storeId: record.storeId,
          slug: record.slug,
          publicUrlPath: record.publicUrlPath,
          title: record.title,
          status: BazaarCatalogStatus.DRAFT,
          accentColor: record.accentColor,
          fontFamily: record.fontFamily,
          headerStyle: record.headerStyle,
          publishedAt: null,
          logoImageId: null,
          updatedById: record.updatedById,
        },
      });
    }
  });
};
