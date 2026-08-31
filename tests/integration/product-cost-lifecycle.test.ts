import { StockMovementType } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import {
  adjustStock,
  bulkSetOnHand,
  postStockReceiving,
  postStockWriteOff,
  transferStock,
} from "@/server/services/inventory";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const costKey = (organizationId: string, productId: string) => ({
  organizationId_productId_variantKey: {
    organizationId,
    productId,
    variantKey: "BASE",
  },
});

describeDb("product cost inventory lifecycle", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("preserves a precise frozen WAC through adjustments, transfer, depletion, and restart", async () => {
    const {
      org,
      store: sourceStore,
      product,
      adminUser,
    } = await seedBase({
      plan: "BUSINESS",
    });
    const destinationStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Cost Lifecycle Destination",
        code: "COST-DST",
        allowNegativeStock: false,
      },
    });

    const assertCostState = async ({
      quantity,
      valueKgs,
      averageKgs,
      physicalOnHand = quantity,
    }: {
      quantity: number;
      valueKgs: number;
      averageKgs: number;
      physicalOnHand?: number;
    }) => {
      const [cost, snapshots] = await Promise.all([
        prisma.productCost.findUniqueOrThrow({
          where: costKey(org.id, product.id),
        }),
        prisma.inventorySnapshot.aggregate({
          where: {
            productId: product.id,
            store: { organizationId: org.id },
          },
          _sum: { onHand: true },
        }),
      ]);

      expect({
        costBasisQty: cost.costBasisQty,
        costBasisValueKgs: Number(cost.costBasisValueKgs),
        avgCostKgs: Number(cost.avgCostKgs),
        physicalOnHand: snapshots._sum.onHand ?? 0,
      }).toEqual({
        costBasisQty: quantity,
        costBasisValueKgs: valueKgs,
        avgCostKgs: averageKgs,
        physicalOnHand,
      });
    };

    await postStockReceiving({
      storeId: sourceStore.id,
      referenceNumber: "WAC-RECEIPT-1",
      lines: [{ productId: product.id, quantity: 3, unitCost: 10.01 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "cost-lifecycle-receive-1",
      idempotencyKey: "cost-lifecycle-receive-1",
    });
    await postStockReceiving({
      storeId: sourceStore.id,
      referenceNumber: "WAC-RECEIPT-2",
      lines: [{ productId: product.id, quantity: 2, unitCost: 10.03 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "cost-lifecycle-receive-2",
      idempotencyKey: "cost-lifecycle-receive-2",
    });

    // (3 * 10.01 + 2 * 10.03) / 5 = 10.018. The two-decimal
    // avgCostKgs is a projection; subsequent movements use the precise basis.
    await assertCostState({ quantity: 5, valueKgs: 50.09, averageKgs: 10.02 });

    await postStockWriteOff({
      storeId: sourceStore.id,
      reason: "Порча",
      comment: "Frozen WAC write-off",
      lines: [{ productId: product.id, qty: 2 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "cost-lifecycle-write-off",
      idempotencyKey: "cost-lifecycle-write-off",
    });
    await assertCostState({ quantity: 3, valueKgs: 30.054, averageKgs: 10.02 });

    await adjustStock({
      storeId: sourceStore.id,
      productId: product.id,
      qtyDelta: 2,
      reason: "Cost lifecycle positive adjustment",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "cost-lifecycle-adjust-positive",
      idempotencyKey: "cost-lifecycle-adjust-positive",
    });
    await assertCostState({ quantity: 5, valueKgs: 50.09, averageKgs: 10.02 });

    await adjustStock({
      storeId: sourceStore.id,
      productId: product.id,
      qtyDelta: -1,
      reason: "Cost lifecycle negative adjustment",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "cost-lifecycle-adjust-negative",
      idempotencyKey: "cost-lifecycle-adjust-negative",
    });
    await assertCostState({ quantity: 4, valueKgs: 40.072, averageKgs: 10.02 });

    const sourceSnapshot = await prisma.inventorySnapshot.findUniqueOrThrow({
      where: {
        storeId_productId_variantKey: {
          storeId: sourceStore.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    await bulkSetOnHand({
      storeId: sourceStore.id,
      snapshotIds: [sourceSnapshot.id],
      targetOnHand: 6,
      reason: "Cost lifecycle full recount",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "cost-lifecycle-recount",
      idempotencyKey: "cost-lifecycle-recount",
    });
    await assertCostState({ quantity: 6, valueKgs: 60.108, averageKgs: 10.02 });

    const beforeTransferCost = await prisma.productCost.findUniqueOrThrow({
      where: costKey(org.id, product.id),
    });
    await transferStock({
      fromStoreId: sourceStore.id,
      toStoreId: destinationStore.id,
      lines: [{ productId: product.id, qty: 2 }],
      note: "Cost lifecycle organization transfer",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "cost-lifecycle-transfer",
      idempotencyKey: "cost-lifecycle-transfer",
    });
    const afterTransferCost = await prisma.productCost.findUniqueOrThrow({
      where: costKey(org.id, product.id),
    });
    expect({
      beforeQuantity: beforeTransferCost.costBasisQty,
      afterQuantity: afterTransferCost.costBasisQty,
      beforeValueKgs: Number(beforeTransferCost.costBasisValueKgs),
      afterValueKgs: Number(afterTransferCost.costBasisValueKgs),
      beforeAverageKgs: Number(beforeTransferCost.avgCostKgs),
      afterAverageKgs: Number(afterTransferCost.avgCostKgs),
    }).toEqual({
      beforeQuantity: 6,
      afterQuantity: 6,
      beforeValueKgs: 60.108,
      afterValueKgs: 60.108,
      beforeAverageKgs: 10.02,
      afterAverageKgs: 10.02,
    });
    await assertCostState({ quantity: 6, valueKgs: 60.108, averageKgs: 10.02 });

    const movementsBeforeDepletion = await prisma.stockMovement.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: "asc" },
      select: {
        storeId: true,
        type: true,
        qtyDelta: true,
        unitCostKgs: true,
        inventoryValueDeltaKgs: true,
        note: true,
      },
    });
    const movementValue = (type: StockMovementType, note?: string) => {
      const movement = movementsBeforeDepletion.find(
        (candidate) => candidate.type === type && (!note || candidate.note === note),
      );
      expect(movement).toBeDefined();
      return movement;
    };
    const firstReceipt = movementsBeforeDepletion.find(
      (movement) => movement.type === StockMovementType.RECEIVE && movement.qtyDelta === 3,
    );
    const secondReceipt = movementsBeforeDepletion.find(
      (movement) => movement.type === StockMovementType.RECEIVE && movement.qtyDelta === 2,
    );
    const writeOff = movementValue(StockMovementType.WRITE_OFF);
    const positiveAdjustment = movementValue(
      StockMovementType.ADJUSTMENT,
      "Cost lifecycle positive adjustment",
    );
    const negativeAdjustment = movementValue(
      StockMovementType.ADJUSTMENT,
      "Cost lifecycle negative adjustment",
    );
    const recount = movementValue(StockMovementType.ADJUSTMENT, "Cost lifecycle full recount");
    const transferOut = movementValue(
      StockMovementType.TRANSFER_OUT,
      "Cost lifecycle organization transfer",
    );
    const transferIn = movementValue(
      StockMovementType.TRANSFER_IN,
      "Cost lifecycle organization transfer",
    );

    expect([
      [firstReceipt?.qtyDelta, Number(firstReceipt?.inventoryValueDeltaKgs)],
      [secondReceipt?.qtyDelta, Number(secondReceipt?.inventoryValueDeltaKgs)],
      [writeOff?.qtyDelta, Number(writeOff?.inventoryValueDeltaKgs)],
      [positiveAdjustment?.qtyDelta, Number(positiveAdjustment?.inventoryValueDeltaKgs)],
      [negativeAdjustment?.qtyDelta, Number(negativeAdjustment?.inventoryValueDeltaKgs)],
      [recount?.qtyDelta, Number(recount?.inventoryValueDeltaKgs)],
      [transferOut?.qtyDelta, Number(transferOut?.inventoryValueDeltaKgs)],
      [transferIn?.qtyDelta, Number(transferIn?.inventoryValueDeltaKgs)],
    ]).toEqual([
      [3, 30.03],
      [2, 20.06],
      [-2, -20.036],
      [2, 20.036],
      [-1, -10.018],
      [2, 20.036],
      [-2, -20.036],
      [2, 20.036],
    ]);
    expect({
      outStore: transferOut?.storeId,
      inStore: transferIn?.storeId,
      outUnitCost: Number(transferOut?.unitCostKgs),
      inUnitCost: Number(transferIn?.unitCostKgs),
    }).toEqual({
      outStore: sourceStore.id,
      inStore: destinationStore.id,
      outUnitCost: 10.02,
      inUnitCost: 10.02,
    });

    await postStockWriteOff({
      storeId: sourceStore.id,
      reason: "Порча",
      comment: "Deplete source",
      lines: [{ productId: product.id, qty: 4 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "cost-lifecycle-deplete-source",
      idempotencyKey: "cost-lifecycle-deplete-source",
    });
    await postStockWriteOff({
      storeId: destinationStore.id,
      reason: "Порча",
      comment: "Deplete destination",
      lines: [{ productId: product.id, qty: 2 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "cost-lifecycle-deplete-destination",
      idempotencyKey: "cost-lifecycle-deplete-destination",
    });
    await assertCostState({ quantity: 0, valueKgs: 0, averageKgs: 0 });

    const depletionMovements = await prisma.stockMovement.findMany({
      where: {
        productId: product.id,
        type: StockMovementType.WRITE_OFF,
        note: { contains: "Deplete" },
      },
      orderBy: { qtyDelta: "asc" },
      select: { qtyDelta: true, inventoryValueDeltaKgs: true },
    });
    expect(
      depletionMovements.map((movement) => [
        movement.qtyDelta,
        Number(movement.inventoryValueDeltaKgs),
      ]),
    ).toEqual([
      [-4, -40.072],
      [-2, -20.036],
    ]);

    await postStockReceiving({
      storeId: destinationStore.id,
      referenceNumber: "WAC-RESTART",
      lines: [{ productId: product.id, quantity: 4, unitCost: 7.25 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "cost-lifecycle-restart",
      idempotencyKey: "cost-lifecycle-restart",
    });
    await assertCostState({ quantity: 4, valueKgs: 29, averageKgs: 7.25 });

    const restartMovement = await prisma.stockMovement.findFirstOrThrow({
      where: {
        productId: product.id,
        type: StockMovementType.RECEIVE,
        referenceType: "STOCK_RECEIVING",
        note: { contains: "WAC-RESTART" },
      },
      select: {
        qtyDelta: true,
        unitCostKgs: true,
        inventoryValueDeltaKgs: true,
      },
    });
    expect({
      qtyDelta: restartMovement.qtyDelta,
      unitCostKgs: Number(restartMovement.unitCostKgs),
      inventoryValueDeltaKgs: Number(restartMovement.inventoryValueDeltaKgs),
    }).toEqual({
      qtyDelta: 4,
      unitCostKgs: 7.25,
      inventoryValueDeltaKgs: 29,
    });
  });
});
