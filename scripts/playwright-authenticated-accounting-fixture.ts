import { StockMovementType, type PrismaClient } from "@prisma/client";

import { buildWriteOffMovementNote } from "../src/lib/inventory/writeOff";
import { authenticatedAccountingFixture } from "../tests/e2e/authenticated/accounting-contract";

const qaPrefix = "QA-BAZAAR";

type AccountingMovementSeed = {
  id: string;
  productId: string;
  type: StockMovementType;
  quantityDelta: number;
  unitCostKgs: number;
  lineTotalKgs: number;
  inventoryValueDeltaKgs: number;
  referenceType: string;
  referenceId: string;
  note: string;
  createdAt: string;
};

const accountingProducts = [
  ...authenticatedAccountingFixture.weightedCostCases.map((fixture) => ({
    id: fixture.productId,
    name: fixture.productName,
    sku: fixture.sku,
    onHand: fixture.expectedQuantity,
    avgCostKgs: fixture.expectedAverageCostKgs,
    costBasisQty: fixture.expectedQuantity,
    costBasisValueKgs: fixture.expectedValueKgs,
    lastReceiptAt: fixture.receiptAt,
  })),
  {
    id: authenticatedAccountingFixture.shrinkage.productId,
    name: authenticatedAccountingFixture.shrinkage.productName,
    sku: authenticatedAccountingFixture.shrinkage.sku,
    onHand: authenticatedAccountingFixture.shrinkage.remainingQuantity,
    avgCostKgs: authenticatedAccountingFixture.shrinkage.unitCostKgs,
    costBasisQty: authenticatedAccountingFixture.shrinkage.remainingQuantity,
    costBasisValueKgs: authenticatedAccountingFixture.shrinkage.remainingValueKgs,
    lastReceiptAt: authenticatedAccountingFixture.shrinkage.initialAt,
  },
] as const;

const accountingMovements: AccountingMovementSeed[] = [
  ...authenticatedAccountingFixture.weightedCostCases.flatMap((fixture) => [
    {
      id: fixture.initialMovementId,
      productId: fixture.productId,
      type: StockMovementType.ADJUSTMENT,
      quantityDelta: fixture.initialQuantity,
      unitCostKgs: fixture.initialUnitCostKgs,
      lineTotalKgs: fixture.initialValueKgs,
      inventoryValueDeltaKgs: fixture.initialValueKgs,
      referenceType: "Product",
      referenceId: fixture.initialReferenceId,
      note: `${qaPrefix} initial-stock cost fixture`,
      createdAt: fixture.initialAt,
    },
    {
      id: fixture.receiptMovementId,
      productId: fixture.productId,
      type: StockMovementType.RECEIVE,
      quantityDelta: fixture.receiptQuantity,
      unitCostKgs: fixture.receiptUnitCostKgs,
      lineTotalKgs: fixture.receiptValueKgs,
      inventoryValueDeltaKgs: fixture.receiptValueKgs,
      referenceType: "STOCK_RECEIVING",
      referenceId: fixture.receiptReferenceId,
      note: `${qaPrefix} receipt cost fixture`,
      createdAt: fixture.receiptAt,
    },
  ]),
  {
    id: authenticatedAccountingFixture.shrinkage.initialMovementId,
    productId: authenticatedAccountingFixture.shrinkage.productId,
    type: StockMovementType.ADJUSTMENT,
    quantityDelta: authenticatedAccountingFixture.shrinkage.initialQuantity,
    unitCostKgs: authenticatedAccountingFixture.shrinkage.unitCostKgs,
    lineTotalKgs: authenticatedAccountingFixture.shrinkage.initialValueKgs,
    inventoryValueDeltaKgs: authenticatedAccountingFixture.shrinkage.initialValueKgs,
    referenceType: "Product",
    referenceId: authenticatedAccountingFixture.shrinkage.initialReferenceId,
    note: `${qaPrefix} shrinkage opening stock fixture`,
    createdAt: authenticatedAccountingFixture.shrinkage.initialAt,
  },
  {
    id: authenticatedAccountingFixture.shrinkage.movementId,
    productId: authenticatedAccountingFixture.shrinkage.productId,
    type: StockMovementType.WRITE_OFF,
    quantityDelta: -authenticatedAccountingFixture.shrinkage.quantity,
    unitCostKgs: authenticatedAccountingFixture.shrinkage.unitCostKgs,
    lineTotalKgs: authenticatedAccountingFixture.shrinkage.valueKgs,
    inventoryValueDeltaKgs: -authenticatedAccountingFixture.shrinkage.valueKgs,
    referenceType: "WRITE_OFF",
    referenceId: authenticatedAccountingFixture.shrinkage.referenceId,
    note: buildWriteOffMovementNote({
      reason: authenticatedAccountingFixture.shrinkage.reason,
      comment: authenticatedAccountingFixture.shrinkage.comment,
    }),
    createdAt: authenticatedAccountingFixture.shrinkage.occurredAt,
  },
];

const assertAccountingSeedOwnership = async (prisma: PrismaClient) => {
  const productIds = accountingProducts.map((product) => product.id);
  const productSkus = accountingProducts.map((product) => product.sku);
  const movementIds = accountingMovements.map((movement) => movement.id);
  const [organization, stores, unit, admin, products, movements, assignments, snapshots, costs] =
    await Promise.all([
      prisma.organization.findUnique({
        where: { id: authenticatedAccountingFixture.organizationId },
        select: { id: true, name: true },
      }),
      prisma.store.findMany({
        where: {
          id: {
            in: [
              authenticatedAccountingFixture.storeId,
              authenticatedAccountingFixture.otherStoreId,
            ],
          },
        },
        select: { id: true, organizationId: true, name: true },
      }),
      prisma.unit.findUnique({
        where: { id: authenticatedAccountingFixture.baseUnitId },
        select: { id: true, organizationId: true },
      }),
      prisma.user.findUnique({
        where: { id: authenticatedAccountingFixture.adminUserId },
        select: { id: true, organizationId: true, name: true },
      }),
      prisma.product.findMany({
        where: { OR: [{ id: { in: productIds } }, { sku: { in: productSkus } }] },
        select: { id: true, organizationId: true, name: true, sku: true },
      }),
      prisma.stockMovement.findMany({
        where: { id: { in: movementIds } },
        select: {
          id: true,
          storeId: true,
          productId: true,
          type: true,
          referenceType: true,
          referenceId: true,
        },
      }),
      prisma.storeProduct.findMany({
        where: {
          storeId: authenticatedAccountingFixture.storeId,
          productId: { in: productIds },
        },
        select: { id: true, organizationId: true, storeId: true, productId: true },
      }),
      prisma.inventorySnapshot.findMany({
        where: {
          storeId: authenticatedAccountingFixture.storeId,
          productId: { in: productIds },
          variantKey: authenticatedAccountingFixture.variantKey,
        },
        select: { id: true, storeId: true, productId: true, variantId: true, variantKey: true },
      }),
      prisma.productCost.findMany({
        where: {
          organizationId: authenticatedAccountingFixture.organizationId,
          productId: { in: productIds },
          variantKey: authenticatedAccountingFixture.variantKey,
        },
        select: {
          id: true,
          organizationId: true,
          productId: true,
          variantId: true,
          variantKey: true,
        },
      }),
    ]);

  if (!organization?.name.startsWith(qaPrefix)) {
    throw new Error("Accounting fixtures require the guarded QA organization.");
  }
  if (
    stores.length !== 2 ||
    stores.some(
      (store) =>
        store.organizationId !== authenticatedAccountingFixture.organizationId ||
        !store.name.startsWith(qaPrefix),
    )
  ) {
    throw new Error("Accounting fixtures require both guarded QA stores.");
  }
  if (unit?.organizationId !== authenticatedAccountingFixture.organizationId) {
    throw new Error("Accounting fixtures require the guarded QA base unit.");
  }
  if (
    admin?.organizationId !== authenticatedAccountingFixture.organizationId ||
    !admin.name.startsWith(qaPrefix)
  ) {
    throw new Error("Accounting fixtures require the guarded QA admin user.");
  }

  const expectedProductById = new Map(accountingProducts.map((product) => [product.id, product]));
  for (const product of products) {
    const expected = expectedProductById.get(product.id);
    if (!expected || product.sku !== expected.sku) {
      throw new Error(`Refusing to reuse accounting SKU ${product.sku} on product ${product.id}.`);
    }
    if (
      product.organizationId !== authenticatedAccountingFixture.organizationId ||
      !product.name.startsWith(qaPrefix)
    ) {
      throw new Error(`Refusing to overwrite non-QA accounting product ${product.id}.`);
    }
  }

  const expectedMovementById = new Map(
    accountingMovements.map((movement) => [movement.id, movement]),
  );
  for (const movement of movements) {
    const expected = expectedMovementById.get(movement.id);
    if (
      !expected ||
      movement.storeId !== authenticatedAccountingFixture.storeId ||
      movement.productId !== expected.productId ||
      movement.type !== expected.type ||
      movement.referenceType !== expected.referenceType ||
      movement.referenceId !== expected.referenceId
    ) {
      throw new Error(`Refusing to overwrite non-QA accounting movement ${movement.id}.`);
    }
  }

  for (const assignment of assignments) {
    if (
      assignment.organizationId !== authenticatedAccountingFixture.organizationId ||
      assignment.storeId !== authenticatedAccountingFixture.storeId ||
      !expectedProductById.has(assignment.productId)
    ) {
      throw new Error(`Refusing to overwrite non-QA store assignment ${assignment.id}.`);
    }
  }
  for (const snapshot of snapshots) {
    if (
      snapshot.storeId !== authenticatedAccountingFixture.storeId ||
      !expectedProductById.has(snapshot.productId) ||
      snapshot.variantId !== null ||
      snapshot.variantKey !== authenticatedAccountingFixture.variantKey
    ) {
      throw new Error(`Refusing to overwrite non-QA inventory snapshot ${snapshot.id}.`);
    }
  }
  for (const cost of costs) {
    if (
      cost.organizationId !== authenticatedAccountingFixture.organizationId ||
      !expectedProductById.has(cost.productId) ||
      cost.variantId !== null ||
      cost.variantKey !== authenticatedAccountingFixture.variantKey
    ) {
      throw new Error(`Refusing to overwrite non-QA product cost ${cost.id}.`);
    }
  }
};

export const seedAuthenticatedAccountingFixtures = async (prisma: PrismaClient) => {
  await assertAccountingSeedOwnership(prisma);
  await prisma.$transaction(
    async (tx) => {
      for (const product of accountingProducts) {
        await tx.product.upsert({
          where: { id: product.id },
          create: {
            id: product.id,
            organizationId: authenticatedAccountingFixture.organizationId,
            sku: product.sku,
            name: product.name,
            category: "QA-BAZAAR Accounting",
            categories: ["QA-BAZAAR Accounting"],
            unit: "pcs",
            baseUnitId: authenticatedAccountingFixture.baseUnitId,
            basePriceKgs: 150,
            description: "QA-BAZAAR deterministic accounting acceptance fixture",
          },
          update: {
            organizationId: authenticatedAccountingFixture.organizationId,
            sku: product.sku,
            name: product.name,
            category: "QA-BAZAAR Accounting",
            categories: ["QA-BAZAAR Accounting"],
            unit: "pcs",
            baseUnitId: authenticatedAccountingFixture.baseUnitId,
            basePriceKgs: 150,
            description: "QA-BAZAAR deterministic accounting acceptance fixture",
            isDeleted: false,
            isBundle: false,
          },
        });
        await tx.storeProduct.upsert({
          where: {
            storeId_productId: {
              storeId: authenticatedAccountingFixture.storeId,
              productId: product.id,
            },
          },
          create: {
            organizationId: authenticatedAccountingFixture.organizationId,
            storeId: authenticatedAccountingFixture.storeId,
            productId: product.id,
            assignedById: authenticatedAccountingFixture.adminUserId,
          },
          update: {
            organizationId: authenticatedAccountingFixture.organizationId,
            isActive: true,
            assignedById: authenticatedAccountingFixture.adminUserId,
          },
        });
        await tx.inventorySnapshot.upsert({
          where: {
            storeId_productId_variantKey: {
              storeId: authenticatedAccountingFixture.storeId,
              productId: product.id,
              variantKey: authenticatedAccountingFixture.variantKey,
            },
          },
          create: {
            storeId: authenticatedAccountingFixture.storeId,
            productId: product.id,
            variantId: null,
            variantKey: authenticatedAccountingFixture.variantKey,
            onHand: product.onHand,
            onOrder: 0,
          },
          update: {
            variantId: null,
            onHand: product.onHand,
            onOrder: 0,
            allowNegativeStock: false,
          },
        });
        await tx.productCost.upsert({
          where: {
            organizationId_productId_variantKey: {
              organizationId: authenticatedAccountingFixture.organizationId,
              productId: product.id,
              variantKey: authenticatedAccountingFixture.variantKey,
            },
          },
          create: {
            organizationId: authenticatedAccountingFixture.organizationId,
            productId: product.id,
            variantId: null,
            variantKey: authenticatedAccountingFixture.variantKey,
            avgCostKgs: product.avgCostKgs,
            costBasisQty: product.costBasisQty,
            costBasisValueKgs: product.costBasisValueKgs,
            lastReceiptAt: new Date(product.lastReceiptAt),
          },
          update: {
            variantId: null,
            avgCostKgs: product.avgCostKgs,
            costBasisQty: product.costBasisQty,
            costBasisValueKgs: product.costBasisValueKgs,
            lastReceiptAt: new Date(product.lastReceiptAt),
          },
        });
      }

      for (const movement of accountingMovements) {
        const values = {
          storeId: authenticatedAccountingFixture.storeId,
          productId: movement.productId,
          variantId: null,
          stockLotId: null,
          type: movement.type,
          qtyDelta: movement.quantityDelta,
          linePosition: 1,
          unitCostKgs: movement.unitCostKgs,
          lineTotalKgs: movement.lineTotalKgs,
          inventoryValueDeltaKgs: movement.inventoryValueDeltaKgs,
          referenceType: movement.referenceType,
          referenceId: movement.referenceId,
          note: movement.note,
          createdAt: new Date(movement.createdAt),
          createdById: authenticatedAccountingFixture.adminUserId,
        };
        await tx.stockMovement.upsert({
          where: { id: movement.id },
          create: { id: movement.id, ...values },
          update: values,
        });
      }
    },
    { timeout: 30_000 },
  );
};
