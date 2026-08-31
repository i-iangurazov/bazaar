import { beforeEach, describe, expect, it } from "vitest";

import { parseCsvTextRows } from "@/lib/fileExport";
import { prisma } from "@/server/db/prisma";
import { createProduct } from "@/server/services/products";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const costKey = (organizationId: string, productId: string) => ({
  organizationId_productId_variantKey: {
    organizationId,
    productId,
    variantKey: "BASE",
  },
});

const createInitiallyStockedProductAndReceive = async ({
  sku,
  initialQuantity,
  initialUnitCostKgs,
  receivedQuantity,
  receivedUnitCostKgs,
}: {
  sku: string;
  initialQuantity: number;
  initialUnitCostKgs: number;
  receivedQuantity: number;
  receivedUnitCostKgs: number;
}) => {
  const { org, store, adminUser, baseUnit } = await seedBase({ plan: "BUSINESS" });
  const caller = createTestCaller({
    id: adminUser.id,
    email: adminUser.email,
    role: adminUser.role,
    organizationId: org.id,
    isOrgOwner: true,
  });
  const product = await createProduct({
    organizationId: org.id,
    actorId: adminUser.id,
    requestId: `${sku}-create`,
    idempotencyKey: `${sku}-create`,
    sku,
    name: `${sku} weighted-cost regression product`,
    baseUnitId: baseUnit.id,
    storeId: store.id,
    initialOnHand: initialQuantity,
    avgCostKgs: initialUnitCostKgs,
  });

  const receiving = await caller.inventory.postStockReceiving({
    storeId: store.id,
    referenceNumber: `${sku}-receipt`,
    lines: [
      {
        productId: product.id,
        quantity: receivedQuantity,
        unitCost: receivedUnitCostKgs,
      },
    ],
    idempotencyKey: `${sku}-receive`,
  });

  const [
    cost,
    snapshot,
    valuedMovements,
    productList,
    productDetail,
    productPricing,
    productStorePricing,
    productCsv,
  ] = await Promise.all([
    prisma.productCost.findUniqueOrThrow({
      where: costKey(org.id, product.id),
    }),
    prisma.inventorySnapshot.findUniqueOrThrow({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    }),
    prisma.stockMovement.aggregate({
      where: { storeId: store.id, productId: product.id, variantId: null },
      _sum: { qtyDelta: true, lineTotalKgs: true },
    }),
    caller.products.list({
      storeId: store.id,
      search: sku,
      page: 1,
      pageSize: 10,
    }),
    caller.products.getById({ productId: product.id }),
    caller.products.pricing({ productId: product.id, storeId: store.id }),
    caller.products.storePricing({ productId: product.id }),
    caller.products.exportCsv({ storeId: store.id }),
  ]);

  const productRows = parseCsvTextRows(productCsv);
  const productHeader = productRows[0] ?? [];
  const productExportRow = productRows.find((row) => row[0] === sku) ?? [];
  const productExport = new Map(
    productHeader.map((header, index) => [header, productExportRow[index]]),
  );
  if (!productDetail) {
    throw new Error("weighted-cost product detail was not found");
  }

  return {
    costBasisQty: cost.costBasisQty,
    avgCostKgs: Number(cost.avgCostKgs),
    onHand: snapshot.onHand,
    movementQuantity: valuedMovements._sum.qtyDelta,
    totalValueKgs: Number(valuedMovements._sum.lineTotalKgs),
    receivingOnHand: receiving.lines[0]?.onHand,
    productListItem: productList.items.find((item) => item.id === product.id),
    productDetail: {
      avgCostKgs: productDetail.avgCostKgs,
      purchasePriceKgs: productDetail.purchasePriceKgs,
    },
    productPricingAvgCostKgs: productPricing.avgCostKgs,
    productStorePricingAvgCostKgs: productStorePricing.avgCostKgs,
    productExport: {
      avgCostKgs: productExport.get("Себестоимость"),
      purchasePriceKgs: productExport.get("Цена закупки"),
    },
  };
};

describeDb("BZR-PRD-001 initial-stock weighted average cost", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("weights the exact master case: 5 @ KGS 80.20 plus 10 @ KGS 81.25", async () => {
    const state = await createInitiallyStockedProductAndReceive({
      sku: "QA-BAZAAR-COST-MASTER",
      initialQuantity: 5,
      initialUnitCostKgs: 80.2,
      receivedQuantity: 10,
      receivedUnitCostKgs: 81.25,
    });

    expect(state).toMatchObject({
      costBasisQty: 15,
      avgCostKgs: 80.9,
      onHand: 15,
      movementQuantity: 15,
      totalValueKgs: 1213.5,
      receivingOnHand: 15,
      productListItem: {
        onHandQty: 15,
        avgCostKgs: 80.9,
        purchasePriceKgs: 80.9,
      },
      productDetail: { avgCostKgs: 80.9, purchasePriceKgs: 80.9 },
      productPricingAvgCostKgs: 80.9,
      productStorePricingAvgCostKgs: 80.9,
      productExport: { avgCostKgs: "80.9", purchasePriceKgs: "80.9" },
    });
  });

  it("rounds the audit case only after weighting: 5 @ KGS 80.25 plus 2 @ KGS 81.00", async () => {
    const state = await createInitiallyStockedProductAndReceive({
      sku: "QA-BAZAAR-COST-AUDIT",
      initialQuantity: 5,
      initialUnitCostKgs: 80.25,
      receivedQuantity: 2,
      receivedUnitCostKgs: 81,
    });

    expect(state).toMatchObject({
      costBasisQty: 7,
      avgCostKgs: 80.46,
      onHand: 7,
      movementQuantity: 7,
      totalValueKgs: 563.25,
      receivingOnHand: 7,
      productListItem: {
        onHandQty: 7,
        avgCostKgs: 80.46,
        purchasePriceKgs: 80.46,
      },
      productDetail: { avgCostKgs: 80.46, purchasePriceKgs: 80.46 },
      productPricingAvgCostKgs: 80.46,
      productStorePricingAvgCostKgs: 80.46,
      productExport: { avgCostKgs: "80.46", purchasePriceKgs: "80.46" },
    });
  });
});
