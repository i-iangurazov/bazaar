import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createProduct } from "@/server/services/products";
import { adjustStock, postStockReceiving } from "@/server/services/inventory";
import {
  addOrUpdateLineByScan,
  applyStockCount,
  createStockCount,
} from "@/server/services/stockCounts";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("stock counts", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("applies counts idempotently", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase();

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-stock-count-product",
      sku: "SC-100",
      name: "Counted Product",
      baseUnitId: baseUnit.id,
      barcodes: ["BC-COUNT-1"],
    });

    await adjustStock({
      storeId: store.id,
      productId: product.id,
      qtyDelta: 5,
      unitCostKgs: 10,
      reason: "Seed stock",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-stock-count-seed",
      idempotencyKey: "idem-stock-count-seed",
    });

    const count = await createStockCount({
      storeId: store.id,
      notes: "Cycle count",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-stock-count-create",
    });

    const line = await addOrUpdateLineByScan({
      stockCountId: count.id,
      storeId: store.id,
      barcodeOrQuery: "BC-COUNT-1",
      mode: "set",
      countedQty: 7,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-stock-count-line",
    });

    expect(line.countedQty).toBe(7);

    await applyStockCount({
      stockCountId: count.id,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-stock-count-apply-1",
      idempotencyKey: "idem-stock-count-apply",
    });

    await applyStockCount({
      stockCountId: count.id,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-stock-count-apply-2",
      idempotencyKey: "idem-stock-count-apply",
    });

    const movements = await prisma.stockMovement.findMany({
      where: {
        storeId: store.id,
        productId: product.id,
        referenceType: "STOCK_COUNT",
        referenceId: count.id,
      },
    });

    expect(movements).toHaveLength(1);

    const snapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });

    expect(snapshot?.onHand).toBe(7);
  });

  it("values positive and negative count corrections at the precise current WAC", async () => {
    const { org, store, product, adminUser } = await seedBase();

    await postStockReceiving({
      storeId: store.id,
      referenceNumber: "SC-WAC-1",
      lines: [{ productId: product.id, quantity: 3, unitCost: 10.01 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-stock-count-wac-receive-1",
      idempotencyKey: "idem-stock-count-wac-receive-1",
    });
    await postStockReceiving({
      storeId: store.id,
      referenceNumber: "SC-WAC-2",
      lines: [{ productId: product.id, quantity: 2, unitCost: 10.03 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-stock-count-wac-receive-2",
      idempotencyKey: "idem-stock-count-wac-receive-2",
    });

    const applyCount = async (countedQty: number, suffix: string) => {
      const count = await createStockCount({
        storeId: store.id,
        notes: `WAC correction ${suffix}`,
        actorId: adminUser.id,
        organizationId: org.id,
        requestId: `req-stock-count-wac-create-${suffix}`,
      });
      await addOrUpdateLineByScan({
        stockCountId: count.id,
        storeId: store.id,
        barcodeOrQuery: product.sku ?? "TEST-1",
        mode: "set",
        countedQty,
        actorId: adminUser.id,
        organizationId: org.id,
        requestId: `req-stock-count-wac-line-${suffix}`,
      });
      await applyStockCount({
        stockCountId: count.id,
        actorId: adminUser.id,
        organizationId: org.id,
        requestId: `req-stock-count-wac-apply-${suffix}`,
        idempotencyKey: `idem-stock-count-wac-apply-${suffix}`,
      });
      return count;
    };

    const increase = await applyCount(7, "increase");
    const afterIncrease = await prisma.productCost.findUniqueOrThrow({
      where: {
        organizationId_productId_variantKey: {
          organizationId: org.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    expect({
      quantity: afterIncrease.costBasisQty,
      valueKgs: Number(afterIncrease.costBasisValueKgs),
      averageKgs: Number(afterIncrease.avgCostKgs),
    }).toEqual({ quantity: 7, valueKgs: 70.126, averageKgs: 10.02 });

    const decrease = await applyCount(4, "decrease");
    const [afterDecrease, movements, snapshot] = await Promise.all([
      prisma.productCost.findUniqueOrThrow({
        where: {
          organizationId_productId_variantKey: {
            organizationId: org.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
      prisma.stockMovement.findMany({
        where: {
          productId: product.id,
          referenceType: "STOCK_COUNT",
          referenceId: { in: [increase.id, decrease.id] },
        },
        orderBy: { createdAt: "asc" },
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
    ]);

    expect({
      quantity: afterDecrease.costBasisQty,
      valueKgs: Number(afterDecrease.costBasisValueKgs),
      averageKgs: Number(afterDecrease.avgCostKgs),
      onHand: snapshot.onHand,
    }).toEqual({ quantity: 4, valueKgs: 40.072, averageKgs: 10.02, onHand: 4 });
    expect(
      movements.map((movement) => ({
        qtyDelta: movement.qtyDelta,
        unitCostKgs: Number(movement.unitCostKgs),
        lineTotalKgs: Number(movement.lineTotalKgs),
        inventoryValueDeltaKgs: Number(movement.inventoryValueDeltaKgs),
      })),
    ).toEqual([
      {
        qtyDelta: 2,
        unitCostKgs: 10.02,
        lineTotalKgs: 20.04,
        inventoryValueDeltaKgs: 20.036,
      },
      {
        qtyDelta: -3,
        unitCostKgs: 10.02,
        lineTotalKgs: -30.05,
        inventoryValueDeltaKgs: -30.054,
      },
    ]);
  });
});
